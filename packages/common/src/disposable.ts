/**
 * A value that can release resources when no longer needed.
 */
export interface IDisposable {
  dispose(): void;
}

/**
 * Check whether a value is disposable.
 *
 * @example
 * ```ts
 * if (isDisposable(resource)) {
 *   resource.dispose();
 * }
 * ```
 */
export function isDisposable(value: unknown): value is IDisposable {
  return (
    typeof value === 'object' &&
    value !== null &&
    'dispose' in value &&
    typeof (value as IDisposable).dispose === 'function'
  );
}

/**
 * A container that manages multiple disposables and disposes them all at once.
 * Once disposed, any further additions are immediately disposed.
 *
 * @example
 * ```ts
 * const store = new DisposableStore();
 * store.add(emitter.event(handler));
 * store.add(bus.on('event', callback));
 * // Later: disposes all at once
 * store.dispose();
 * ```
 */
export class DisposableStore implements IDisposable {
  private readonly _disposables = new Set<IDisposable>();
  private _isDisposed = false;

  get isDisposed(): boolean {
    return this._isDisposed;
  }

  /**
   * Add a disposable to the store. Returns the same disposable for chaining.
   * If the store is already disposed, the disposable is disposed immediately.
   */
  add<T extends IDisposable>(disposable: T): T {
    if (this._isDisposed) {
      disposable.dispose();
      return disposable;
    }
    this._disposables.add(disposable);
    return disposable;
  }

  /**
   * Remove a disposable from the store without disposing it.
   */
  remove(disposable: IDisposable): void {
    this._disposables.delete(disposable);
  }

  /**
   * Dispose all contained disposables and mark the store as disposed.
   */
  dispose(): void {
    if (this._isDisposed) {
      return;
    }
    this._isDisposed = true;
    for (const disposable of this._disposables) {
      disposable.dispose();
    }
    this._disposables.clear();
  }
}

/**
 * Create a disposable from a plain cleanup function.
 *
 * @example
 * ```ts
 * const handle = setInterval(tick, 1000);
 * const disposable = toDisposable(() => clearInterval(handle));
 * disposable.dispose(); // clears the interval
 * ```
 */
export function toDisposable(fn: () => void): IDisposable {
  let disposed = false;
  return {
    dispose() {
      if (!disposed) {
        disposed = true;
        fn();
      }
    },
  };
}
