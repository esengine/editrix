/**
 * Project configuration types.
 *
 * Defines the shape of `editrix.json` — the single source of truth
 * for an Editrix project. Everything is plugin-driven: the project
 * config tells the framework which plugins to load, and plugins
 * bring all domain-specific capabilities.
 *
 * @example
 * ```json
 * {
 *   "name": "My Game",
 *   "version": "0.1.0",
 *   "editrix": "0.1.0",
 *   "template": "2d-game",
 *   "plugins": {
 *     "builtin": true,
 *     "packages": []
 *   }
 * }
 * ```
 */

/**
 * Root project configuration — maps to `editrix.json`.
 */
export interface ProjectConfig {
  /** Display name of the project. */
  readonly name: string;
  /** Project version (semver). */
  readonly version: string;
  /** Required Editrix framework version (semver). */
  readonly editrix: string;
  /** Template ID used when creating this project. */
  readonly template?: string;
  /** Plugin configuration. */
  readonly plugins: PluginConfig;
  /** Default editor settings shared by the team. */
  readonly settings?: Record<string, unknown>;
  /** Named layout presets. */
  readonly layouts?: Record<string, LayoutPreset>;
  /** Asset pipeline configuration. */
  readonly assets?: AssetConfig;
}

/**
 * Plugin loading configuration.
 */
export interface PluginConfig {
  /** Whether to load built-in plugins (console, settings, plugin-manager). Default: true. */
  readonly builtin?: boolean;
  /** npm package plugin IDs to load. */
  readonly packages?: readonly string[];
  /** Relative paths to project-local plugin directories. */
  readonly local?: readonly string[];
}

/**
 * A named layout preset.
 */
export interface LayoutPreset {
  /** Use a built-in layout preset name. */
  readonly preset?: string;
  /** Path to a custom layout JSON file (relative to project root). */
  readonly file?: string;
}

/**
 * Asset pipeline configuration.
 */
export interface AssetConfig {
  /** Root directories for asset discovery (relative to project root). */
  readonly roots?: readonly string[];
  /** Glob patterns to ignore. */
  readonly ignore?: readonly string[];
}

/**
 * An entry in the launcher's project list (~/.editrix/launcher.json).
 */
export interface LauncherProjectEntry {
  /** Absolute path to the project directory. */
  readonly path: string;
  /** Project display name (cached from editrix.json). */
  readonly name: string;
  /** Editrix version the project uses (cached). */
  readonly editrixVersion: string;
  /** ISO timestamp of last time the project was opened. */
  readonly lastOpened: string;
  /** Whether the user starred/favorited this project. */
  readonly starred: boolean;
}

/**
 * Launcher global configuration — maps to `~/.editrix/launcher.json`.
 */
export interface LauncherConfig {
  /** Known projects. */
  readonly projects: LauncherProjectEntry[];
}

/**
 * Create a default project config for a given template.
 */
export function createDefaultProjectConfig(
  name: string,
  template: string,
): ProjectConfig {
  const base: ProjectConfig = {
    name,
    version: '0.1.0',
    editrix: '0.1.0',
    template,
    plugins: {
      builtin: true,
      packages: [],
    },
    settings: {},
    assets: {
      roots: ['assets'],
      ignore: ['*.tmp', '.DS_Store', 'Thumbs.db'],
    },
  };

  // Template-specific plugin sets — currently no template requires extra
  // packages because the runtime (ECS, scene, layout) is built into the editor.
  const templatePlugins: Record<string, readonly string[]> = {
    'empty': [],
    '2d-game': [],
    '3d-game': [],
    'ui-app': [],
    'node-editor': [],
  };

  const packages = templatePlugins[template] ?? [];

  return {
    ...base,
    plugins: { ...base.plugins, packages },
  };
}
