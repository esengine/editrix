/**
 * A branded identifier for an extension point. Carries a phantom type
 * `TContribution` so that contributions are type-checked at compile time.
 *
 * Created via `createExtensionPointId`.
 */
export interface ExtensionPointId<TContribution> {
  /** Phantom brand — never accessed at runtime. */
  readonly _brand: TContribution;
  /** Unique string key. */
  readonly id: string;
}

/**
 * Create a typed extension point identifier.
 *
 * @example
 * ```ts
 * interface IThemeContribution { name: string; colors: Record<string, string>; }
 * const ThemesExtPoint = createExtensionPointId<IThemeContribution>('view.themes');
 *
 * ctx.extensionPoints.declare(ThemesExtPoint);
 * ctx.extensionPoints.contribute(ThemesExtPoint, { name: 'dark', colors: { ... } });
 * ```
 */
export function createExtensionPointId<TContribution>(id: string): ExtensionPointId<TContribution> {
  return { id } as ExtensionPointId<TContribution>;
}
