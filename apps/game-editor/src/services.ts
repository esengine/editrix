/**
 * App-level service identifiers shared between the game-editor's plugins.
 *
 * These are NOT framework services — they describe wiring that's specific to
 * this editor (the shared render context for ECS panels, and a presence
 * wrapper that lets plugins react to the late arrival of the WASM-backed
 * IECSSceneService). A different editor would define its own equivalents.
 */

import type { Event, IDisposable } from '@editrix/common';
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

/**
 * Resolved view of the open project. Owned by the ProjectPlugin; consumed by
 * any plugin that needs to know where on disk the user's project lives or
 * which subdirectories are configured for asset roots.
 *
 * `path` is empty when the editor was launched without a project (the launcher
 * itself, or a development run). Consumers should treat all I/O as no-op in
 * that case rather than throwing — the editor still has to render its empty
 * state cleanly.
 */
export interface IProjectService {
  /** Absolute project root path, or '' if no project is open. */
  readonly path: string;
  /** Configured asset root directories (relative to project root). */
  readonly assetRoots: readonly string[];
  /** True when a real project is open (path is non-empty). */
  readonly isOpen: boolean;
  /** Resolve a project-relative path to an absolute path. Returns '' if no project. */
  resolve(relativePath: string): string;
}

export const IProjectService = createServiceId<IProjectService>('IProjectService');

// ─── Typed selection refs ──────────────────────────────────────────────────

/**
 * A typed reference to something selectable in the editor. The framework's
 * ISelectionService stores selections as opaque strings; this app encodes them
 * as `kind:value` so plugins can distinguish entities (Inspector targets) from
 * assets (asset-picker targets) from filesystem folders (project-files
 * navigation) without resorting to isNaN checks.
 *
 * Encoding is lexical: the first ':' splits kind from value. Asset UUIDs may
 * contain ':' themselves (e.g. "@uuid:..."), so we only split on the first.
 */
export type SelectionRef =
  | { readonly kind: 'entity'; readonly id: number }
  | { readonly kind: 'asset'; readonly uuid: string }
  | { readonly kind: 'folder'; readonly path: string };

/** Encode an entity selection. */
export function entityRef(id: number): string {
  return `entity:${String(id)}`;
}

/** Encode an asset selection by UUID. */
export function assetRef(uuid: string): string {
  return `asset:${uuid}`;
}

/** Encode a folder selection by absolute path. */
export function folderRef(path: string): string {
  return `folder:${path}`;
}

/**
 * Parse a serialized selection back to its typed form. Returns undefined for
 * unrecognized kinds or malformed values — callers can early-return on unknown
 * selections instead of crashing.
 */
export function parseSelectionRef(serialized: string): SelectionRef | undefined {
  const colonIdx = serialized.indexOf(':');
  if (colonIdx <= 0) return undefined;
  const kind = serialized.slice(0, colonIdx);
  const value = serialized.slice(colonIdx + 1);
  switch (kind) {
    case 'entity': {
      const id = Number(value);
      if (!Number.isFinite(id)) return undefined;
      return { kind: 'entity', id };
    }
    case 'asset':
      if (value === '') return undefined;
      return { kind: 'asset', uuid: value };
    case 'folder':
      if (value === '') return undefined;
      return { kind: 'folder', path: value };
    default:
      return undefined;
  }
}

// ─── Play mode ─────────────────────────────────────────────────────────────

/**
 * Editor mode. The runtime simulation only ticks while `playing` is active;
 * `paused` keeps the play-mode scene snapshot live and the render loop frozen
 * so the user can step through frames with F6.
 */
export type PlayMode = 'edit' | 'playing' | 'paused';

export interface PlayModeChangeEvent {
  readonly previous: PlayMode;
  readonly current: PlayMode;
}

/**
 * Owns the editor's edit ↔ play state machine.
 *
 * Entering play takes a snapshot of the ECS scene (via SceneData round-trip);
 * exiting play restores it so anything the user changed during play (entity
 * create/destroy, property tweaks, transform drags) doesn't pollute the
 * authored data. While playing, a requestAnimationFrame loop drives the
 * shared render context every frame.
 *
 * Step (single-frame advance from paused) is provided for debugging — the
 * scene renders once with a synthetic delta, then returns to paused.
 */
export interface PlayFrameStats {
  /** Frames since the current play session started; resets on stop(). */
  readonly frame: number;
  /** Exponential moving average of dt, in milliseconds. */
  readonly avgDtMs: number;
}

export interface IPlayModeService {
  /** Current mode. */
  readonly mode: PlayMode;
  /** True if mode is 'playing' or 'paused'. */
  readonly isInPlay: boolean;
  /** Fired when mode transitions. */
  readonly onDidChangeMode: Event<PlayModeChangeEvent>;
  /** Live tick instrumentation — zero while in edit mode. */
  readonly frameStats: PlayFrameStats;

  /** Enter play: snapshot the scene if not already in play, start the loop. */
  play(): void;
  /** Stop the loop without leaving play (snapshot intact, paused frame visible). */
  pause(): void;
  /** Resume from paused state. */
  resume(): void;
  /** Render exactly one frame while paused. No-op outside paused state. */
  step(): void;
  /** Exit play, restore the snapshot, drop selection (entity ids would be stale). */
  stop(): void;
}

export const IPlayModeService = createServiceId<IPlayModeService>('IPlayModeService');

/**
 * Extension point for "hide this component from the Inspector". Predicates
 * compose via disjunction. UI-only — ECS queries still see the component.
 */
export interface IInspectorComponentFilter {
  register(predicate: (componentName: string) => boolean): IDisposable;
  isHidden(componentName: string): boolean;
}

export const IInspectorComponentFilter = createServiceId<IInspectorComponentFilter>('IInspectorComponentFilter');

export type AssetType = 'image' | 'scene' | 'audio' | 'font' | 'unknown';

export interface AssetEntry {
  readonly uuid: string;
  /** Path relative to the project root, forward-slashed (e.g. `assets/sprites/hero.png`). */
  readonly relativePath: string;
  /** Absolute path on disk (forward-slashed). */
  readonly absolutePath: string;
  readonly type: AssetType;
  readonly mtime: string;
  readonly size: number;
}

export type AssetChange =
  | { readonly kind: 'added'; readonly asset: AssetEntry }
  | { readonly kind: 'removed'; readonly uuid: string; readonly relativePath: string }
  | { readonly kind: 'modified'; readonly asset: AssetEntry };

/**
 * Catalog of the project's assets/ tree, keyed by stable UUID v4. `.meta`
 * sidecar files persist the UUID next to each asset (same pattern as Unity)
 * so references survive file moves and team-member swaps.
 */
export interface IAssetCatalogService {
  /** Completes when the initial scan has finished. */
  readonly ready: Promise<void>;
  /** All known assets. Read-only snapshot — safe to iterate without copying. */
  getAll(): readonly AssetEntry[];
  getByUuid(uuid: string): AssetEntry | undefined;
  /** `relativePath` is the forward-slashed project-relative path. */
  getByPath(relativePath: string): AssetEntry | undefined;
  readonly onDidChange: Event<AssetChange>;
}

export const IAssetCatalogService = createServiceId<IAssetCatalogService>('IAssetCatalogService');
