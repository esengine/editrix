import type { IECSSceneService } from '@editrix/estella';
import { IConsoleService } from '@editrix/plugin-console';
import type { PropertyGroup, PropertyType } from '@editrix/properties';
import type { ComponentFieldSchema } from '@editrix/scene';
import type { IPlugin, IPluginContext } from '@editrix/shell';
import { ILayoutService, ISelectionService, IUndoRedoService, IViewService } from '@editrix/shell';
import type { AssetPickerBinding, AssetRefPreview } from '@editrix/view-dom';
import { PropertyGridWidget, showContextMenu, showQuickPick } from '@editrix/view-dom';
import { AssetInspectorWidget } from '../asset-inspector-widget.js';
import { showApplyPrefabDialog } from '../prefab-apply-dialog.js';
import type {
  AssetEntry,
  IAssetCatalogService as IAssetCatalogServiceShape,
  PrefabInstanceInfo,
} from '../services.js';
import {
  IAssetCatalogService,
  IAssetRevealService,
  IECSScenePresence,
  IInspectorComponentFilter,
  IPrefabService,
  ISharedRenderContext,
  parseSelectionRef,
} from '../services.js';

/** Resolve a selection-service id back to its entity number, if it is one. */
function selectionToEntityId(serialized: string): number | undefined {
  const ref = parseSelectionRef(serialized);
  return ref?.kind === 'entity' ? ref.id : undefined;
}

// ─── Asset picker helpers ─────────────────────────────────

function assetFilename(relativePath: string): string {
  const slash = relativePath.lastIndexOf('/');
  return slash >= 0 ? relativePath.slice(slash + 1) : relativePath;
}

function assetFolder(relativePath: string): string {
  const slash = relativePath.lastIndexOf('/');
  return slash >= 0 ? relativePath.slice(0, slash) : '';
}

/** Turn a project-relative path into a URL the renderer can load via protocol. */
function assetUrl(relativePath: string): string {
  return `project-asset:///${relativePath.split('/').map(encodeURIComponent).join('/')}`;
}

function resolveAssetPreview(
  catalog: IAssetCatalogServiceShape,
  ref: string,
): AssetRefPreview | undefined {
  if (!ref) return undefined;
  const uuid = ref.startsWith('@uuid:') ? ref.slice('@uuid:'.length) : ref;
  const entry: AssetEntry | undefined = catalog.getByUuid(uuid);
  if (!entry) return undefined;
  return {
    label: assetFilename(entry.relativePath),
    description: assetFolder(entry.relativePath),
    ...(entry.type === 'image' ? { thumbnailUrl: assetUrl(entry.relativePath) } : {}),
  };
}

/**
 * Translate an SDK asset-field subtype (from the component schema) into
 * the editor's catalog asset-type tag. Subtypes the editor doesn't track
 * yet (material) return undefined so the picker falls back to "show all
 * assets" — better than silently dropping to an empty list.
 */
function pickerAssetType(subtype: string | undefined): string | undefined {
  // 'material' / 'tilemap' / 'timeline' aren't catalog-classified yet —
  // undefined falls back to "show all assets" rather than an empty list.
  if (subtype === 'texture') return 'image';
  if (subtype === 'anim-clip') return 'anim-clip';
  if (subtype === 'audio') return 'audio';
  if (subtype === 'font') return 'font';
  return undefined;
}

function pickerPlaceholder(wanted: string | undefined): string {
  if (wanted === 'image') return 'Search images...';
  if (wanted === 'anim-clip') return 'Search animation clips...';
  if (wanted === 'audio') return 'Search audio...';
  if (wanted === 'font') return 'Search fonts...';
  return 'Search assets...';
}

// ─── ECS field-type → Inspector PropertyType ──────────────

/** Short, human-friendly print of a prefab source value for tooltips. */
function formatSourceValue(v: unknown): string {
  if (v === null || v === undefined) return 'empty';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(3);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return v.length > 48 ? `"${v.slice(0, 45)}…"` : `"${v}"`;
  try {
    const json = JSON.stringify(v);
    return json.length > 64 ? `${json.slice(0, 61)}…` : json;
  } catch {
    return '[unprintable]';
  }
}

function fieldTypeToPropertyType(type: ComponentFieldSchema['type']): PropertyType {
  switch (type) {
    case 'float':
      return 'number';
    case 'int':
      return 'number';
    case 'bool':
      return 'boolean';
    // 'color' in ECS is a packed numeric — long term we'd render a color
    // swatch, but the inspector's color control wants a hex string today.
    // Treat as number for now so the value at least round-trips.
    case 'color':
      return 'number';
    case 'enum':
      return 'enum';
    case 'string':
      return 'string';
    case 'asset':
      return 'asset';
    case 'entity':
      return 'entity';
  }
}

// ─── Component icon mapping ───────────────────────────────

const componentIconMap: Record<string, string> = {
  Transform: 'move',
  Camera: 'camera',
  Sprite: 'image',
  ShapeRenderer: 'square',
  BitmapText: 'type',
  SpineAnimation: 'zap',
  RigidBody: 'shield',
  BoxCollider: 'square',
  CircleCollider: 'circle',
  CapsuleCollider: 'shield',
  SegmentCollider: 'shield',
  ParticleEmitter: 'wind',
  Canvas: 'monitor',
  UIRect: 'crosshair',
  UIRenderer: 'image',
  UIInteraction: 'crosshair',
  FlexContainer: 'columns',
  FlexItem: 'columns',
  GridLayout: 'grid',
  LayoutGroup: 'layout',
};

// Default priority for components the user didn't add themselves — i.e.
// what a freshly-deserialized entity comes with. Transform/UIRect are
// layout anchors; visual trio (Sprite/Image/Text/UIRenderer) next;
// Camera/Canvas after. Everything else falls through to alphabetical.
const COMPONENT_ORDER_PRIORITY: Record<string, number> = {
  Transform: 0,
  UIRect: 1,
  Sprite: 10,
  Image: 11,
  Text: 12,
  BitmapText: 13,
  UIRenderer: 14,
  Camera: 20,
  Canvas: 21,
};

function sortByDefaultPriority(components: readonly string[]): string[] {
  return [...components].sort((a, b) => {
    const pa = COMPONENT_ORDER_PRIORITY[a];
    const pb = COMPONENT_ORDER_PRIORITY[b];
    if (pa !== undefined && pb !== undefined) return pa - pb;
    if (pa !== undefined) return -1;
    if (pb !== undefined) return 1;
    return a.localeCompare(b);
  });
}

// Asset refs live in per-entity metadata, not the ECS int field — the runtime
// texture handle doesn't exist in edit mode. ImageImporter binds metadata →
// handle at load time.
function assetMetadataKey(fullKey: string): string {
  return `asset:${fullKey}`;
}

function ecsToPropertyGroups(
  ecs: IECSSceneService,
  entityId: number,
  filter: IInspectorComponentFilter,
  // Optional explicit ordering — used by the inspector to preserve the user's
  // insertion order. Components in `order` that aren't on the entity are
  // skipped; components on the entity that aren't in `order` fall through the
  // default priority sort and are appended after.
  order?: readonly string[],
): { groups: PropertyGroup[]; values: Record<string, unknown> } {
  const live = ecs.getComponents(entityId).filter((c) => !filter.isHidden(c));
  let components: string[];
  if (order && order.length > 0) {
    const liveSet = new Set(live);
    const ordered = order.filter((name) => liveSet.has(name));
    const orderedSet = new Set(ordered);
    const extras = sortByDefaultPriority(live.filter((name) => !orderedSet.has(name)));
    components = [...ordered, ...extras];
  } else {
    components = sortByDefaultPriority(live);
  }
  const groups: PropertyGroup[] = [];
  const values: Record<string, unknown> = {};

  for (const compName of components) {
    const schema = ecs.getComponentSchema(compName);
    if (schema.length === 0) continue;

    const icon = componentIconMap[compName];
    groups.push({
      id: compName,
      label: compName,
      ...(icon !== undefined ? { icon } : {}),
      properties: schema.map((f) => ({
        key: `${compName}.${f.key}`,
        label: f.label,
        type: fieldTypeToPropertyType(f.type),
        defaultValue: f.defaultValue,
        ...(f.min !== undefined ? { min: f.min } : {}),
        ...(f.max !== undefined ? { max: f.max } : {}),
        ...(f.step !== undefined ? { step: f.step } : {}),
        ...(f.enumValues !== undefined ? { enumValues: f.enumValues } : {}),
        ...(f.assetType !== undefined ? { assetType: f.assetType } : {}),
      })),
    });

    for (const f of schema) {
      const fullKey = `${compName}.${f.key}`;
      if (f.type === 'asset') {
        const stored = ecs.getEntityMetadata(entityId, assetMetadataKey(fullKey));
        values[fullKey] = typeof stored === 'string' ? stored : '';
      } else {
        values[fullKey] = ecs.getProperty(entityId, compName, f.key);
      }
    }
  }

  return { groups, values };
}

/**
 * Inspector panel plugin. Reflects the first selected entity's components as
 * a grid of property cards. Card order per entity is tracked in the entity's
 * metadata so insertion order survives scene save/load and the inspector
 * doesn't reshuffle when the user adds a component.
 *
 * Owns the add/remove/reorder component flows (with undo grouping).
 */
export const InspectorPlugin: IPlugin = {
  descriptor: {
    id: 'app.inspector',
    version: '1.0.0',
    dependencies: [
      'editrix.layout',
      'editrix.view',
      'editrix.properties',
      'app.ecs-scene',
      'app.inspector-filters',
      'app.asset-catalog',
      'app.prefab',
    ],
  },
  activate(ctx: IPluginContext) {
    const layout = ctx.services.get(ILayoutService);
    const view = ctx.services.get(IViewService);
    const selection = ctx.services.get(ISelectionService);
    const undoRedo = ctx.services.get(IUndoRedoService);
    const presence = ctx.services.get(IECSScenePresence);
    const renderContextSvc = ctx.services.get(ISharedRenderContext);
    const componentFilter = ctx.services.get(IInspectorComponentFilter);
    const catalog: IAssetCatalogServiceShape = ctx.services.get(IAssetCatalogService);
    const prefabService = ctx.services.get(IPrefabService);
    // Lazy — IAssetRevealService is registered by ProjectPanelsPlugin,
    // which activates after us. Resolved on demand inside the click
    // handler (by which point it exists).
    const tryReveal = (): IAssetRevealService | undefined => {
      try {
        return ctx.services.get(IAssetRevealService);
      } catch {
        return undefined;
      }
    };

    // Resolved lazily — IConsoleService is registered by ProjectPanelsPlugin
    // which may activate later in the dependency graph.
    const logError = (msg: string, source = 'inspector'): void => {
      try {
        ctx.services.get(IConsoleService).log('error', msg, source);
      } catch {
        // consoleService not yet available — fall back.
        // eslint-disable-next-line no-console
        console.error(`[${source}] ${msg}`);
      }
    };

    let inspectorGrid: PropertyGridWidget | undefined;
    let assetInspector: AssetInspectorWidget | undefined;
    let entityContainer: HTMLElement | undefined;
    let assetContainer: HTMLElement | undefined;
    let prefabHeaderEl: HTMLElement | undefined;
    let prefabHeaderTitleEl: HTMLElement | undefined;
    let prefabHeaderRevertBtn: HTMLButtonElement | undefined;
    let prefabHeaderApplyBtn: HTMLButtonElement | undefined;

    const INSPECTOR_ORDER_KEY = 'inspectorComponentOrder';

    const getInspectorOrder = (entityId: number): string[] | undefined => {
      const ecs = presence.current;
      if (!ecs) return undefined;
      const raw = ecs.getEntityMetadata(entityId, INSPECTOR_ORDER_KEY);
      return Array.isArray(raw) ? (raw as string[]).slice() : undefined;
    };

    const setInspectorOrder = (entityId: number, names: readonly string[]): void => {
      presence.current?.setEntityMetadata(entityId, INSPECTOR_ORDER_KEY, [...names]);
    };

    const appendToInspectorOrder = (entityId: number, compName: string): void => {
      const existing = getInspectorOrder(entityId);
      if (!existing) return;
      if (!existing.includes(compName)) {
        existing.push(compName);
        setInspectorOrder(entityId, existing);
      }
    };

    const dropFromInspectorOrder = (entityId: number, compName: string): void => {
      const existing = getInspectorOrder(entityId);
      if (!existing) return;
      const idx = existing.indexOf(compName);
      if (idx >= 0) {
        existing.splice(idx, 1);
        setInspectorOrder(entityId, existing);
      }
    };

    const showEntity = (): void => {
      entityContainer?.classList.remove('editrix-inspector-view--hidden');
      assetContainer?.classList.add('editrix-inspector-view--hidden');
    };
    const showAsset = (entry: AssetEntry | undefined): void => {
      assetInspector?.setAsset(entry);
      entityContainer?.classList.add('editrix-inspector-view--hidden');
      assetContainer?.classList.remove('editrix-inspector-view--hidden');
    };

    const updatePrefabHeader = (info: PrefabInstanceInfo | undefined): void => {
      if (
        !prefabHeaderEl ||
        !prefabHeaderTitleEl ||
        !prefabHeaderRevertBtn ||
        !prefabHeaderApplyBtn
      )
        return;
      if (!info) {
        prefabHeaderEl.style.display = 'none';
        return;
      }
      prefabHeaderEl.style.display = 'flex';
      prefabHeaderTitleEl.textContent = `Prefab: ${info.sourceName} · ${String(info.overrideCount)} override${info.overrideCount === 1 ? '' : 's'}`;
      // Disable Apply / Revert when there's nothing to apply or revert.
      const hasOverrides = info.overrideCount > 0;
      prefabHeaderRevertBtn.disabled = !hasOverrides;
      prefabHeaderApplyBtn.disabled = !hasOverrides;
    };

    const refreshInspector = (): void => {
      if (!inspectorGrid) return;
      const selectedIds = selection.getSelection();
      const selectedId = selectedIds[0];
      const parsed = selectedId !== undefined ? parseSelectionRef(selectedId) : undefined;

      // Asset selection → hand off to the AssetInspectorWidget.
      if (parsed?.kind === 'asset') {
        showAsset(catalog.getByUuid(parsed.uuid));
        updatePrefabHeader(undefined);
        return;
      }

      // Entity selection → normal property grid flow.
      showEntity();
      const ecs = presence.current;
      if (!ecs) {
        inspectorGrid.setData([], {});
        updatePrefabHeader(undefined);
        return;
      }
      const entityId = parsed?.kind === 'entity' ? parsed.id : undefined;
      if (entityId === undefined) {
        inspectorGrid.setData([], {});
        updatePrefabHeader(undefined);
        return;
      }
      let tracked = getInspectorOrder(entityId);
      if (!tracked) {
        tracked = sortByDefaultPriority(ecs.getComponents(entityId));
        setInspectorOrder(entityId, tracked);
      }
      const { groups, values } = ecsToPropertyGroups(ecs, entityId, componentFilter, tracked);

      // Compute prefab override decorations for this entity.
      const overriddenKeys = prefabService.getOverriddenFieldKeys(entityId);
      const overriddenComponentIds = new Set<string>();
      for (const group of groups) {
        if (prefabService.isComponentOverridden(entityId, group.id)) {
          overriddenComponentIds.add(group.id);
        }
      }
      // Build source-value tooltips for every overridden key so the
      // Inspector can reveal the authored value on hover.
      const sourceValueTooltips = new Map<string, string>();
      for (const key of overriddenKeys) {
        const dot = key.indexOf('.');
        if (dot <= 0) continue;
        const compType = key.substring(0, dot);
        const fieldPath = key.substring(dot + 1);
        const sourceValue = prefabService.getSourceFieldValue(entityId, compType, fieldPath);
        if (sourceValue === undefined) continue;
        sourceValueTooltips.set(key, `Source: ${formatSourceValue(sourceValue)}`);
      }
      inspectorGrid.setData(groups, values, {
        overriddenKeys,
        overriddenComponentIds,
        sourceValueTooltips,
      });
      updatePrefabHeader(prefabService.getInstanceInfo(entityId));
    };

    ctx.subscriptions.add(
      presence.onDidBind((ecs) => {
        ctx.subscriptions.add(ecs.onPropertyChanged(refreshInspector));
        ctx.subscriptions.add(ecs.onComponentAdded(refreshInspector));
        ctx.subscriptions.add(ecs.onComponentRemoved(refreshInspector));
        ctx.subscriptions.add(
          ecs.onMetadataChanged(() => {
            refreshInspector();
          }),
        );
        refreshInspector();
      }),
    );

    ctx.subscriptions.add(
      selection.onDidChangeSelection(() => {
        refreshInspector();
        renderContextSvc.context.requestRender(); // update Scene View selection highlight
      }),
    );

    ctx.subscriptions.add(
      catalog.onDidChange(() => {
        refreshInspector();
      }),
    );
    ctx.subscriptions.add(
      catalog.onDidChangeImporter(() => {
        refreshInspector();
      }),
    );
    ctx.subscriptions.add(
      prefabService.onDidHotReload(() => {
        refreshInspector();
      }),
    );
    ctx.subscriptions.add(
      prefabService.onDidCreateInstance(() => {
        refreshInspector();
      }),
    );

    ctx.subscriptions.add(
      layout.registerPanel({ id: 'inspector', title: 'Inspector', defaultRegion: 'right' }),
    );
    ctx.subscriptions.add(
      view.registerFactory('inspector', (id) => {
        // Inject one-shot CSS for the host container's view switching.
        if (!document.getElementById('editrix-inspector-host-styles')) {
          const style = document.createElement('style');
          style.id = 'editrix-inspector-host-styles';
          style.textContent = `
.editrix-inspector-host { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; position: relative; }
.editrix-inspector-view { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; }
.editrix-inspector-view--hidden { display: none !important; }
.editrix-prefab-grid-host { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.editrix-prefab-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 10px; gap: 8px;
  background: linear-gradient(180deg, rgba(90,164,255,0.12) 0%, rgba(90,164,255,0.04) 100%);
  border-bottom: 1px solid rgba(90,164,255,0.25);
  font-size: 11px; color: var(--editrix-text);
  flex-shrink: 0;
}
.editrix-prefab-header__title { font-weight: 600; }
.editrix-prefab-header__actions { display: flex; gap: 6px; }
.editrix-prefab-header__btn {
  background: #3a3b40; color: #ccc;
  border: 1px solid #4a4b50; border-radius: 4px;
  padding: 3px 9px; font-size: 11px; cursor: pointer;
  font-family: inherit;
}
.editrix-prefab-header__btn:hover:not(:disabled) { background: #46474C; color: #fff; }
.editrix-prefab-header__btn:disabled { opacity: 0.5; cursor: not-allowed; }
.editrix-prefab-header__btn--primary { background: #4a8fff; color: #fff; border-color: transparent; }
.editrix-prefab-header__btn--primary:hover:not(:disabled) { background: #5aa4ff; }
`;
          document.head.appendChild(style);
        }

        const assetPicker: AssetPickerBinding = {
          resolve: (ref) => resolveAssetPreview(catalog, ref),
          requestPicker: (args) => {
            // `assetType` (from the property descriptor) scopes the picker
            // to the kind the field expects — textures for Sprite.texture,
            // anim-clips for SpriteAnimator.clip, etc. Undefined = no
            // field-kind info, show every asset.
            const wanted = pickerAssetType(args.assetType);
            const items = catalog
              .getAll()
              .filter((a) => wanted === undefined || a.type === wanted)
              .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
            showQuickPick({
              anchor: args.anchor,
              placeholder: pickerPlaceholder(wanted),
              items: items.map((a) => ({
                id: a.uuid,
                label: assetFilename(a.relativePath),
                description: assetFolder(a.relativePath),
                ...(a.type === 'image' ? { iconUrl: assetUrl(a.relativePath) } : {}),
                ...(args.currentRef === a.uuid ? { disabled: true } : {}),
              })),
              onSelect: (item) => {
                args.setValue(item.id);
              },
            });
          },
        };

        inspectorGrid = new PropertyGridWidget(id, {
          assetPicker,
          onChange: (key, value) => {
            const ecs = presence.current;
            const selectedId = selection.getSelection()[0];
            const entityId = selectedId !== undefined ? selectionToEntityId(selectedId) : undefined;
            if (entityId === undefined || !ecs) return;
            const dotIdx = key.indexOf('.');
            if (dotIdx <= 0) return;
            const comp = key.substring(0, dotIdx);
            const field = key.substring(dotIdx + 1);
            const fieldDesc = ecs.getComponentSchema(comp).find((f) => f.key === field);
            if (fieldDesc?.type === 'asset') {
              const next = typeof value === 'string' && value !== '' ? value : undefined;
              ecs.setEntityMetadata(entityId, assetMetadataKey(key), next);
              refreshInspector();
              return;
            }
            ecs.setProperty(entityId, comp, field, value);
          },
        });

        // ── Field-level revert menu (prefab override UI) ──
        // The grid emits this on every right-click. We only show a menu
        // when the field is currently overridden — otherwise we'd be
        // hijacking right-click for no reason.
        inspectorGrid.onDidRequestFieldMenu(({ fieldKey, isOverridden, x, y }) => {
          if (!isOverridden) return;
          const ecs = presence.current;
          const selectedId = selection.getSelection()[0];
          const entityId = selectedId !== undefined ? selectionToEntityId(selectedId) : undefined;
          if (entityId === undefined || !ecs) return;
          const dotIdx = fieldKey.indexOf('.');
          if (dotIdx <= 0) return;
          const comp = fieldKey.substring(0, dotIdx);
          const fieldPath = fieldKey.substring(dotIdx + 1);
          // Strip the trailing .x/.y/.z/.w/.r/.g/.b/.a sub-axis when the
          // field is part of a vec/color row — the override is on the
          // composite leaf, not the sub-component.
          const parentField = /\.[xyzwrgba]$/.test(fieldPath)
            ? fieldPath.replace(/\.[xyzwrgba]$/, '')
            : fieldPath;
          // Sub-keys the user is reverting/applying as a unit — axes of a
          // vec/color composite plus the primary key. Dedup via Set.
          const affectedKeys = [
            ...new Set([
              fieldPath,
              ...['x', 'y', 'z', 'w', 'r', 'g', 'b', 'a'].map((s) => `${parentField}.${s}`),
            ]),
          ];
          showContextMenu({
            x,
            y,
            items: [
              {
                label: `Apply "${parentField}" to Source`,
                icon: 'save',
                onSelect: () => {
                  const refs = affectedKeys.map((k) => ({
                    prefabEntityId: ecs.getEntityMetadata(entityId, 'prefab:entityId') as string,
                    type: 'property' as const,
                    componentType: comp,
                    propertyName: k,
                  }));
                  prefabService.applyToSource(entityId, refs).catch((err: unknown) => {
                    logError(
                      `Apply ${parentField}: ${err instanceof Error ? err.message : String(err)}`,
                      'prefab',
                    );
                  });
                },
              },
              {
                label: `Revert "${parentField}" to Source`,
                icon: 'refresh',
                onSelect: () => {
                  for (const k of affectedKeys) {
                    prefabService.revertPropertyOverride(entityId, comp, k);
                  }
                },
              },
            ],
          });
        });

        // ── Add Component ──
        inspectorGrid.onDidRequestAddComponent(() => {
          const ecs = presence.current;
          const selectedId = selection.getSelection()[0];
          const entityId = selectedId !== undefined ? selectionToEntityId(selectedId) : undefined;
          if (entityId === undefined || !ecs) return;
          const grid = inspectorGrid;
          const existing = new Set(ecs.getComponents(entityId));
          const available = ecs
            .getAvailableComponents()
            .filter((c) => !componentFilter.isHidden(c));

          const anchor = grid
            ?.getRootElement()
            ?.querySelector('.editrix-inspector-add-btn') as HTMLElement | null;
          if (!anchor) return;

          showQuickPick({
            items: [...available].sort().map((name) => ({
              id: name,
              label: name,
              icon: componentIconMap[name] ?? 'component',
              disabled: existing.has(name),
              ...(existing.has(name) ? { description: 'Already added' } : {}),
            })),
            anchor,
            placeholder: 'Search components...',
            onSelect: (item) => {
              // Wrap addComponent so a throw from the ECS side surfaces in the
              // editor's console panel instead of failing silently.
              try {
                ecs.addComponent(entityId, item.id);
              } catch (err) {
                logError(
                  `Add ${item.id}: ${err instanceof Error ? err.message : String(err)}`,
                  'add-component',
                );
                return;
              }
              // Pin the new card to the end of the inspector for this entity.
              appendToInspectorOrder(entityId, item.id);
              undoRedo.push({
                label: `Add ${item.id}`,
                undo: () => {
                  ecs.removeComponent(entityId, item.id);
                },
                redo: () => {
                  ecs.addComponent(entityId, item.id);
                  appendToInspectorOrder(entityId, item.id);
                },
              });
            },
          });
        });

        // ── Component Card Menu (⋯) ──
        inspectorGrid.onDidRequestComponentMenu(({ componentId, anchor }) => {
          const ecs = presence.current;
          const selectedId = selection.getSelection()[0];
          const entityId = selectedId !== undefined ? selectionToEntityId(selectedId) : undefined;
          if (entityId === undefined || !ecs) return;
          const isTransform = componentId === 'Transform';
          const rect = anchor.getBoundingClientRect();

          showContextMenu({
            x: rect.right,
            y: rect.bottom,
            items: [
              {
                label: 'Reset to Default',
                icon: 'refresh',
                onSelect: () => {
                  const schema = ecs.getComponentSchema(componentId);
                  if (schema.length === 0) return;
                  // Snapshot current values so we can undo back to them.
                  const previous: Record<string, unknown> = {};
                  for (const field of schema) {
                    previous[field.key] = ecs.getProperty(entityId, componentId, field.key);
                  }
                  // Apply schema defaults.
                  for (const field of schema) {
                    ecs.setProperty(entityId, componentId, field.key, field.defaultValue);
                  }
                  undoRedo.push({
                    label: `Reset ${componentId}`,
                    undo: () => {
                      for (const [key, value] of Object.entries(previous)) {
                        ecs.setProperty(entityId, componentId, key, value);
                      }
                    },
                    redo: () => {
                      for (const field of schema) {
                        ecs.setProperty(entityId, componentId, field.key, field.defaultValue);
                      }
                    },
                  });
                },
              },
              { separator: true, label: '' },
              {
                label: 'Remove Component',
                icon: 'x',
                destructive: true,
                disabled: isTransform,
                onSelect: () => {
                  const data = ecs.getComponentData(entityId, componentId);
                  ecs.removeComponent(entityId, componentId);
                  dropFromInspectorOrder(entityId, componentId);
                  undoRedo.push({
                    label: `Remove ${componentId}`,
                    undo: () => {
                      ecs.addComponent(entityId, componentId);
                      for (const [field, value] of Object.entries(data)) {
                        ecs.setProperty(entityId, componentId, field, value);
                      }
                      // Undoing a remove appends the component back to the
                      // tail of the inspector list rather than restoring the
                      // original slot. Users who care can drag once
                      // drag-to-reorder lands.
                      appendToInspectorOrder(entityId, componentId);
                    },
                    redo: () => {
                      ecs.removeComponent(entityId, componentId);
                      dropFromInspectorOrder(entityId, componentId);
                    },
                  });
                },
              },
            ],
          });
        });

        // ── Drag-to-reorder component cards ──
        inspectorGrid.onDidReorderComponent(({ componentId, targetId, position }) => {
          const ecs = presence.current;
          const selectedId = selection.getSelection()[0];
          const entityId = selectedId !== undefined ? selectionToEntityId(selectedId) : undefined;
          if (entityId === undefined || !ecs) return;
          const order = getInspectorOrder(entityId);
          if (!order) return;

          const srcIdx = order.indexOf(componentId);
          const tgtIdx = order.indexOf(targetId);
          if (srcIdx < 0 || tgtIdx < 0 || srcIdx === tgtIdx) return;

          const [moved] = order.splice(srcIdx, 1);
          if (!moved) return;
          // After splicing the source out, the target index may have shifted
          // down by one. Recompute before inserting.
          const newTgtIdx = order.indexOf(targetId);
          const insertAt = position === 'before' ? newTgtIdx : newTgtIdx + 1;
          order.splice(insertAt, 0, moved);

          const before = [...order];
          const prevIndex = srcIdx;
          const reorderTo = (desired: readonly string[]): void => {
            setInspectorOrder(entityId, desired);
            refreshInspector();
          };
          reorderTo(order);
          undoRedo.push({
            label: `Reorder ${componentId}`,
            undo: () => {
              const cur = getInspectorOrder(entityId);
              if (!cur) return;
              const i = cur.indexOf(componentId);
              if (i < 0) return;
              const [m] = cur.splice(i, 1);
              if (!m) return;
              cur.splice(prevIndex, 0, m);
              setInspectorOrder(entityId, cur);
              refreshInspector();
            },
            redo: () => {
              reorderTo(before);
            },
          });
        });

        // Host widget that mounts both sub-views (entity grid + asset view)
        // side-by-side and toggles visibility. Keeps the Inspector panel
        // contract simple — one widget in, selection-aware content out.
        assetInspector = new AssetInspectorWidget(`${id}-asset`, {
          getImporterSettings: (uuid) => catalog.getImporterSettings(uuid),
          setImporterSettings: (uuid, patch) => catalog.setImporterSettings(uuid, patch),
        });
        const hostGrid = inspectorGrid;
        const hostAsset = assetInspector;
        const host = {
          id,
          get hasFocus(): boolean {
            return hostGrid.hasFocus || hostAsset.hasFocus;
          },
          mount(container: unknown): void {
            const parent = container as HTMLElement;
            const root = document.createElement('div');
            root.className = 'editrix-inspector-host';
            parent.appendChild(root);

            entityContainer = document.createElement('div');
            entityContainer.className = 'editrix-inspector-view';
            root.appendChild(entityContainer);

            // Prefab instance strip — sits above the property grid inside
            // the entity view, hidden when the selected entity isn't part
            // of an instance. Held visible by `updatePrefabHeader`.
            prefabHeaderEl = document.createElement('div');
            prefabHeaderEl.className = 'editrix-prefab-header';
            prefabHeaderEl.style.display = 'none';
            prefabHeaderTitleEl = document.createElement('span');
            prefabHeaderTitleEl.className = 'editrix-prefab-header__title';
            prefabHeaderEl.appendChild(prefabHeaderTitleEl);
            const headerActions = document.createElement('div');
            headerActions.className = 'editrix-prefab-header__actions';
            const revealBtn = document.createElement('button');
            revealBtn.className = 'editrix-prefab-header__btn';
            revealBtn.title = 'Reveal source in Content Browser';
            revealBtn.textContent = 'Select Source';
            revealBtn.addEventListener('click', () => {
              const sel = selection.getSelection()[0];
              const entityId = sel !== undefined ? selectionToEntityId(sel) : undefined;
              if (entityId === undefined) return;
              const info = prefabService.getInstanceInfo(entityId);
              if (!info) return;
              tryReveal()?.revealByUuid(info.sourceUuid);
            });
            headerActions.appendChild(revealBtn);
            prefabHeaderRevertBtn = document.createElement('button');
            prefabHeaderRevertBtn.className = 'editrix-prefab-header__btn';
            prefabHeaderRevertBtn.textContent = 'Revert All';
            prefabHeaderRevertBtn.addEventListener('click', () => {
              const sel = selection.getSelection()[0];
              const entityId = sel !== undefined ? selectionToEntityId(sel) : undefined;
              if (entityId !== undefined) prefabService.revertAll(entityId);
            });
            prefabHeaderApplyBtn = document.createElement('button');
            prefabHeaderApplyBtn.className =
              'editrix-prefab-header__btn editrix-prefab-header__btn--primary';
            prefabHeaderApplyBtn.textContent = 'Apply...';
            prefabHeaderApplyBtn.addEventListener('click', () => {
              const sel = selection.getSelection()[0];
              const entityId = sel !== undefined ? selectionToEntityId(sel) : undefined;
              if (entityId === undefined) return;
              const ecs = presence.current;
              if (!ecs) return;
              showApplyPrefabDialog({
                entityId,
                ecs,
                prefabService,
                onConfirm: async (selected) => {
                  try {
                    await prefabService.applyToSource(entityId, selected);
                  } catch (err) {
                    logError(
                      `Apply to source: ${err instanceof Error ? err.message : String(err)}`,
                      'prefab',
                    );
                  }
                },
              });
            });
            headerActions.appendChild(prefabHeaderRevertBtn);
            headerActions.appendChild(prefabHeaderApplyBtn);
            prefabHeaderEl.appendChild(headerActions);
            entityContainer.appendChild(prefabHeaderEl);

            // Property grid mounts INSIDE the entity view, after the strip.
            const gridHost = document.createElement('div');
            gridHost.className = 'editrix-prefab-grid-host';
            entityContainer.appendChild(gridHost);
            hostGrid.mount(gridHost);

            assetContainer = document.createElement('div');
            assetContainer.className = 'editrix-inspector-view editrix-inspector-view--hidden';
            root.appendChild(assetContainer);
            hostAsset.mount(assetContainer);

            refreshInspector();
          },
          resize(w: number, h: number): void {
            hostGrid.resize(w, h);
            hostAsset.resize(w, h);
          },
          focus(): void {
            hostGrid.focus();
          },
          dispose(): void {
            hostGrid.dispose();
            hostAsset.dispose();
          },
        };
        return host;
      }),
    );
  },
};
