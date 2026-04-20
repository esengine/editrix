import type { Event, IDisposable } from '@editrix/common';
import { Emitter, toDisposable } from '@editrix/common';

/**
 * Payload for the {@link IEventBus.onError} event.
 */
export interface EventBusListenerError {
  /** The event ID that was being delivered when the listener threw. */
  readonly eventId: string;
  /** The error thrown by the listener. */
  readonly error: unknown;
}

/**
 * Inter-plugin event bus. Supports exact-match and wildcard subscriptions.
 *
 * Type parameters on `emit`/`on`/`once` are intentionally single-use —
 * they exist for call-site type safety, not for constraint propagation.
 */
export interface IEventBus {
  /** Emit a typed event to all matching listeners. */
  emit(eventId: string, data: unknown): void;

  /** Subscribe to an exact event ID. */
  on(eventId: string, handler: (data: unknown) => void): IDisposable;

  /** Subscribe once — auto-removed after first invocation. */
  once(eventId: string, handler: (data: unknown) => void): IDisposable;

  /**
   * Wildcard subscription: `'document.*'` matches `'document.changed'`.
   * Only `*` at the end of a dot-separated pattern is supported.
   */
  onWild(pattern: string, handler: (eventId: string, data: unknown) => void): IDisposable;

  /**
   * Fired when a listener throws during {@link emit}. The error is reported here
   * instead of propagating, so a single buggy plugin cannot break delivery to
   * the rest of the bus. Wire this to a logger in production.
   */
  readonly onError: Event<EventBusListenerError>;

  /**
   * Run `fn` and defer every {@link emit} made during its execution until
   * the outer batch completes. Order is preserved — events are delivered
   * one-by-one in the order they were emitted, not coalesced.
   *
   * Batches nest: only the outermost batch flushes. If `fn` throws, any
   * queued events are discarded so listeners never observe state the
   * failed caller is about to roll back. Caller's return value is
   * forwarded, making `batch` transparent for computed values.
   *
   * Use for high-frequency updates (e.g. bulk property writes) where
   * listeners would thrash if notified per-change.
   */
  batch<T>(fn: () => T): T;
}

/**
 * Default implementation of {@link IEventBus}.
 *
 * @example
 * ```ts
 * const bus = new EventBus();
 * bus.on('document.changed', (data) => { ... });
 * bus.emit('document.changed', { type: 'insert' });
 * ```
 */
export class EventBus implements IEventBus, IDisposable {
  private readonly _listeners = new Map<string, Set<(data: unknown) => void>>();
  private readonly _wildcards = new Map<string, Set<(eventId: string, data: unknown) => void>>();
  private readonly _onError = new Emitter<EventBusListenerError>();
  private _batchDepth = 0;
  private _queue: { eventId: string; data: unknown }[] = [];

  readonly onError: Event<EventBusListenerError> = this._onError.event;

  emit(eventId: string, data: unknown): void {
    if (this._batchDepth > 0) {
      this._queue.push({ eventId, data });
      return;
    }
    this._dispatch(eventId, data);
  }

  batch<T>(fn: () => T): T {
    this._batchDepth++;
    try {
      const result = fn();
      this._batchDepth--;
      if (this._batchDepth === 0) this._flush();
      return result;
    } catch (error) {
      this._batchDepth--;
      if (this._batchDepth === 0) {
        // Caller's logical operation failed — events queued under its
        // assumption of success should not be observed.
        this._queue.length = 0;
      }
      throw error;
    }
  }

  private _flush(): void {
    // Swap out the queue so listener-triggered emits that happen after
    // the batch ends (via normal dispatch) don't tangle with this flush.
    const pending = this._queue;
    this._queue = [];
    for (const entry of pending) {
      this._dispatch(entry.eventId, entry.data);
    }
  }

  private _dispatch(eventId: string, data: unknown): void {
    const exact = this._listeners.get(eventId);
    if (exact) {
      // Snapshot so a listener that disposes itself or subscribes another
      // does not perturb iteration mid-flight.
      for (const handler of [...exact]) {
        try {
          handler(data);
        } catch (error) {
          this._reportError(eventId, error);
        }
      }
    }

    for (const [pattern, handlers] of this._wildcards) {
      if (!matchWildcard(pattern, eventId)) continue;
      for (const handler of [...handlers]) {
        try {
          handler(eventId, data);
        } catch (error) {
          this._reportError(eventId, error);
        }
      }
    }
  }

  private _reportError(eventId: string, error: unknown): void {
    this._onError.fire({ eventId, error });
  }

  on(eventId: string, handler: (data: unknown) => void): IDisposable {
    let set = this._listeners.get(eventId);
    if (!set) {
      set = new Set();
      this._listeners.set(eventId, set);
    }
    set.add(handler);

    return toDisposable(() => {
      set.delete(handler);
      if (set.size === 0) {
        this._listeners.delete(eventId);
      }
    });
  }

  once(eventId: string, handler: (data: unknown) => void): IDisposable {
    const sub = this.on(eventId, (data) => {
      sub.dispose();
      handler(data);
    });
    return sub;
  }

  onWild(pattern: string, handler: (eventId: string, data: unknown) => void): IDisposable {
    let set = this._wildcards.get(pattern);
    if (!set) {
      set = new Set();
      this._wildcards.set(pattern, set);
    }
    set.add(handler);

    return toDisposable(() => {
      set.delete(handler);
      if (set.size === 0) {
        this._wildcards.delete(pattern);
      }
    });
  }

  dispose(): void {
    this._listeners.clear();
    this._wildcards.clear();
    this._queue.length = 0;
    this._onError.dispose();
  }
}

/**
 * Match a wildcard pattern like `'document.*'` against an event ID.
 * Only trailing `*` after a dot is supported.
 */
function matchWildcard(pattern: string, eventId: string): boolean {
  if (!pattern.endsWith('.*')) {
    return pattern === eventId;
  }
  const prefix = pattern.slice(0, -1); // 'document.*' → 'document.'
  return eventId.startsWith(prefix);
}
