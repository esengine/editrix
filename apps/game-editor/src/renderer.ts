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
  IViewAdapter,
  IViewService,
} from '@editrix/shell';
import type { EditorInstance, IPlugin } from '@editrix/shell';
import { createIconElement, DomViewAdapter } from '@editrix/view-dom';
import { showInputDialog, showThreeChoiceDialog } from './dialogs.js';
import { LocalPluginScanner } from './local-plugin-scanner.js';
import {
  DocumentSyncPlugin,
  DocumentTabsPlugin,
  ECSScenePlugin,
  FilesystemPlugin,
  HierarchyPlugin,
  InspectorFiltersPlugin,
  InspectorPlugin,
  PlayModePlugin,
  ProjectPanelsPlugin,
  ProjectPlugin,
  RenderContextPlugin,
  ViewportPlugin,
} from './plugins/index.js';
import { IPlayModeService, IProjectService } from './services.js';

// ─── Electron API ───────────────────────────────────────

interface ElectronAPI {
  minimize(): void;
  maximize(): void;
  close(): void;
  getProjectPath(): string;
  onRequestClose(handler: () => void): void;
  closeAck(shouldClose: boolean): void;
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

  const editor: EditorInstance = await createEditor({
    container,
    plugins: [
      ProjectPlugin,
      FilesystemPlugin,
      InspectorFiltersPlugin,
      EstellaPlugin,
      RenderContextPlugin,
      ECSScenePlugin,
      PlayModePlugin,
      DocumentSyncPlugin,
      DocumentTabsPlugin,
      ProjectPanelsPlugin,
      ViewportPlugin,
      HierarchyPlugin,
      InspectorPlugin,
      PluginManagerPanelPlugin,
      SettingsPlugin,
    ],
    ...(projectPath ? { pluginScanner: new LocalPluginScanner(projectPath) } : {}),
  });

  const documentService = editor.kernel.services.get(IDocumentService);
  const consoleService = editor.kernel.services.get(IConsoleService);
  const fileSystem = editor.kernel.services.get(IFileSystemService);
  const project = editor.kernel.services.get(IProjectService);

  // Preload the runtime SDK so the first Play doesn't wait on a 368KB fetch.
  const estellaService = editor.kernel.services.get(IEstellaService);
  estellaService.loadCore('estella:///').then(() => {
    return estellaService.loadSDK();
  }).catch((err: unknown) => {
    consoleService.log('error', `Failed to load estella: ${String(err)}`, 'estella');
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
      { id: 'file.newScene', label: 'New Scene', onClick: () => {
        void editor.commands.execute('scene.new');
      } },
      { id: 'file.openScene', label: 'Open Scene...', onClick: () => {
        void editor.commands.execute('scene.open');
      } },
      { id: 'sep0', label: '', separator: true },
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
  const DEFAULT_PANELS: readonly string[] = [
    'viewport', 'hierarchy', 'inspector', 'project-files', 'content-browser',
  ];
  const openDefaultPanels = (): void => {
    for (const id of DEFAULT_PANELS) editor.layout.openPanel(id);
  };

  editor.commands.register({
    id: 'view.openPanel', title: 'Open Panel...', category: 'View',
    execute() {
      const adapter = editor.kernel.services.get(IViewAdapter);
      if (adapter instanceof DomViewAdapter) adapter.showPanelPicker();
    },
  });
  editor.commands.register({
    id: 'view.resetLayout', title: 'Reset Layout', category: 'View',
    execute() {
      editor.layout.setLayout({ type: 'tab-group', panels: [], activeIndex: 0 });
      openDefaultPanels();
    },
  });

  editor.view.menuBar.addMenu({
    id: 'view-menu', label: 'View', items: [
      { id: 'view.openPanel', label: 'Open Panel...', onClick: () => { void editor.commands.execute('view.openPanel'); } },
      { id: 'view.resetLayout', label: 'Reset Layout', onClick: () => { void editor.commands.execute('view.resetLayout'); } },
    ],
  });

  editor.view.menuBar.addMenu({ id: 'help', label: 'Help', items: [] });

  openDefaultPanels();

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

  getApi()?.onRequestClose(() => {
    void (async (): Promise<void> => {
      const dirty = documentService.getOpenDocuments().filter((d) => d.dirty);
      if (dirty.length === 0) {
        getApi()?.closeAck(true);
        return;
      }

      const message = dirty.length === 1
        ? `"${dirty[0]?.name ?? ''}" has unsaved changes.\nSave before closing?`
        : `${String(dirty.length)} files have unsaved changes:\n\n${dirty.map((d) => `• ${d.name}`).join('\n')}\n\nSave before closing?`;

      const choice = await showThreeChoiceDialog(message);
      if (choice === 'cancel') {
        getApi()?.closeAck(false);
        return;
      }
      if (choice === 'save') {
        try {
          for (const doc of dirty) {
            await documentService.save(doc.filePath);
          }
        } catch (err) {
          // Mid-flight save failure — stay open so the user can retry.
          consoleService.log(
            'error',
            `Save failed, aborting close: ${err instanceof Error ? err.message : String(err)}`,
          );
          getApi()?.closeAck(false);
          return;
        }
      }
      getApi()?.closeAck(true);
    })();
  });

  // ── Right section: Play/Pause/Stop/Step + window controls ──
  const rightSection = editor.view.menuBar.rightSection;
  if (rightSection) {
    const playMode = editor.kernel.services.get(IPlayModeService);

    // Build a single play button that toggles based on mode (Play <-> Pause),
    // a Stop button visible only while in play, and a Step button visible only
    // while paused. The mode-change handler swaps icon/title/visibility.
    const playBtn = document.createElement('button');
    playBtn.className = 'editrix-menubar-play-btn';
    playBtn.appendChild(createIconElement('play', 16));
    playBtn.title = 'Play (F5)';
    playBtn.addEventListener('click', () => {
      switch (playMode.mode) {
        case 'edit': playMode.play(); break;
        case 'playing': playMode.pause(); break;
        case 'paused': playMode.resume(); break;
      }
    });
    rightSection.appendChild(playBtn);

    const stopBtn = document.createElement('button');
    stopBtn.className = 'editrix-menubar-play-btn';
    stopBtn.appendChild(createIconElement('x', 16));
    stopBtn.title = 'Stop (Shift+F5)';
    stopBtn.style.display = 'none';
    stopBtn.addEventListener('click', () => { playMode.stop(); });
    rightSection.appendChild(stopBtn);

    const stepBtn = document.createElement('button');
    stepBtn.className = 'editrix-menubar-play-btn';
    stepBtn.appendChild(createIconElement('refresh', 16));
    stepBtn.title = 'Step one frame (F6)';
    stepBtn.style.display = 'none';
    stepBtn.addEventListener('click', () => { playMode.step(); });
    rightSection.appendChild(stepBtn);

    const updatePlayButtons = (mode: typeof playMode.mode): void => {
      // Swap the play button between Play and Pause icons.
      playBtn.replaceChildren(createIconElement(mode === 'playing' ? 'pause' : 'play', 16));
      playBtn.title = mode === 'playing' ? 'Pause (F5)' : mode === 'paused' ? 'Resume (F5)' : 'Play (F5)';
      stopBtn.style.display = mode === 'edit' ? 'none' : '';
      stepBtn.style.display = mode === 'paused' ? '' : 'none';
    };
    updatePlayButtons(playMode.mode);
    playMode.onDidChangeMode(({ current }) => { updatePlayButtons(current); });

    // Keyboard: F5 toggles play/pause, Shift+F5 stops, F6 steps.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'F5') {
        e.preventDefault();
        if (e.shiftKey) {
          playMode.stop();
        } else {
          switch (playMode.mode) {
            case 'edit': playMode.play(); break;
            case 'playing': playMode.pause(); break;
            case 'paused': playMode.resume(); break;
          }
        }
      } else if (e.key === 'F6' && playMode.mode === 'paused') {
        e.preventDefault();
        playMode.step();
      }
    });

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

  // Mode indicator — quietly says EDIT, loudly says PLAY/PAUSED so the user
  // is never confused about whether their changes are about to be reverted.
  const playModeService = editor.kernel.services.get(IPlayModeService);
  const renderModeLabel = (mode: typeof playModeService.mode): string => {
    switch (mode) {
      case 'playing': return '▶ PLAY';
      case 'paused':  return '❚❚ PAUSED';
      case 'edit':    return 'EDIT';
    }
  };
  editor.view.statusBar.addItem({
    id: 'play-mode',
    text: renderModeLabel(playModeService.mode),
    alignment: 'right',
  });
  playModeService.onDidChangeMode(({ current }) => {
    editor.view.statusBar.updateItem('play-mode', renderModeLabel(current));
    document.body.dataset['playMode'] = current;
  });
  document.body.dataset['playMode'] = playModeService.mode;

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
              // Single viewport panel — Scene/Game switch lives inside the
              // panel itself as a segmented control, so this tab-group has
              // exactly one fixed panel and the layout-renderer skips its
              // tab header entirely.
              node: { type: 'tab-group', panels: ['viewport'], activeIndex: 0 },
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

  // Initial scene load is handled by DocumentSyncPlugin on ECS bind — keeping
  // the autoload there means the seed/load decision is mutually exclusive
  // (no default Camera+Shape briefly appearing before a real scene replaces it).

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
