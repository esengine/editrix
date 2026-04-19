export { IEstellaService, EstellaService } from './estella-service.js';
export type { ESEngineModule, EstellaModuleName, CppRegistry, VectorString } from './estella-service.js';
export { EstellaPlugin } from './estella-plugin.js';

export { IECSSceneService } from './ecs-scene-service.js';
export type {
    ComponentFieldSchema, FieldType, SceneData, SerializedEntity,
    EntityEvent, ComponentEvent, PropertyEvent,
} from './ecs-scene-service.js';

export { deriveComponentSchema, deriveAllSchemas } from './component-schema.js';
export type { ComponentMeta } from './component-schema.js';

export { ECSSceneService } from './ecs-scene-service-impl.js';

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
