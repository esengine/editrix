import type { ComponentFieldSchema, IECSSceneService } from '@editrix/estella';
import { IConsoleService } from '@editrix/plugin-console';
import type { PropertyGroup, PropertyType } from '@editrix/properties';
import type { IPlugin, IPluginContext } from '@editrix/shell';
import { ILayoutService, ISelectionService, IUndoRedoService, IViewService } from '@editrix/shell';
import { PropertyGridWidget, showContextMenu, showQuickPick } from '@editrix/view-dom';
import { IECSScenePresence, IInspectorComponentFilter, ISharedRenderContext, parseSelectionRef } from '../services.js';

/** Resolve a selection-service id back to its entity number, if it is one. */
function selectionToEntityId(serialized: string): number | undefined {
  const ref = parseSelectionRef(serialized);
  return ref?.kind === 'entity' ? ref.id : undefined;
}

// ─── ECS field-type → Inspector PropertyType ──────────────

function fieldTypeToPropertyType(type: ComponentFieldSchema['type']): PropertyType {
  switch (type) {
    case 'float': return 'number';
    case 'int': return 'number';
    case 'bool': return 'boolean';
    // 'color' in ECS is a packed numeric — long term we'd render a color
    // swatch, but the inspector's color control wants a hex string today.
    // Treat as number for now so the value at least round-trips.
    case 'color': return 'number';
    case 'enum': return 'enum';
    case 'string': return 'string';
    case 'asset': return 'asset';
    case 'entity': return 'entity';
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
  Transform:   0,
  UIRect:      1,
  Sprite:      10,
  Image:       11,
  Text:        12,
  BitmapText:  13,
  UIRenderer:  14,
  Camera:      20,
  Canvas:      21,
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
      })),
    });

    for (const f of schema) {
      const fullKey = `${compName}.${f.key}`;
      values[fullKey] = ecs.getProperty(entityId, compName, f.key);
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
    dependencies: ['editrix.layout', 'editrix.view', 'editrix.properties', 'app.ecs-scene', 'app.inspector-filters'],
  },
  activate(ctx: IPluginContext) {
    const layout = ctx.services.get(ILayoutService);
    const view = ctx.services.get(IViewService);
    const selection = ctx.services.get(ISelectionService);
    const undoRedo = ctx.services.get(IUndoRedoService);
    const presence = ctx.services.get(IECSScenePresence);
    const renderContextSvc = ctx.services.get(ISharedRenderContext);
    const componentFilter = ctx.services.get(IInspectorComponentFilter);

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

    const refreshInspector = (): void => {
      if (!inspectorGrid) return;
      const ecs = presence.current;
      if (!ecs) {
        inspectorGrid.setData([], {});
        return;
      }
      const selectedIds = selection.getSelection();
      const selectedId = selectedIds[0];
      const entityId = selectedId !== undefined ? selectionToEntityId(selectedId) : undefined;
      if (entityId === undefined) {
        // Either nothing is selected, or the selection is an asset/folder/etc.
        // The inspector renders entity property grids only — clear when off-target.
        inspectorGrid.setData([], {});
        return;
      }
      let tracked = getInspectorOrder(entityId);
      if (!tracked) {
        tracked = sortByDefaultPriority(ecs.getComponents(entityId));
        setInspectorOrder(entityId, tracked);
      }
      const { groups, values } = ecsToPropertyGroups(ecs, entityId, componentFilter, tracked);
      inspectorGrid.setData(groups, values);
    };

    ctx.subscriptions.add(presence.onDidBind((ecs) => {
      ctx.subscriptions.add(ecs.onPropertyChanged(refreshInspector));
      ctx.subscriptions.add(ecs.onComponentAdded(refreshInspector));
      ctx.subscriptions.add(ecs.onComponentRemoved(refreshInspector));
      refreshInspector();
    }));

    ctx.subscriptions.add(selection.onDidChangeSelection(() => {
      refreshInspector();
      renderContextSvc.context.requestRender(); // update Scene View selection highlight
    }));

    ctx.subscriptions.add(layout.registerPanel({ id: 'inspector', title: 'Inspector', defaultRegion: 'right' }));
    ctx.subscriptions.add(
      view.registerFactory('inspector', (id) => {
        inspectorGrid = new PropertyGridWidget(id, {
          onChange: (key, value) => {
            const ecs = presence.current;
            const selectedId = selection.getSelection()[0];
            const entityId = selectedId !== undefined ? selectionToEntityId(selectedId) : undefined;
            if (entityId === undefined || !ecs) return;
            const dotIdx = key.indexOf('.');
            if (dotIdx <= 0) return;
            const comp = key.substring(0, dotIdx);
            const field = key.substring(dotIdx + 1);
            ecs.setProperty(entityId, comp, field, value);
          },
        });

        // ── Add Component ──
        inspectorGrid.onDidRequestAddComponent(() => {
          const ecs = presence.current;
          const selectedId = selection.getSelection()[0];
          const entityId = selectedId !== undefined ? selectionToEntityId(selectedId) : undefined;
          if (entityId === undefined || !ecs) return;
          const grid = inspectorGrid;
          const existing = new Set(ecs.getComponents(entityId));
          const available = ecs.getAvailableComponents().filter((c) => !componentFilter.isHidden(c));

          const anchor = grid?.getRootElement()?.querySelector('.editrix-inspector-add-btn') as HTMLElement | null;
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
                logError(`Add ${item.id}: ${err instanceof Error ? err.message : String(err)}`,
                  'add-component');
                return;
              }
              // Pin the new card to the end of the inspector for this entity.
              appendToInspectorOrder(entityId, item.id);
              undoRedo.push({
                label: `Add ${item.id}`,
                undo: () => { ecs.removeComponent(entityId, item.id); },
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
                label: 'Reset to Default', icon: 'refresh',
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
                label: 'Remove Component', icon: 'x', destructive: true,
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
            redo: () => { reorderTo(before); },
          });
        });

        refreshInspector();
        return inspectorGrid;
      }),
    );
  },
};
