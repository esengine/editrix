export { IEstellaService, EstellaService } from './estella-service.js';
export type { ESEngineModule, EstellaModuleName, CppRegistry, VectorString } from './estella-service.js';
export { EstellaPlugin } from './estella-plugin.js';

export { IECSSceneService } from './ecs-scene-service.js';
export type {
    ComponentFieldSchema, FieldType, AssetFieldSubtype,
    SceneData, SerializedEntity,
    EntityEvent, ComponentEvent, PropertyEvent,
} from './ecs-scene-service.js';
import type { AssetFieldSubtype } from './ecs-scene-service.js';

export { deriveComponentSchema, deriveAllSchemas } from './component-schema.js';
export type { ComponentMeta } from './component-schema.js';

// Asset-field subtype registry: tells the editor which asset kind a
// component's asset-typed field expects — `Sprite.texture → 'texture'`,
// `SpriteAnimator.clip → 'anim-clip'`, etc. The SDK owns the canonical
// list at runtime via AssetFieldRegistry, but the editor needs this
// info at schema-load time which runs *before* the runtime App has
// built (and therefore before the SDK registry is populated). We keep
// a frozen mirror here; the SDK's list is stable enough that drift
// review on bump is straightforward.
export const BUILTIN_ASSET_FIELD_SUBTYPES: Readonly<Record<string, Readonly<Record<string, AssetFieldSubtype>>>> = Object.freeze({
  Sprite:          { texture: 'texture', material: 'material' },
  SpineAnimation:  { material: 'material' },
  BitmapText:      { font: 'font' },
  Image:           { texture: 'texture', material: 'material' },
  UIRenderer:      { texture: 'texture', material: 'material' },
  SpriteAnimator:  { clip: 'anim-clip' },
  AudioSource:     { clip: 'audio' },
  ParticleEmitter: { texture: 'texture', material: 'material' },
  Tilemap:         { source: 'tilemap' },
  TilemapLayer:    { texture: 'texture' },
  TimelinePlayer:  { timeline: 'timeline' },
});

export function assetFieldSubtype(componentName: string, fieldKey: string): AssetFieldSubtype | undefined {
  return BUILTIN_ASSET_FIELD_SUBTYPES[componentName]?.[fieldKey];
}

export { ECSSceneService } from './ecs-scene-service-impl.js';

export { IComponentCatalog, ComponentCatalog } from './component-catalog.js';
export type { SdkComponentInfo, SdkComponentDef } from './component-catalog.js';
export type { IEcsSdkAdapter } from './ecs-sdk-adapter.js';

// Re-export prefab authoring helpers from the engine SDK. These are pure
// data-model utilities (no WASM dependency) and the editor consumes them
// through the @editrix/estella gateway so the app surface has a single
// import point for scene + prefab types.
export type {
    PrefabData,
    PrefabEntityData,
    PrefabEntityId,
    PrefabOverride,
    NestedPrefabRef,
    ProcessedEntity,
    FlattenContext,
    MigrationResult,
    DiffOptions,
    ValidateResult,
    StaleOverride,
} from 'esengine';
export {
    flattenPrefab,
    diffAgainstSource,
    validateOverrides,
    migratePrefabData,
    applyOverrides,
    bucketOverridesByEntity,
    cloneComponents,
    cloneComponentData,
    cloneMetadata,
    remapComponentEntityRefs,
    PREFAB_FORMAT_VERSION,
} from 'esengine';
