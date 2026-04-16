import { IEstellaService, EstellaPlugin, IECSSceneService, ECSSceneService } from '@editrix/estella';
import type { ComponentFieldSchema, ESEngineModule } from '@editrix/estella';
import { IConsoleService } from '@editrix/plugin-console';
import { PluginManagerPanelPlugin } from '@editrix/plugin-manager';
import { SettingsPlugin } from '@editrix/plugin-settings';
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
import { IFileSystemService } from '@editrix/core';
import type { TreeNode } from '@editrix/view-dom';
import { createIconElement, PropertyGridWidget, TreeWidget } from '@editrix/view-dom';
import { ContentBrowserWidget } from './content-browser-widget.js';
import { LocalPluginScanner } from './local-plugin-scanner.js';
import { ProjectFilesWidget } from './project-files-widget.js';
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

type LayoutTreeNode = { type: string; panels?: readonly string[]; activeIndex?: number; children?: readonly { node: unknown }[] };

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

function fieldTypeToPropertyType(type: ComponentFieldSchema['type']): import('@editrix/properties').PropertyType {
  switch (type) {
    case 'float': return 'number';
    case 'int': return 'number';
    case 'bool': return 'boolean';
    case 'color': return 'color';
    case 'enum': return 'enum';
    case 'string': return 'string';
    case 'asset': return 'number';
    case 'entity': return 'number';
  }
}

function ecsToPropertyGroups(
  ecsScene: IECSSceneService,
  entityId: number,
): { groups: import('@editrix/properties').PropertyGroup[]; values: Record<string, unknown> } {
  const components = ecsScene.getComponents(entityId);
  const groups: import('@editrix/properties').PropertyGroup[] = [];
  const values: Record<string, unknown> = {};

  for (const compName of components) {
    const schema = ecsScene.getComponentSchema(compName);
    if (schema.length === 0) continue;

    groups.push({
      id: compName,
      label: compName,
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
    const api = getApi();

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
        async load(_filePath, content) {
          const raw = JSON.parse(content) as Record<string, unknown>;
          // Validate format — must have $type or at least nodeTypes+nodes
          const data: SceneFileData = {
            $type: 'editrix:scene',
            $version: (raw['$version'] as number) ?? 1,
            name: (raw['name'] as string) ?? 'Untitled',
            nodeTypes: (raw['nodeTypes'] as SceneFileData['nodeTypes']) ?? [],
            nodes: (raw['nodes'] as SceneFileData['nodes']) ?? [],
          };
          scene.deserialize(data);
        },
        async serialize(_filePath) {
          const data = scene.serialize();
          return JSON.stringify(data, null, 2);
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

    // ── Scene View ──
    let sceneViewWidget: SceneViewWidget | undefined;

    const initECSScene = (module: ESEngineModule): void => {
      if (ecsScene) return;
      // SceneView creates the registry; get it from the widget
      const registry = sceneViewWidget?.getRegistry();
      if (!registry) return;

      ecsScene = new ECSSceneService(module, registry, () => sceneViewWidget?.requestRender());
      ctx.subscriptions.add(ecsScene);
      ctx.services.register(IECSSceneService, ecsScene);

      // Wire ECS events to Hierarchy + Inspector refresh
      ctx.subscriptions.add(ecsScene.onHierarchyChanged(() => { refreshHierarchy(); }));
      ctx.subscriptions.add(ecsScene.onPropertyChanged(() => { refreshInspector(); }));
      ctx.subscriptions.add(ecsScene.onComponentAdded(() => { refreshInspector(); }));
      ctx.subscriptions.add(ecsScene.onComponentRemoved(() => { refreshInspector(); }));

      refreshHierarchy();
      refreshInspector();
    };

    ctx.subscriptions.add(layout.registerPanel({ id: 'scene-view', title: 'Scene View', defaultRegion: 'center', closable: false, draggable: false }));
    ctx.subscriptions.add(view.registerFactory('scene-view', (id) => {
      sceneViewWidget = new SceneViewWidget(id);

      if (estella.isReady && estella.module) {
        sceneViewWidget.initRenderer(estella.module);
        initECSScene(estella.module);
      } else {
        const sub = estella.onReady((module) => {
          sceneViewWidget?.initRenderer(module);
          initECSScene(module);
          sub.dispose();
        });
        ctx.subscriptions.add(sub);
      }

      return sceneViewWidget;
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

        hierarchyTree.onDidChangeSelection((ids) => {
          selection.select(ids);
        });

        hierarchyTree.onDidChangeVisibility(({ id: nodeId, visible }) => {
          scene.setNodeVisible(nodeId, visible);
        });

        return hierarchyTree;
      }),
    );

    ctx.subscriptions.add(scene.onDidChangeScene(() => { refreshHierarchy(); }));

    // ── Inspector ──
    let inspectorGrid: PropertyGridWidget | undefined;

    const refreshInspector = (): void => {
      if (!inspectorGrid) return;
      const selectedIds = selection.getSelection();
      if (selectedIds.length === 0) {
        inspectorGrid.setData([], {});
        return;
      }

      const selectedId = selectedIds[0]!;

      // ECS path: entity selected
      if (ecsScene) {
        const entityId = Number(selectedId);
        if (isNaN(entityId)) {
          inspectorGrid.setData([], {});
          return;
        }
        const { groups, values } = ecsToPropertyGroups(ecsScene, entityId);
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
        refreshInspector();
        return inspectorGrid;
      }),
    );

    ctx.subscriptions.add(selection.onDidChangeSelection(() => { refreshInspector(); }));
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
          documentService.save(active).then(() => {
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
      { id: 'edit.prefs', label: 'Settings...', shortcut: 'Ctrl+,', onClick: () => { editor.commands.execute('settings.show'); } },
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
          showInputDialog('Create Plugin', 'Plugin name (e.g. My Tool)').then((name) => {
            if (!name) return;
            const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
            if (!slug) return;
            const electronApi = getApi() as unknown as {
              createPlugin(p: string, id: string, n: string): Promise<{ success: boolean; error?: string }>;
            };
            electronApi.createPlugin(projectPath, slug, name).then(async (result: { success: boolean; error?: string }) => {
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
                  editor.kernel.registerPlugin(plugin as unknown as import('@editrix/shell').IPlugin);
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
    if (tabId === 'scene-view' || layoutPanelTabs.has(tabId)) {
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
        documentService.save(active).then(() => {
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
              node: { type: 'tab-group', panels: ['scene-view'], activeIndex: 0 },
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
      fsApi.watch(pluginsDir).then((watchId: string | null) => {
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
          editor.kernel.deactivatePlugin(info.manifest.id).then(async () => {
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
