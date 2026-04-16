import type { Event, IDisposable } from '@editrix/common';
import { createServiceId, Emitter } from '@editrix/common';
import type { IKernel } from './kernel.js';
import type { IPluginScanner, PluginLoadResult } from './plugin-loader.js';
import { PluginLoader } from './plugin-loader.js';
import type { PluginManifest } from './plugin-manifest.js';
import { PluginState } from './types.js';

/**
 * Runtime status of a managed plugin.
 */
export interface PluginInfo {
  /** Plugin manifest metadata. */
  readonly manifest: PluginManifest;
  /** Current lifecycle state. */
  readonly state: PluginState;
  /** Whether the user has explicitly disabled this plugin. */
  readonly disabled: boolean;
  /** Whether this is a built-in (framework) plugin that cannot be uninstalled. */
  readonly builtin: boolean;
}

/**
 * Event payload when a plugin's status changes.
 */
export interface PluginStatusChangeEvent {
  readonly pluginId: string;
  readonly previousState: PluginState;
  readonly newState: PluginState;
}

/**
 * Central plugin management service.
 *
 * Builds on top of {@link IKernel} and {@link IPluginLoader} to provide
 * a complete plugin lifecycle: scan → install → enable/disable → uninstall.
 * Also manages a persistent disabled-set so user preferences survive restarts.
 *
 * @example
 * ```ts
 * const manager = new PluginManager(kernel);
 * await manager.scanAndLoad(scanner);
 * await manager.disablePlugin('some.plugin');
 * await manager.enablePlugin('some.plugin');
 * await manager.uninstallPlugin('some.plugin');
 * ```
 */
export interface IPluginManager extends IDisposable {
  /** Scan a directory and load all discovered plugins. */
  scanAndLoad(scanner: IPluginScanner): Promise<PluginLoadResult[]>;

  /** Get info for all known plugins (built-in + loaded). */
  getAll(): readonly PluginInfo[];

  /** Get info for a specific plugin. */
  getInfo(pluginId: string): PluginInfo | undefined;

  /** Disable a plugin (deactivates it, remembers the preference). */
  disablePlugin(pluginId: string): Promise<void>;

  /** Enable a previously disabled plugin (activates it). */
  enablePlugin(pluginId: string): Promise<void>;

  /** Uninstall a non-builtin plugin (deactivates + removes). */
  uninstallPlugin(pluginId: string): Promise<void>;

  /** Check if a plugin is disabled. */
  isDisabled(pluginId: string): boolean;

  /** Get the set of disabled plugin IDs. */
  getDisabledIds(): ReadonlySet<string>;

  /** Event fired when any plugin's status changes. */
  readonly onDidChangePlugin: Event<PluginStatusChangeEvent>;

  /** Event fired when the plugin list changes (install/uninstall). */
  readonly onDidChangePluginList: Event<void>;
}

/** Service identifier for DI. */
export const IPluginManager = createServiceId<IPluginManager>('IPluginManager');

/**
 * Default implementation of {@link IPluginManager}.
 *
 * @example
 * ```ts
 * const manager = new PluginManager(kernel);
 * const results = await manager.scanAndLoad(fileScanner);
 * manager.getAll(); // lists all plugins with status
 * ```
 */
export class PluginManager implements IPluginManager {
  private readonly _kernel: IKernel;
  private readonly _loader: PluginLoader;
  private readonly _infos = new Map<string, MutablePluginInfo>();
  private readonly _disabledIds = new Set<string>();

  private readonly _onDidChangePlugin = new Emitter<PluginStatusChangeEvent>();
  private readonly _onDidChangePluginList = new Emitter<void>();

  readonly onDidChangePlugin: Event<PluginStatusChangeEvent> = this._onDidChangePlugin.event;
  readonly onDidChangePluginList: Event<void> = this._onDidChangePluginList.event;

  constructor(kernel: IKernel) {
    this._kernel = kernel;
    this._loader = new PluginLoader(kernel);
  }

  /**
   * Register a built-in plugin's manifest so it appears in the plugin list.
   * Built-in plugins cannot be uninstalled or disabled.
   */
  registerBuiltin(manifest: PluginManifest): void {
    this._infos.set(manifest.id, {
      manifest,
      state: PluginState.Active,
      disabled: false,
      builtin: true,
    });
  }

  async scanAndLoad(scanner: IPluginScanner): Promise<PluginLoadResult[]> {
    const results = await this._loader.loadFromScanner(scanner);

    for (const result of results) {
      const info: MutablePluginInfo = {
        manifest: result.manifest,
        state: result.success ? PluginState.Resolved : PluginState.Unloaded,
        disabled: this._disabledIds.has(result.manifest.id),
        builtin: false,
      };
      this._infos.set(result.manifest.id, info);
    }

    this._onDidChangePluginList.fire();
    return results;
  }

  getAll(): readonly PluginInfo[] {
    return [...this._infos.values()];
  }

  getInfo(pluginId: string): PluginInfo | undefined {
    return this._infos.get(pluginId);
  }

  async disablePlugin(pluginId: string): Promise<void> {
    const info = this._infos.get(pluginId);
    if (!info) {
      throw new Error(`Plugin "${pluginId}" is not known.`);
    }
    if (info.builtin) {
      throw new Error(`Cannot disable built-in plugin "${pluginId}".`);
    }

    const prev = info.state;
    this._disabledIds.add(pluginId);
    info.disabled = true;

    // Deactivate if currently active
    await this._kernel.deactivatePlugin(pluginId);
    info.state = PluginState.Unloaded;

    this._onDidChangePlugin.fire({ pluginId, previousState: prev, newState: info.state });
  }

  async enablePlugin(pluginId: string): Promise<void> {
    const info = this._infos.get(pluginId);
    if (!info) {
      throw new Error(`Plugin "${pluginId}" is not known.`);
    }

    const prev = info.state;
    this._disabledIds.delete(pluginId);
    info.disabled = false;

    // Activate
    await this._kernel.activatePlugin(pluginId);
    info.state = PluginState.Active;

    this._onDidChangePlugin.fire({ pluginId, previousState: prev, newState: info.state });
  }

  async uninstallPlugin(pluginId: string): Promise<void> {
    const info = this._infos.get(pluginId);
    if (!info) {
      throw new Error(`Plugin "${pluginId}" is not known.`);
    }
    if (info.builtin) {
      throw new Error(`Cannot uninstall built-in plugin "${pluginId}".`);
    }

    // Deactivate first
    await this._kernel.deactivatePlugin(pluginId);

    // Remove from tracking
    this._infos.delete(pluginId);
    this._disabledIds.delete(pluginId);

    this._onDidChangePluginList.fire();
  }

  isDisabled(pluginId: string): boolean {
    return this._disabledIds.has(pluginId);
  }

  getDisabledIds(): ReadonlySet<string> {
    return this._disabledIds;
  }

  /**
   * Restore disabled state from a previously saved set.
   * Call this before {@link scanAndLoad} so newly loaded plugins respect preferences.
   */
  restoreDisabledIds(ids: readonly string[]): void {
    for (const id of ids) {
      this._disabledIds.add(id);
    }
  }

  dispose(): void {
    this._loader.dispose();
    this._infos.clear();
    this._disabledIds.clear();
    this._onDidChangePlugin.dispose();
    this._onDidChangePluginList.dispose();
  }
}

/** Internal mutable version of PluginInfo. */
interface MutablePluginInfo {
  readonly manifest: PluginManifest;
  state: PluginState;
  disabled: boolean;
  readonly builtin: boolean;
}
