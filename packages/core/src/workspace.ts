import type { Event, IDisposable } from '@editrix/common';
import { createServiceId, Emitter } from '@editrix/common';

/**
 * Structural subset of `@editrix/project`'s `ProjectConfig` — declared
 * here so `@editrix/core` needn't depend on the project package.
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

/** Snapshot fired to {@link IWorkspaceService.onDidChange} subscribers. */
export interface WorkspaceChangeEvent {
  /** The path the workspace was opened at, or `''` when closed. */
  readonly path: string;
  /** The loaded config, or `undefined` when no workspace is open. */
  readonly config: WorkspaceConfig | undefined;
}

/**
 * Framework-level "current project" contract. Platform hosts (launcher,
 * web shell) call {@link setWorkspace}; plugins read state and subscribe
 * to {@link onDidChange}.
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

  /** Open, switch, or (with `path: ''`) close a workspace. */
  setWorkspace(workspace: { path: string; config: WorkspaceConfig | undefined }): void;

  /** Resolve a relative path against {@link path}. Returns `''` when none is open. */
  resolve(relativePath: string): string;

  readonly onDidChange: Event<WorkspaceChangeEvent>;
}

export const IWorkspaceService = createServiceId<IWorkspaceService>('IWorkspaceService');

/** Default in-memory implementation of {@link IWorkspaceService}. */
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
