import type { Event, IDisposable, ServiceIdentifier } from '@editrix/common';
import { Emitter, toDisposable } from '@editrix/common';
import { ServiceScope } from './types.js';

/**
 * Typed service registry — the DI container of the micro-kernel.
 */
export interface IServiceRegistry {
  /** Register a service instance or class. Returns a disposable to unregister. */
  register<T>(id: ServiceIdentifier<T>, impl: T, scope?: ServiceScope): IDisposable;

  /** Resolve a service. Throws if not registered. */
  get<T>(id: ServiceIdentifier<T>): T;

  /** Resolve a service, returning undefined if not registered. */
  getOptional<T>(id: ServiceIdentifier<T>): T | undefined;

  /** Check if a service is registered. */
  has(id: ServiceIdentifier<unknown>): boolean;

  /** Event fired when a service is registered or unregistered. */
  readonly onDidChangeService: Event<ServiceIdentifier<unknown>>;
}

interface ServiceEntry {
  readonly id: ServiceIdentifier<unknown>;
  readonly impl: unknown;
  readonly scope: ServiceScope;
}

/**
 * Default implementation of {@link IServiceRegistry}.
 *
 * @example
 * ```ts
 * const registry = new ServiceRegistry();
 * registry.register(ILogger, consoleLogger);
 * const logger = registry.get(ILogger);
 * ```
 */
export class ServiceRegistry implements IServiceRegistry, IDisposable {
  private readonly _entries = new Map<symbol, ServiceEntry>();
  private readonly _onDidChange = new Emitter<ServiceIdentifier<unknown>>();

  readonly onDidChangeService: Event<ServiceIdentifier<unknown>> = this._onDidChange.event;

  register<T>(
    id: ServiceIdentifier<T>,
    impl: T,
    scope: ServiceScope = ServiceScope.Singleton,
  ): IDisposable {
    if (this._entries.has(id.id)) {
      throw new Error(`Service "${id.name}" is already registered.`);
    }

    const entry: ServiceEntry = { id: id as ServiceIdentifier<unknown>, impl, scope };
    this._entries.set(id.id, entry);
    this._onDidChange.fire(id as ServiceIdentifier<unknown>);

    return toDisposable(() => {
      this._entries.delete(id.id);
      this._onDidChange.fire(id as ServiceIdentifier<unknown>);
    });
  }

  get<T>(id: ServiceIdentifier<T>): T {
    const result = this.getOptional(id);
    if (result === undefined) {
      throw new Error(`Service "${id.name}" is not registered.`);
    }
    return result;
  }

  getOptional<T>(id: ServiceIdentifier<T>): T | undefined {
    const entry = this._entries.get(id.id);
    if (!entry) {
      return undefined;
    }
    return entry.impl as T;
  }

  has(id: ServiceIdentifier<unknown>): boolean {
    return this._entries.has(id.id);
  }

  dispose(): void {
    // Surface the unregistration so listeners (UI, caches) can release any
    // references they kept to the resolved instances before the registry goes away.
    const ids = [...this._entries.values()].map((e) => e.id);
    this._entries.clear();
    for (const id of ids) {
      this._onDidChange.fire(id);
    }
    this._onDidChange.dispose();
  }
}
