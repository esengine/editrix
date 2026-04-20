/**
 * Workspace service — framework-level "current project" abstraction.
 *
 * A workspace is whatever the editor currently has open: a folder on
 * disk, its `editrix.json`, and its asset-root configuration. Plugins
 * resolve paths and read project metadata through this service rather
 * than reaching into platform-specific storage directly.
 *
 * The service is platform-agnostic — the launcher (Electron main) or
 * a web host decides what to open, then calls {@link IWorkspaceService.setWorkspace}
 * (typically via `createEditor({workspace})`). Plugins subscribe to
 * {@link IWorkspaceService.onDidChange} to react when a project opens,
 * closes, or switches.
 */

import type { Event, IDisposable } from '@editrix/common';
import { createServiceId, Emitter } from '@editrix/common';

/**
 * Subset of `@editrix/project`'s `ProjectConfig` required by the core
 * service. Declared structurally so `@editrix/core` stays a leaf and
 * doesn't have to depend on `@editrix/project`.
 */
export interface WorkspaceConfig {
  readonly name: string;
  readonly version: string;
  readonly editrix: string;
  readonly template?: string;
  readonly plugins?: {
    readonly builtin?: boolean;
    readonly packages?: readonly string[];
    readonly local?: readonly string[];
  };
  readonly settings?: Record<string, unknown>;
  readonly assets?: {
    readonly roots?: readonly string[];
    readonly ignore?: readonly string[];
  };
}

/**
 * Snapshot handed to subscribers of {@link IWorkspaceService.onDidChange}.
 */
export interface WorkspaceChangeEvent {
  /** The path the workspace was opened at, or `''` when closed. */
  readonly path: string;
  /** The loaded config, or `undefined` when no workspace is open. */
  readonly config: WorkspaceConfig | undefined;
}

/**
 * Workspace service.
 *
 * Methods return synchronously — I/O happens on the caller (launcher,
 * document handlers) before `setWorkspace` is invoked. Keeping this
 * interface pure makes it trivially mockable in plugin tests.
 */
export interface IWorkspaceService extends IDisposable {
  /** Absolute workspace root path, or `''` when none is open. */
  readonly path: string;
  /** The current workspace config, or `undefined` when none is open. */
  readonly config: WorkspaceConfig | undefined;
  /** Convenience: `path.length > 0`. */
  readonly isOpen: boolean;
  /**
   * Configured asset roots relative to {@link path}. Returns an empty
   * array when no workspace is open or when the config doesn't declare
   * any. Callers should treat an empty list as "no asset scanning".
   */
  readonly assetRoots: readonly string[];

  /**
   * Open (or switch to) a workspace. Pass `{path: '', config: undefined}`
   * to close. Fires {@link onDidChange} after the internal state updates.
   */
  setWorkspace(workspace: { path: string; config: WorkspaceConfig | undefined }): void;

  /**
   * Resolve a workspace-relative path against {@link path}. Returns `''`
   * when no workspace is open (callers should treat that as a no-op
   * signal and not attempt I/O).
   */
  resolve(relativePath: string): string;

  /** Fires after any `setWorkspace` call, including closes. */
  readonly onDidChange: Event<WorkspaceChangeEvent>;
}

export const IWorkspaceService = createServiceId<IWorkspaceService>('IWorkspaceService');

/**
 * Default implementation — pure in-memory state + forward-slash path
 * joining. Suitable for every platform; platform-specific realities
 * (drive letters on Windows, POSIX roots, etc.) are the launcher's
 * problem to normalise before it calls {@link setWorkspace}.
 */
export class WorkspaceService implements IWorkspaceService {
  private _path = '';
  private _config: WorkspaceConfig | undefined;
  private readonly _onDidChange = new Emitter<WorkspaceChangeEvent>();

  readonly onDidChange: Event<WorkspaceChangeEvent> = this._onDidChange.event;

  constructor(initial?: { path?: string; config?: WorkspaceConfig }) {
    if (initial?.path !== undefined) this._path = initial.path;
    if (initial?.config !== undefined) this._config = initial.config;
  }

  get path(): string {
    return this._path;
  }

  get config(): WorkspaceConfig | undefined {
    return this._config;
  }

  get isOpen(): boolean {
    return this._path.length > 0;
  }

  get assetRoots(): readonly string[] {
    return this._config?.assets?.roots ?? [];
  }

  setWorkspace(workspace: { path: string; config: WorkspaceConfig | undefined }): void {
    this._path = workspace.path;
    this._config = workspace.config;
    this._onDidChange.fire({ path: this._path, config: this._config });
  }

  resolve(relativePath: string): string {
    if (this._path.length === 0) return '';
    const trimmed = relativePath.replace(/^\/+/, '');
    if (trimmed.length === 0) return this._path;
    return `${this._path}/${trimmed}`;
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
