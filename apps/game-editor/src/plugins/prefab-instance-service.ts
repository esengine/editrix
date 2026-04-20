/**
 * Prefab authoring service — factory producing an {@link IPrefabService}.
 *
 * Owns the instance ↔ source relationship for `.esprefab`-derived entities in
 * the open scene. Responsibilities:
 *
 *   - **Create prefab from entity**: serialise an entity subtree into a
 *     `PrefabData` blob, pre-assign a UUID via the asset catalog `.meta`
 *     sidecar, write the `.esprefab` file, convert the live entity into an
 *     instance of the newly-saved prefab.
 *
 *   - **Instantiate prefab into scene**: load+flatten the source, allocate
 *     editor entity ids via {@link IECSSceneService.createEntity}, copy
 *     components / metadata / visibility / hierarchy onto the new entities,
 *     mark the subtree with `prefab:*` metadata so later machinery can find
 *     it.
 *
 *   - **Debounced override recompute**: every ECS mutation on an instance
 *     subtree is marked dirty; 100 ms later we re-run {@link diffAgainstSource}
 *     against the cached source and persist the resulting overrides to
 *     `prefab:overrides` metadata on the root. {@link IPrefabService.flushPendingOverrides}
 *     forces synchronous flush — called before scene save and on Play entry.
 *
 *   - **Structural hot reload**: when the source `.esprefab` file changes on
 *     disk, we flatten the new source with the current overrides and reconcile
 *     against the live instance node-by-node, preserving ECS ids for nodes
 *     that survive so selections / undo / outgoing entity refs all stay valid.
 *
 * The matching identity across reloads is the source prefab's
 * {@link PrefabEntityId} string, mirrored into each instance node's metadata
 * under {@link PREFAB_METADATA_KEYS.ENTITY_ID}.
 */

import type { DisposableStore } from '@editrix/common';
import { Emitter } from '@editrix/common';
import type { IFileSystemService } from '@editrix/core';
import type { IECSSceneService } from '@editrix/estella';
import type {
  FlattenContext,
  PrefabData,
  PrefabEntityData,
  PrefabEntityId,
  PrefabOverride,
  ProcessedEntity,
  SceneData,
} from '@editrix/scene';
import {
  diffAgainstSource,
  flattenPrefab,
  migratePrefabData,
  PREFAB_FORMAT_VERSION,
} from '@editrix/scene';
import type { IDocumentService, ISelectionService } from '@editrix/shell';
import type {
  IAssetCatalogService,
  IECSScenePresence,
  IPlayModeService,
  IPrefabService,
  IProjectService,
  PrefabEvent,
  PrefabInstanceInfo,
  PrefabOverrideRef,
} from '../services.js';
import { PREFAB_METADATA_KEYS } from '../services.js';

export interface PrefabServiceDeps {
  readonly presence: IECSScenePresence;
  readonly fileSystem: IFileSystemService;
  readonly project: IProjectService;
  readonly catalog: IAssetCatalogService;
  readonly playMode: IPlayModeService;
  readonly documentService: IDocumentService;
  readonly selection: ISelectionService;
  /**
   * Disposable bag the service adds its event subscriptions to. Lifetime
   * must at least equal the returned service's usage — typically the
   * plugin's `subscriptions`.
   */
  readonly subscriptions: DisposableStore;
}

const OVERRIDE_DEBOUNCE_MS = 100;

// Metadata keys the prefab service owns — excluded from diff so we don't
// treat our own bookkeeping as user overrides.
const PREFAB_META_KEYS_IGNORED_BY_DIFF: readonly string[] = [
  PREFAB_METADATA_KEYS.SOURCE,
  PREFAB_METADATA_KEYS.OVERRIDES,
  PREFAB_METADATA_KEYS.ENTITY_ID,
];

// Components handled out-of-band — excluded from prefab serialization and diff.
const NON_PREFAB_COMPONENTS: ReadonlySet<string> = new Set([
  'Parent',
  'Children',
  'Disabled', // carried via the top-level visible field
]);

/**
 * Transform property paths that, on the **instance root only**, are
 * considered "placement" rather than customization. Placing a prefab in
 * the world is the entire point of instantiating one — showing these as
 * blue-bar overrides on every moved instance is pure noise.
 *
 * Treatment:
 *   - Still persisted in `prefab:overrides` so the state survives scene
 *     round-trips + structural hot reload (the ECS otherwise gets its
 *     Transform reset to the source's 0,0 during flatten).
 *   - Excluded from the Inspector's override count + blue bar.
 *   - Excluded from `revertAll` (accidentally resetting position to 0,0
 *     is a destructive surprise — the user can re-place manually if
 *     they want).
 *   - Default-unchecked in the Apply-to-Source dialog, shown in a
 *     separate "Placement" group so the user understands they'd be
 *     baking a specific instance's placement into the source.
 *
 * Non-root children's Transforms are NOT placement — moving a part
 * inside a prefab is an intentional customization of the prefab's
 * visual design.
 */
const ROOT_PLACEMENT_PROPERTIES: ReadonlySet<string> = new Set([
  'position.x',
  'position.y',
  'position.z',
  'rotation.x',
  'rotation.y',
  'rotation.z',
  'rotation.w',
  'scale.x',
  'scale.y',
  'scale.z',
]);

function isPlacementOverride(o: PrefabOverride, rootPrefabEntityId: string): boolean {
  return (
    o.type === 'property' &&
    o.prefabEntityId === rootPrefabEntityId &&
    o.componentType === 'Transform' &&
    typeof o.propertyName === 'string' &&
    ROOT_PLACEMENT_PROPERTIES.has(o.propertyName)
  );
}

/**
 * Build the prefab authoring service. All state (caches, dirty queues,
 * override debouncers, ECS snapshots) is closed over inside this factory
 * — the returned object is a valid {@link IPrefabService} that the
 * plugin shell registers on the service registry.
 */
export function createPrefabInstanceService(deps: PrefabServiceDeps): IPrefabService {
  const { presence, fileSystem, project, catalog, playMode, documentService, selection } = deps;
  const subscriptions = deps.subscriptions;

  const onDidCreateInstance = new Emitter<PrefabEvent>();
  const onDidHotReload = new Emitter<{ sourceUuid: string; affectedRoots: readonly number[] }>();
  subscriptions.add(onDidCreateInstance);
  subscriptions.add(onDidHotReload);

  /** Cache of loaded+migrated prefab data keyed by source UUID. */
  const prefabCache = new Map<string, PrefabData>();

  const sourceCacheInvalidate = (uuid: string): void => {
    prefabCache.delete(uuid);
  };

  const loadSourcePrefab = async (sourceUuid: string): Promise<PrefabData | undefined> => {
    const cached = prefabCache.get(sourceUuid);
    if (cached) return cached;
    const asset = catalog.getByUuid(sourceUuid);
    if (!asset) return undefined;
    try {
      const text = await fileSystem.readFile(asset.absolutePath);
      const { data } = migratePrefabData(JSON.parse(text));
      prefabCache.set(sourceUuid, data);
      return data;
    } catch {
      return undefined;
    }
  };

  // ── Instance queries (pure metadata reads) ────────────────
  const getEcs = (): IECSSceneService | undefined => presence.current;

  const isInstanceRoot = (entityId: number): boolean => {
    const ecs = getEcs();
    if (!ecs) return false;
    return typeof ecs.getEntityMetadata(entityId, PREFAB_METADATA_KEYS.SOURCE) === 'string';
  };

  const findInstanceRoot = (entityId: number): number | undefined => {
    const ecs = getEcs();
    if (!ecs) return undefined;
    let current: number | null = entityId;
    while (current !== null) {
      if (isInstanceRoot(current)) return current;
      current = ecs.getParent(current);
    }
    return undefined;
  };

  const isInsideInstance = (entityId: number): boolean => findInstanceRoot(entityId) !== undefined;

  const getInstanceInfo = (entityId: number): PrefabInstanceInfo | undefined => {
    const ecs = getEcs();
    if (!ecs) return undefined;
    const rootId = findInstanceRoot(entityId);
    if (rootId === undefined) return undefined;
    const sourceUuid = ecs.getEntityMetadata(rootId, PREFAB_METADATA_KEYS.SOURCE) as string;
    const overrides =
      (ecs.getEntityMetadata(rootId, PREFAB_METADATA_KEYS.OVERRIDES) as
        | PrefabOverride[]
        | undefined) ?? [];
    const rootPid = ecs.getEntityMetadata(rootId, PREFAB_METADATA_KEYS.ENTITY_ID);
    const rootPidStr = typeof rootPid === 'string' ? rootPid : undefined;
    // Count only "real" overrides (customization), not placement.
    // Placement counts get shown separately in the Apply dialog.
    const nonPlacementCount =
      rootPidStr !== undefined
        ? overrides.filter((o) => !isPlacementOverride(o, rootPidStr)).length
        : overrides.length;
    const asset = catalog.getByUuid(sourceUuid);
    const sourceName = asset?.relativePath.split('/').pop() ?? sourceUuid;
    return { entityId: rootId, sourceUuid, sourceName, overrideCount: nonPlacementCount };
  };

  // ── ECS → ProcessedEntity extraction (for diff and hot reload) ──

  /**
   * Walk the live instance subtree rooted at {@link rootEntityId} and
   * shape it into the {@link ProcessedEntity} form diffAgainstSource
   * expects. Entities lacking a `prefab:entityId` are skipped — they
   * aren't part of the authored prefab (e.g. user-added siblings). Such
   * nodes need a separate design (variant-addition style) before they
   * can be represented; today they're silently ignored by the diff.
   */
  const extractInstanceState = (rootEntityId: number): ProcessedEntity[] => {
    const ecs = getEcs();
    if (!ecs) return [];
    const result: ProcessedEntity[] = [];
    const walk = (ecsId: number, parentEcsId: number | null): void => {
      const prefabEntityId = ecs.getEntityMetadata(ecsId, PREFAB_METADATA_KEYS.ENTITY_ID);
      if (typeof prefabEntityId !== 'string') return;

      const components = ecs
        .getComponents(ecsId)
        .filter((name) => !NON_PREFAB_COMPONENTS.has(name))
        .map((name) => ({ type: name, data: ecs.getComponentData(ecsId, name) }));

      // Normalise asset fields: the authoritative ref lives in
      // `asset:Comp.field` metadata (UUID), the numeric handle is
      // session-specific runtime state. The source prefab also
      // stores 0 for these (see buildPrefabData), so zeroing here
      // keeps diff comparing apples-to-apples and prevents a
      // noise-override on every texture-using instance.
      for (const comp of components) {
        const schema = ecs.getComponentSchema(comp.type);
        for (const field of schema) {
          if (field.type === 'asset') comp.data[field.key] = 0;
        }
      }

      const metadata: Record<string, unknown> = {};
      for (const key of ecs.getEntityMetadataKeys(ecsId)) {
        if (PREFAB_META_KEYS_IGNORED_BY_DIFF.includes(key)) continue;
        metadata[key] = ecs.getEntityMetadata(ecsId, key);
      }

      const children = ecs.getChildren(ecsId);
      const entity: ProcessedEntity = {
        id: ecsId,
        prefabEntityId,
        name: ecs.getName(ecsId),
        parent: parentEcsId,
        children: [...children],
        components,
        visible: ecs.getVisible(ecsId),
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      };
      result.push(entity);
      for (const childId of children) walk(childId, ecsId);
    };
    walk(rootEntityId, ecs.getParent(rootEntityId));
    return result;
  };

  // ── Entity → PrefabEntityData (createPrefab) ─────────────

  const randomPrefabEntityId = (): PrefabEntityId => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    // Fallback — non-crypto rng is acceptable because the only
    // requirement is uniqueness within the file.
    return `pid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  };

  const buildPrefabData = (rootEntityId: number, name: string): PrefabData => {
    const ecs = getEcs();
    if (!ecs) throw new Error('ECS not ready');
    const ecsToPrefabId = new Map<number, PrefabEntityId>();

    // Pass 1: assign prefab ids to every entity in the subtree.
    const collect = (ecsId: number): void => {
      ecsToPrefabId.set(ecsId, randomPrefabEntityId());
      for (const childId of ecs.getChildren(ecsId)) collect(childId);
    };
    collect(rootEntityId);

    // Pass 2: build PrefabEntityData rows.
    const entities: PrefabEntityData[] = [];
    const build = (ecsId: number, parentEcsId: number | null): void => {
      const prefabEntityId = ecsToPrefabId.get(ecsId);
      if (prefabEntityId === undefined) return;
      const parentPrefabId = parentEcsId !== null ? (ecsToPrefabId.get(parentEcsId) ?? null) : null;

      const components = ecs
        .getComponents(ecsId)
        .filter((name) => !NON_PREFAB_COMPONENTS.has(name))
        .map((name) => ({ type: name, data: ecs.getComponentData(ecsId, name) }));

      // Remap entity refs in component data: runtime ids → prefab
      // entity ids. Zero out asset handles: the authoritative ref
      // is the `asset:Comp.field` metadata (UUID-based); the
      // numeric handle is session-specific and writing it to a
      // new session's ECS either does nothing or points at the
      // wrong texture. See `writeComponentFields` for the read
      // side of this contract.
      for (const comp of components) {
        const schema = ecs.getComponentSchema(comp.type);
        for (const field of schema) {
          if (field.type === 'entity') {
            const value = comp.data[field.key];
            if (typeof value !== 'number' || value === 0) continue;
            const mapped = ecsToPrefabId.get(value);
            comp.data[field.key] = mapped !== undefined ? (mapped as unknown as number) : 0;
          } else if (field.type === 'asset') {
            comp.data[field.key] = 0;
          }
        }
      }

      const metadata: Record<string, unknown> = {};
      for (const key of ecs.getEntityMetadataKeys(ecsId)) {
        if (PREFAB_META_KEYS_IGNORED_BY_DIFF.includes(key)) continue;
        metadata[key] = ecs.getEntityMetadata(ecsId, key);
      }

      const children = ecs
        .getChildren(ecsId)
        .map((id) => ecsToPrefabId.get(id))
        .filter((id): id is PrefabEntityId => id !== undefined);

      entities.push({
        prefabEntityId,
        name: ecs.getName(ecsId),
        parent: parentPrefabId,
        children,
        components,
        visible: ecs.getVisible(ecsId),
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      });
      for (const childId of ecs.getChildren(ecsId)) build(childId, ecsId);
    };
    build(rootEntityId, null);

    const rootPrefabId = ecsToPrefabId.get(rootEntityId);
    if (rootPrefabId === undefined) throw new Error('Failed to assign prefab id to root');
    return {
      version: PREFAB_FORMAT_VERSION,
      name,
      rootEntityId: rootPrefabId,
      entities,
    };
  };

  // ── createPrefab ─────────────────────────────────────────

  const createPrefab = async (entityId: number, filePath: string): Promise<string> => {
    const ecs = getEcs();
    if (!ecs) throw new Error('ECS not ready');
    if (isInstanceRoot(entityId) || isInsideInstance(entityId)) {
      throw new Error(
        'Cannot create a prefab from an entity that is already part of a prefab instance.',
      );
    }

    const name = ecs.getName(entityId) || 'Prefab';
    const prefabData = buildPrefabData(entityId, name);

    // Pre-assign UUID via .meta sidecar so the catalog uses ours when
    // it scans. Without this the new file would get a fresh UUID on
    // scan, and we'd have to wait for the async scan to link the
    // instance — racy and user-visible.
    const uuid = randomPrefabEntityId(); // UUID v4 shape is fine for asset UUIDs too
    const metaPath = `${filePath}.meta`;
    const metaDoc = { uuid, version: 1, importer: {} };
    await fileSystem.writeFile(metaPath, JSON.stringify(metaDoc, null, 2) + '\n');
    await fileSystem.writeFile(filePath, JSON.stringify(prefabData, null, 2) + '\n');

    // Seed the cache so hot-reload doesn't re-fetch immediately.
    prefabCache.set(uuid, prefabData);

    // Convert the live entity into an instance of the new prefab.
    // buildPrefabData walked the subtree in DFS order and pushed
    // entities[] in that same order; replay the walk and pop each
    // prefabEntityId off a queue to tag the corresponding live node.
    const prefabIdQueue = prefabData.entities.map((e) => e.prefabEntityId);
    let cursor = 0;
    const tag = (ecsId: number): void => {
      const pid = prefabIdQueue[cursor++];
      if (pid !== undefined) {
        ecs.setEntityMetadata(ecsId, PREFAB_METADATA_KEYS.ENTITY_ID, pid);
      }
      for (const childId of ecs.getChildren(ecsId)) tag(childId);
    };
    tag(entityId);

    ecs.setEntityMetadata(entityId, PREFAB_METADATA_KEYS.SOURCE, uuid);
    ecs.setEntityMetadata(entityId, PREFAB_METADATA_KEYS.OVERRIDES, []);

    onDidCreateInstance.fire({ entityId });
    return uuid;
  };

  // ── instantiate ──────────────────────────────────────────

  /**
   * Resolve `@uuid:<uuid>` or a project-relative path to the matching
   * catalog UUID, or undefined if neither form resolves.
   */
  const uuidFromRef = (ref: string): string | undefined => {
    if (ref.startsWith('@uuid:')) return ref.slice('@uuid:'.length);
    const asset = catalog.getByPath(ref);
    return asset?.uuid;
  };

  /**
   * Walk a prefab's base-chain + nested-prefab references, loading each
   * one into a cache keyed by the form the authored `basePrefab` /
   * `prefabPath` string uses (typically `@uuid:<uuid>`). The returned
   * map is safe to hand to a synchronous `FlattenContext.loadPrefab`.
   */
  const preloadPrefabGraph = async (sourceUuid: string): Promise<Map<string, PrefabData>> => {
    const graph = new Map<string, PrefabData>();
    const visit = async (uuid: string | undefined, refKey: string | undefined): Promise<void> => {
      if (uuid === undefined) return;
      const key = refKey ?? `@uuid:${uuid}`;
      if (graph.has(key)) return;
      const data = await loadSourcePrefab(uuid);
      if (!data) return;
      graph.set(key, data);
      // Also index under the raw uuid key so any authored ref
      // form (`@uuid:...`, relative path) we haven't seen yet can
      // still hit when flatten does ctx.loadPrefab.
      graph.set(`@uuid:${uuid}`, data);
      if (data.basePrefab) {
        await visit(uuidFromRef(data.basePrefab), data.basePrefab);
      }
      for (const e of data.entities) {
        if (e.nestedPrefab) {
          await visit(uuidFromRef(e.nestedPrefab.prefabPath), e.nestedPrefab.prefabPath);
        }
      }
    };
    await visit(sourceUuid, `@uuid:${sourceUuid}`);
    return graph;
  };

  const flattenWithPlaceholderIds = (
    prefab: PrefabData,
    graph?: ReadonlyMap<string, PrefabData>,
  ): { entities: ProcessedEntity[]; rootId: number } => {
    let counter = 1;
    const allocateId = (): number => counter++;
    const flattenCtx: FlattenContext = {
      allocateId,
      loadPrefab: (path) => graph?.get(path) ?? null,
      visited: new Set(),
    };
    return flattenPrefab(prefab, [], flattenCtx);
  };

  /**
   * Write a {@link ProcessedEntity} tree into the live {@link ECSSceneService},
   * returning a map from the flattener's placeholder ids to the newly
   * allocated editor entity ids.
   */
  const materializeFlattened = (
    ecs: IECSSceneService,
    flat: readonly ProcessedEntity[],
    rootPlaceholder: number,
    instanceParent: number | undefined,
    sourceUuid: string,
  ): { rootEntityId: number; idMap: Map<number, number> } => {
    const idMap = new Map<number, number>();

    // Topological order: parents before children. The flattener
    // produces a list but not necessarily in tree order; sort so
    // root comes first, then descendants.
    const byPlaceholder = new Map<number, ProcessedEntity>();
    for (const e of flat) byPlaceholder.set(e.id, e);

    const ordered: ProcessedEntity[] = [];
    const visit = (placeholder: number): void => {
      const entry = byPlaceholder.get(placeholder);
      if (!entry) return;
      ordered.push(entry);
      for (const childPh of entry.children) visit(childPh);
    };
    visit(rootPlaceholder);

    for (const e of ordered) {
      const parentEcs =
        e.id === rootPlaceholder
          ? instanceParent
          : e.parent !== null
            ? idMap.get(e.parent)
            : undefined;
      const ecsId = ecs.createEntity(e.name, parentEcs);
      idMap.set(e.id, ecsId);

      // Remap entity-typed component fields before writing.
      for (const comp of e.components) {
        const schema = ecs.getComponentSchema(comp.type);
        for (const field of schema) {
          if (field.type !== 'entity') continue;
          const value = comp.data[field.key];
          if (typeof value !== 'number' || value === 0) continue;
          const mapped = idMap.get(value);
          comp.data[field.key] = mapped ?? 0;
        }
      }

      for (const comp of e.components) {
        if (comp.type === 'Transform') {
          // Transform is auto-added by createEntity; just set properties.
          writeComponentFields(ecs, ecsId, comp.type, comp.data);
          continue;
        }
        ecs.addComponent(ecsId, comp.type);
        writeComponentFields(ecs, ecsId, comp.type, comp.data);
      }

      if (!e.visible) ecs.setVisible(ecsId, false);

      if (e.metadata) {
        for (const [k, v] of Object.entries(e.metadata)) {
          ecs.setEntityMetadata(ecsId, k, v);
        }
      }

      // Tag every instance node with its prefab entity id so later
      // diff / hot-reload can match it. The root gets source + overrides.
      ecs.setEntityMetadata(ecsId, PREFAB_METADATA_KEYS.ENTITY_ID, e.prefabEntityId);
      if (e.id === rootPlaceholder) {
        ecs.setEntityMetadata(ecsId, PREFAB_METADATA_KEYS.SOURCE, sourceUuid);
        ecs.setEntityMetadata(ecsId, PREFAB_METADATA_KEYS.OVERRIDES, []);
      }
    }

    const rootEntityId = idMap.get(rootPlaceholder);
    if (rootEntityId === undefined) throw new Error('Failed to materialize prefab root');
    return { rootEntityId, idMap };
  };

  const writeComponentFields = (
    ecs: IECSSceneService,
    entityId: number,
    componentType: string,
    data: Record<string, unknown>,
  ): void => {
    const schema = ecs.getComponentSchema(componentType);
    for (const field of schema) {
      // Asset fields store a runtime texture/material/font handle
      // (an int packed as {generation, index}). That handle is
      // only valid within the session that minted it — writing
      // a prefab-file-captured handle into a new session's ECS
      // would point at the wrong slot, or nothing at all. The
      // authoritative ref lives in `asset:Comp.field` metadata
      // (a UUID), which ImageImporterPlugin reads to resolve
      // the current-session handle. Skip the stale number here
      // and let the metadata subscription do the write.
      if (field.type === 'asset') continue;
      const value = data[field.key];
      if (value === undefined) continue;
      ecs.setProperty(entityId, componentType, field.key, value);
    }
    // Copy fields that aren't in the schema (e.g. nested dict values
    // for Vec-style defaults) verbatim — schema-driven setters may
    // miss author-overridden sub-fields that weren't expanded.
    for (const [key, value] of Object.entries(data)) {
      if (schema.some((f) => f.key === key)) continue;
      if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
        ecs.setProperty(entityId, componentType, key, value);
      }
    }
  };

  const instantiate = async (
    sourceUuid: string,
    options?: { parent?: number; position?: { x: number; y: number } },
  ): Promise<number> => {
    const ecs = getEcs();
    if (!ecs) throw new Error('ECS not ready');
    const source = await loadSourcePrefab(sourceUuid);
    if (!source) throw new Error(`Prefab source not found: ${sourceUuid}`);
    const graph = await preloadPrefabGraph(sourceUuid);

    const { entities, rootId } = flattenWithPlaceholderIds(source, graph);
    const { rootEntityId } = materializeFlattened(
      ecs,
      entities,
      rootId,
      options?.parent,
      sourceUuid,
    );

    if (options?.position) {
      ecs.setProperty(rootEntityId, 'Transform', 'position.x', options.position.x);
      ecs.setProperty(rootEntityId, 'Transform', 'position.y', options.position.y);
    }

    onDidCreateInstance.fire({ entityId: rootEntityId });
    return rootEntityId;
  };

  // ── Debounced override recompute ─────────────────────────

  const dirtyRoots = new Set<number>();
  let debounceHandle: ReturnType<typeof setTimeout> | undefined;
  // Reentrancy guard: we write `prefab:overrides` back via
  // setEntityMetadata, which fires onMetadataChanged. Without a guard
  // that write re-schedules a flush and we'd oscillate.
  let suppressDirty = false;

  const markInstanceDirty = (entityId: number): void => {
    if (suppressDirty) return;
    const rootId = findInstanceRoot(entityId);
    if (rootId === undefined) return;
    dirtyRoots.add(rootId);
    if (debounceHandle) clearTimeout(debounceHandle);
    debounceHandle = setTimeout(() => {
      debounceHandle = undefined;
      flushOverrides();
    }, OVERRIDE_DEBOUNCE_MS);
  };

  const recomputeOverridesFor = async (rootId: number): Promise<void> => {
    const ecs = getEcs();
    if (!ecs) return;
    const sourceUuid = ecs.getEntityMetadata(rootId, PREFAB_METADATA_KEYS.SOURCE);
    if (typeof sourceUuid !== 'string') return;
    const source = await loadSourcePrefab(sourceUuid);
    if (!source) return;
    const instance = extractInstanceState(rootId);
    const { overrides } = diffAgainstSource(source, instance, {
      ignoreMetadataKeys: PREFAB_META_KEYS_IGNORED_BY_DIFF,
    });
    suppressDirty = true;
    try {
      ecs.setEntityMetadata(rootId, PREFAB_METADATA_KEYS.OVERRIDES, overrides);
    } finally {
      suppressDirty = false;
    }
  };

  const flushOverrides = (): void => {
    if (debounceHandle) {
      clearTimeout(debounceHandle);
      debounceHandle = undefined;
    }
    const toProcess = [...dirtyRoots];
    dirtyRoots.clear();
    // Fire-and-forget: the fs/catalog calls inside recompute are
    // editor-local and don't need backpressure. Errors are swallowed
    // (warning goes through console via the cache miss path).
    for (const rootId of toProcess) {
      void recomputeOverridesFor(rootId);
    }
  };

  // ── Structural hot reload on source change ───────────────

  const findAllInstanceRootsOf = (sourceUuid: string): number[] => {
    const ecs = getEcs();
    if (!ecs) return [];
    const roots: number[] = [];
    const walk = (ecsId: number): void => {
      if (ecs.getEntityMetadata(ecsId, PREFAB_METADATA_KEYS.SOURCE) === sourceUuid) {
        roots.push(ecsId);
        // Don't recurse into instance subtrees — nested
        // instances handled separately.
        return;
      }
      for (const childId of ecs.getChildren(ecsId)) walk(childId);
    };
    for (const rootId of ecs.getRootEntities()) walk(rootId);
    return roots;
  };

  /**
   * Reconcile a live instance against a new version of its source,
   * preserving ECS ids for any node whose `prefabEntityId` survives.
   * This is the cheap version: we don't diff component-by-component,
   * we wholesale replace components on surviving nodes. A future pass
   * can refine this to per-field deltas for minimal Inspector churn.
   */
  const structuralReload = (
    rootId: number,
    newSource: PrefabData,
    graph?: ReadonlyMap<string, PrefabData>,
  ): void => {
    const ecs = getEcs();
    if (!ecs) return;

    const overrides =
      (ecs.getEntityMetadata(rootId, PREFAB_METADATA_KEYS.OVERRIDES) as
        | PrefabOverride[]
        | undefined) ?? [];
    const { entities: newFlat, rootId: newRootPlaceholder } = (() => {
      let counter = 1;
      const ctx: FlattenContext = {
        allocateId: () => counter++,
        loadPrefab: (path) => graph?.get(path) ?? null,
        visited: new Set(),
      };
      return flattenPrefab(newSource, overrides, ctx);
    })();

    // Index old subtree: prefabEntityId → ecs entity id
    const oldByPrefabId = new Map<PrefabEntityId, number>();
    const indexOld = (ecsId: number): void => {
      const pid = ecs.getEntityMetadata(ecsId, PREFAB_METADATA_KEYS.ENTITY_ID);
      if (typeof pid === 'string') oldByPrefabId.set(pid, ecsId);
      for (const childId of ecs.getChildren(ecsId)) indexOld(childId);
    };
    indexOld(rootId);

    // Index new subtree: prefabEntityId → ProcessedEntity
    const newByPrefabId = new Map<PrefabEntityId, ProcessedEntity>();
    for (const e of newFlat) newByPrefabId.set(e.prefabEntityId, e);

    const newRoot = newFlat.find((e) => e.id === newRootPlaceholder);
    if (!newRoot) return;
    // Sanity: new root's prefabEntityId must match the current root's.
    const oldRootPid = ecs.getEntityMetadata(rootId, PREFAB_METADATA_KEYS.ENTITY_ID);
    if (oldRootPid !== newRoot.prefabEntityId) {
      // Source root changed identity — safer to reinstantiate
      // wholesale than attempt reconciliation.
      fullReinstantiate(rootId, newSource, graph);
      return;
    }

    suppressDirty = true;
    try {
      // Phase 1: destroy old nodes that aren't in the new prefab.
      for (const [pid, ecsId] of oldByPrefabId) {
        if (!newByPrefabId.has(pid)) {
          ecs.destroyEntity(ecsId);
          oldByPrefabId.delete(pid);
        }
      }

      // Phase 2: create new nodes that weren't in the old prefab
      // (variant additions or brand-new source nodes). We create
      // them in topological order (parents first).
      const createdInOrder: ProcessedEntity[] = [];
      const addIfNew = (pe: ProcessedEntity): void => {
        if (oldByPrefabId.has(pe.prefabEntityId)) return;
        createdInOrder.push(pe);
        for (const childPh of pe.children) {
          const child = newFlat.find((e) => e.id === childPh);
          if (child) addIfNew(child);
        }
      };
      for (const pe of newFlat) {
        if (!createdInOrder.includes(pe)) addIfNew(pe);
      }
      // Filter out duplicates + ensure root already exists (it
      // survives by definition since old root's pid matched).
      for (const pe of createdInOrder) {
        const parentPlaceholder = pe.parent;
        let parentEcs: number | undefined;
        if (parentPlaceholder !== null) {
          const parentPrefab = newFlat.find((e) => e.id === parentPlaceholder);
          if (parentPrefab) parentEcs = oldByPrefabId.get(parentPrefab.prefabEntityId);
        }
        const newEcsId = ecs.createEntity(pe.name, parentEcs);
        oldByPrefabId.set(pe.prefabEntityId, newEcsId);
      }

      // Phase 3: for every (surviving + newly-created) node, apply
      // the authored state from the new prefab. Component set:
      // replace wholesale (remove components no longer present;
      // add/upsert components that are). Then name/visibility/metadata.
      for (const [pid, ecsId] of oldByPrefabId) {
        const pe = newByPrefabId.get(pid);
        if (!pe) continue;

        // Remap entity refs in component data from placeholder
        // runtime ids to real ecs ids via oldByPrefabId lookup
        // through newFlat index.
        const remappedComponents = pe.components.map((c) => ({
          type: c.type,
          data: { ...c.data },
        }));
        for (const comp of remappedComponents) {
          const schema = ecs.getComponentSchema(comp.type);
          for (const field of schema) {
            if (field.type !== 'entity') continue;
            const value = comp.data[field.key];
            if (typeof value !== 'number' || value === 0) continue;
            // `value` is a flatten placeholder id; map back
            // via newFlat (placeholder → ProcessedEntity).
            const target = newFlat.find((e) => e.id === value);
            if (!target) {
              comp.data[field.key] = 0;
              continue;
            }
            const ecsRef = oldByPrefabId.get(target.prefabEntityId);
            comp.data[field.key] = ecsRef ?? 0;
          }
        }

        const currentComponents = new Set(ecs.getComponents(ecsId));
        const desiredComponents = new Set(remappedComponents.map((c) => c.type));
        // Remove components that are no longer desired (skip plumbing).
        for (const name of currentComponents) {
          if (NON_PREFAB_COMPONENTS.has(name)) continue;
          if (!desiredComponents.has(name)) ecs.removeComponent(ecsId, name);
        }
        // Add+write each desired component.
        for (const comp of remappedComponents) {
          if (!ecs.hasComponent(ecsId, comp.type)) ecs.addComponent(ecsId, comp.type);
          writeComponentFields(ecs, ecsId, comp.type, comp.data);
        }

        ecs.setName(ecsId, pe.name);
        ecs.setVisible(ecsId, pe.visible);

        // Reset metadata: clear prior authored keys, reapply new
        // authored set. `prefab:*` service-owned keys are preserved.
        for (const key of ecs.getEntityMetadataKeys(ecsId)) {
          if (PREFAB_META_KEYS_IGNORED_BY_DIFF.includes(key)) continue;
          ecs.setEntityMetadata(ecsId, key, undefined);
        }
        if (pe.metadata) {
          for (const [k, v] of Object.entries(pe.metadata)) {
            ecs.setEntityMetadata(ecsId, k, v);
          }
        }
        ecs.setEntityMetadata(ecsId, PREFAB_METADATA_KEYS.ENTITY_ID, pe.prefabEntityId);
      }
    } finally {
      suppressDirty = false;
    }
  };

  const fullReinstantiate = (
    rootId: number,
    newSource: PrefabData,
    graph?: ReadonlyMap<string, PrefabData>,
  ): void => {
    const ecs = getEcs();
    if (!ecs) return;
    const overrides =
      (ecs.getEntityMetadata(rootId, PREFAB_METADATA_KEYS.OVERRIDES) as
        | PrefabOverride[]
        | undefined) ?? [];
    const parent = ecs.getParent(rootId);
    const sourceUuid = ecs.getEntityMetadata(rootId, PREFAB_METADATA_KEYS.SOURCE) as
      | string
      | undefined;
    if (typeof sourceUuid !== 'string') return;
    // Capture source BEFORE destroying — the metadata vanishes with the entity.
    ecs.destroyEntity(rootId);
    const { entities, rootId: placeholder } = flattenWithPlaceholderIds(newSource, graph);
    const { rootEntityId: newRoot } = materializeFlattened(
      ecs,
      entities,
      placeholder,
      parent ?? undefined,
      sourceUuid,
    );
    // Reapply overrides as the live state — they'll be recomputed
    // by the debounce on next mutation.
    ecs.setEntityMetadata(newRoot, PREFAB_METADATA_KEYS.OVERRIDES, overrides);
  };

  const hotReload = async (sourceUuid: string): Promise<void> => {
    sourceCacheInvalidate(sourceUuid);
    const source = await loadSourcePrefab(sourceUuid);
    if (!source) return;
    const graph = await preloadPrefabGraph(sourceUuid);
    const roots = findAllInstanceRootsOf(sourceUuid);
    for (const rootId of roots) {
      structuralReload(rootId, source, graph);
    }
    onDidHotReload.fire({ sourceUuid, affectedRoots: roots });
  };

  // ── Event wiring ─────────────────────────────────────────

  const wireMutationWatchers = (ecs: IECSSceneService): void => {
    subscriptions.add(
      ecs.onPropertyChanged((ev) => {
        markInstanceDirty(ev.entityId);
      }),
    );
    subscriptions.add(
      ecs.onComponentAdded((ev) => {
        markInstanceDirty(ev.entityId);
      }),
    );
    subscriptions.add(
      ecs.onComponentRemoved((ev) => {
        markInstanceDirty(ev.entityId);
      }),
    );
    subscriptions.add(
      ecs.onVisibilityChanged((ev) => {
        markInstanceDirty(ev.entityId);
      }),
    );
    subscriptions.add(
      ecs.onMetadataChanged((ev) => {
        if (PREFAB_META_KEYS_IGNORED_BY_DIFF.includes(ev.key)) return;
        markInstanceDirty(ev.entityId);
      }),
    );
    subscriptions.add(
      ecs.onHierarchyChanged(() => {
        // Mark every known instance root — a move could have landed
        // inside any of them.
        const roots = new Set<number>();
        const walk = (ecsId: number): void => {
          if (typeof ecs.getEntityMetadata(ecsId, PREFAB_METADATA_KEYS.SOURCE) === 'string') {
            roots.add(ecsId);
            return;
          }
          for (const childId of ecs.getChildren(ecsId)) walk(childId);
        };
        for (const rootId of ecs.getRootEntities()) walk(rootId);
        for (const rootId of roots) dirtyRoots.add(rootId);
        if (roots.size > 0) {
          if (debounceHandle) clearTimeout(debounceHandle);
          debounceHandle = setTimeout(() => {
            debounceHandle = undefined;
            flushOverrides();
          }, OVERRIDE_DEBOUNCE_MS);
        }
      }),
    );
  };

  if (presence.current) {
    wireMutationWatchers(presence.current);
  } else {
    subscriptions.add(
      presence.onDidBind((ecs) => {
        wireMutationWatchers(ecs);
      }),
    );
  }

  // Catalog changes → hot reload
  subscriptions.add(
    catalog.onDidChange((change) => {
      if (change.kind === 'removed') {
        sourceCacheInvalidate(change.uuid);
        return;
      }
      const asset = change.asset;
      if (!asset.relativePath.endsWith('.esprefab')) return;
      if (change.kind === 'added') {
        // No live instances to reload yet. Just warm the cache lazily
        // on first instantiate.
        return;
      }
      void hotReload(asset.uuid);
    }),
  );

  // Flush on Play entry so snapshot captures fresh overrides.
  subscriptions.add(
    playMode.onDidChangeMode((ev) => {
      if (ev.current !== 'edit') flushOverrides();
    }),
  );

  // ── Override queries (Inspector decorations) ─────────────

  /**
   * The `prefab:entityId` string that identifies the instance root
   * an entity belongs to, or undefined if the entity isn't inside an
   * instance. Used to gate {@link isPlacementOverride} — placement is
   * only special on the root, not on child entities.
   */
  const getInstanceRootPrefabId = (entityId: number): string | undefined => {
    const ecs = getEcs();
    if (!ecs) return undefined;
    const rootId = findInstanceRoot(entityId);
    if (rootId === undefined) return undefined;
    const pid = ecs.getEntityMetadata(rootId, PREFAB_METADATA_KEYS.ENTITY_ID);
    return typeof pid === 'string' ? pid : undefined;
  };

  /**
   * All overrides authored on the instance root that target the entity
   * with the matching `prefab:entityId`. Flushing first guarantees
   * callers see overrides reflecting the live state, not the last
   * debounce window. Placement overrides (root Transform pos/rot/scale)
   * are filtered by default; pass `{ includePlacement: true }` to
   * include them (used by the Apply dialog's "Placement" group).
   */
  const getOverridesForEntity = (
    entityId: number,
    options?: { includePlacement?: boolean },
  ): PrefabOverride[] => {
    flushOverrides();
    const ecs = getEcs();
    if (!ecs) return [];
    const rootId = findInstanceRoot(entityId);
    if (rootId === undefined) return [];
    const overrides =
      (ecs.getEntityMetadata(rootId, PREFAB_METADATA_KEYS.OVERRIDES) as
        | PrefabOverride[]
        | undefined) ?? [];
    const pid = ecs.getEntityMetadata(entityId, PREFAB_METADATA_KEYS.ENTITY_ID);
    if (typeof pid !== 'string') return [];
    const forEntity = overrides.filter((o) => o.prefabEntityId === pid);
    if (options?.includePlacement === true) return forEntity;
    const rootPid = getInstanceRootPrefabId(entityId);
    if (rootPid === undefined) return forEntity;
    return forEntity.filter((o) => !isPlacementOverride(o, rootPid));
  };

  const getOverriddenFieldKeys = (entityId: number): ReadonlySet<string> => {
    const keys = new Set<string>();
    for (const o of getOverridesForEntity(entityId)) {
      if (o.type === 'property' && o.componentType && o.propertyName !== undefined) {
        keys.add(`${o.componentType}.${o.propertyName}`);
      }
    }
    return keys;
  };

  const isComponentOverridden = (entityId: number, componentType: string): boolean => {
    for (const o of getOverridesForEntity(entityId)) {
      if (
        (o.type === 'component_added' ||
          o.type === 'component_replaced' ||
          o.type === 'component_removed') &&
        (o.componentType === componentType || o.componentData?.type === componentType)
      ) {
        return true;
      }
    }
    return false;
  };

  /**
   * Look up the canonical source value for a field on an instance
   * entity. Pure read — never mutates state. Used by Inspector
   * tooltips so the user can see what they deviated from without
   * having to mentally undo their edits.
   */
  const getSourceFieldValue = (
    entityId: number,
    componentType: string,
    fieldPath: string,
  ): unknown => {
    const ecs = getEcs();
    if (!ecs) return undefined;
    const rootId = findInstanceRoot(entityId);
    if (rootId === undefined) return undefined;
    const sourceUuid = ecs.getEntityMetadata(rootId, PREFAB_METADATA_KEYS.SOURCE);
    if (typeof sourceUuid !== 'string') return undefined;
    const source = prefabCache.get(sourceUuid);
    if (!source) return undefined;
    const pid = ecs.getEntityMetadata(entityId, PREFAB_METADATA_KEYS.ENTITY_ID);
    if (typeof pid !== 'string') return undefined;
    const sourceEntity = source.entities.find((e) => e.prefabEntityId === pid);
    if (!sourceEntity) return undefined;
    const comp = sourceEntity.components.find((c) => c.type === componentType);
    if (!comp) return undefined;
    return comp.data[fieldPath];
  };

  const isMetadataOverridden = (entityId: number, metadataKey: string): boolean => {
    for (const o of getOverridesForEntity(entityId)) {
      if (
        (o.type === 'metadata_set' || o.type === 'metadata_removed') &&
        o.metadataKey === metadataKey
      ) {
        return true;
      }
    }
    return false;
  };

  // ── Revert paths (re-run structural reload with filtered overrides) ──

  /**
   * Remove overrides matching {@link predicate} from the instance root's
   * stored list, then re-run the structural reconciler so the live
   * entity values snap back to whatever the source prefab says. This
   * keeps the revert-to-source semantic identical to the reload path
   * (single source of truth for "how do overrides get applied"), so
   * edge cases like nested component removal inside variants fall out
   * for free instead of needing a bespoke imperative revert.
   */
  const revertBy = (entityId: number, predicate: (o: PrefabOverride) => boolean): void => {
    flushOverrides();
    const ecs = getEcs();
    if (!ecs) return;
    const rootId = findInstanceRoot(entityId);
    if (rootId === undefined) return;
    const sourceUuid = ecs.getEntityMetadata(rootId, PREFAB_METADATA_KEYS.SOURCE);
    if (typeof sourceUuid !== 'string') return;
    const source = prefabCache.get(sourceUuid);
    if (!source) {
      // Source not cached yet; kick an async load-and-retry. The
      // editor normally has the source warm by the time any
      // revert UI appears, but new scene opens haven't hit the
      // instance yet.
      void (async (): Promise<void> => {
        const loaded = await loadSourcePrefab(sourceUuid);
        if (loaded) revertBy(entityId, predicate);
      })();
      return;
    }
    const overrides =
      (ecs.getEntityMetadata(rootId, PREFAB_METADATA_KEYS.OVERRIDES) as
        | PrefabOverride[]
        | undefined) ?? [];
    const filtered = overrides.filter((o) => !predicate(o));
    if (filtered.length === overrides.length) return; // nothing matched

    suppressDirty = true;
    try {
      ecs.setEntityMetadata(rootId, PREFAB_METADATA_KEYS.OVERRIDES, filtered);
    } finally {
      suppressDirty = false;
    }
    // Revert may be triggered against a variant; preload its chain
    // before reconciling so additions from the base / base-of-base
    // still flow through.
    void (async (): Promise<void> => {
      const graph = await preloadPrefabGraph(sourceUuid);
      structuralReload(rootId, source, graph);
    })();
  };

  const revertPropertyOverride = (
    entityId: number,
    componentType: string,
    fieldPath: string,
  ): void => {
    const ecs = getEcs();
    if (!ecs) return;
    const pid = ecs.getEntityMetadata(entityId, PREFAB_METADATA_KEYS.ENTITY_ID);
    if (typeof pid !== 'string') return;
    revertBy(
      entityId,
      (o) =>
        o.prefabEntityId === pid &&
        o.type === 'property' &&
        o.componentType === componentType &&
        o.propertyName === fieldPath,
    );
  };

  const revertComponentOverride = (entityId: number, componentType: string): void => {
    const ecs = getEcs();
    if (!ecs) return;
    const pid = ecs.getEntityMetadata(entityId, PREFAB_METADATA_KEYS.ENTITY_ID);
    if (typeof pid !== 'string') return;
    revertBy(
      entityId,
      (o) =>
        o.prefabEntityId === pid &&
        ((o.type === 'component_added' && o.componentData?.type === componentType) ||
          (o.type === 'component_replaced' && o.componentData?.type === componentType) ||
          (o.type === 'component_removed' && o.componentType === componentType) ||
          // Also sweep any stray property overrides on the same
          // component — reverting the whole component and leaving
          // per-field overrides behind on the removed component
          // would be incoherent.
          (o.type === 'property' && o.componentType === componentType)),
    );
  };

  const revertMetadataOverride = (entityId: number, metadataKey: string): void => {
    const ecs = getEcs();
    if (!ecs) return;
    const pid = ecs.getEntityMetadata(entityId, PREFAB_METADATA_KEYS.ENTITY_ID);
    if (typeof pid !== 'string') return;
    revertBy(
      entityId,
      (o) =>
        o.prefabEntityId === pid &&
        (o.type === 'metadata_set' || o.type === 'metadata_removed') &&
        o.metadataKey === metadataKey,
    );
  };

  const revertAll = (entityId: number): void => {
    // "Revert All" reverts only customizations, not placement.
    // Resetting an instance's position/rotation/scale to the
    // source's 0,0 values is a destructive surprise — the user
    // can reposition manually if that's what they actually want.
    const rootPid = getInstanceRootPrefabId(entityId);
    if (rootPid === undefined) {
      revertBy(entityId, () => true);
      return;
    }
    revertBy(entityId, (o) => !isPlacementOverride(o, rootPid));
  };

  // ── Apply to Source (bake overrides into the prefab file) ────

  /** Mutate a source prefab's entities in place to bake an override. */
  const bakeOverride = (source: PrefabData, override: PrefabOverride): void => {
    const target = source.entities.find((e) => e.prefabEntityId === override.prefabEntityId);
    if (!target) return;
    switch (override.type) {
      case 'name':
        if (typeof override.value === 'string') target.name = override.value;
        break;
      case 'visibility':
        if (typeof override.value === 'boolean') target.visible = override.value;
        break;
      case 'property':
        if (override.componentType && override.propertyName !== undefined) {
          const comp = target.components.find((c) => c.type === override.componentType);
          if (comp) comp.data[override.propertyName] = override.value;
        }
        break;
      case 'component_added': {
        const compData = override.componentData;
        if (!compData) break;
        const exists = target.components.some((c) => c.type === compData.type);
        if (!exists) {
          target.components.push({
            type: compData.type,
            data: JSON.parse(JSON.stringify(compData.data)) as Record<string, unknown>,
          });
        }
        break;
      }
      case 'component_replaced': {
        const compData = override.componentData;
        if (!compData) break;
        const idx = target.components.findIndex((c) => c.type === compData.type);
        const cloned = {
          type: compData.type,
          data: JSON.parse(JSON.stringify(compData.data)) as Record<string, unknown>,
        };
        if (idx >= 0) target.components[idx] = cloned;
        else target.components.push(cloned);
        break;
      }
      case 'component_removed':
        if (override.componentType) {
          target.components = target.components.filter((c) => c.type !== override.componentType);
        }
        break;
      case 'metadata_set':
        if (typeof override.metadataKey === 'string') {
          target.metadata ??= {};
          target.metadata[override.metadataKey] = override.value;
        }
        break;
      case 'metadata_removed':
        if (typeof override.metadataKey === 'string' && target.metadata) {
          Reflect.deleteProperty(target.metadata, override.metadataKey);
          if (Object.keys(target.metadata).length === 0) delete target.metadata;
        }
        break;
    }
  };

  const matchesRef = (override: PrefabOverride, ref: PrefabOverrideRef): boolean => {
    if (override.prefabEntityId !== ref.prefabEntityId) return false;
    if (override.type !== ref.type) return false;
    if (ref.componentType !== undefined) {
      const targetCompType = override.componentType ?? override.componentData?.type;
      if (targetCompType !== ref.componentType) return false;
    }
    if (ref.propertyName !== undefined && override.propertyName !== ref.propertyName) return false;
    if (ref.metadataKey !== undefined && override.metadataKey !== ref.metadataKey) return false;
    return true;
  };

  const countInstancesOf = (sourceUuid: string): number =>
    findAllInstanceRootsOf(sourceUuid).length;

  /**
   * Public "is this a placement override?" predicate for UI callers
   * (Apply dialog). Operates on `PrefabOverrideRef` since that's
   * what the dialog has — resolves rootPid from the ref's own
   * prefabEntityId (placement refs are by definition on the root).
   */
  const isPlacementOverrideExternal = (ref: PrefabOverrideRef): boolean => {
    if (ref.type !== 'property') return false;
    if (ref.componentType !== 'Transform') return false;
    if (typeof ref.propertyName !== 'string') return false;
    if (!ROOT_PLACEMENT_PROPERTIES.has(ref.propertyName)) return false;
    // The ref points at the root iff its prefabEntityId equals the
    // root's prefabEntityId. We don't carry that here; callers
    // already have the entity context, so they drive this via
    // getPlacementOverrides instead. But if a caller calls us
    // directly we answer conservatively: if shape matches, it's
    // placement. (There's no way a non-root Transform override
    // matches the root-only placement set unambiguously without
    // more context.)
    return true;
  };

  const getPlacementOverrides = (entityId: number): readonly PrefabOverrideRef[] => {
    flushOverrides();
    const ecs = getEcs();
    if (!ecs) return [];
    const rootId = findInstanceRoot(entityId);
    if (rootId === undefined) return [];
    const rootPid = ecs.getEntityMetadata(rootId, PREFAB_METADATA_KEYS.ENTITY_ID);
    if (typeof rootPid !== 'string') return [];
    const overrides =
      (ecs.getEntityMetadata(rootId, PREFAB_METADATA_KEYS.OVERRIDES) as
        | PrefabOverride[]
        | undefined) ?? [];
    return overrides
      .filter((o) => isPlacementOverride(o, rootPid))
      .map(
        (o): PrefabOverrideRef => ({
          prefabEntityId: o.prefabEntityId,
          type: o.type,
          ...(o.componentType !== undefined ? { componentType: o.componentType } : {}),
          ...(o.propertyName !== undefined ? { propertyName: o.propertyName } : {}),
        }),
      );
  };

  /**
   * Mint a variant file pointing at {@link baseUuid} via `@uuid:`. The
   * variant's own `entities` list is empty so flatten falls through
   * to the base wholesale; the author can later add overrides (via
   * an instance) or net-new entities (via variant authoring mode —
   * separate Phase 2.2c scope) without touching this file by hand.
   */
  const createVariant = async (baseUuid: string, filePath: string): Promise<string> => {
    const baseAsset = catalog.getByUuid(baseUuid);
    if (!baseAsset) throw new Error(`Base prefab ${baseUuid} not found in catalog`);
    const base = await loadSourcePrefab(baseUuid);
    if (!base) throw new Error('Failed to load base prefab for variant creation');

    // Derive a sensible default name from the filename (caller picked it).
    const slash = filePath.lastIndexOf('/');
    const dot = filePath.lastIndexOf('.');
    const leaf = slash >= 0 ? filePath.slice(slash + 1) : filePath;
    const niceName = dot > slash ? leaf.slice(0, dot - (slash + 1)) : leaf;

    const variant: PrefabData = {
      version: PREFAB_FORMAT_VERSION,
      name: niceName || `${base.name} Variant`,
      // Variants share the base's root identity — the engine's
      // flattenVariant enforces this invariant; we respect it up front.
      rootEntityId: base.rootEntityId,
      basePrefab: `@uuid:${baseUuid}`,
      entities: [],
    };

    const uuid = randomPrefabEntityId();
    const metaPath = `${filePath}.meta`;
    await fileSystem.writeFile(
      metaPath,
      JSON.stringify({ uuid, version: 1, importer: {} }, null, 2) + '\n',
    );
    await fileSystem.writeFile(filePath, JSON.stringify(variant, null, 2) + '\n');
    prefabCache.set(uuid, variant);
    return uuid;
  };

  const applyToSource = async (
    entityId: number,
    selectedOverrides?: readonly PrefabOverrideRef[],
  ): Promise<{ affectedOtherInstances: number }> => {
    flushOverrides();
    const ecs = getEcs();
    if (!ecs) throw new Error('ECS not ready');
    const rootId = findInstanceRoot(entityId);
    if (rootId === undefined) throw new Error('Entity is not part of a prefab instance');
    const sourceUuid = ecs.getEntityMetadata(rootId, PREFAB_METADATA_KEYS.SOURCE);
    if (typeof sourceUuid !== 'string') throw new Error('Instance has no source UUID');
    const asset = catalog.getByUuid(sourceUuid);
    if (!asset) throw new Error('Source prefab not found in catalog');

    const source = await loadSourcePrefab(sourceUuid);
    if (!source) throw new Error('Failed to load source prefab');

    const overrides =
      (ecs.getEntityMetadata(rootId, PREFAB_METADATA_KEYS.OVERRIDES) as
        | PrefabOverride[]
        | undefined) ?? [];
    const toBake = selectedOverrides
      ? overrides.filter((o) => selectedOverrides.some((ref) => matchesRef(o, ref)))
      : overrides;
    if (toBake.length === 0) return { affectedOtherInstances: 0 };

    // Mutate a deep-cloned source to avoid corrupting the live cache
    // entry if the write fails downstream.
    const updatedSource = JSON.parse(JSON.stringify(source)) as PrefabData;
    for (const override of toBake) bakeOverride(updatedSource, override);

    await fileSystem.writeFile(asset.absolutePath, JSON.stringify(updatedSource, null, 2) + '\n');
    // Seed cache so the hot-reload triggered by the catalog watcher
    // reflects our just-written state without a round-trip through fs.
    prefabCache.set(sourceUuid, updatedSource);

    // Remove baked overrides from THIS instance — they're now
    // authored, no longer distinctive state. Other instances get
    // re-reconciled via the catalog.onDidChange path; their overrides
    // may also collapse on their next debounced diff if they
    // happened to share the same values.
    const remaining = overrides.filter((o) => !toBake.includes(o));
    suppressDirty = true;
    try {
      ecs.setEntityMetadata(rootId, PREFAB_METADATA_KEYS.OVERRIDES, remaining);
    } finally {
      suppressDirty = false;
    }

    // Count "other" = all live instance roots minus this one.
    const allRoots = findAllInstanceRootsOf(sourceUuid);
    const affectedOtherInstances = allRoots.filter((id) => id !== rootId).length;

    // Proactively hot-reload so UI updates immediately rather than
    // waiting for the filesystem watcher's debounce.
    const graph = await preloadPrefabGraph(sourceUuid);
    for (const id of allRoots) {
      structuralReload(id, updatedSource, graph);
    }
    onDidHotReload.fire({ sourceUuid, affectedRoots: allRoots });

    return { affectedOtherInstances };
  };

  // ── Prefab Mode (document handler for `.esprefab`) ───────
  //
  // When the user opens a `.esprefab`, the live ECS is repurposed to
  // host the prefab's own entities. Edits go through the normal
  // Hierarchy/Inspector/Scene View surfaces; on save we walk the ECS
  // and serialise back to `PrefabData` with stable `prefabEntityId`s
  // preserved via per-entity metadata. Prefab-mode entities are NOT
  // instances — they don't carry `prefab:source` / `prefab:overrides`
  // on the root, only `prefab:entityId` on each node so ids survive
  // round-trips.

  let prefabModeFilePath: string | undefined;

  // ── In-memory ECS snapshot tab-swap ──────────────────────
  //
  // The editor has exactly one live ECS but the user can have a
  // scene + one or more prefabs open as tabs. On tab switch we
  // serialise the outgoing doc's ECS state into an in-memory
  // snapshot and deserialise the incoming one. The snapshot is
  // NOT written to disk; save is still explicit via the doc's
  // serialize handler. This replaces the old "opening a prefab
  // closes the scene" behaviour that surprised users.
  //
  // `currentEcsDocPath` tracks which tab's state the ECS currently
  // holds — kept in sync with handler.load and active-doc changes
  // rather than inferred from documentService.activeDocument, which
  // only reflects the selected tab, not the ECS content.
  const ecsSnapshots = new Map<string, SceneData>();
  let currentEcsDocPath: string | undefined;

  const isEcsOccupyingDoc = (path: string | undefined): boolean =>
    typeof path === 'string' && (path.endsWith('.scene.json') || path.endsWith('.esprefab'));

  /** Persist the currently-displayed ECS content under its owning doc path. */
  const snapshotCurrent = (): void => {
    const ecs = getEcs();
    if (!ecs || currentEcsDocPath === undefined) return;
    ecsSnapshots.set(currentEcsDocPath, ecs.serialize());
  };

  /**
   * Swap ECS content to match the requested doc. Returns true if a
   * swap happened (caller shouldn't redundantly fill the ECS). When
   * no snapshot exists, the caller is expected to either leave the
   * ECS as-is (already belongs to the target) or call handler.load
   * which will fill it.
   */
  const swapEcsTo = (targetPath: string | undefined): boolean => {
    if (targetPath === undefined) return false;
    if (!isEcsOccupyingDoc(targetPath)) return false;
    if (targetPath === currentEcsDocPath) return true; // already showing
    const ecs = getEcs();
    if (!ecs) return false;
    snapshotCurrent();
    const snap = ecsSnapshots.get(targetPath);
    if (snap === undefined) return false;
    ecs.deserialize(snap);
    currentEcsDocPath = targetPath;
    return true;
  };

  subscriptions.add(
    documentService.onDidChangeActive((newPath) => {
      const path = newPath ?? undefined;
      if (!isEcsOccupyingDoc(path)) return;
      if (path === currentEcsDocPath) return;
      swapEcsTo(path);
    }),
  );

  subscriptions.add(
    documentService.onDidChangeDocuments(() => {
      // Drop snapshots for docs that are no longer open. Keeps memory
      // bounded — long editor sessions would otherwise accumulate
      // forgotten snapshots.
      const openPaths = new Set(documentService.getOpenDocuments().map((d) => d.filePath));
      for (const path of [...ecsSnapshots.keys()]) {
        if (!openPaths.has(path)) ecsSnapshots.delete(path);
      }
      // If the doc whose state lives in the ECS just closed, clear the marker.
      if (currentEcsDocPath !== undefined && !openPaths.has(currentEcsDocPath)) {
        currentEcsDocPath = undefined;
      }
    }),
  );

  const processedEntitiesToSceneData = (
    flat: readonly ProcessedEntity[],
    name: string,
  ): {
    version: number;
    name: string;
    entities: {
      id: number;
      name: string;
      children: number[];
      components: Record<string, Record<string, unknown>>;
      visible?: boolean;
      metadata?: Record<string, unknown>;
    }[];
  } => ({
    version: 1,
    name,
    entities: flat.map((e) => ({
      id: e.id,
      name: e.name,
      children: [...e.children],
      components: Object.fromEntries(e.components.map((c) => [c.type, c.data])),
      ...(!e.visible ? { visible: false as const } : {}),
      // Seed prefab:entityId immediately so subsequent save reads
      // it back and minting-new isn't needed. Any extra authored
      // metadata rides along unchanged.
      metadata: {
        ...(e.metadata ?? {}),
        [PREFAB_METADATA_KEYS.ENTITY_ID]: e.prefabEntityId,
      },
    })),
  });

  /**
   * Walk the ECS and serialise it as a `PrefabData`. Unlike
   * {@link buildPrefabData}, which mints fresh `prefabEntityId`s for
   * every entity, this path honours any existing `prefab:entityId`
   * metadata so re-saving the same prefab file keeps its id graph
   * stable — important for variants that reference this prefab by
   * `prefabEntityId`, and for overrides on instances of this prefab.
   */
  const buildPrefabFromEcsPreservingIds = (rootEntityId: number, name: string): PrefabData => {
    const ecs = getEcs();
    if (!ecs) throw new Error('ECS not ready');
    const ecsToPrefabId = new Map<number, PrefabEntityId>();

    const collect = (ecsId: number): void => {
      const existing = ecs.getEntityMetadata(ecsId, PREFAB_METADATA_KEYS.ENTITY_ID);
      const pid = typeof existing === 'string' ? existing : randomPrefabEntityId();
      ecsToPrefabId.set(ecsId, pid);
      // Newly-created entities in prefab mode get a tag now so the
      // next save is idempotent.
      if (typeof existing !== 'string') {
        ecs.setEntityMetadata(ecsId, PREFAB_METADATA_KEYS.ENTITY_ID, pid);
      }
      for (const childId of ecs.getChildren(ecsId)) collect(childId);
    };
    collect(rootEntityId);

    const entities: PrefabEntityData[] = [];
    const walk = (ecsId: number, parentEcsId: number | null): void => {
      const pid = ecsToPrefabId.get(ecsId);
      if (pid === undefined) return;
      const parentPid = parentEcsId !== null ? (ecsToPrefabId.get(parentEcsId) ?? null) : null;

      const components = ecs
        .getComponents(ecsId)
        .filter((compName) => !NON_PREFAB_COMPONENTS.has(compName))
        .map((compName) => ({ type: compName, data: ecs.getComponentData(ecsId, compName) }));

      // Map entity-typed component fields from runtime ids → prefab ids;
      // zero out asset handles (session-specific, ref lives in metadata).
      for (const comp of components) {
        const schema = ecs.getComponentSchema(comp.type);
        for (const field of schema) {
          if (field.type === 'entity') {
            const value = comp.data[field.key];
            if (typeof value !== 'number' || value === 0) continue;
            const mapped = ecsToPrefabId.get(value);
            comp.data[field.key] = mapped !== undefined ? (mapped as unknown as number) : 0;
          } else if (field.type === 'asset') {
            comp.data[field.key] = 0;
          }
        }
      }

      const metadata: Record<string, unknown> = {};
      for (const key of ecs.getEntityMetadataKeys(ecsId)) {
        if (PREFAB_META_KEYS_IGNORED_BY_DIFF.includes(key)) continue;
        metadata[key] = ecs.getEntityMetadata(ecsId, key);
      }

      const children = ecs
        .getChildren(ecsId)
        .map((id) => ecsToPrefabId.get(id))
        .filter((id): id is PrefabEntityId => id !== undefined);

      entities.push({
        prefabEntityId: pid,
        name: ecs.getName(ecsId),
        parent: parentPid,
        children,
        components,
        visible: ecs.getVisible(ecsId),
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      });
      for (const childId of ecs.getChildren(ecsId)) walk(childId, ecsId);
    };
    walk(rootEntityId, null);

    const rootPid = ecsToPrefabId.get(rootEntityId);
    if (rootPid === undefined) throw new Error('Failed to resolve prefab-mode root id');
    return {
      version: PREFAB_FORMAT_VERSION,
      name,
      rootEntityId: rootPid,
      entities,
    };
  };

  subscriptions.add(
    documentService.registerHandler({
      extensions: ['.esprefab'],
      async load(filePath, content): Promise<void> {
        const ecs = getEcs();
        if (!ecs) {
          // Can happen very early in boot — the ECS presence is
          // late-bound. Defer to `pendingPrefabOpen` mirroring
          // doc-sync's `pendingScene` pattern rather than failing,
          // so that autoload-of-last-opened-doc doesn't bounce.
          pendingPrefabOpen = { filePath, content };
          return;
        }

        // Preserve the outgoing doc's state (scene or another prefab)
        // so switching back restores it — no disk round-trip required.
        snapshotCurrent();

        const raw = JSON.parse(content) as unknown;
        const { data: prefabData } = migratePrefabData(raw);
        const rel = project.isOpen
          ? filePath.startsWith(project.path + '/')
            ? filePath.slice(project.path.length + 1)
            : undefined
          : undefined;
        const asset = rel !== undefined ? catalog.getByPath(rel) : undefined;
        const sourceUuid = asset?.uuid;

        // Preload base chain so variants flatten correctly even when
        // opened standalone (before their base has been instantiated).
        const graph = sourceUuid !== undefined ? await preloadPrefabGraph(sourceUuid) : undefined;

        // Wipe ECS + write flattened prefab as a scene-shaped blob.
        selection.clearSelection();
        const { entities, rootId: rootPlaceholder } = flattenWithPlaceholderIds(prefabData, graph);
        const sceneName = filePath.split('/').pop() ?? prefabData.name;
        const sceneData = processedEntitiesToSceneData(entities, sceneName);
        ecs.deserialize(sceneData as unknown as Parameters<typeof ecs.deserialize>[0]);

        prefabModeFilePath = filePath;
        currentEcsDocPath = filePath;
        void sourceUuid; // tracked via catalog lookup at serialize-time

        // Parks the root selection so the Inspector immediately shows
        // the prefab. Falls back to the first root if flatten placed
        // more than one (shouldn't, but handles defensively).
        const roots = ecs.getRootEntities();
        if (roots.length > 0) {
          selection.select([`entity:${String(roots[0])}`]);
        }
        void rootPlaceholder; // placeholder id is local; runtime roots win
      },
      serialize(filePath): Promise<string> {
        const ecs = getEcs();
        if (!ecs) throw new Error('Cannot save prefab — ECS runtime is not ready yet.');
        if (prefabModeFilePath !== filePath) {
          throw new Error('Prefab mode state missing for this file.');
        }
        const roots = ecs.getRootEntities();
        if (roots.length !== 1) {
          throw new Error(
            `Prefab must have exactly one root entity (currently ${String(roots.length)}).`,
          );
        }
        const rootId = roots[0];
        if (rootId === undefined) throw new Error('Prefab root not found in ECS.');
        const leaf = filePath.split('/').pop() ?? 'Prefab';
        const niceName = leaf.replace(/\.esprefab$/, '');
        const data = buildPrefabFromEcsPreservingIds(rootId, niceName);
        return Promise.resolve(JSON.stringify(data, null, 2));
      },
    }),
  );

  // Clear prefab-mode bookkeeping when its doc closes.
  subscriptions.add(
    documentService.onDidChangeDocuments(() => {
      if (prefabModeFilePath === undefined) return;
      const stillOpen = documentService
        .getOpenDocuments()
        .some((d) => d.filePath === prefabModeFilePath);
      if (!stillOpen) {
        prefabModeFilePath = undefined;
      }
    }),
  );

  let pendingPrefabOpen: { filePath: string; content: string } | undefined;
  subscriptions.add(
    presence.onDidBind(() => {
      if (!pendingPrefabOpen) return;
      const { filePath, content } = pendingPrefabOpen;
      pendingPrefabOpen = undefined;
      // Re-enter through documentService so handler state (dirty, tab
      // label, etc.) stays coherent; its `load` will call our
      // registered handler now that the ECS is ready.
      void documentService.open(filePath).catch(() => {
        /* already logged */
      });
      void content; // content already parsed by documentService; reopen is cheap
    }),
  );

  // ── Service registration ─────────────────────────────────

  const service: IPrefabService = {
    createPrefab,
    instantiate,
    isInstanceRoot,
    isInsideInstance,
    getInstanceInfo,
    flushPendingOverrides: flushOverrides,
    getOverriddenFieldKeys,
    isComponentOverridden,
    isMetadataOverridden,
    getSourceFieldValue,
    revertPropertyOverride,
    revertComponentOverride,
    revertMetadataOverride,
    revertAll,
    applyToSource,
    countInstancesOf,
    isPlacementOverride: isPlacementOverrideExternal,
    getPlacementOverrides,
    createVariant,
    snapshotCurrentEcsDoc: snapshotCurrent,
    adoptEcsDoc: (filePath: string): void => {
      currentEcsDocPath = filePath;
    },
    onDidCreateInstance: onDidCreateInstance.event,
    onDidHotReload: onDidHotReload.event,
  };
  // `project` is closed over for future variant-authoring flows; void it
  // so unused-var lint stays silent while those callers are pending.
  void project;

  return service;
}
