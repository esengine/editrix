/**
 * App-level service identifiers shared between the game-editor's plugins.
 *
 * These are NOT framework services — they describe wiring that's specific to
 * this editor (the shared render context for ECS panels, and a presence
 * wrapper that lets plugins react to the late arrival of the WASM-backed
 * IECSSceneService). A different editor would define its own equivalents.
 */

import type { Event, IDisposable } from '@editrix/common';
import { createServiceId } from '@editrix/common';
import type { IECSSceneService } from '@editrix/estella';
import type { SharedRenderContext } from './render-context.js';

/**
 * The single render surface shared by Scene View and Game View. Owned by the
 * RenderContextPlugin; consumed by view plugins. Lifecycle is tied to the
 * owning plugin's subscriptions — service consumers do not dispose it.
 */
export interface ISharedRenderContext {
  readonly context: SharedRenderContext;
}

export const ISharedRenderContext = createServiceId<ISharedRenderContext>('ISharedRenderContext');

/**
 * Late-binding wrapper around {@link IECSSceneService}. The ECS scene becomes
 * available only after the WASM module finishes loading; consumers subscribe
 * to {@link onDidBind} to be notified, or read {@link current} synchronously
 * (returns undefined until binding completes).
 *
 * Plugins consume this instead of trying to depend on activation order.
 */
export interface IECSScenePresence {
  /** The bound ECS scene service, or undefined if WASM hasn't finished loading. */
  readonly current: IECSSceneService | undefined;
  /** Fired exactly once when the ECS scene is created and registered. */
  readonly onDidBind: Event<IECSSceneService>;
}

export const IECSScenePresence = createServiceId<IECSScenePresence>('IECSScenePresence');

/**
 * Resolved view of the open project. Owned by the ProjectPlugin; consumed by
 * any plugin that needs to know where on disk the user's project lives or
 * which subdirectories are configured for asset roots.
 *
 * `path` is empty when the editor was launched without a project (the launcher
 * itself, or a development run). Consumers should treat all I/O as no-op in
 * that case rather than throwing — the editor still has to render its empty
 * state cleanly.
 */
export interface IProjectService {
  /** Absolute project root path, or '' if no project is open. */
  readonly path: string;
  /** Configured asset root directories (relative to project root). */
  readonly assetRoots: readonly string[];
  /** True when a real project is open (path is non-empty). */
  readonly isOpen: boolean;
  /** Resolve a project-relative path to an absolute path. Returns '' if no project. */
  resolve(relativePath: string): string;
}

export const IProjectService = createServiceId<IProjectService>('IProjectService');

// ─── Typed selection refs ──────────────────────────────────────────────────

/**
 * A typed reference to something selectable in the editor. The framework's
 * ISelectionService stores selections as opaque strings; this app encodes them
 * as `kind:value` so plugins can distinguish entities (Inspector targets) from
 * assets (asset-picker targets) from filesystem folders (project-files
 * navigation) without resorting to isNaN checks.
 *
 * Encoding is lexical: the first ':' splits kind from value. Asset UUIDs may
 * contain ':' themselves (e.g. "@uuid:..."), so we only split on the first.
 */
export type SelectionRef =
  | { readonly kind: 'entity'; readonly id: number }
  | { readonly kind: 'asset'; readonly uuid: string }
  | { readonly kind: 'folder'; readonly path: string };

/** Encode an entity selection. */
export function entityRef(id: number): string {
  return `entity:${String(id)}`;
}

/** Encode an asset selection by UUID. */
export function assetRef(uuid: string): string {
  return `asset:${uuid}`;
}

/** Encode a folder selection by absolute path. */
export function folderRef(path: string): string {
  return `folder:${path}`;
}

/**
 * Parse a serialized selection back to its typed form. Returns undefined for
 * unrecognized kinds or malformed values — callers can early-return on unknown
 * selections instead of crashing.
 */
export function parseSelectionRef(serialized: string): SelectionRef | undefined {
  const colonIdx = serialized.indexOf(':');
  if (colonIdx <= 0) return undefined;
  const kind = serialized.slice(0, colonIdx);
  const value = serialized.slice(colonIdx + 1);
  switch (kind) {
    case 'entity': {
      const id = Number(value);
      if (!Number.isFinite(id)) return undefined;
      return { kind: 'entity', id };
    }
    case 'asset':
      if (value === '') return undefined;
      return { kind: 'asset', uuid: value };
    case 'folder':
      if (value === '') return undefined;
      return { kind: 'folder', path: value };
    default:
      return undefined;
  }
}

// ─── Play mode ─────────────────────────────────────────────────────────────

/**
 * Editor mode. The runtime simulation only ticks while `playing` is active;
 * `paused` keeps the play-mode scene snapshot live and the render loop frozen
 * so the user can step through frames with F6.
 */
export type PlayMode = 'edit' | 'playing' | 'paused';

export interface PlayModeChangeEvent {
  readonly previous: PlayMode;
  readonly current: PlayMode;
}

/**
 * Owns the editor's edit ↔ play state machine.
 *
 * Entering play takes a snapshot of the ECS scene (via SceneData round-trip);
 * exiting play restores it so anything the user changed during play (entity
 * create/destroy, property tweaks, transform drags) doesn't pollute the
 * authored data. While playing, a requestAnimationFrame loop drives the
 * shared render context every frame.
 *
 * Step (single-frame advance from paused) is provided for debugging — the
 * scene renders once with a synthetic delta, then returns to paused.
 */
export interface PlayFrameStats {
  /** Frames since the current play session started; resets on stop(). */
  readonly frame: number;
  /** Exponential moving average of dt, in milliseconds. */
  readonly avgDtMs: number;
}

export interface IPlayModeService {
  /** Current mode. */
  readonly mode: PlayMode;
  /** True if mode is 'playing' or 'paused'. */
  readonly isInPlay: boolean;
  /** Fired when mode transitions. */
  readonly onDidChangeMode: Event<PlayModeChangeEvent>;
  /** Live tick instrumentation — zero while in edit mode. */
  readonly frameStats: PlayFrameStats;

  /** Enter play: snapshot the scene if not already in play, start the loop. */
  play(): void;
  /** Stop the loop without leaving play (snapshot intact, paused frame visible). */
  pause(): void;
  /** Resume from paused state. */
  resume(): void;
  /** Render exactly one frame while paused. No-op outside paused state. */
  step(): void;
  /** Exit play, restore the snapshot, drop selection (entity ids would be stale). */
  stop(): void;
}

export const IPlayModeService = createServiceId<IPlayModeService>('IPlayModeService');

/**
 * Extension point for "hide this component from the Inspector". Predicates
 * compose via disjunction. UI-only — ECS queries still see the component.
 */
export interface IInspectorComponentFilter {
  register(predicate: (componentName: string) => boolean): IDisposable;
  isHidden(componentName: string): boolean;
}

export const IInspectorComponentFilter = createServiceId<IInspectorComponentFilter>('IInspectorComponentFilter');

export type AssetType = 'image' | 'scene' | 'audio' | 'font' | 'prefab' | 'anim-clip' | 'unknown';

export interface AssetEntry {
  readonly uuid: string;
  /** Path relative to the project root, forward-slashed (e.g. `assets/sprites/hero.png`). */
  readonly relativePath: string;
  /** Absolute path on disk (forward-slashed). */
  readonly absolutePath: string;
  readonly type: AssetType;
  readonly mtime: string;
  readonly size: number;
}

export type AssetChange =
  | { readonly kind: 'added'; readonly asset: AssetEntry }
  | { readonly kind: 'removed'; readonly uuid: string; readonly relativePath: string }
  | { readonly kind: 'modified'; readonly asset: AssetEntry };

/** Per-asset settings persisted under the `importer` key of the `.meta` sidecar. */
export interface ImporterSettings {
  readonly texture?: {
    readonly filter?: 'linear' | 'nearest';
    readonly wrap?: 'repeat' | 'clamp' | 'mirror';
    readonly mipmaps?: boolean;
  };
  readonly [key: string]: unknown;
}

/**
 * Catalog of the project's assets/ tree, keyed by stable UUID v4. `.meta`
 * sidecar files persist the UUID next to each asset (same pattern as Unity)
 * so references survive file moves and team-member swaps.
 */
export interface IAssetCatalogService {
  /** Completes when the initial scan has finished. */
  readonly ready: Promise<void>;
  /** All known assets. Read-only snapshot — safe to iterate without copying. */
  getAll(): readonly AssetEntry[];
  getByUuid(uuid: string): AssetEntry | undefined;
  /** `relativePath` is the forward-slashed project-relative path. */
  getByPath(relativePath: string): AssetEntry | undefined;
  /** Importer settings from the `.meta` sidecar. Returns empty object if none. */
  getImporterSettings(uuid: string): ImporterSettings;
  /** Merge-in importer settings for `uuid` and persist to `.meta`. */
  setImporterSettings(uuid: string, patch: ImporterSettings): Promise<void>;
  readonly onDidChange: Event<AssetChange>;
  readonly onDidChangeImporter: Event<{ uuid: string; settings: ImporterSettings }>;
}

export const IAssetCatalogService = createServiceId<IAssetCatalogService>('IAssetCatalogService');

/**
 * Minimal view of the estella runtime App that non–play-mode plugins depend on.
 * The App is created lazily (first Play) and torn down on Stop, so asset-wiring
 * plugins can't hold a reference across the lifecycle — they re-bind each time.
 */
export interface IRuntimeApp {
  /** The SDK's App instance. Typed `unknown` because the SDK is late-bound. */
  readonly instance: unknown;
  /** Matching SDK module — exposes `Assets` ResourceDef, `AssetRegistry`, etc. */
  readonly sdk: Record<string, unknown>;
}

/**
 * Presence wrapper for the runtime App. The App is created lazily by
 * PlayModePlugin on the first Play transition and torn down on Stop; consumers
 * subscribe to {@link onDidBind}/{@link onDidUnbind} rather than holding
 * references directly.
 */
export interface IRuntimeAppPresence {
  /** The currently-bound runtime App, or undefined in edit mode. */
  readonly current: IRuntimeApp | undefined;
  /** Fired each time the App is created (potentially many times per session). */
  readonly onDidBind: Event<IRuntimeApp>;
  /** Fired when the App is about to be disposed. */
  readonly onDidUnbind: Event<void>;
}

export const IRuntimeAppPresence = createServiceId<IRuntimeAppPresence>('IRuntimeAppPresence');

// ─── Prefab authoring ───────────────────────────────────────────────────────

/** Lightweight summary of an instance root entity for UI consumption. */
export interface PrefabInstanceInfo {
  /** ECS entity id of the instance root in the current scene. */
  readonly entityId: number;
  /** UUID of the source `.esprefab` in the asset catalog. */
  readonly sourceUuid: string;
  /** `.esprefab` filename (without path) — cached for Hierarchy display. */
  readonly sourceName: string;
  /** Current override count — cheap signal for Inspector badges. */
  readonly overrideCount: number;
}

export interface PrefabEvent {
  readonly entityId: number;
}

/**
 * Editor-side Prefab authoring service.
 *
 * Owns the "instance ↔ source" relationship for prefab-derived entities in the
 * open scene. An entity qualifies as a prefab instance root iff it carries the
 * `prefab:source` metadata key. Non-root instance children are tagged with
 * `prefab:entityId` (the stable `PrefabEntityId` from the source file) so the
 * diff engine can match them across reloads.
 *
 * Mutations on instance subtrees are watched and the override list is
 * recomputed on a 100ms debounce (flushed on scene save / play transitions).
 * Source `.esprefab` edits trigger a structural hot reload that preserves
 * entity ids for unchanged nodes — selections and undo history survive.
 */
export interface IPrefabService {
  /**
   * Serialise the entity subtree rooted at {@link entityId} as a `.esprefab`
   * file at {@link filePath} (absolute). The original entity is converted in
   * place to an instance of the newly-created prefab (no overrides). Returns
   * the UUID the catalog assigned to the new prefab.
   */
  createPrefab(entityId: number, filePath: string): Promise<string>;

  /**
   * Instantiate the prefab identified by {@link sourceUuid} into the current
   * scene. Optional {@link parent} attaches the instance root as a child.
   * Returns the instance root entity id.
   */
  instantiate(sourceUuid: string, options?: {
    parent?: number;
    position?: { x: number; y: number };
  }): Promise<number>;

  /** True when {@link entityId} is the root of a prefab instance subtree. */
  isInstanceRoot(entityId: number): boolean;
  /** True when {@link entityId} is anywhere inside a prefab instance subtree. */
  isInsideInstance(entityId: number): boolean;
  /** Info for the instance root of {@link entityId}, or undefined if not in one. */
  getInstanceInfo(entityId: number): PrefabInstanceInfo | undefined;

  /**
   * Force the debounced override recompute to run synchronously. Called
   * before scene save and before entering Play so the serialised form is
   * consistent with the live ECS state.
   */
  flushPendingOverrides(): void;

  /**
   * Field keys (`"Component.field"`) currently overridden on {@link entityId}.
   * Only returns entries matching the entity's own `prefab:entityId`; the
   * caller is expected to query per-entity. Empty if not inside an instance.
   */
  getOverriddenFieldKeys(entityId: number): ReadonlySet<string>;

  /**
   * Whether the entity has a `component_added`, `component_replaced`, or
   * `component_removed` override for the given component type. Used by the
   * Inspector to badge component headers.
   */
  isComponentOverridden(entityId: number, componentType: string): boolean;

  /** Whether the entity has a `metadata_set` / `metadata_removed` override for the key. */
  isMetadataOverridden(entityId: number, metadataKey: string): boolean;

  /**
   * Read the authored source value for {@link fieldPath} of the entity
   * corresponding to {@link entityId}'s `prefab:entityId`. Returns
   * `undefined` when the entity isn't in a prefab instance, the source
   * can't be resolved, or the component/field isn't in the source.
   * Editor uses this for "Source: X" tooltips on overridden Inspector
   * rows.
   */
  getSourceFieldValue(entityId: number, componentType: string, fieldPath: string): unknown;

  /**
   * Revert a single property override. Removes the matching `property`
   * override from the instance root's `prefab:overrides` and re-runs the
   * structural reconciler so the field snaps back to its source value.
   */
  revertPropertyOverride(entityId: number, componentType: string, fieldPath: string): void;

  /** Revert an entire component override (added/replaced/removed). */
  revertComponentOverride(entityId: number, componentType: string): void;

  /** Revert a metadata override. */
  revertMetadataOverride(entityId: number, metadataKey: string): void;

  /**
   * Revert every override on the entire instance subtree — returns the
   * instance root to pristine source state.
   */
  revertAll(entityId: number): void;

  /**
   * Bake overrides permanently into the source `.esprefab`. If
   * {@link selectedOverrides} is omitted, every override on this instance
   * is applied. The matching overrides are removed from this instance's
   * `prefab:overrides`; catalog change → other instances of the same
   * source hot-reload and may prune now-redundant overrides on their own.
   *
   * Returns the number of other instances that will be affected — the
   * caller can display this in the confirmation dialog.
   */
  applyToSource(entityId: number, selectedOverrides?: readonly PrefabOverrideRef[]): Promise<{ affectedOtherInstances: number }>;

  /** Cheap "how many instances of this prefab exist in the current scene". */
  countInstancesOf(sourceUuid: string): number;

  /**
   * Classify an override as "placement" (root Transform pos/rot/scale).
   * The Apply-to-Source dialog uses this to group placement overrides
   * separately and default them unchecked — baking one instance's
   * placement into the source would rewrite the prefab's origin point,
   * which is rarely what the user wants.
   */
  isPlacementOverride(override: PrefabOverrideRef): boolean;

  /**
   * Enumerate placement overrides separately. Supplied to the Apply
   * dialog so it can render "Placement" as a distinct group.
   */
  getPlacementOverrides(entityId: number): readonly PrefabOverrideRef[];

  /**
   * ECS-tab-swap hook for document handlers.
   *
   * Handlers that mutate the live ECS (scene, prefab) call
   * {@link snapshotCurrentEcsDoc} **before** overwriting its contents so
   * the prior tab's state can be restored later, then call
   * {@link adoptEcsDoc} **after** loading so the snapshot layer knows
   * which doc's state currently lives in the ECS. Without this wiring
   * opening one doc silently loses the other's state — the editor has
   * exactly one live ECS but we present tabs as if each owned its own.
   */
  snapshotCurrentEcsDoc(): void;
  adoptEcsDoc(filePath: string): void;

  /**
   * Create a new `.esprefab` that inherits from {@link baseUuid}. The
   * emitted file references the base via `@uuid:` so moves or renames of
   * the base survive. The variant starts empty — its `entities` list is
   * `[]` and its `rootEntityId` mirrors the base's — so flatten produces
   * the base's state verbatim until the author adds overrides or
   * additions.
   *
   * Returns the UUID assigned to the new variant file.
   */
  createVariant(baseUuid: string, filePath: string): Promise<string>;

  readonly onDidCreateInstance: Event<PrefabEvent>;
  readonly onDidHotReload: Event<{ sourceUuid: string; affectedRoots: readonly number[] }>;
}

/**
 * Stable reference to a single override within an instance. Passed to
 * {@link IPrefabService.applyToSource} so the Apply dialog can pick
 * individual overrides to bake without reproducing their full payloads.
 */
export interface PrefabOverrideRef {
  readonly prefabEntityId: string;
  readonly type: 'property' | 'component_added' | 'component_replaced' | 'component_removed'
    | 'name' | 'visibility' | 'metadata_set' | 'metadata_removed';
  readonly componentType?: string;
  readonly propertyName?: string;
  readonly metadataKey?: string;
}

export const IPrefabService = createServiceId<IPrefabService>('IPrefabService');

/**
 * "Select this asset in the Content Browser" action. Registered by
 * `ProjectPanelsPlugin` (owner of the Content Browser) and consumed by
 * any plugin that wants a "show where this file lives" button —
 * Inspector "Select Source" on prefab instances is the flagship caller.
 */
export interface IAssetRevealService {
  /** Navigate the Content Browser to the asset identified by {@link uuid} and highlight it. */
  revealByUuid(uuid: string): void;
}

export const IAssetRevealService = createServiceId<IAssetRevealService>('IAssetRevealService');

/** Per-entity metadata keys owned by the Prefab service. */
export const PREFAB_METADATA_KEYS = {
  /** Present only on instance roots. Value is the source prefab UUID. */
  SOURCE: 'prefab:source',
  /** Present only on instance roots. Value is serialised `PrefabOverride[]`. */
  OVERRIDES: 'prefab:overrides',
  /** Present on every node inside an instance subtree (root and children). */
  ENTITY_ID: 'prefab:entityId',
} as const;

// ─── Animation authoring ────────────────────────────────────────────────────

/** One frame of a sprite animation clip, as stored on disk. */
export interface AnimFrameData {
  /** Project-relative path of the frame texture (e.g. `assets/sprites/run_01.png`). */
  readonly texture: string;
  /** Per-frame duration override in seconds. Omitted → inherit from clip fps. */
  readonly duration?: number;
}

/** On-disk shape of a `.esanim` file. Matches the runtime SDK's `AnimClipAssetData`. */
export interface AnimClipData {
  readonly version: string;
  readonly type: 'animation-clip';
  readonly fps: number;
  readonly loop: boolean;
  readonly frames: readonly AnimFrameData[];
}

/**
 * Editor-side animation-clip authoring service.
 *
 * Owns in-memory state for any `.esanim` tab that's currently open:
 * loads on `documentService.open`, serialises on save, and fires change
 * events so the editor UI can repaint. Closing the tab drops the entry.
 */
export interface IAnimationService {
  /** Current in-memory clip data for an open `.esanim`, or undefined if not open. */
  getClip(filePath: string): AnimClipData | undefined;
  /**
   * Replace the clip data for an open `.esanim` and mark the doc dirty.
   * Throws if the file isn't currently open as a document tab.
   */
  updateClip(filePath: string, next: AnimClipData): void;
  /**
   * Create a new empty `.esanim` at {@link filePath}. Writes a `.meta`
   * sidecar (pre-assigned UUID) then the file body so the catalog doesn't
   * race to assign its own UUID. Opens the resulting file as a document.
   */
  createClip(filePath: string): Promise<string>;
  /** Fired whenever any open clip's data changes (load, edit, save). */
  readonly onDidChangeClip: Event<{ filePath: string; data: AnimClipData }>;
}

export const IAnimationService = createServiceId<IAnimationService>('IAnimationService');
