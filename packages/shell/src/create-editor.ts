import { CommandsPlugin, ICommandRegistry } from '@editrix/commands';
import type {
  IClipboardService,
  IDialogService,
  IKernel,
  INotificationService,
  IPlugin,
  IPluginManager,
  IPluginScanner,
  ISettingsService,
  IUndoRedoService,
  IWorkspaceService,
  WorkspaceConfig,
} from '@editrix/core';
import {
  createKernel,
  IClipboardService as IClipboardServiceId,
  IDialogService as IDialogServiceId,
  INotificationService as INotificationServiceId,
  IPathService as IPathServiceId,
  IPluginManager as IPluginManagerId,
  ISettingsService as ISettingsServiceId,
  IUndoRedoService as IUndoRedoServiceId,
  IWorkspaceService as IWorkspaceServiceId,
  PathService,
  PluginManager,
  SettingsService,
  UndoRedoService,
  WorkspaceService,
} from '@editrix/core';
import { ILayoutService, LayoutPlugin } from '@editrix/layout';
import { PropertiesPlugin } from '@editrix/properties';
import { IViewAdapter, ViewPlugin } from '@editrix/view';
import type { DomViewAdapter, DomViewAdapterOptions } from '@editrix/view-dom';
import { createDomViewPlugin, SettingsBinding } from '@editrix/view-dom';

/**
 * Options for creating an editor instance.
 */
export interface CreateEditorOptions {
  /** The DOM element to mount the editor into. */
  readonly container: HTMLElement;
  /** Additional plugins to register alongside the built-in ones. */
  readonly plugins?: readonly IPlugin[];
  /** Plugin scanner for dynamic plugin loading. If provided, scans and loads before start. */
  readonly pluginScanner?: IPluginScanner;
  /** Previously disabled plugin IDs to restore. */
  readonly disabledPlugins?: readonly string[];
  /** Previously saved user settings to restore. */
  readonly userSettings?: Record<string, unknown>;
  /** DOM view adapter options (theme, etc.). */
  readonly viewOptions?: DomViewAdapterOptions;
  /**
   * Initial workspace (opened project). When provided, the workspace
   * service is seeded with it before plugins activate — plugins that
   * read {@link IWorkspaceService.path} during `activate()` see the
   * correct value immediately. Omit when the editor launches without a
   * project (standalone mode).
   */
  readonly workspace?: {
    readonly path: string;
    readonly config?: WorkspaceConfig;
  };
}

/**
 * A running editor instance.
 */
export interface EditorInstance {
  /** The micro-kernel powering this editor. */
  readonly kernel: IKernel;
  /** Shortcut to the layout service. */
  readonly layout: ILayoutService;
  /** Shortcut to the command registry. */
  readonly commands: ICommandRegistry;
  /** Shortcut to the plugin manager. */
  readonly pluginManager: IPluginManager;
  /** Shortcut to the settings service. */
  readonly settings: ISettingsService;
  /** Shortcut to the undo/redo service. */
  readonly undoRedo: IUndoRedoService;
  /** Shortcut to the dialog service (provided by the DOM view plugin). */
  readonly dialogs: IDialogService;
  /** Shortcut to the notification (toast) service. */
  readonly notifications: INotificationService;
  /** Shortcut to the clipboard service. */
  readonly clipboard: IClipboardService;
  /** Shortcut to the workspace (current-project) service. */
  readonly workspace: IWorkspaceService;
  /** The DOM view adapter. */
  readonly view: DomViewAdapter;
  /** Shut down the editor and release all resources. */
  destroy(): Promise<void>;
}

/**
 * Create and start a fully assembled editor instance.
 *
 * This is the main entry point for consuming the Editrix framework.
 * It registers all built-in plugins, optionally scans for dynamic plugins,
 * activates them in the correct order, and mounts the DOM view.
 *
 * @example
 * ```ts
 * const editor = await createEditor({
 *   container: document.getElementById('app')!,
 *   plugins: [myCustomPlugin],
 *   pluginScanner: new FileSystemScanner('./plugins'),
 * });
 *
 * editor.pluginManager.getAll(); // list all plugins with status
 * await editor.destroy();
 * ```
 */
export async function createEditor(options: CreateEditorOptions): Promise<EditorInstance> {
  const kernel = createKernel();

  // Core services
  const pluginManager = new PluginManager(kernel);
  kernel.services.register(IPluginManagerId, pluginManager);

  const settingsService = new SettingsService();
  kernel.services.register(ISettingsServiceId, settingsService);

  const pathService = new PathService();
  kernel.services.register(IPathServiceId, pathService);

  const undoRedoService = new UndoRedoService();
  kernel.services.register(IUndoRedoServiceId, undoRedoService);

  const workspaceService = new WorkspaceService(
    options.workspace
      ? {
          path: options.workspace.path,
          ...(options.workspace.config !== undefined ? { config: options.workspace.config } : {}),
        }
      : {},
  );
  kernel.services.register(IWorkspaceServiceId, workspaceService);

  if (options.userSettings) {
    settingsService.importUserValues(options.userSettings);
  }

  // Restore disabled preferences
  if (options.disabledPlugins) {
    pluginManager.restoreDisabledIds(options.disabledPlugins);
  }

  // Register built-in plugins
  const builtins: IPlugin[] = [
    CommandsPlugin,
    LayoutPlugin,
    ViewPlugin,
    PropertiesPlugin,
    createDomViewPlugin(options.viewOptions),
  ];

  for (const plugin of builtins) {
    kernel.registerPlugin(plugin);
    pluginManager.registerBuiltin({
      id: plugin.descriptor.id,
      name: plugin.descriptor.id.split('.').pop() ?? plugin.descriptor.id,
      version: plugin.descriptor.version,
      description: `Built-in ${plugin.descriptor.id} plugin`,
    });
  }

  // Register statically provided user plugins
  if (options.plugins) {
    for (const plugin of options.plugins) {
      kernel.registerPlugin(plugin);
    }
  }

  // Scan and load dynamic plugins
  if (options.pluginScanner) {
    await pluginManager.scanAndLoad(options.pluginScanner);
  }

  // Start the kernel (activates all eager, non-disabled plugins in dependency order)
  await kernel.start();

  // Mount the DOM view adapter
  const view = kernel.services.get(IViewAdapter) as DomViewAdapter;
  view.mount(options.container);

  const layout = kernel.services.get(ILayoutService);
  const commands = kernel.services.get(ICommandRegistry);
  const dialogs = kernel.services.get(IDialogServiceId);
  const notifications = kernel.services.get(INotificationServiceId);
  const clipboard = kernel.services.get(IClipboardServiceId);

  commands.onWillExecute((commandId) => {
    void kernel.fireActivationEvent(`onCommand:${commandId}`);
  });

  // Mirror workspace-scoped settings from the project config into
  // ISettingsService. When the workspace closes or switches, the
  // overlay is atomically swapped — listeners observe a single change
  // event per key whose effective value moved.
  const applyWorkspaceSettings = (config: WorkspaceConfig | undefined): void => {
    settingsService.setWorkspaceValues(config?.settings ?? {});
  };
  applyWorkspaceSettings(workspaceService.config);
  workspaceService.onDidChange((ev) => {
    applyWorkspaceSettings(ev.config);
    if (ev.path.length > 0) void kernel.fireActivationEvent('onWorkspaceOpen');
  });
  if (workspaceService.isOpen) {
    await kernel.fireActivationEvent('onWorkspaceOpen');
  }

  registerBuiltinCommands(commands, layout, undoRedoService);
  const globalBinding = registerEditorSettings(settingsService, options.container);

  // Undo stack size controlled by settings
  settingsService.onDidChange('editrix.editor.maxUndoSteps', (e) => {
    undoRedoService.setMaxStackSize(e.newValue as number);
  });

  return {
    kernel,
    layout,
    commands,
    pluginManager,
    settings: settingsService,
    undoRedo: undoRedoService,
    dialogs,
    notifications,
    clipboard,
    workspace: workspaceService,
    view,
    async destroy() {
      globalBinding.dispose();
      view.unmount();
      await kernel.shutdown();
      undoRedoService.dispose();
      pluginManager.dispose();
      settingsService.dispose();
      workspaceService.dispose();
      pathService.dispose();
    },
  };
}

/**
 * Register commands that are always available in any editor.
 */
function registerBuiltinCommands(
  commands: ICommandRegistry,
  layout: ILayoutService,
  undoRedo: IUndoRedoService,
): void {
  commands.register({
    id: 'editrix.undo',
    title: 'Undo',
    category: 'Edit',
    execute() {
      undoRedo.undo();
    },
  });

  commands.register({
    id: 'editrix.redo',
    title: 'Redo',
    category: 'Edit',
    execute() {
      undoRedo.redo();
    },
  });

  commands.register({
    id: 'editrix.closePanel',
    title: 'Close Active Panel',
    category: 'Layout',
    execute() {
      const openIds = layout.getOpenPanelIds();
      const last = openIds[openIds.length - 1];
      if (last) {
        layout.closePanel(last);
      }
    },
  });

  commands.register({
    id: 'editrix.resetLayout',
    title: 'Reset Layout',
    category: 'Layout',
    execute() {
      layout.setLayout({ type: 'tab-group', panels: [], activeIndex: 0 });
    },
  });
}

/**
 * Register editor-wide settings and bind them reactively to CSS variables.
 */
function registerEditorSettings(
  settings: ISettingsService,
  container: HTMLElement,
): SettingsBinding {
  settings.registerGroup({
    id: 'editrix.editor',
    label: 'Editor',
    settings: [
      {
        key: 'editrix.editor.fontSize',
        label: 'Font Size',
        type: 'range',
        defaultValue: 13,
        min: 10,
        max: 24,
        step: 1,
        description: 'Base font size for the editor UI',
      },
      {
        key: 'editrix.editor.fontFamily',
        label: 'Font Family',
        type: 'enum',
        defaultValue: 'system-ui',
        enumValues: [
          'system-ui',
          'Segoe UI',
          'Microsoft YaHei UI',
          'Inter',
          'Roboto',
          'Arial',
          'Helvetica',
        ],
        description: 'Font family for the editor UI',
      },
      {
        key: 'editrix.editor.monoFont',
        label: 'Monospace Font',
        type: 'enum',
        defaultValue: 'Consolas',
        enumValues: ['Consolas', 'Cascadia Code', 'Cascadia Mono', 'Courier New', 'monospace'],
        description: 'Monospace font for console, code, and IDs',
      },
      {
        key: 'editrix.editor.sidebarWidth',
        label: 'Sidebar Width',
        type: 'range',
        defaultValue: 260,
        min: 180,
        max: 500,
        step: 10,
        description: 'Width of the sidebar panel in pixels',
      },
      {
        key: 'editrix.editor.maxUndoSteps',
        label: 'Max Undo Steps',
        type: 'number',
        defaultValue: 100,
        description: 'Maximum number of undo steps to keep in history',
      },
    ],
  });

  const binding = new SettingsBinding(settings);

  binding.bindStyle(container, 'editrix.editor.fontSize', 'fontSize', 'px');
  binding.bindStyle(container, 'editrix.editor.fontFamily', 'fontFamily');
  binding.bindCssVar(container, 'editrix.editor.monoFont', '--editrix-mono-font');
  binding.bindCssVar(container, 'editrix.editor.sidebarWidth', '--editrix-sidebar-width', 'px');

  return binding;
}
