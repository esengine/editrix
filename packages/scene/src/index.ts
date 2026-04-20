/**
 * @editrix/scene — domain types for game/3D editors built on the
 * Editrix framework.
 *
 * This package holds the **data model** of a scene: serialization
 * shapes, inspector schemas, prefab authoring helpers, and asset-field
 * registries. It deliberately has no WASM or DOM dependency.
 *
 * The WASM-backed `IECSSceneService` implementation lives in
 * `@editrix/estella` and imports its interface types from here.
 */

// ─── Serialization model + events ──────────────────────────
export type {
  AssetFieldSubtype,
  ComponentEvent,
  ComponentFieldSchema,
  EntityEvent,
  FieldType,
  PropertyEvent,
  SceneData,
  SerializedEntity,
} from './serialization.js';

// ─── Schema derivation (SDK metadata → inspector schema) ───
export type { ComponentMeta } from './component-schema.js';
export { deriveAllSchemas, deriveComponentSchema } from './component-schema.js';

// ─── Asset-field registry (component.field → subtype) ──────
export { assetFieldSubtype, BUILTIN_ASSET_FIELD_SUBTYPES } from './asset-fields.js';

// ─── Prefab authoring (re-exports from the SDK) ────────────
// These are pure data-model utilities; keeping them re-exported from
// here means the editor has a single domain-package import point for
// both scene *and* prefab authoring.
export type {
  DiffOptions,
  FlattenContext,
  MigrationResult,
  NestedPrefabRef,
  PrefabData,
  PrefabEntityData,
  PrefabEntityId,
  PrefabOverride,
  ProcessedEntity,
  StaleOverride,
  ValidateResult,
} from 'esengine';
export {
  applyOverrides,
  bucketOverridesByEntity,
  cloneComponentData,
  cloneComponents,
  cloneMetadata,
  diffAgainstSource,
  flattenPrefab,
  migratePrefabData,
  PREFAB_FORMAT_VERSION,
  remapComponentEntityRefs,
  validateOverrides,
} from 'esengine';
