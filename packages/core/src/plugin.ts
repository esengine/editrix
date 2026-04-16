import type { DisposableStore } from '@editrix/common';
import type { IEventBus } from './event-bus.js';
import type { IExtensionPointAccess } from './extension-point-registry.js';
import type { IServiceRegistry } from './service-registry.js';

/**
 * Static plugin descriptor — the "manifest" of a plugin.
 */
export interface IPluginDescriptor {
  /** Unique plugin identifier, e.g. `'editrix.document'`. */
  readonly id: string;
  /** Semver version string. */
  readonly version: string;
  /** IDs of plugins this plugin depends on. Prefix with `?` for optional deps. */
  readonly dependencies?: readonly string[];
  /** Events that trigger lazy activation. If omitted, activated eagerly on `kernel.start()`. */
  readonly activationEvents?: readonly string[];
}

/**
 * A plugin implementation. This is what plugin authors write.
 */
export interface IPlugin {
  readonly descriptor: IPluginDescriptor;

  /** Called when the plugin is activated. Register services, contribute to extension points. */
  activate(context: IPluginContext): Promise<void> | void;

  /** Called when the plugin is being deactivated. Optional cleanup beyond auto-disposed subscriptions. */
  deactivate?(): Promise<void> | void;
}

/**
 * Context passed to a plugin during activation — its API surface to the kernel.
 */
export interface IPluginContext {
  /** Register and resolve services. */
  readonly services: IServiceRegistry;
  /** Subscribe to and emit events. */
  readonly events: IEventBus;
  /** Declare and contribute to extension points. */
  readonly extensionPoints: IExtensionPointAccess;
  /** Auto-cleanup store. Everything added here is disposed when the plugin deactivates. */
  readonly subscriptions: DisposableStore;
}
