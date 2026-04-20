/**
 * @editrix/project — project config schema, validation, and version
 * drift classification.
 *
 * This package owns the shape of `editrix.json` and the typed helpers
 * around it. It deliberately has no I/O — consumers (launcher, editor
 * plugins) read the file with their own filesystem abstraction and
 * hand the parsed JSON to {@link validateProjectConfig}.
 */

export type {
  AssetConfig,
  LauncherConfig,
  LauncherProjectEntry,
  LayoutPreset,
  PluginConfig,
  ProjectConfig,
} from './config.js';
export { createDefaultProjectConfig } from './config.js';

export type { ValidationResult } from './validate.js';
export { validateProjectConfig } from './validate.js';

export type { ProjectVersionInfo, ProjectVersionStatus } from './version.js';
export { classifyProjectVersion, compareVersions } from './version.js';
