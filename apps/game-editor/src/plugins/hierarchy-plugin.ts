import { IFileSystemService } from '@editrix/core';
import type { IECSSceneService } from '@editrix/estella';
import type { IPlugin, IPluginContext } from '@editrix/shell';
import {
  IDialogService,
  IDocumentService,
  ILayoutService,
  INotificationService,
  ISelectionService,
  IUndoRedoService,
  IViewService,
  IWorkspaceService,
} from '@editrix/shell';
import type { TreeNode } from '@editrix/view-dom';
import { registerIcon, showContextMenu, TreeWidget } from '@editrix/view-dom';
import { captureEntitySnapshot, restoreEntitySnapshot } from '../scene-ops.js';
import {
  entityRef,
  IAssetCatalogService,
  IECSScenePresence,
  IPrefabService,
  parseSelectionRef,
  PREFAB_METADATA_KEYS,
} from '../services.js';

// One-shot registrations — safe to call during module eval because the
// default icon registry is a singleton. `editrix-prefab-label` carries the
// blue color via CSS injected once below.
registerIcon(
  'prefab-instance',
  // Isometric-ish cube silhouette, hardcoded blue so the icon stays distinctive
  // regardless of the row's selection/hover text color.
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5aa4ff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M12 3 3 7.5v9L12 21l9-4.5v-9L12 3Z"/>' +
    '<path d="M3 7.5 12 12l9-4.5"/>' +
    '<path d="M12 12v9"/>' +
    '</svg>',
);

// Blue label color for prefab instance roots — one-time stylesheet injection
// so the hierarchy plugin owns its own styling without pulling it into the
// framework's tree-widget CSS.
if (typeof document !== 'undefined' && !document.getElementById('editrix-hierarchy-prefab-style')) {
  const style = document.createElement('style');
  style.id = 'editrix-hierarchy-prefab-style';
  style.textContent = `
    .editrix-tree-label.editrix-prefab-label {
      color: #5aa4ff;
    }
    .editrix-tree-row--selected .editrix-tree-label.editrix-prefab-label {
      /* keep contrast against the selected-row background */
      color: #b7d6ff;
    }
    /* External-MIME drop target (e.g. prefab drag from Content Browser). */
    .editrix-tree-row--external-drop {
      outline: 1px solid #5aa4ff;
      background: rgba(90,164,255,0.12);
    }
  `;
  document.head.appendChild(style);
}

function ecsToTreeNodes(ecs: IECSSceneService, entityIds: readonly number[]): TreeNode[] {
  return entityIds.map((id) => {
    const children = ecs.getChildren(id);
    const isInstanceRoot =
      typeof ecs.getEntityMetadata(id, PREFAB_METADATA_KEYS.SOURCE) === 'string';
    const label = ecs.getName(id) || `Entity ${String(id)}`;
    return {
      id: entityRef(id),
      label,
      ...(isInstanceRoot
        ? { icon: 'prefab-instance', labelClassName: 'editrix-prefab-label' }
        : {}),
      ...(children.length > 0 ? { children: ecsToTreeNodes(ecs, children) } : {}),
    };
  });
}

/** Resolve a selection-service id back to its entity number, if it is one. */
function selectionToEntityId(serialized: string): number | undefined {
  const ref = parseSelectionRef(serialized);
  return ref?.kind === 'entity' ? ref.id : undefined;
}

export const HierarchyPlugin: IPlugin = {
  descriptor: {
    id: 'app.hierarchy',
    version: '1.0.0',
    dependencies: [
      'editrix.layout',
      'editrix.view',
      'editrix.properties',
      'app.ecs-scene',
      'app.document-sync',
      'app.prefab',
      'app.asset-catalog',
    ],
  },
  activate(ctx: IPluginContext) {
    const layout = ctx.services.get(ILayoutService);
    const view = ctx.services.get(IViewService);
    const selection = ctx.services.get(ISelectionService);
    const undoRedo = ctx.services.get(IUndoRedoService);
    const presence = ctx.services.get(IECSScenePresence);
    const documentService = ctx.services.get(IDocumentService);
    const prefabService = ctx.services.get(IPrefabService);
    const project = ctx.services.get(IWorkspaceService);
    const fileSystem = ctx.services.get(IFileSystemService);
    const catalog = ctx.services.get(IAssetCatalogService);
    const dialogs = ctx.services.get(IDialogService);
    const notifications = ctx.services.get(INotificationService);

    const hasActiveSceneDoc = (): boolean => {
      return documentService.activeDocument?.endsWith('.scene.json') === true;
    };

    let hierarchyTree: TreeWidget | undefined;

    const refreshHierarchy = (): void => {
      const ecs = presence.current;
      if (!hierarchyTree || !ecs) return;
      hierarchyTree.setRoots(ecsToTreeNodes(ecs, ecs.getRootEntities()));
    };

    ctx.subscriptions.add(
      presence.onDidBind((ecs) => {
        ctx.subscriptions.add(ecs.onHierarchyChanged(refreshHierarchy));
        // The prefab badge in the tree is derived from `prefab:source` metadata,
        // so any time that key flips on/off (instantiate, hot-reload, undo of a
        // create-prefab) we redraw the affected row by refreshing wholesale.
        ctx.subscriptions.add(
          ecs.onMetadataChanged((ev) => {
            if (ev.key === PREFAB_METADATA_KEYS.SOURCE) refreshHierarchy();
          }),
        );
        refreshHierarchy();
      }),
    );
    ctx.subscriptions.add(prefabService.onDidCreateInstance(refreshHierarchy));
    ctx.subscriptions.add(prefabService.onDidHotReload(refreshHierarchy));

    ctx.subscriptions.add(
      layout.registerPanel({ id: 'hierarchy', title: 'Hierarchy', defaultRegion: 'left' }),
    );

    const refreshAddButtonState = (): void => {
      const root = hierarchyTree?.getRootElement();
      if (!root) return;
      const btn = root.querySelector<HTMLButtonElement>('.editrix-tree-add-btn');
      if (!btn) return;
      const enabled = hasActiveSceneDoc();
      btn.disabled = !enabled;
      btn.style.opacity = enabled ? '' : '0.4';
      btn.style.cursor = enabled ? '' : 'not-allowed';
      btn.title = enabled ? '' : 'Open or create a scene to add entities';
    };
    ctx.subscriptions.add(documentService.onDidChangeActive(refreshAddButtonState));
    ctx.subscriptions.add(documentService.onDidChangeDocuments(refreshAddButtonState));

    ctx.subscriptions.add(
      view.registerFactory('hierarchy', (id) => {
        const canDrop = (sourceRaws: readonly string[], targetRaw: string): boolean => {
          const ecs = presence.current;
          if (!ecs) return false;
          const targetId = selectionToEntityId(targetRaw);
          if (targetId === undefined) return false;
          const sourceIds = sourceRaws
            .map(selectionToEntityId)
            .filter((id): id is number => id !== undefined);
          if (sourceIds.length === 0) return false;
          if (sourceIds.includes(targetId)) return false;
          for (const sourceId of sourceIds) {
            let cursor: number | null = targetId;
            while (cursor !== null) {
              if (cursor === sourceId) return false;
              cursor = ecs.getParent(cursor);
            }
          }
          return true;
        };
        hierarchyTree = new TreeWidget(id, {
          showFilter: true,
          showAddButton: true,
          addButtonLabel: 'Add Entity',
          enableDrag: true,
          multiSelect: true,
          canDrop,
        });
        refreshHierarchy();
        refreshAddButtonState();

        let syncingSelection = false;
        hierarchyTree.onDidChangeSelection((ids) => {
          if (syncingSelection) return;
          selection.select(ids);
        });

        ctx.subscriptions.add(
          selection.onDidChangeSelection((ids) => {
            if (!hierarchyTree) return;
            syncingSelection = true;
            hierarchyTree.setSelection(ids);
            syncingSelection = false;
          }),
        );

        hierarchyTree.onDidRequestAdd(() => {
          const ecs = presence.current;
          if (!ecs) return;
          if (!hasActiveSceneDoc()) return;
          const entityId = ecs.createEntity('New Entity');
          selection.select([entityRef(entityId)]);
          undoRedo.push({
            label: 'Create Entity',
            undo: () => {
              ecs.destroyEntity(entityId);
              selection.clearSelection();
            },
            redo: () => {
              const newId = ecs.createEntity('New Entity');
              selection.select([entityRef(newId)]);
            },
          });
        });

        const deleteEntities = (rawIds: readonly string[]): void => {
          const ecs = presence.current;
          if (!ecs || rawIds.length === 0) return;
          // Resolve entity selections only — non-entity selections (assets,
          // folders) are silently ignored so a stray Delete keystroke can't
          // wipe an entity when the user actually has an asset card focused.
          const entityIds = rawIds
            .map(selectionToEntityId)
            .filter((id): id is number => id !== undefined);
          if (entityIds.length === 0) return;
          // Filter to only root-level entities in the selection (skip children of selected parents).
          const entitySet = new Set(entityIds);
          let toDelete = entityIds.filter((id) => {
            const parentId = ecs.getParent(id);
            return parentId === null || !entitySet.has(parentId);
          });
          // In Prefab Mode the ECS IS the prefab. Deleting the sole root
          // would break the next save (`serialize` expects exactly one
          // root). Silently filter it out and warn — the user still sees
          // children deletion work normally.
          if (documentService.activeDocument?.endsWith('.esprefab') === true) {
            const rootsBeforeDelete = ecs.getRootEntities();
            const deletingRoot = toDelete.filter((id) => rootsBeforeDelete.includes(id));
            const remainingRoots = rootsBeforeDelete.filter((id) => !toDelete.includes(id));
            if (deletingRoot.length > 0 && remainingRoots.length === 0) {
              notifications.warn(
                'A prefab must have exactly one root entity. Delete its children instead, or exit Prefab Mode to edit a scene.',
              );
              toDelete = toDelete.filter((id) => !deletingRoot.includes(id));
              if (toDelete.length === 0) return;
            }
          }
          const snapshots = toDelete.map((id) => captureEntitySnapshot(ecs, id));
          const previousSelection = [...selection.getSelection()];
          for (const id of toDelete) {
            ecs.destroyEntity(id);
          }
          selection.clearSelection();
          undoRedo.push({
            label:
              toDelete.length === 1
                ? 'Delete Entity'
                : `Delete ${String(toDelete.length)} Entities`,
            undo: () => {
              const newRefs: string[] = [];
              for (const snapshot of snapshots) {
                const newId = restoreEntitySnapshot(ecs, snapshot, snapshot.parentId ?? undefined);
                newRefs.push(entityRef(newId));
              }
              selection.select(newRefs.length > 0 ? newRefs : previousSelection);
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

        hierarchyTree.onDidRequestDelete((ids) => {
          deleteEntities(ids);
        });

        const renameEntity = (rawId: string): void => {
          const ecs = presence.current;
          if (!ecs) return;
          const entityId = selectionToEntityId(rawId);
          if (entityId === undefined) return;
          const previous = ecs.getName(entityId) || `Entity ${String(entityId)}`;
          void dialogs
            .prompt({
              title: 'Rename Entity',
              initialValue: previous,
              okLabel: 'Rename',
            })
            .then((name) => {
              if (!name || name === previous) return;
              ecs.setName(entityId, name);
              undoRedo.push({
                label: 'Rename Entity',
                undo: () => {
                  ecs.setName(entityId, previous);
                },
                redo: () => {
                  ecs.setName(entityId, name);
                },
              });
            });
        };

        const duplicateEntities = (rawIds: readonly string[]): void => {
          const ecs = presence.current;
          if (!ecs || rawIds.length === 0) return;
          const entityIds = rawIds
            .map(selectionToEntityId)
            .filter((id): id is number => id !== undefined);
          if (entityIds.length === 0) return;
          // Filter to only roots in the selection (children come along via the
          // recursive snapshot, so duplicating an explicitly-selected child is
          // redundant when its parent is also selected).
          const entitySet = new Set(entityIds);
          const toDuplicate = entityIds.filter((id) => {
            const parentId = ecs.getParent(id);
            return parentId === null || !entitySet.has(parentId);
          });
          const snapshots = toDuplicate.map((id) => captureEntitySnapshot(ecs, id));
          const newIds: number[] = [];
          for (const snapshot of snapshots) {
            const newId = restoreEntitySnapshot(ecs, snapshot, snapshot.parentId ?? undefined);
            newIds.push(newId);
          }
          selection.select(newIds.map(entityRef));
          undoRedo.push({
            label:
              toDuplicate.length === 1
                ? 'Duplicate Entity'
                : `Duplicate ${String(toDuplicate.length)} Entities`,
            undo: () => {
              for (const id of newIds) ecs.destroyEntity(id);
              selection.select(rawIds);
            },
            redo: () => {
              const replayIds: number[] = [];
              for (const snapshot of snapshots) {
                const newId = restoreEntitySnapshot(ecs, snapshot, snapshot.parentId ?? undefined);
                replayIds.push(newId);
              }
              selection.select(replayIds.map(entityRef));
            },
          });
        };

        const createPrefabFromEntity = async (entityId: number): Promise<void> => {
          const ecs = presence.current;
          if (!ecs) return;
          const entityName = ecs.getName(entityId) || 'Prefab';
          const safeName = entityName.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'Prefab';
          const suggested = `${safeName}.esprefab`;
          const filename = await dialogs.prompt({
            title: 'Create Prefab',
            initialValue: suggested,
            placeholder: 'filename.esprefab',
            okLabel: 'Create',
          });
          if (!filename) return;

          const trimmed = filename.trim();
          const finalName = trimmed.endsWith('.esprefab') ? trimmed : `${trimmed}.esprefab`;
          const prefabsDir = project.resolve('assets/prefabs');
          const filePath = `${prefabsDir}/${finalName}`;

          if (await fileSystem.exists(filePath)) {
            const ok = await dialogs.confirm({
              message: `${finalName} already exists. Overwrite?`,
              okLabel: 'Overwrite',
              destructive: true,
            });
            if (!ok) return;
          }
          await fileSystem.mkdir(prefabsDir);

          try {
            await prefabService.createPrefab(entityId, filePath);
          } catch (err) {
            notifications.error('Could not create prefab', {
              detail: err instanceof Error ? err.message : String(err),
            });
          }
        };

        hierarchyTree.onDidRequestRename((id) => {
          renameEntity(id);
        });
        hierarchyTree.onDidRequestDuplicate((ids) => {
          duplicateEntities(ids);
        });

        hierarchyTree.onDidRequestDrop(
          ({ sourceIds: sourceRaws, targetId: targetRaw, position }) => {
            const ecs = presence.current;
            if (!ecs) return;
            const targetId = selectionToEntityId(targetRaw);
            if (targetId === undefined) return;

            // Filter to "roots in selection" — a descendant of another source
            // comes along automatically when its ancestor moves.
            const requested = sourceRaws
              .map(selectionToEntityId)
              .filter((id): id is number => id !== undefined);
            if (requested.length === 0) return;
            const requestedSet = new Set(requested);
            const roots = requested.filter((id) => {
              let cursor = ecs.getParent(id);
              while (cursor !== null) {
                if (requestedSet.has(cursor)) return false;
                cursor = ecs.getParent(cursor);
              }
              return true;
            });
            if (roots.length === 0) return;

            // Snapshot original positions for undo.
            const originals = roots.map((id) => {
              const parentId = ecs.getParent(id);
              const siblings =
                parentId === null ? ecs.getRootEntities() : ecs.getChildren(parentId);
              return { id, parentId, index: siblings.indexOf(id) };
            });

            let newParentId: number | null;
            let newIndex: number | undefined;
            if (position === 'inside') {
              newParentId = targetId;
              newIndex = undefined;
            } else {
              newParentId = ecs.getParent(targetId);
              const targetSiblings =
                newParentId === null ? ecs.getRootEntities() : ecs.getChildren(newParentId);
              const targetIdx = targetSiblings.indexOf(targetId);
              if (targetIdx === -1) return;
              newIndex = position === 'before' ? targetIdx : targetIdx + 1;
            }

            if (
              roots.length === 1 &&
              originals[0]?.parentId === newParentId &&
              originals[0].index === newIndex
            ) {
              return;
            }

            ecs.moveEntities(roots, newParentId, newIndex);

            const label =
              roots.length === 1 ? 'Move Entity' : `Move ${String(roots.length)} Entities`;
            undoRedo.push({
              label,
              undo: () => {
                // Reverse iteration so shifts from earlier removals don't
                // invalidate later recorded indices.
                for (let i = originals.length - 1; i >= 0; i--) {
                  const rec = originals[i];
                  if (!rec) continue;
                  ecs.moveEntity(rec.id, rec.parentId, rec.index);
                }
              },
              redo: () => {
                ecs.moveEntities(roots, newParentId, newIndex);
              },
            });
          },
        );

        hierarchyTree.onDidRequestContextMenu(({ ids, x, y }) => {
          const ecs = presence.current;
          if (!ecs) return;
          const tree = hierarchyTree;
          const singleId = ids[0];
          const singleEntityId = singleId ? selectionToEntityId(singleId) : undefined;
          // Eligible only when exactly one entity is selected, a project is
          // open (we need a place to write the file), and the entity isn't
          // already part of an instance (nested prefabs are a future phase).
          const canCreatePrefab =
            ids.length === 1 &&
            singleEntityId !== undefined &&
            project.isOpen &&
            !prefabService.isInsideInstance(singleEntityId);
          showContextMenu({
            x,
            y,
            items: [
              {
                label: 'Add Child Entity',
                icon: 'plus',
                disabled: ids.length !== 1,
                onSelect: () => {
                  if (!singleId) return;
                  const parentId = selectionToEntityId(singleId);
                  if (parentId === undefined) return;
                  const childId = ecs.createEntity('New Entity', parentId);
                  tree?.expand(singleId);
                  selection.select([entityRef(childId)]);
                },
              },
              { separator: true, label: '' },
              {
                label: 'Rename',
                shortcut: 'F2',
                disabled: ids.length !== 1,
                onSelect: () => {
                  if (singleId) renameEntity(singleId);
                },
              },
              {
                label: ids.length === 1 ? 'Duplicate' : `Duplicate (${String(ids.length)})`,
                shortcut: 'Ctrl+D',
                onSelect: () => {
                  duplicateEntities(ids);
                },
              },
              { separator: true, label: '' },
              {
                label: 'Create Prefab',
                disabled: !canCreatePrefab,
                onSelect: () => {
                  if (singleEntityId === undefined) return;
                  void createPrefabFromEntity(singleEntityId);
                },
              },
              { separator: true, label: '' },
              {
                label: ids.length === 1 ? 'Delete' : `Delete (${String(ids.length)})`,
                icon: 'x',
                shortcut: 'Del',
                destructive: true,
                onSelect: () => {
                  deleteEntities(ids);
                },
              },
            ],
          });
        });

        // External-MIME drop layer: accept `.esprefab` drags from the
        // Content Browser onto any entity row. Mounting runs after the
        // factory returns so we defer with microtask so the tree's root
        // DOM element exists.
        void Promise.resolve().then(() => {
          const rootEl = hierarchyTree?.getRootElement();
          if (!rootEl) return;
          rootEl.addEventListener('dragover', (e) => {
            if (!e.dataTransfer?.types.includes('application/x-editrix-asset-path')) return;
            const rowEl = (e.target as HTMLElement | null)?.closest(
              '.editrix-tree-row',
            ) as HTMLElement | null;
            if (!rowEl) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            rowEl.classList.add('editrix-tree-row--external-drop');
          });
          rootEl.addEventListener('dragleave', (e) => {
            const rowEl = (e.target as HTMLElement | null)?.closest(
              '.editrix-tree-row',
            ) as HTMLElement | null;
            rowEl?.classList.remove('editrix-tree-row--external-drop');
          });
          rootEl.addEventListener('drop', (e) => {
            const path = e.dataTransfer?.getData('application/x-editrix-asset-path');
            if (path?.endsWith('.esprefab') !== true) return;
            const rowEl = (e.target as HTMLElement | null)?.closest(
              '.editrix-tree-row',
            ) as HTMLElement | null;
            if (!rowEl) return;
            const raw = rowEl.dataset['nodeId'];
            if (raw === undefined) return;
            const parentId = selectionToEntityId(raw);
            if (parentId === undefined) return;
            e.preventDefault();
            e.stopPropagation();
            rowEl.classList.remove('editrix-tree-row--external-drop');

            const rel = path.startsWith(project.path + '/')
              ? path.slice(project.path.length + 1)
              : path;
            const catalogEntry = catalog.getByPath(rel);
            if (!catalogEntry) return;
            void (async (): Promise<void> => {
              try {
                const rootEntityId = await prefabService.instantiate(catalogEntry.uuid, {
                  parent: parentId,
                });
                selection.select([entityRef(rootEntityId)]);
                const ecs = presence.current;
                if (!ecs) return;
                undoRedo.push({
                  label: `Instantiate ${catalogEntry.relativePath.split('/').pop() ?? 'Prefab'}`,
                  undo: () => {
                    ecs.destroyEntity(rootEntityId);
                    selection.clearSelection();
                  },
                  redo: () => {
                    void prefabService
                      .instantiate(catalogEntry.uuid, { parent: parentId })
                      .then((newRootId) => {
                        selection.select([entityRef(newRootId)]);
                      });
                  },
                });
              } catch {
                /* prefab-plugin already logged */
              }
            })();
          });
        });

        return hierarchyTree;
      }),
    );
  },
};
