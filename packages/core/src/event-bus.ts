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

  readonly onError: Event<EventBusListenerError> = this._onError.event;

  emit(eventId: string, data: unknown): void {
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
