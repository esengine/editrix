/**
 * Bridge between {@link IECSSceneService} and SDK-only components living
 * in a runtime `World`'s ScriptStorage.
 *
 * The ECS service talks WASM natively — C++ components reach the editor
 * through `ESEngineModule.editor_*` calls. SDK components (SpriteAnimator,
 * ScrollView, UIRect, …) have no C++ backing; their state lives in a
 * JS-side `Map<symbol, Map<Entity, data>>` owned by a {@link World}.
 *
 * Rather than teach the ECS service about `World`, `ComponentDef`, or
 * `ScriptStorage` directly (that would yank esengine types into every
 * file that touches the ECS), we declare this thin adapter interface and
 * let an app-side plugin wire it up once the runtime App has built.
 *
 * The service calls {@link IECSSceneService.attachSdkAdapter} to install
 * / detach the adapter. Before install, the service behaves exactly as
 * before (WASM-only). After install, every `addComponent`,
 * `getProperty`, `serialize`, etc. that names an SDK component routes
 * through the adapter.
 */

import type { ComponentFieldSchema } from './ecs-scene-service.js';

/**
 * The app-side adapter plugging SDK components into the ECS service.
 * All methods operate on the **live runtime world** (the App's `world`).
 */
export interface IEcsSdkAdapter {
  /** Names of SDK components this adapter knows about. */
  list(): readonly string[];
  /** Quick membership check. */
  has(name: string): boolean;
  /**
   * Schema rows for an SDK component — same shape the WASM side emits
   * so the Inspector can render them with the same machinery.
   */
  getSchema(name: string): readonly ComponentFieldSchema[];
  /** Default field values (new instance template). */
  getDefaults(name: string): Record<string, unknown> | undefined;

  /** Does {@link entityId} currently have the SDK component `name`? */
  entityHas(entityId: number, name: string): boolean;
  /** SDK components currently attached to {@link entityId}. */
  entityComponents(entityId: number): readonly string[];
  /**
   * Attach the SDK component `name` to {@link entityId} with `data`
   * (or the component's defaults when `data` is omitted). Returns true
   * iff the insertion took place (false on unknown component).
   */
  insert(entityId: number, name: string, data?: Record<string, unknown>): boolean;
  /** Detach an SDK component. Returns true iff it was attached. */
  remove(entityId: number, name: string): boolean;
  /**
   * Snapshot of the component's current data on {@link entityId}, or
   * undefined if the component isn't attached. The return value is a
   * copy — callers may mutate freely.
   */
  getData(entityId: number, name: string): Record<string, unknown> | undefined;
  /**
   * Set a single field (dot-path supported, e.g. `position.x`). Returns
   * true on success. Creates intermediate nested objects only if the
   * path already exists in the component's default shape.
   */
  setField(entityId: number, name: string, fieldPath: string, value: unknown): boolean;
  /**
   * Called when an entity is destroyed — adapter must strip any SDK
   * component storage for {@link entityId}. Mirrors what the SDK's own
   * `world.despawn` does for its ScriptStorage.
   */
  cleanupEntity(entityId: number): void;
}
