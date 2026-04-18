import type { IECSSceneService } from '@editrix/estella';
import type { IPlugin, IPluginContext } from '@editrix/shell';
import { ILayoutService, ISelectionService, IUndoRedoService, IViewService } from '@editrix/shell';
import type { TreeNode } from '@editrix/view-dom';
import { showContextMenu, TreeWidget } from '@editrix/view-dom';
import { IECSScenePresence } from '../services.js';

interface EntitySnapshot {
  readonly name: string;
  readonly parentId: number | null;
  readonly components: readonly string[];
  readonly componentData: Record<string, Record<string, unknown>>;
  readonly children: readonly EntitySnapshot[];
}

function ecsToTreeNodes(ecs: IECSSceneService, entityIds: readonly number[]): TreeNode[] {
  return entityIds.map((id) => {
    const children = ecs.getChildren(id);
    return {
      id: String(id),
      label: ecs.getName(id) || `Entity ${String(id)}`,
      ...(children.length > 0 ? { children: ecsToTreeNodes(ecs, children) } : {}),
    };
  });
}

/** Recursively capture an entity's full state for undo. */
function captureEntitySnapshot(ecs: IECSSceneService, entityId: number): EntitySnapshot {
  const components = ecs.getComponents(entityId);
  const componentData: Record<string, Record<string, unknown>> = {};
  for (const comp of components) {
    componentData[comp] = ecs.getComponentData(entityId, comp);
  }
  const childIds = ecs.getChildren(entityId);
  return {
    name: ecs.getName(entityId) || `Entity ${String(entityId)}`,
    parentId: ecs.getParent(entityId),
    components: [...components],
    componentData,
    children: childIds.map((id) => captureEntitySnapshot(ecs, id)),
  };
}

/** Recursively restore an entity from a snapshot. Returns the new entity ID. */
function restoreEntitySnapshot(
  ecs: IECSSceneService,
  snapshot: EntitySnapshot,
  parentId?: number,
): number {
  const newId = ecs.createEntity(snapshot.name, parentId);
  for (const comp of snapshot.components) {
    if (comp === 'Transform') continue; // createEntity already adds Transform
    ecs.addComponent(newId, comp);
  }
  for (const [comp, data] of Object.entries(snapshot.componentData)) {
    for (const [field, value] of Object.entries(data)) {
      ecs.setProperty(newId, comp, field, value);
    }
  }
  for (const childSnapshot of snapshot.children) {
    restoreEntitySnapshot(ecs, childSnapshot, newId);
  }
  return newId;
}

/**
 * Hierarchy panel plugin: tree of ECS entities with create / delete / reorder
 * affordances and selection-service round-trip.
 *
 * Defers all ECS access through {@link IECSScenePresence}; the panel renders
 * fine before WASM loads (just empty). Once the scene binds, it refreshes and
 * subscribes to onHierarchyChanged for live updates.
 */
export const HierarchyPlugin: IPlugin = {
  descriptor: {
    id: 'app.hierarchy',
    version: '1.0.0',
    dependencies: ['editrix.layout', 'editrix.view', 'editrix.properties', 'app.ecs-scene'],
  },
  activate(ctx: IPluginContext) {
    const layout = ctx.services.get(ILayoutService);
    const view = ctx.services.get(IViewService);
    const selection = ctx.services.get(ISelectionService);
    const undoRedo = ctx.services.get(IUndoRedoService);
    const presence = ctx.services.get(IECSScenePresence);

    let hierarchyTree: TreeWidget | undefined;

    const refreshHierarchy = (): void => {
      const ecs = presence.current;
      if (!hierarchyTree || !ecs) return;
      hierarchyTree.setRoots(ecsToTreeNodes(ecs, ecs.getRootEntities()));
    };

    ctx.subscriptions.add(presence.onDidBind((ecs) => {
      ctx.subscriptions.add(ecs.onHierarchyChanged(refreshHierarchy));
      refreshHierarchy();
    }));

    ctx.subscriptions.add(layout.registerPanel({ id: 'hierarchy', title: 'Hierarchy', defaultRegion: 'left' }));
    ctx.subscriptions.add(
      view.registerFactory('hierarchy', (id) => {
        // showVisibility is off until ECS gains a Visibility component to bind to.
        hierarchyTree = new TreeWidget(id, { showFilter: true, showAddButton: true, addButtonLabel: 'Add Entity' });
        refreshHierarchy();

        let syncingSelection = false;
        hierarchyTree.onDidChangeSelection((ids) => {
          if (syncingSelection) return;
          selection.select(ids);
        });

        ctx.subscriptions.add(selection.onDidChangeSelection((ids) => {
          if (!hierarchyTree) return;
          syncingSelection = true;
          hierarchyTree.setSelection(ids);
          syncingSelection = false;
        }));

        hierarchyTree.onDidRequestAdd(() => {
          const ecs = presence.current;
          if (!ecs) return;
          const entityId = ecs.createEntity('New Entity');
          selection.select([String(entityId)]);
          undoRedo.push({
            label: 'Create Entity',
            undo: () => { ecs.destroyEntity(entityId); selection.clearSelection(); },
            redo: () => {
              const newId = ecs.createEntity('New Entity');
              selection.select([String(newId)]);
            },
          });
        });

        const deleteEntities = (ids: readonly string[]): void => {
          const ecs = presence.current;
          if (!ecs || ids.length === 0) return;
          // Filter to only root-level entities in the selection (skip children of selected parents).
          const idSet = new Set(ids);
          const toDelete = ids.filter((rawId) => {
            const parentId = ecs.getParent(Number(rawId));
            return parentId === null || !idSet.has(String(parentId));
          });
          const snapshots = toDelete.map((rawId) => captureEntitySnapshot(ecs, Number(rawId)));
          const previousSelection = [...selection.getSelection()];
          for (const rawId of toDelete) {
            ecs.destroyEntity(Number(rawId));
          }
          selection.clearSelection();
          undoRedo.push({
            label: ids.length === 1 ? 'Delete Entity' : `Delete ${String(ids.length)} Entities`,
            undo: () => {
              const newIds: string[] = [];
              for (const snapshot of snapshots) {
                const newId = restoreEntitySnapshot(ecs, snapshot, snapshot.parentId ?? undefined);
                newIds.push(String(newId));
              }
              selection.select(newIds.length > 0 ? newIds : previousSelection);
            },
            redo: () => {
              // Re-capturing entities by name match is fragile; just delete the
              // most recently created tail (which are the ones undo created).
              const currentRoots = ecs.getRootEntities();
              const tail = currentRoots.slice(-snapshots.length);
              for (const tailId of tail) {
                ecs.destroyEntity(tailId);
              }
              selection.clearSelection();
            },
          });
        };

        hierarchyTree.onDidRequestDelete((ids) => { deleteEntities(ids); });

        hierarchyTree.onDidRequestContextMenu(({ ids, x, y }) => {
          const ecs = presence.current;
          if (!ecs) return;
          const tree = hierarchyTree;
          const singleId = ids[0];
          showContextMenu({
            x, y,
            items: [
              {
                label: 'Add Child Entity', icon: 'plus',
                disabled: ids.length !== 1,
                onSelect: () => {
                  if (!singleId) return;
                  const childId = ecs.createEntity('New Entity', Number(singleId));
                  tree?.expand(singleId);
                  selection.select([String(childId)]);
                },
              },
              { separator: true, label: '' },
              { label: 'Rename', shortcut: 'F2', disabled: true },
              { label: 'Duplicate', shortcut: 'Ctrl+D', disabled: true },
              { separator: true, label: '' },
              {
                label: ids.length === 1 ? 'Delete' : `Delete (${String(ids.length)})`,
                icon: 'x', shortcut: 'Del', destructive: true,
                onSelect: () => { deleteEntities(ids); },
              },
            ],
          });
        });

        return hierarchyTree;
      }),
    );
  },
};
