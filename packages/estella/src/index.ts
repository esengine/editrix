/**
 * @editrix/estella — the WASM engine integration layer.
 *
 * This package owns the bridge between the editor and the `esengine`
 * runtime: WASM module loading, the WASM-backed `IECSSceneService`, the
 * SDK component catalog, and the SDK-adapter interface. Pure
 * **domain types** (scene serialization, prefab data, schema, asset
 * subtypes) live in `@editrix/scene` and are imported from there.
 */

// ── Engine loader + low-level WASM types ──────────────────
export { EstellaService, IEstellaService } from './estella-service.js';
export type {
  CppRegistry,
  ESEngineModule,
  EstellaModuleName,
  VectorString,
} from './estella-service.js';

// ── Plugin wiring ─────────────────────────────────────────
export { EstellaPlugin } from './estella-plugin.js';

// ── WASM-backed scene service ─────────────────────────────
export { IECSSceneService } from './ecs-scene-service.js';
export { ECSSceneService } from './ecs-scene-service-impl.js';

// ── SDK component catalog (bridge) ────────────────────────
export { ComponentCatalog, IComponentCatalog } from './component-catalog.js';
export type { SdkComponentDef, SdkComponentInfo } from './component-catalog.js';

// ── SDK adapter interface ─────────────────────────────────
export type { IEcsSdkAdapter } from './ecs-sdk-adapter.js';
