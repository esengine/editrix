import type { IDisposable } from '@editrix/common';
import { toDisposable } from '@editrix/common';

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

  emit(eventId: string, data: unknown): void {
    const exact = this._listeners.get(eventId);
    if (exact) {
      for (const handler of exact) {
        handler(data);
      }
    }

    for (const [pattern, handlers] of this._wildcards) {
      if (matchWildcard(pattern, eventId)) {
        for (const handler of handlers) {
          handler(eventId, data);
        }
      }
    }
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
