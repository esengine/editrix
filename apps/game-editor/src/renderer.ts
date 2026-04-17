import { IFileSystemService } from '@editrix/core';
import { IEstellaService, EstellaPlugin, IECSSceneService, ECSSceneService } from '@editrix/estella';
import type { ComponentFieldSchema, ESEngineModule } from '@editrix/estella';
import { IConsoleService } from '@editrix/plugin-console';
import { PluginManagerPanelPlugin } from '@editrix/plugin-manager';
import { SettingsPlugin } from '@editrix/plugin-settings';
import type { PropertyGroup, PropertyType } from '@editrix/properties';
import type { SceneFileData } from '@editrix/scene';
import { ISceneService, SceneService } from '@editrix/scene';
import {
  createEditor,
  DocumentService,
  ICommandRegistry,
  IDocumentService,
  ILayoutService,
  IPluginManager,
  IPropertyService,
  ISelectionService,
  ISettingsService,
  IUndoRedoService,
  IViewService,
} from '@editrix/shell';
import type { EditorInstance, IPlugin, IPluginContext } from '@editrix/shell';
import type { TreeNode } from '@editrix/view-dom';
import { createIconElement, PropertyGridWidget, showContextMenu, showQuickPick, TreeWidget } from '@editrix/view-dom';
import { ContentBrowserWidget } from './content-browser-widget.js';
import { GameViewWidget } from './game-view-widget.js';
import { LocalPluginScanner } from './local-plugin-scanner.js';
import { ProjectFilesWidget } from './project-files-widget.js';
import { SharedRenderContext } from './render-context.js';
import { SceneViewWidget } from './scene-view-widget.js';

// ─── Simple Input Dialog ────────────────────────────────

function showInputDialog(title: string, placeholder: string): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.5);
      display:flex;align-items:center;justify-content:center;z-index:99999;
    `;

    const dialog = document.createElement('div');
    dialog.style.cssText = `
      background:#2c2c32;border:1px solid #444;border-radius:8px;
      padding:20px;min-width:360px;color:#ccc;font-family:inherit;
    `;

    const label = document.createElement('div');
    label.textContent = title;
    label.style.cssText = 'font-size:14px;font-weight:600;margin-bottom:12px;';
    dialog.appendChild(label);

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = placeholder;
    input.style.cssText = `
      width:100%;box-sizing:border-box;background:#414141;border:none;
      color:#ccc;padding:8px 12px;border-radius:6px;font-size:13px;
      font-family:inherit;outline:none;margin-bottom:16px;
    `;
    dialog.appendChild(input);

    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = `
      background:#333;border:1px solid #555;color:#ccc;padding:6px 16px;
      border-radius:6px;cursor:pointer;font-family:inherit;font-size:13px;
    `;
    cancelBtn.addEventListener('click', () => { overlay.remove(); resolve(null); });
    buttons.appendChild(cancelBtn);

    const okBtn = document.createElement('button');
    okBtn.textContent = 'Create';
    okBtn.style.cssText = `
      background:#4a8fff;border:none;color:#fff;padding:6px 16px;
      border-radius:6px;cursor:pointer;font-family:inherit;font-size:13px;
    `;
    okBtn.addEventListener('click', () => { overlay.remove(); resolve(input.value || null); });
    buttons.appendChild(okBtn);

    dialog.appendChild(buttons);
    overlay.appendChild(dialog);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { overlay.remove(); resolve(null); }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { overlay.remove(); resolve(input.value || null); }
      if (e.key === 'Escape') { overlay.remove(); resolve(null); }
    });

    document.body.appendChild(overlay);
    input.focus();
  });
}

// ─── Layout Helpers ─────────────────────────────────────

interface LayoutTreeNode { type: string; panels?: readonly string[]; activeIndex?: number; children?: readonly { node: unknown }[] }

/** Find the active panel ID in the tab-group that contains scene-view. */
function findActiveCenterPanel(node: LayoutTreeNode): string | null {
  if (node.type === 'tab-group') {
    const panels = node.panels ?? [];
    if (panels.includes('scene-view')) {
      return panels[node.activeIndex ?? 0] ?? null;
    }
    return null;
  }
  if (node.type === 'split') {
    for (const child of (node.children ?? [])) {
      const found = findActiveCenterPanel(child.node as LayoutTreeNode);
      if (found) return found;
    }
  }
  return null;
}

/** Get all panel IDs in the tab-group that contains scene-view. */
function getCenterPanelIds(node: LayoutTreeNode): ReadonlySet<string> {
  if (node.type === 'tab-group') {
    const panels = node.panels ?? [];
    if (panels.includes('scene-view')) return new Set(panels);
    return new Set();
  }
  if (node.type === 'split') {
    for (const child of (node.children ?? [])) {
      const found = getCenterPanelIds(child.node as LayoutTreeNode);
      if (found.size > 0) return found;
    }
  }
  return new Set();
}

// ─── Electron API ───────────────────────────────────────

interface ElectronAPI {
  minimize(): void;
  maximize(): void;
  close(): void;
  getProjectPath(): string;
  fs: {
    readFile(path: string): Promise<string>;
    writeFile(path: string, content: string): Promise<void>;
    watch(dirPath: string): Promise<string | null>;
    onChange(callback: (event: { kind: string; path: string }) => void): void;
  };
}

function getApi(): ElectronAPI | undefined {
  return (window as unknown as { electronAPI?: ElectronAPI }).electronAPI;
}

// ─── Convert SceneService tree → TreeWidget TreeNode[] ───

// ─── ECS → PropertyGroup conversion ────────────────────

function fieldTypeToPropertyType(type: ComponentFieldSchema['type']): PropertyType {
  switch (type) {
    case 'float': return 'number';
    case 'int': return 'number';
    case 'bool': return 'boolean';
    case 'color': return 'number';
    case 'enum': return 'enum';
    case 'string': return 'string';
    case 'asset': return 'number';
    case 'entity': return 'number';
  }
}

// ─── Component Icon Mapping ────────────────────────────

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
// Once the user starts adding components by hand, the inspector tracks
// insertion order per entity (see `computeInspectorOrder` in the
// EditorPanelsPlugin) so a new component always lands at the end of
// the card list, not in its alphabetical position (which would move
// the inspector's scroll out from under the user).
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
  ecsScene: IECSSceneService,
  entityId: number,
  // Optional explicit ordering — used by the inspector to preserve
  // the user's insertion order. Components in `order` that aren't
  // actually on the entity are skipped; components on the entity
  // that aren't in `order` fall through the default priority sort
  // and are appended after.
  order?: readonly string[],
): { groups: PropertyGroup[]; values: Record<string, unknown> } {
  const live = [...ecsScene.getComponents(entityId)];
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
    const schema = ecsScene.getComponentSchema(compName);
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
      values[fullKey] = ecsScene.getProperty(entityId, compName, f.key);
    }
  }

  return { groups, values };
}

// ─── Scene tree helpers ────────────────────────────────

function ecsToTreeNodes(ecsScene: IECSSceneService, entityIds: readonly number[]): TreeNode[] {
  return entityIds.map((id) => {
    const children = ecsScene.getChildren(id);
    return {
      id: String(id),
      label: ecsScene.getName(id) || `Entity ${String(id)}`,
      ...(children.length > 0 ? { children: ecsToTreeNodes(ecsScene, children) } : {}),
    };
  });
}

// ─── Entity Snapshot for Undo ──────────────────────────

interface EntitySnapshot {
  readonly name: string;
  readonly parentId: number | null;
  readonly components: readonly string[];
  readonly componentData: Record<string, Record<string, unknown>>;
  readonly children: readonly EntitySnapshot[];
}

/** Recursively capture an entity's full state for undo. */
function captureEntitySnapshot(ecsScene: IECSSceneService, entityId: number): EntitySnapshot {
  const components = ecsScene.getComponents(entityId);
  const componentData: Record<string, Record<string, unknown>> = {};
  for (const comp of components) {
    componentData[comp] = ecsScene.getComponentData(entityId, comp);
  }
  const childIds = ecsScene.getChildren(entityId);
  return {
    name: ecsScene.getName(entityId) || `Entity ${String(entityId)}`,
    parentId: ecsScene.getParent(entityId),
    components: [...components],
    componentData,
    children: childIds.map((id) => captureEntitySnapshot(ecsScene, id)),
  };
}

/** Recursively restore an entity from a snapshot. Returns the new entity ID. */
function restoreEntitySnapshot(
  ecsScene: IECSSceneService,
  snapshot: EntitySnapshot,
  parentId?: number,
): number {
  const newId = ecsScene.createEntity(snapshot.name, parentId);
  for (const comp of snapshot.components) {
    if (comp === 'Transform') continue; // createEntity already adds Transform
    ecsScene.addComponent(newId, comp);
  }
  for (const [comp, data] of Object.entries(snapshot.componentData)) {
    for (const [field, value] of Object.entries(data)) {
      ecsScene.setProperty(newId, comp, field, value);
    }
  }
  for (const childSnapshot of snapshot.children) {
    restoreEntitySnapshot(ecsScene, childSnapshot, newId);
  }
  return newId;
}

function sceneToTreeNodes(scene: ISceneService, nodeIds: readonly string[]): TreeNode[] {
  return nodeIds.map((id) => {
    const node = scene.getNode(id);
    if (!node) return { id, label: id };
    const children = scene.getChildren(id);
    return {
      id: node.id,
      label: node.name,
      ...(node.icon !== undefined ? { icon: node.icon } : {}),
      ...(children.length > 0 ? { children: sceneToTreeNodes(scene, children.map((c) => c.id)) } : {}),
    };
  });
}

// ─── Editor Plugin: Hierarchy + Inspector + Scene ────────

const EditorPanelsPlugin: IPlugin = {
  descriptor: {
    id: 'editor.panels',
    version: '1.0.0',
    dependencies: ['editrix.layout', 'editrix.view', 'editrix.properties', 'editrix.estella'],
  },
  activate(ctx: IPluginContext) {
    const layout = ctx.services.get(ILayoutService);
    const view = ctx.services.get(IViewService);
    const selection = ctx.services.get(ISelectionService);
    const undoRedo = ctx.services.get(IUndoRedoService);
    const api = getApi();
    // Resolved lazily because the IConsoleService registration may
    // happen in a sibling plugin that activates after us.
    const logError = (msg: string, source = 'editor'): void => {
      try {
        ctx.services.get(IConsoleService).log('error', msg, source);
      } catch {
        // consoleService not yet available — fall back.
        // eslint-disable-next-line no-console
        console.error(`[${source}] ${msg}`);
      }
    };

    // ── Scene Service (legacy, kept for document handler compatibility) ──
    const scene = new SceneService();
    ctx.subscriptions.add(scene);
    ctx.subscriptions.add(ctx.services.register(ISceneService, scene));

    // ── ECS Scene Service (created when WASM is ready) ──
    let ecsScene: ECSSceneService | undefined;
    const estella = ctx.services.get(IEstellaService);

    // ── Document Service ──
    const documentService = new DocumentService(
      (path) => api?.fs.readFile(path) ?? Promise.resolve(''),
      (path, content) => api?.fs.writeFile(path, content) ?? Promise.resolve(),
    );
    ctx.subscriptions.add(documentService);
    ctx.subscriptions.add(ctx.services.register(IDocumentService, documentService));

    // Register scene file handler
    ctx.subscriptions.add(
      documentService.registerHandler({
        extensions: ['.scene.json'],
        load(_filePath, content): Promise<void> {
          const raw = JSON.parse(content) as Record<string, unknown>;
          // Validate format — must have $type or at least nodeTypes+nodes
          const data: SceneFileData = {
            $type: 'editrix:scene',
            $version: (raw['$version'] as number | undefined) ?? 1,
            name: (raw['name'] as string | undefined) ?? 'Untitled',
            nodeTypes: (raw['nodeTypes'] as SceneFileData['nodeTypes'] | undefined) ?? [],
            nodes: (raw['nodes'] as SceneFileData['nodes'] | undefined) ?? [],
          };
          scene.deserialize(data);
          return Promise.resolve();
        },
        serialize(_filePath): Promise<string> {
          const data = scene.serialize();
          return Promise.resolve(JSON.stringify(data, null, 2));
        },
      }),
    );

    // Mark scene dirty when properties change
    ctx.subscriptions.add(
      scene.onDidChangeScene(() => {
        const active = documentService.activeDocument;
        if (active) documentService.setDirty(active, true);
      }),
    );
    ctx.subscriptions.add(
      scene.onDidChangeProperty(() => {
        const active = documentService.activeDocument;
        if (active) documentService.setDirty(active, true);
      }),
    );

    // ── Shared Render Context ──
    const renderContext = new SharedRenderContext();
    ctx.subscriptions.add(renderContext);

    const initECSScene = (module: ESEngineModule): void => {
      if (ecsScene) return;
      const registry = renderContext.registry;
      if (!registry) return;

      ecsScene = new ECSSceneService(module, registry, () => { renderContext.requestRender(); });
      ctx.subscriptions.add(ecsScene);
      ctx.services.register(IECSSceneService, ecsScene);

      // Wire ECS events to Hierarchy + Inspector refresh
      ctx.subscriptions.add(ecsScene.onHierarchyChanged(() => { refreshHierarchy(); }));
      ctx.subscriptions.add(ecsScene.onPropertyChanged(() => { refreshInspector(); }));
      ctx.subscriptions.add(ecsScene.onComponentAdded(() => { refreshInspector(); }));
      ctx.subscriptions.add(ecsScene.onComponentRemoved(() => { refreshInspector(); }));

      // Create default scene: Camera (for Game View) + test Shape
      const camId = ecsScene.createEntity('Main Camera');
      ecsScene.addComponent(camId, 'Camera');
      ecsScene.setProperty(camId, 'Camera', 'isActive', true);
      ecsScene.setProperty(camId, 'Transform', 'position.z', 200);

      const shapeId = ecsScene.createEntity('Test Shape');
      ecsScene.addComponent(shapeId, 'ShapeRenderer');

      sceneViewWidget?.setECSScene(ecsScene);

      refreshHierarchy();
      refreshInspector();
    };

    const initRenderer = (module: ESEngineModule): void => {
      if (!renderContext.init(module)) return;
      initECSScene(module);
    };

    if (estella.isReady && estella.module) {
      initRenderer(estella.module);
    } else {
      const sub = estella.onReady((module) => { initRenderer(module); sub.dispose(); });
      ctx.subscriptions.add(sub);
    }

    // ── Scene View ──
    let sceneViewWidget: SceneViewWidget | undefined;

    ctx.subscriptions.add(layout.registerPanel({ id: 'scene-view', title: 'Scene View', defaultRegion: 'center', closable: false, draggable: false }));
    ctx.subscriptions.add(view.registerFactory('scene-view', (id) => {
      sceneViewWidget = new SceneViewWidget(id, renderContext, selection, undoRedo);
      if (ecsScene) sceneViewWidget.setECSScene(ecsScene);
      if (estella.isReady && estella.module) {
        sceneViewWidget.initCamera(estella.module);
      } else {
        const sub = estella.onReady((module) => { sceneViewWidget?.initCamera(module); sub.dispose(); });
        ctx.subscriptions.add(sub);
      }
      return sceneViewWidget;
    }));

    // ── Game View ──
    ctx.subscriptions.add(layout.registerPanel({ id: 'game-view', title: 'Game View', defaultRegion: 'center', closable: false, draggable: false }));
    ctx.subscriptions.add(view.registerFactory('game-view', (id) => {
      return new GameViewWidget(id, renderContext);
    }));

    // ── Hierarchy ──
    let hierarchyTree: TreeWidget | undefined;

    const refreshHierarchy = (): void => {
      if (!hierarchyTree) return;
      if (ecsScene) {
        const roots = ecsToTreeNodes(ecsScene, ecsScene.getRootEntities());
        hierarchyTree.setRoots(roots);
      } else {
        const roots = sceneToTreeNodes(scene, scene.getRootIds());
        hierarchyTree.setRoots(roots);
      }
    };

    ctx.subscriptions.add(layout.registerPanel({ id: 'hierarchy', title: 'Hierarchy', defaultRegion: 'left' }));
    ctx.subscriptions.add(
      view.registerFactory('hierarchy', (id) => {
        hierarchyTree = new TreeWidget(id, { showFilter: true, showVisibility: true, showAddButton: true, addButtonLabel: 'Add Entity' });
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

        hierarchyTree.onDidChangeVisibility(({ id: nodeId, visible }) => {
          scene.setNodeVisible(nodeId, visible);
        });

        hierarchyTree.onDidRequestAdd(() => {
          if (ecsScene) {
            const ecs = ecsScene;
            const entityId = ecs.createEntity('New Entity');
            selection.select([String(entityId)]);
            undoRedo.push({
              label: 'Create Entity',
              undo: () => { ecs.destroyEntity(entityId); selection.clearSelection(); },
              redo: () => {
                const id = ecs.createEntity('New Entity');
                selection.select([String(id)]);
              },
            });
          }
        });

        // Delete entities (Delete key or context menu)
        const deleteEntities = (ids: readonly string[]): void => {
          if (!ecsScene || ids.length === 0) return;
          const ecs = ecsScene;
          // Filter to only root-level entities in the selection (skip children of selected parents)
          const idSet = new Set(ids);
          const toDelete = ids.filter((id) => {
            const parentId = ecs.getParent(Number(id));
            return parentId === null || !idSet.has(String(parentId));
          });
          const snapshots = toDelete.map((id) => captureEntitySnapshot(ecs, Number(id)));
          const previousSelection = [...selection.getSelection()];
          for (const id of toDelete) {
            ecs.destroyEntity(Number(id));
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
              // Re-capture current entities by name match is fragile;
              // just clear selection — the entities created by undo will be gone
              const currentRoots = ecs.getRootEntities();
              // Delete the most recently created entities (last N)
              const countToDelete = snapshots.length;
              const tail = currentRoots.slice(-countToDelete);
              for (const id of tail) {
                ecs.destroyEntity(id);
              }
              selection.clearSelection();
            },
          });
        };

        hierarchyTree.onDidRequestDelete((ids) => { deleteEntities(ids); });

        hierarchyTree.onDidRequestContextMenu(({ ids, x, y }) => {
          if (!ecsScene) return;
          const ecs = ecsScene;
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

    ctx.subscriptions.add(scene.onDidChangeScene(() => { refreshHierarchy(); }));

    // ── Inspector ──
    let inspectorGrid: PropertyGridWidget | undefined;

    // Per-entity record of the order the inspector has been showing
    // components in. Built-ins (what the entity was deserialized with)
    // get sorted by COMPONENT_ORDER_PRIORITY on first inspection and
    // the result is stored on the ECS scene as entity metadata under
    // INSPECTOR_ORDER_KEY, so it round-trips through scene save/load.
    // Each subsequent addComponent appends to the tail, so new cards
    // always land at the end of the panel instead of jumping to an
    // alphabetical slot.
    const INSPECTOR_ORDER_KEY = 'inspectorComponentOrder';

    const getInspectorOrder = (entityId: number): string[] | undefined => {
      if (!ecsScene) return undefined;
      const raw = ecsScene.getEntityMetadata(entityId, INSPECTOR_ORDER_KEY);
      return Array.isArray(raw) ? (raw as string[]).slice() : undefined;
    };

    const setInspectorOrder = (entityId: number, names: readonly string[]): void => {
      ecsScene?.setEntityMetadata(entityId, INSPECTOR_ORDER_KEY, [...names]);
    };

    const appendToInspectorOrder = (entityId: number, compName: string): void => {
      const existing = getInspectorOrder(entityId);
      if (!existing) return; // entity not yet inspected, will seed on first refresh
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
      const selectedIds = selection.getSelection();
      if (selectedIds.length === 0) {
        inspectorGrid.setData([], {});
        return;
      }

      const selectedId = selectedIds[0];
      if (!selectedId) {
        inspectorGrid.setData([], {});
        return;
      }

      // ECS path: entity selected
      if (ecsScene) {
        const entityId = Number(selectedId);
        if (isNaN(entityId)) {
          inspectorGrid.setData([], {});
          return;
        }
        // First time we see this entity, seed the tracked order from
        // the default priority sort; thereafter it's driven by user
        // actions (addComponent appends). Either way we hand the
        // resolved order to ecsToPropertyGroups which preserves it.
        let tracked = getInspectorOrder(entityId);
        if (!tracked) {
          tracked = sortByDefaultPriority(ecsScene.getComponents(entityId));
          setInspectorOrder(entityId, tracked);
        }
        const { groups, values } = ecsToPropertyGroups(ecsScene, entityId, tracked);
        inspectorGrid.setData(groups, values);
        return;
      }

      // Legacy path: SceneService node selected
      const node = scene.getNode(selectedId);
      if (!node) {
        inspectorGrid.setData([], {});
        return;
      }
      const schema = scene.getNodeTypeSchema(node.type);
      if (!schema) {
        inspectorGrid.setData([], {});
        return;
      }
      const groupMap = new Map<string, typeof schema.properties[number][]>();
      for (const prop of schema.properties) {
        const groupName = prop.group ?? 'Properties';
        let arr = groupMap.get(groupName);
        if (!arr) {
          arr = [];
          groupMap.set(groupName, arr);
        }
        arr.push(prop);
      }
      const groups = [...groupMap.entries()].map(([label, props]) => ({
        id: label.toLowerCase(),
        label,
        properties: props.map((p) => ({
          key: p.key,
          label: p.label,
          type: p.type,
          defaultValue: p.defaultValue,
          ...(p.description !== undefined ? { description: p.description } : {}),
          ...(p.min !== undefined ? { min: p.min } : {}),
          ...(p.max !== undefined ? { max: p.max } : {}),
          ...(p.step !== undefined ? { step: p.step } : {}),
          ...(p.enumValues !== undefined ? { enumValues: p.enumValues } : {}),
        })),
      }));
      inspectorGrid.setData(groups, scene.getProperties(selectedId));
    };

    ctx.subscriptions.add(layout.registerPanel({ id: 'inspector', title: 'Inspector', defaultRegion: 'right' }));
    ctx.subscriptions.add(
      view.registerFactory('inspector', (id) => {
        inspectorGrid = new PropertyGridWidget(id, {
          onChange: (key, value) => {
            const selectedIds = selection.getSelection();
            const selectedId = selectedIds[0];
            if (!selectedId) return;

            if (ecsScene) {
              // ECS path: key format is "ComponentName.fieldPath"
              const dotIdx = key.indexOf('.');
              if (dotIdx > 0) {
                const comp = key.substring(0, dotIdx);
                const field = key.substring(dotIdx + 1);
                ecsScene.setProperty(Number(selectedId), comp, field, value);
              }
            } else {
              scene.setProperty(selectedId, key, value);
            }
          },
        });

        // ── Add Component ──
        inspectorGrid.onDidRequestAddComponent(() => {
          const selectedId = selection.getSelection()[0];
          if (!selectedId || !ecsScene) return;
          const ecs = ecsScene;
          const grid = inspectorGrid;
          const entityId = Number(selectedId);
          const existing = new Set(ecs.getComponents(entityId));
          const available = ecs.getAvailableComponents();

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
              // Wrap addComponent so a throw from the ECS side surfaces
              // in the editor's console panel instead of failing silently
              // — that silent failure was the symptom of the original
              // 'click does nothing' bug.
              try {
                ecs.addComponent(entityId, item.id);
              } catch (err) {
                logError(`Add ${item.id}: ${err instanceof Error ? err.message : String(err)}`,
                  'add-component');
                return;
              }
              // Pin the new card to the end of the inspector for this
              // entity (the priority-based default sort would have put
              // it alphabetically; user wants "new always last" so they
              // can eyeball what just got added).
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
          const selectedId = selection.getSelection()[0];
          if (!selectedId || !ecsScene) return;
          const ecs = ecsScene;
          const entityId = Number(selectedId);
          const isTransform = componentId === 'Transform';
          const rect = anchor.getBoundingClientRect();

          showContextMenu({
            x: rect.right,
            y: rect.bottom,
            items: [
              { label: 'Reset to Default', icon: 'refresh', disabled: true },
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
                      // Undoing a remove appends the component back to
                      // the tail of the inspector list rather than
                      // restoring the original slot. We don't track
                      // pre-remove position; users who care can drag
                      // once drag-to-reorder lands.
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
          const selectedId = selection.getSelection()[0];
          if (!selectedId || !ecsScene) return;
          const entityId = Number(selectedId);
          const order = getInspectorOrder(entityId);
          if (!order) return;

          const srcIdx = order.indexOf(componentId);
          const tgtIdx = order.indexOf(targetId);
          if (srcIdx < 0 || tgtIdx < 0 || srcIdx === tgtIdx) return;

          const [moved] = order.splice(srcIdx, 1);
          if (!moved) return;
          // After splicing the source out, the target index may have
          // shifted down by one. Recompute before inserting.
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

    ctx.subscriptions.add(selection.onDidChangeSelection(() => {
      refreshInspector();
      renderContext.requestRender(); // update selection highlight in Scene View
    }));
    ctx.subscriptions.add(scene.onDidChangeProperty(() => { refreshInspector(); }));

    // ── Project Files ──
    let contentBrowserWidget: ContentBrowserWidget | undefined;

    ctx.subscriptions.add(
      layout.registerPanel({ id: 'project-files', title: 'Project Files', defaultRegion: 'left' }),
    );
    ctx.subscriptions.add(
      view.registerFactory('project-files', (id) => {
        const widget = new ProjectFilesWidget(id);
        widget.onDidSelectFolder((folderPath) => {
          if (contentBrowserWidget) {
            contentBrowserWidget.navigateTo(folderPath);
            contentBrowserWidget.showView('assets');
          }
        });
        // Double-click file → open document
        widget.onDidSelectFolder((_selectedPath) => {
          // onDidSelectFolder fires for all selections; check if it's a file
          // Files are handled by the Asset Browser double-click instead
        });
        return widget;
      }),
    );

    // ── Content Browser ──
    ctx.subscriptions.add(
      layout.registerPanel({ id: 'content-browser', title: 'Content Browser', defaultRegion: 'center', closable: false, draggable: false }),
    );
    ctx.subscriptions.add(
      view.registerFactory('content-browser', (id) => {
        contentBrowserWidget = new ContentBrowserWidget(id);
        // Wire double-click on scene files to open in document service
        contentBrowserWidget.onDidOpenFile((filePath) => {
          documentService.open(filePath).catch(() => {
            consoleService.log('error', `Failed to open: ${filePath}`);
          });
        });
        return contentBrowserWidget;
      }),
    );

    // ── Console Service ──
    const consoleService: { log(level: 'info' | 'warn' | 'error' | 'debug', message: string, source?: string): void; clear(): void } = {
      log(level, message, source) {
        contentBrowserWidget?.log(level, message, source);
      },
      clear() {
        contentBrowserWidget?.clearConsole();
      },
    };
    ctx.subscriptions.add(ctx.services.register(IConsoleService, consoleService));

    // Open panels
    layout.openPanel('scene-view');
    layout.openPanel('hierarchy');
    layout.openPanel('inspector');
    layout.openPanel('project-files');
    layout.openPanel('content-browser');
  },
};

// ─── Bootstrap ───────────────────────────────────────────

async function main(): Promise<void> {
  const container = document.getElementById('app');
  if (!container) {
    throw new Error('Missing #app container element.');
  }

  const projectPath = getApi()?.getProjectPath() ?? '';

  // Expose framework service identifiers globally so dynamically loaded plugins
  // can resolve services without importing npm packages (which aren't available in file:// modules)
  // Expose all framework service identifiers for dynamically loaded plugins
  (window as unknown as Record<string, unknown>)['__editrix'] = {
    // Layout & View
    ILayoutService,
    IViewService,
    ISelectionService,
    IPropertyService,
    // Documents & Files
    IDocumentService,
    IFileSystemService,
    // Commands & Settings
    ICommandRegistry,
    ISettingsService,
    IUndoRedoService,
    // Scene
    ISceneService,
    // Plugin management
    IPluginManager,
    // Logging
    IConsoleService,
  };

  const EDITRIX_API_VERSION = 1;

  const editor: EditorInstance = await createEditor({
    container,
    plugins: [EstellaPlugin, EditorPanelsPlugin, PluginManagerPanelPlugin, SettingsPlugin],
    ...(projectPath ? { pluginScanner: new LocalPluginScanner(projectPath) } : {}),
  });

  const documentService = editor.kernel.services.get(IDocumentService);
  const consoleService = editor.kernel.services.get(IConsoleService);

  // ── Load estella WASM ──
  const estellaService = editor.kernel.services.get(IEstellaService);
  estellaService.loadCore('estella:///').catch((err: unknown) => {
    consoleService.log('error', `Failed to load estella WASM: ${String(err)}`, 'estella');
  });

  // Check plugin API version compatibility
  for (const info of editor.pluginManager.getAll()) {
    if (info.builtin) continue;
    const pluginApi = info.manifest.apiVersion;
    if (pluginApi !== undefined && pluginApi > EDITRIX_API_VERSION) {
      consoleService.log(
        'warn',
        `Plugin "${info.manifest.name}" requires API v${String(pluginApi)} but editor provides v${String(EDITRIX_API_VERSION)}. It may not work correctly.`,
        'plugin-loader',
      );
    }
  }

  // ── Menu bar ──
  editor.view.menuBar.setAppIcon('extensions');
  editor.view.menuBar.addMenu({
    id: 'file', label: 'File', items: [
      { id: 'file.save', label: 'Save', shortcut: 'Ctrl+S', onClick: () => {
        const active = documentService.activeDocument;
        if (active) {
          void documentService.save(active).then(() => {
            consoleService.log('info', `Saved: ${active.split('/').pop()}`);
          });
        }
      } },
      { id: 'sep1', label: '', separator: true },
      { id: 'file.exit', label: 'Exit', shortcut: 'Ctrl+Q', onClick: () => { window.close(); } },
    ],
  });
  editor.view.menuBar.addMenu({
    id: 'edit-menu', label: 'Edit', items: [
      { id: 'edit.undo', label: 'Undo', shortcut: 'Ctrl+Z', onClick: () => { editor.undoRedo.undo(); } },
      { id: 'edit.redo', label: 'Redo', shortcut: 'Ctrl+Shift+Z', onClick: () => { editor.undoRedo.redo(); } },
      { id: 'sep2', label: '', separator: true },
      { id: 'edit.prefs', label: 'Settings...', shortcut: 'Ctrl+,', onClick: () => { void editor.commands.execute('settings.show'); } },
    ],
  });
  editor.view.menuBar.addMenu({
    id: 'debug', label: 'Debug', items: [
      { id: 'debug.cmd', label: 'Command Palette', shortcut: 'Ctrl+Shift+P', onClick: () => { editor.view.commandPalette.open(); } },
    ],
  });
  editor.view.menuBar.addMenu({
    id: 'project', label: 'Project', items: [
      {
        id: 'project.createPlugin', label: 'Create Plugin...', onClick: () => {
          void showInputDialog('Create Plugin', 'Plugin name (e.g. My Tool)').then((name) => {
            if (!name) return;
            const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
            if (!slug) return;
            const electronApi = getApi() as unknown as {
              createPlugin(p: string, id: string, n: string): Promise<{ success: boolean; error?: string }>;
            };
            void electronApi.createPlugin(projectPath, slug, name).then(async (result: { success: boolean; error?: string }) => {
              if (!result.success) {
                consoleService.log('error', `Failed to create plugin: ${result.error ?? 'unknown'}`);
                return;
              }
              consoleService.log('info', `Plugin "${name}" created at plugins/${slug}/`);
              // Hot-load: read plugin.json to get the main entry path
              try {
                const pluginDir = `${projectPath.replace(/\\/g, '/')}/plugins/${slug}`;
                const manifestRaw = await getApi()?.fs.readFile(`${pluginDir}/plugin.json`) ?? '';
                const manifest = JSON.parse(manifestRaw) as { main?: string };
                const mainFile = manifest.main ?? 'dist/index.js';
                const entryUrl = `file:///${pluginDir}/${mainFile}`;
                const mod = await import(/* webpackIgnore: true */ entryUrl) as Record<string, unknown>;
                const plugin = (mod['default'] ?? mod['plugin']) as { descriptor?: { id: string }; activate?: unknown } | undefined;
                if (plugin?.descriptor && typeof plugin.activate === 'function') {
                  editor.kernel.registerPlugin(plugin as unknown as IPlugin);
                  await editor.kernel.activatePlugin(plugin.descriptor.id);
                  consoleService.log('info', `Plugin "${name}" loaded and activated.`);
                }
              } catch (err) {
                consoleService.log('warn', `Plugin created but could not hot-load: ${String(err)}`);
                consoleService.log('info', 'Restart the editor to load the plugin.');
              }
            });
          });
        },
      },
    ],
  });
  editor.view.menuBar.addMenu({ id: 'help', label: 'Help', items: [] });

  // ── Document tabs — driven by DocumentService + layout panels ──
  const tabDisposables = new Map<string, { dispose(): void }>();

  // Persistent Scene View tab (always present, not closable)
  tabDisposables.set('scene-view', editor.view.menuBar.addTab({
    id: 'scene-view',
    label: 'Scene View',
    icon: 'grid',
    color: '#56b6c2',
    closable: false,
  }));
  tabDisposables.set('game-view', editor.view.menuBar.addTab({
    id: 'game-view',
    label: 'Game View',
    icon: 'play',
    color: '#98c379',
    closable: false,
  }));
  editor.view.menuBar.setActiveTab('scene-view');

  documentService.onDidChangeDocuments(() => {
    const openDocs = documentService.getOpenDocuments();
    const openPaths = new Set(openDocs.map((d) => d.filePath));

    // Remove tabs for closed documents
    for (const [path, disposable] of tabDisposables) {
      if (!openPaths.has(path)) {
        disposable.dispose();
        tabDisposables.delete(path);
      }
    }

    // Add tabs for new documents
    for (const doc of openDocs) {
      if (!tabDisposables.has(doc.filePath)) {
        const d = editor.view.menuBar.addTab({
          id: doc.filePath,
          label: doc.name,
          icon: 'layers',
          color: '#61afef',
          modified: doc.dirty,
        });
        tabDisposables.set(doc.filePath, d);
      }
    }
  });

  documentService.onDidChangeActive((filePath) => {
    if (filePath) {
      editor.view.menuBar.setActiveTab(filePath);
    }
  });

  documentService.onDidChangeDirty(({ filePath, dirty }) => {
    // Remove and re-add the tab to update modified state
    const existing = tabDisposables.get(filePath);
    if (existing) {
      existing.dispose();
      const doc = documentService.getOpenDocuments().find((d) => d.filePath === filePath);
      if (doc) {
        const d = editor.view.menuBar.addTab({
          id: doc.filePath,
          label: doc.name,
          icon: 'layers',
          color: '#61afef',
          modified: dirty,
        });
        tabDisposables.set(filePath, d);
        editor.view.menuBar.setActiveTab(filePath);
      }
    }
  });

  // Track which menubar tabs are layout panels (vs document files)
  const layoutPanelTabs = new Set<string>();

  /** Check if a panel is "fixed" (not closable or not draggable) — these don't get menubar tabs. */
  function isFixedPanel(panelId: string): boolean {
    const desc = editor.layout.getDescriptor(panelId);
    return desc?.closable === false || desc?.draggable === false;
  }

  // ── Section C: Tab Interactions (user clicks) ──

  editor.view.menuBar.onDidSelectTab((tabId) => {
    if (tabId === 'scene-view' || tabId === 'game-view' || layoutPanelTabs.has(tabId)) {
      // Layout panel tab — switch the visible panel in layout
      editor.layout.activatePanel(tabId);
    } else {
      // Document tab — activate in DocumentService, show scene-view
      documentService.setActive(tabId);
      editor.layout.activatePanel('scene-view');
    }
  });

  editor.view.menuBar.onDidCloseTab((tabId) => {
    if (layoutPanelTabs.has(tabId)) {
      // Layout panel — close it
      editor.layout.closePanel(tabId);
      layoutPanelTabs.delete(tabId);
      tabDisposables.get(tabId)?.dispose();
      tabDisposables.delete(tabId);
    } else {
      // Document — close via DocumentService
      documentService.close(tabId);
    }
  });

  // ── Sync dynamic layout panels as menubar document tabs ──
  // Only panels in the center tab-group (with scene-view) get menubar tabs.
  // Panels moved elsewhere have their own tab bar — no menubar tab needed.
  editor.layout.onDidChangeLayout(() => {
    const layoutTree = editor.layout.getLayout();
    const centerIds = getCenterPanelIds(layoutTree as LayoutTreeNode);

    // Add menubar tabs for closable/draggable panels that are in the center group
    for (const panelId of centerIds) {
      if (!isFixedPanel(panelId) && !layoutPanelTabs.has(panelId)) {
        const desc = editor.layout.getDescriptor(panelId);
        if (!desc) continue;
        const isPluginDetail = panelId.startsWith('plugin-detail:');
        const d = editor.view.menuBar.addTab({
          id: panelId,
          label: desc.title,
          icon: isPluginDetail ? 'extensions' : 'box',
          color: isPluginDetail ? '#c678dd' : '#98c379',
          draggable: true,
        });
        tabDisposables.set(panelId, d);
        layoutPanelTabs.add(panelId);
      }
    }

    // Sync active tab
    const activeCenter = findActiveCenterPanel(layoutTree as LayoutTreeNode);
    if (activeCenter && tabDisposables.has(activeCenter)) {
      editor.view.menuBar.setActiveTab(activeCenter);
    }

    // Remove menubar tabs for panels that left the center group or were closed
    for (const id of layoutPanelTabs) {
      if (!centerIds.has(id)) {
        tabDisposables.get(id)?.dispose();
        tabDisposables.delete(id);
        layoutPanelTabs.delete(id);
      }
    }
  });

  // ── Ctrl+S keyboard shortcut ──
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      const active = documentService.activeDocument;
      if (active) {
        void documentService.save(active).then(() => {
          consoleService.log('info', `Saved: ${active.split('/').pop()}`);
        });
      }
    }
  });

  // ── Right section: Play/Pause + window controls ──
  const rightSection = editor.view.menuBar.rightSection;
  if (rightSection) {
    for (const { icon, tooltip } of [
      { icon: 'play', tooltip: 'Play' },
      { icon: 'pause', tooltip: 'Pause' },
    ]) {
      const btn = document.createElement('button');
      btn.className = 'editrix-menubar-play-btn';
      btn.title = tooltip;
      btn.appendChild(createIconElement(icon, 16));
      rightSection.appendChild(btn);
    }

    const spacer = document.createElement('div');
    spacer.style.cssText = 'width:6px;flex-shrink:0';
    rightSection.appendChild(spacer);

    const api = getApi();
    for (const { icon, action, cls } of [
      { icon: 'win-minimize', action: () => api?.minimize(), cls: '' },
      { icon: 'win-maximize', action: () => api?.maximize(), cls: '' },
      { icon: 'win-close', action: () => api?.close(), cls: 'editrix-menubar-win-close' },
    ]) {
      const btn = document.createElement('button');
      btn.className = `editrix-menubar-win-btn ${cls}`;
      btn.appendChild(createIconElement(icon, 14));
      btn.addEventListener('click', action);
      rightSection.appendChild(btn);
    }
  }

  // ── Status bar ──
  editor.view.statusBar.addItem({ id: 'branch', text: '\u{2387} main (a1b2c3d)', alignment: 'left' });
  editor.view.statusBar.addItem({ id: 'version', text: 'editrix-0.1.0', alignment: 'left' });
  editor.view.statusBar.addItem({
    id: 'cmd-hint', text: 'Ctrl+Shift+P', alignment: 'right',
    onClick: () => { editor.view.commandPalette.open(); },
  });

  // ── Layout ──
  editor.layout.setLayout({
    type: 'split',
    direction: 'horizontal',
    children: [
      {
        node: {
          type: 'split',
          direction: 'vertical',
          children: [
            {
              node: { type: 'tab-group', panels: ['hierarchy'], activeIndex: 0 },
              weight: 0.55,
            },
            {
              node: { type: 'tab-group', panels: ['project-files'], activeIndex: 0 },
              weight: 0.45,
            },
          ],
        },
        weight: 0.2,
      },
      {
        node: {
          type: 'split',
          direction: 'vertical',
          children: [
            {
              node: {
                type: 'split',
                direction: 'horizontal',
                children: [
                  {
                    node: { type: 'tab-group', panels: ['scene-view'], activeIndex: 0 },
                    weight: 0.6,
                  },
                  {
                    node: { type: 'tab-group', panels: ['game-view'], activeIndex: 0 },
                    weight: 0.4,
                  },
                ],
              },
              weight: 0.65,
            },
            {
              node: { type: 'tab-group', panels: ['content-browser'], activeIndex: 0 },
              weight: 0.35,
            },
          ],
        },
        weight: 0.6,
      },
      {
        node: { type: 'tab-group', panels: ['inspector'], activeIndex: 0 },
        weight: 0.2,
      },
    ],
  });

  // ── Auto-open the default scene if it exists ──
  if (projectPath) {
    const scenePath = projectPath.replace(/\\/g, '/') + '/scenes/main.scene.json';
    try {
      const exists = await getApi()?.fs.readFile(scenePath);
      if (exists) {
        await documentService.open(scenePath);
      }
    } catch {
      // No default scene — that's fine
    }
  }

  // ── Plugin hot-reload: watch plugin dist/ for changes ──
  if (projectPath) {
    const pluginsDir = projectPath.replace(/\\/g, '/') + '/plugins';
    const fsApi = getApi()?.fs;
    if (fsApi) {
      void fsApi.watch(pluginsDir).then((watchId: string | null) => {
        if (!watchId) return;
        fsApi.onChange((event: { kind: string; path: string }) => {
          // Only reload when a .js file changes
          if (!event.path.endsWith('.js') || event.kind === 'deleted') return;

          // Find which plugin this belongs to
          const relative = event.path.replace(pluginsDir + '/', '');
          const pluginSlug = relative.split('/')[0];
          if (!pluginSlug) return;

          // Find the plugin ID from the loaded plugins
          const allPlugins = editor.pluginManager.getAll();
          const info = allPlugins.find((p) => !p.builtin && p.manifest.id === pluginSlug);
          if (!info) return;

          // Verify this is the main entry file by reading plugin.json
          const expectedMain = info.manifest.main ?? 'dist/index.js';
          const expectedPath = `${pluginsDir}/${pluginSlug}/${expectedMain}`;
          if (event.path !== expectedPath) return;

          consoleService.log('info', `Plugin "${info.manifest.name}" changed, reloading...`);

          // Deactivate old version
          void editor.kernel.deactivatePlugin(info.manifest.id).then(async () => {
            try {
              // Re-import with cache-busting timestamp
              const entryUrl = `file:///${event.path}?t=${Date.now()}`;
              const mod = await import(/* webpackIgnore: true */ entryUrl) as Record<string, unknown>;
              const plugin = (mod['default'] ?? mod['plugin']) as IPlugin | undefined;
              if (plugin && typeof plugin.activate === 'function') {
                editor.kernel.registerPlugin(plugin);
                await editor.kernel.activatePlugin(plugin.descriptor.id);
                consoleService.log('info', `Plugin "${info.manifest.name}" reloaded successfully.`);
              }
            } catch (err) {
              consoleService.log('error', `Failed to reload plugin: ${String(err)}`);
            }
          });
        });
      });
    }
  }

  consoleService.log('info', 'Editor ready');
}

main().catch((err: unknown) => {
  document.body.textContent = `Failed to start: ${String(err)}`;
});
