import type { IDisposable } from './disposable.js';
import { toDisposable } from './disposable.js';

/**
 * A subscribable event. Call with a listener to subscribe.
 * Returns a disposable that removes the listener when disposed.
 */
export type Event<T> = (listener: (e: T) => void) => IDisposable;

/**
 * An event emitter that produces typed events.
 * The emitter owns the event — only the owner can fire it.
 *
 * @example
 * ```ts
 * const onChanged = new Emitter<string>();
 * const sub = onChanged.event((value) => console.log(value));
 * onChanged.fire('hello'); // logs 'hello'
 * sub.dispose();           // stops listening
 * onChanged.dispose();     // removes all listeners
 * ```
 */
export class Emitter<T> implements IDisposable {
  private readonly _listeners = new Set<(e: T) => void>();
  private _disposed = false;

  /**
   * The subscribable event. Expose this to consumers, keep the emitter private.
   */
  readonly event: Event<T> = (listener: (e: T) => void): IDisposable => {
    if (this._disposed) {
      return toDisposable(() => {});
    }

    this._listeners.add(listener);
    return toDisposable(() => {
      this._listeners.delete(listener);
    });
  };

  /**
   * Fire the event, notifying all listeners synchronously.
   */
  fire(value: T): void {
    if (this._disposed) {
      return;
    }
    for (const listener of this._listeners) {
      listener(value);
    }
  }

  /**
   * Dispose the emitter and remove all listeners.
   */
  dispose(): void {
    if (this._disposed) {
      return;
    }
    this._disposed = true;
    this._listeners.clear();
  }
}
