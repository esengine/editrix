/**
 * A branded identifier for a service type. Carries a phantom type `T`
 * so that `registry.get(id)` returns the correct type without casts.
 *
 * Created via `createServiceId`.
 */
export interface ServiceIdentifier<T> {
  /** Phantom brand — never accessed at runtime. */
  readonly _brand: T;
  /** Unique symbol for identity comparison. */
  readonly id: symbol;
  /** Human-readable name for debugging. */
  readonly name: string;
}

/**
 * Create a typed service identifier.
 *
 * @example
 * ```ts
 * interface ILogger { log(msg: string): void; }
 * const ILogger = createServiceId<ILogger>('ILogger');
 *
 * registry.register(ILogger, consoleLogger);
 * const logger = registry.get(ILogger); // typed as ILogger
 * ```
 */
export function createServiceId<T>(name: string): ServiceIdentifier<T> {
  return {
    id: Symbol(name),
    name,
  } as ServiceIdentifier<T>;
}
