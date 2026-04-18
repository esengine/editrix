/**
 * App-level service identifiers shared between the game-editor's plugins.
 *
 * These are NOT framework services — they describe wiring that's specific to
 * this editor (the shared render context for ECS panels, and a presence
 * wrapper that lets plugins react to the late arrival of the WASM-backed
 * IECSSceneService). A different editor would define its own equivalents.
 */

import type { Event } from '@editrix/common';
import { createServiceId } from '@editrix/common';
import type { IECSSceneService } from '@editrix/estella';
import type { SharedRenderContext } from './render-context.js';

/**
 * The single render surface shared by Scene View and Game View. Owned by the
 * RenderContextPlugin; consumed by view plugins. Lifecycle is tied to the
 * owning plugin's subscriptions — service consumers do not dispose it.
 */
export interface ISharedRenderContext {
  readonly context: SharedRenderContext;
}

export const ISharedRenderContext = createServiceId<ISharedRenderContext>('ISharedRenderContext');

/**
 * Late-binding wrapper around {@link IECSSceneService}. The ECS scene becomes
 * available only after the WASM module finishes loading; consumers subscribe
 * to {@link onDidBind} to be notified, or read {@link current} synchronously
 * (returns undefined until binding completes).
 *
 * Plugins consume this instead of trying to depend on activation order.
 */
export interface IECSScenePresence {
  /** The bound ECS scene service, or undefined if WASM hasn't finished loading. */
  readonly current: IECSSceneService | undefined;
  /** Fired exactly once when the ECS scene is created and registered. */
  readonly onDidBind: Event<IECSSceneService>;
}

export const IECSScenePresence = createServiceId<IECSScenePresence>('IECSScenePresence');
