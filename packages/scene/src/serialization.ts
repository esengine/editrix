/**
 * Scene serialization model — editor-side domain types that survive
 * round-trip through `.scene.json` and friends.
 *
 * These types are pure data; no WASM / SDK / runtime dependency. The
 * WASM-backed implementation lives in `@editrix/estella` (IECSSceneService)
 * and imports from this package.
 */

/**
 * Field primitive types understood by the inspector and by
 * {@link ComponentFieldSchema}.
 */
export type FieldType = 'float' | 'int' | 'bool' | 'string' | 'color' | 'enum' | 'asset' | 'entity';

/**
 * Asset subtype for `type: 'asset'` fields. Surfaced so the inspector's
 * picker can filter to just the asset kind a component expects — Sprite
 * wants `texture`, SpriteAnimator wants `anim-clip`, and so on. Omitted
 * on non-asset fields or when the component isn't in the builtin map.
 */
export type AssetFieldSubtype =
  | 'texture'
  | 'material'
  | 'font'
  | 'anim-clip'
  | 'audio'
  | 'tilemap'
  | 'timeline';

export interface ComponentFieldSchema {
  readonly key: string;
  readonly label: string;
  readonly type: FieldType;
  readonly defaultValue: unknown;
  readonly group: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly enumValues?: readonly string[];
  /** Asset subtype for `type: 'asset'` fields. Undefined when unknown. */
  readonly assetType?: AssetFieldSubtype;
}

/**
 * One entity in a serialised scene.
 */
export interface SerializedEntity {
  readonly id: number;
  readonly name: string;
  readonly components: Record<string, Record<string, unknown>>;
  readonly children: number[];
  /**
   * Visibility intent. `false` is persisted and the editor mirrors it to
   * the engine `Disabled` tag so renderers/systems see consistent state.
   * Omitted in serialised form when the entity is visible (the default)
   * to keep scene files clean.
   */
  readonly visible?: boolean;
  /**
   * Per-entity editor/tooling metadata that survives scene round-trip.
   * Not interpreted by the ECS — callers namespace their own keys
   * (e.g. 'inspectorComponentOrder').
   */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** The full on-disk shape of a scene file. */
export interface SceneData {
  readonly version: number;
  readonly name: string;
  readonly entities: SerializedEntity[];
}

// ─── Scene events ──────────────────────────────────────────

export interface EntityEvent {
  readonly entityId: number;
  readonly name: string;
}

export interface ComponentEvent {
  readonly entityId: number;
  readonly component: string;
}

export interface PropertyEvent {
  readonly entityId: number;
  readonly component: string;
  readonly field: string;
  readonly value: unknown;
}
