import { IFileSystemService } from '@editrix/core';
import { EstellaPlugin, IECSSceneService, IEstellaService } from '@editrix/estella';
import { IConsoleService } from '@editrix/plugin-console';
import { PluginManagerPanelPlugin } from '@editrix/plugin-manager';
import { SettingsPlugin } from '@editrix/plugin-settings';
import {
  createEditor,
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
import type { EditorInstance, IPlugin } from '@editrix/shell';
import { createIconElement } from '@editrix/view-dom';
import { showInputDialog } from './dialogs.js';
import { LocalPluginScanner } from './local-plugin-scanner.js';
import {
  DocumentSyncPlugin,
  ECSScenePlugin,
  FilesystemPlugin,
  GameViewPlugin,
  HierarchyPlugin,
  InspectorPlugin,
  ProjectPanelsPlugin,
  ProjectPlugin,
  RenderContextPlugin,
  SceneViewPlugin,
} from './plugins/index.js';
import { IProjectService } from './services.js';

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

// ─── Bootstrap ───────────────────────────────────────────

async function main(): Promise<void> {
  const container = document.getElementById('app');
  if (!container) {
    throw new Error('Missing #app container element.');
  }

  const projectPath = getApi()?.getProjectPath() ?? '';

  // Expose framework service identifiers globally so dynamically loaded plugins
  // can resolve services without importing npm packages (which aren't available
  // in file:// modules).
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
    // Scene (ECS authoritative state)
    IECSSceneService,
    // Plugin management
    IPluginManager,
    // Logging
    IConsoleService,
  };

  const EDITRIX_API_VERSION = 1;

  // The editor is composed from app-level plugins (one per panel + a few
  // wiring plugins) plus framework plugins. Activation order is computed
  // from each plugin's descriptor.dependencies.
  const editor: EditorInstance = await createEditor({
    container,
    plugins: [
      // Foundational app context (no deps)
      ProjectPlugin,
      FilesystemPlugin,
      // Engine + render
      EstellaPlugin,
      RenderContextPlugin,
      ECSScenePlugin,
      // Document + panel layer
      DocumentSyncPlugin,
      ProjectPanelsPlugin,
      SceneViewPlugin,
      GameViewPlugin,
      HierarchyPlugin,
      InspectorPlugin,
      // Framework / settings panels
      PluginManagerPanelPlugin,
      SettingsPlugin,
    ],
    ...(projectPath ? { pluginScanner: new LocalPluginScanner(projectPath) } : {}),
  });

  const documentService = editor.kernel.services.get(IDocumentService);
  const consoleService = editor.kernel.services.get(IConsoleService);
  const fileSystem = editor.kernel.services.get(IFileSystemService);
  const project = editor.kernel.services.get(IProjectService);

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
          void showInputDialog('Create Plugin', {
            placeholder: 'Plugin name (e.g. My Tool)',
            okLabel: 'Create',
          }).then((name) => {
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
                const pluginDir = project.resolve(`plugins/${slug}`);
                const manifestRaw = await fileSystem.readFile(`${pluginDir}/plugin.json`);
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

  // Open the panels each app plugin registered.
  editor.layout.openPanel('scene-view');
  editor.layout.openPanel('hierarchy');
  editor.layout.openPanel('inspector');
  editor.layout.openPanel('project-files');
  editor.layout.openPanel('content-browser');

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
  if (project.isOpen) {
    const scenePath = project.resolve('scenes/main.scene.json');
    try {
      if (await fileSystem.exists(scenePath)) {
        await documentService.open(scenePath);
      }
    } catch {
      // No default scene — that's fine
    }
  }

  // ── Plugin hot-reload: watch plugin dist/ for changes ──
  if (project.isOpen) {
    const pluginsDir = project.resolve('plugins');
    fileSystem.watch(pluginsDir);
    fileSystem.onDidChangeFile((event) => {
      // Only reload when a .js file changes
      if (!event.path.endsWith('.js') || event.kind === 'deleted') return;
      // Restrict to plugin-dir events (the watcher above is the only one we set up,
      // but other plugins could install more — be defensive).
      if (!event.path.startsWith(pluginsDir + '/')) return;

      // Find which plugin this belongs to
      const relative = event.path.slice(pluginsDir.length + 1);
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
  }

  consoleService.log('info', 'Editor ready');
}

main().catch((err: unknown) => {
  document.body.textContent = `Failed to start: ${String(err)}`;
});
