/**
 * Editor-side registry of **SDK-only components** — those defined in
 * TypeScript via the SDK's `defineComponent(...)` rather than through the
 * WASM's `COMPONENT_META`. The WASM side remains reached via
 * `ESEngineModule.editor_*` calls; this catalog is for everything else
 * (SpriteAnimator, UI components, user-plugin components …).
 *
 * **Why separate from the WASM schema.** The WASM schema is fixed at
 * engine build time and exposed via `editor_getComponentSchema(name)`.
 * SDK components live in JS and only exist once the SDK bundle has
 * loaded and its top-level `defineComponent` calls have fired. The
 * editor learns about them through two channels:
 *
 *   1. **Initial replay**: after `loadSDK()` resolves, the bridge plugin
 *      walks `getAllRegisteredComponents()` (from the SDK) and registers
 *      every non-builtin entry here.
 *   2. **Live bridge**: the plugin installs an `EditorBridge` on the
 *      SDK's `AppContext` so future `defineComponent` calls (e.g. from
 *      user plugins loaded later) land here too.
 *
 * Downstream consumers (`ECSSceneService` routing, the Inspector, the
 * scene serializer) treat this as the source of truth for "does the
 * component named X exist, what's its default shape, what asset kinds
 * do its fields expect".
 */

import {
  createServiceId,
  Emitter,
  toDisposable,
  type Event,
  type IDisposable,
} from '@editrix/common';

/**
 * Subset of the SDK's `ComponentDef<T>` shape that the editor depends on.
 * Structural — we don't import the SDK type directly because this
 * package runs in contexts (tests, type-checking) where the SDK may not
 * be loaded yet; the shape is stable enough that drift at SDK bumps is
 * obvious when it matters.
 */
export interface SdkComponentDef {
  readonly _name: string;
  readonly _default: Readonly<Record<string, unknown>>;
  readonly _builtin?: boolean;
  readonly assetFields: readonly { readonly field: string; readonly type: string }[];
  readonly entityFields: readonly string[];
  readonly colorKeys: readonly string[];
  readonly animatableFields: readonly string[];
  create(data?: Record<string, unknown>): Record<string, unknown>;
}

/** Entry for a single SDK component known to the editor. */
export interface SdkComponentInfo {
  readonly name: string;
  readonly def: SdkComponentDef;
  /** Default value for each field, snapshot at registration time. */
  readonly defaults: Readonly<Record<string, unknown>>;
  /** True for tag-only components (no field data). */
  readonly isTag: boolean;
}

/**
 * Registry of SDK-only components visible to the editor. Populated by
 * {@link SdkBridgePlugin}; consumed by `ECSSceneService`, the Inspector,
 * and the scene serializer.
 */
export interface IComponentCatalog {
  /** Snapshot of all known SDK components. */
  list(): readonly SdkComponentInfo[];
  get(name: string): SdkComponentInfo | undefined;
  has(name: string): boolean;
  /** Fired after any register/unregister/clear. Coalesce in consumers. */
  readonly onDidChange: Event<void>;
}

export const IComponentCatalog = createServiceId<IComponentCatalog>('IComponentCatalog');

/**
 * Default {@link IComponentCatalog} implementation. The `register` /
 * `unregister` / `clear` methods are public so the bridge plugin can
 * drive them, but the {@link IComponentCatalog} contract itself is
 * read-only from consumer code.
 */
export class ComponentCatalog implements IComponentCatalog, IDisposable {
  private readonly _byName = new Map<string, SdkComponentInfo>();
  private readonly _onDidChange = new Emitter<void>();

  readonly onDidChange: Event<void> = this._onDidChange.event;

  list(): readonly SdkComponentInfo[] {
    return [...this._byName.values()];
  }

  get(name: string): SdkComponentInfo | undefined {
    return this._byName.get(name);
  }

  has(name: string): boolean {
    return this._byName.has(name);
  }

  /**
   * Add or overwrite an entry. Fires `onDidChange` unconditionally; the
   * bridge plugin batches its initial replay so a single fire is enough.
   */
  register(info: SdkComponentInfo): IDisposable {
    this._byName.set(info.name, info);
    this._onDidChange.fire();
    return toDisposable(() => {
      this.unregister(info.name);
    });
  }

  unregister(name: string): void {
    if (!this._byName.delete(name)) return;
    this._onDidChange.fire();
  }

  clear(): void {
    if (this._byName.size === 0) return;
    this._byName.clear();
    this._onDidChange.fire();
  }

  dispose(): void {
    this._byName.clear();
    this._onDidChange.dispose();
  }
}
