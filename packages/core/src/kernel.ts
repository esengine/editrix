import type { Event, IDisposable } from '@editrix/common';
import { DisposableStore, Emitter } from '@editrix/common';
import type { IEventBus } from './event-bus.js';
import { EventBus } from './event-bus.js';
import type { IExtensionPointAccess } from './extension-point-registry.js';
import { ExtensionPointRegistry } from './extension-point-registry.js';
import type { IPlugin, IPluginContext } from './plugin.js';
import type { IServiceRegistry } from './service-registry.js';
import { ServiceRegistry } from './service-registry.js';
import { PluginState } from './types.js';

/**
 * The micro-kernel — owns plugin lifecycle, service registry, event bus,
 * and extension point system.
 */
export interface IKernel extends IDisposable {
  /** Register a plugin with the kernel. */
  registerPlugin(plugin: IPlugin): void;

  /** Activate a plugin by ID (and its dependencies, transitively). */
  activatePlugin(pluginId: string): Promise<void>;

  /** Deactivate a plugin (and plugins that depend on it, transitively). */
  deactivatePlugin(pluginId: string): Promise<void>;

  /** Activate all eagerly-registered plugins in dependency order. */
  start(): Promise<void>;

  /** Deactivate all plugins in reverse dependency order, then release all resources. */
  shutdown(): Promise<void>;

  /** Global service registry. */
  readonly services: IServiceRegistry;

  /** Global event bus. */
  readonly events: IEventBus;

  /** Global extension point registry. */
  readonly extensionPoints: IExtensionPointAccess;

  /** Lifecycle events. */
  readonly onDidActivatePlugin: Event<string>;
  readonly onDidDeactivatePlugin: Event<string>;
}

interface PluginEntry {
  readonly plugin: IPlugin;
  state: PluginState;
  subscriptions: DisposableStore;
  // In-flight activation Promise — concurrent activatePlugin callers await this
  // instead of returning early on the Activating state, which used to let dependents
  // run before the dependency had finished registering its services.
  activation?: Promise<void>;
}

/**
 * Create a new kernel instance.
 *
 * @example
 * ```ts
 * const kernel = createKernel();
 * kernel.registerPlugin(myPlugin);
 * await kernel.start();
 * // ... use the editor ...
 * await kernel.shutdown();
 * ```
 */
export function createKernel(): IKernel {
  return new Kernel();
}

class Kernel implements IKernel {
  private readonly _plugins = new Map<string, PluginEntry>();
  private readonly _serviceRegistry = new ServiceRegistry();
  private readonly _eventBus = new EventBus();
  private readonly _extensionPoints = new ExtensionPointRegistry();

  private readonly _onDidActivate = new Emitter<string>();
  private readonly _onDidDeactivate = new Emitter<string>();

  readonly onDidActivatePlugin: Event<string> = this._onDidActivate.event;
  readonly onDidDeactivatePlugin: Event<string> = this._onDidDeactivate.event;

  get services(): IServiceRegistry {
    return this._serviceRegistry;
  }

  get events(): IEventBus {
    return this._eventBus;
  }

  get extensionPoints(): IExtensionPointAccess {
    return this._extensionPoints;
  }

  registerPlugin(plugin: IPlugin): void {
    const id = plugin.descriptor.id;
    if (this._plugins.has(id)) {
      throw new Error(`Plugin "${id}" is already registered.`);
    }
    this._plugins.set(id, {
      plugin,
      state: PluginState.Unloaded,
      subscriptions: new DisposableStore(),
    });
  }

  async activatePlugin(pluginId: string): Promise<void> {
    const entry = this._plugins.get(pluginId);
    if (!entry) {
      throw new Error(`Plugin "${pluginId}" is not registered.`);
    }
    if (entry.state === PluginState.Active) {
      return;
    }
    if (entry.activation) {
      // A concurrent caller is mid-activation; share its Promise so both
      // observe completion (or failure) at the same point.
      return entry.activation;
    }

    const promise = this._doActivate(pluginId, entry);
    entry.activation = promise;
    try {
      await promise;
    } finally {
      delete entry.activation;
    }
  }

  private async _doActivate(pluginId: string, entry: PluginEntry): Promise<void> {
    // Dependencies must be active before this plugin can initialize
    const deps = entry.plugin.descriptor.dependencies ?? [];
    for (const dep of deps) {
      const isOptional = dep.startsWith('?');
      const depId = isOptional ? dep.slice(1) : dep;
      if (this._plugins.has(depId)) {
        await this.activatePlugin(depId);
      } else if (!isOptional) {
        throw new Error(`Plugin "${pluginId}" requires "${depId}", but it is not registered.`);
      }
    }

    entry.state = PluginState.Activating;
    const context: IPluginContext = {
      services: this._serviceRegistry,
      events: this._eventBus,
      extensionPoints: this._extensionPoints,
      subscriptions: entry.subscriptions,
    };

    try {
      await entry.plugin.activate(context);
      entry.state = PluginState.Active;
      this._onDidActivate.fire(pluginId);
      this._eventBus.emit('plugin.activated', pluginId);
    } catch (cause) {
      // Tear down any disposables the plugin managed to register before
      // throwing, so a retry starts from a clean store.
      entry.subscriptions.dispose();
      entry.subscriptions = new DisposableStore();
      entry.state = PluginState.Unloaded;
      throw new Error(`Plugin "${pluginId}" failed to activate.`, { cause });
    }
  }

  async deactivatePlugin(pluginId: string): Promise<void> {
    const entry = this._plugins.get(pluginId);
    if (entry?.state !== PluginState.Active) {
      return;
    }

    // Dependents must be torn down before their dependency disappears
    for (const [id, other] of this._plugins) {
      if (other.state !== PluginState.Active) continue;
      const deps = other.plugin.descriptor.dependencies ?? [];
      const dependsOnThis = deps.some((d) => {
        const depId = d.startsWith('?') ? d.slice(1) : d;
        return depId === pluginId;
      });
      if (dependsOnThis) {
        await this.deactivatePlugin(id);
      }
    }

    entry.state = PluginState.Deactivating;
    try {
      await entry.plugin.deactivate?.();
    } finally {
      entry.subscriptions.dispose();
      entry.subscriptions = new DisposableStore();
      entry.state = PluginState.Unloaded;
      this._onDidDeactivate.fire(pluginId);
      this._eventBus.emit('plugin.deactivated', pluginId);
    }
  }

  async start(): Promise<void> {
    const order = this._topologicalSort();
    for (const pluginId of order) {
      const entry = this._plugins.get(pluginId);
      if (!entry) continue;
      // Lazy plugins are activated on-demand when their activation events fire
      const activationEvents = entry.plugin.descriptor.activationEvents;
      if (activationEvents && activationEvents.length > 0) {
        entry.state = PluginState.Resolved;
        continue;
      }
      await this.activatePlugin(pluginId);
    }
  }

  async shutdown(): Promise<void> {
    const order = this._topologicalSort().reverse();
    const errors: Error[] = [];
    for (const pluginId of order) {
      try {
        await this.deactivatePlugin(pluginId);
      } catch (cause) {
        // Collect and continue — one buggy deactivate must not strand the
        // rest of the editor with un-disposed resources.
        errors.push(new Error(`Plugin "${pluginId}" failed to deactivate.`, { cause }));
      }
    }
    this.dispose();
    if (errors.length > 0) {
      throw new AggregateError(errors, 'One or more plugins failed to deactivate during shutdown.');
    }
  }

  dispose(): void {
    this._serviceRegistry.dispose();
    this._eventBus.dispose();
    this._extensionPoints.dispose();
    this._onDidActivate.dispose();
    this._onDidDeactivate.dispose();
  }

  /**
   * Topological sort of plugins by dependency order.
   * Throws on cycles with a descriptive error.
   */
  private _topologicalSort(): string[] {
    const result: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (id: string, path: string[]): void => {
      if (visited.has(id)) return;
      if (visiting.has(id)) {
        const cycle = [...path.slice(path.indexOf(id)), id].join(' → ');
        throw new Error(`Circular plugin dependency detected: ${cycle}`);
      }

      const entry = this._plugins.get(id);
      if (!entry) return;

      visiting.add(id);
      path.push(id);

      const deps = entry.plugin.descriptor.dependencies ?? [];
      for (const dep of deps) {
        const depId = dep.startsWith('?') ? dep.slice(1) : dep;
        visit(depId, path);
      }

      path.pop();
      visiting.delete(id);
      visited.add(id);
      result.push(id);
    };

    for (const id of this._plugins.keys()) {
      visit(id, []);
    }

    return result;
  }
}
