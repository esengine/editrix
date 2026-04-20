import type { Event, ExtensionPointId, IDisposable } from '@editrix/common';
import { Emitter, toDisposable } from '@editrix/common';

/**
 * Options for declaring an extension point.
 */
export interface ExtensionPointOptions<T> {
  /** Validate a contribution before accepting it. */
  validator?: (contribution: T) => boolean;
}

/**
 * A declared extension point with its current contributions.
 */
export interface IExtensionPoint<T> {
  readonly id: ExtensionPointId<T>;
  readonly contributions: readonly T[];
  readonly onDidChange: Event<readonly T[]>;
}

/**
 * Access to the extension point system.
 */
export interface IExtensionPointAccess {
  /** Declare a new extension point. */
  declare<T>(id: ExtensionPointId<T>, options?: ExtensionPointOptions<T>): IExtensionPoint<T>;

  /** Contribute to a declared extension point. */
  contribute<T>(id: ExtensionPointId<T>, contribution: T): IDisposable;

  /** Read all contributions to an extension point. */
  getContributions<T>(id: ExtensionPointId<T>): readonly T[];

  /** React to contributions being added or removed. */
  onDidChangeContributions<T>(
    id: ExtensionPointId<T>,
    handler: (contributions: readonly T[]) => void,
  ): IDisposable;
}

interface ExtensionPointEntry {
  readonly contributions: unknown[];
  readonly emitter: Emitter<readonly unknown[]>;
  readonly validator: ((contribution: unknown) => boolean) | undefined;
}

/**
 * A subscriber that arrived before the extension point was declared. We hold
 * onto the handler so that when declare() finally happens we can attach it to
 * the real emitter and replay an initial snapshot — eliminating activation-order
 * coupling between contributors and observers.
 */
interface PendingSubscriber {
  readonly handler: (contributions: readonly unknown[]) => void;
  /** Set to true if the disposable returned to the caller is disposed before declare. */
  cancelled: boolean;
}

/**
 * Default implementation of {@link IExtensionPointAccess}.
 *
 * @example
 * ```ts
 * const registry = new ExtensionPointRegistry();
 * const ep = registry.declare(ThemesExtPoint);
 * registry.contribute(ThemesExtPoint, { name: 'dark' });
 * ```
 */
export class ExtensionPointRegistry implements IExtensionPointAccess, IDisposable {
  private readonly _points = new Map<string, ExtensionPointEntry>();
  private readonly _pending = new Map<string, PendingSubscriber[]>();

  declare<T>(id: ExtensionPointId<T>, options?: ExtensionPointOptions<T>): IExtensionPoint<T> {
    if (this._points.has(id.id)) {
      throw new Error(`Extension point "${id.id}" is already declared.`);
    }

    const emitter = new Emitter<readonly unknown[]>();
    const entry: ExtensionPointEntry = {
      contributions: [],
      emitter,
      validator: options?.validator as ((c: unknown) => boolean) | undefined,
    };
    this._points.set(id.id, entry);

    // Drain anyone who subscribed before declare. Each pending subscriber
    // gets attached to the real emitter and immediately receives a snapshot
    // (initially empty) so they're aligned with future onDidChange events.
    const pending = this._pending.get(id.id);
    if (pending) {
      this._pending.delete(id.id);
      for (const sub of pending) {
        if (sub.cancelled) continue;
        emitter.event(sub.handler);
        sub.handler(entry.contributions);
      }
    }

    return {
      id,
      get contributions() {
        return entry.contributions as readonly T[];
      },
      onDidChange: emitter.event as Event<readonly T[]>,
    };
  }

  contribute<T>(id: ExtensionPointId<T>, contribution: T): IDisposable {
    const entry = this._points.get(id.id);
    if (!entry) {
      throw new Error(
        `Extension point "${id.id}" has not been declared. ` +
          `Ensure the declaring plugin is activated first.`,
      );
    }

    if (entry.validator && !entry.validator(contribution)) {
      throw new Error(`Contribution to "${id.id}" failed validation.`);
    }

    entry.contributions.push(contribution);
    entry.emitter.fire(entry.contributions);

    return toDisposable(() => {
      const idx = entry.contributions.indexOf(contribution);
      if (idx !== -1) {
        entry.contributions.splice(idx, 1);
        entry.emitter.fire(entry.contributions);
      }
    });
  }

  getContributions<T>(id: ExtensionPointId<T>): readonly T[] {
    const entry = this._points.get(id.id);
    if (!entry) {
      return [];
    }
    return entry.contributions as readonly T[];
  }

  onDidChangeContributions<T>(
    id: ExtensionPointId<T>,
    handler: (contributions: readonly T[]) => void,
  ): IDisposable {
    const entry = this._points.get(id.id);
    if (entry) {
      return entry.emitter.event(handler as (contributions: readonly unknown[]) => void);
    }

    // Deferred binding: the declaring plugin has not activated yet. Hold the
    // handler so a future declare() can wire it up plus replay the snapshot.
    const pending: PendingSubscriber = {
      handler: handler as (contributions: readonly unknown[]) => void,
      cancelled: false,
    };
    let bucket = this._pending.get(id.id);
    if (!bucket) {
      bucket = [];
      this._pending.set(id.id, bucket);
    }
    const owned = bucket;
    owned.push(pending);
    return toDisposable(() => {
      pending.cancelled = true;
      const idx = owned.indexOf(pending);
      if (idx !== -1) owned.splice(idx, 1);
      if (owned.length === 0) this._pending.delete(id.id);
    });
  }

  dispose(): void {
    for (const entry of this._points.values()) {
      entry.emitter.dispose();
    }
    this._points.clear();
    this._pending.clear();
  }
}
