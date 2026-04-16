/**
 * A plugin manifest declares a plugin's metadata in a JSON-serializable format.
 *
 * Each plugin folder contains a `manifest.json` file that the framework reads
 * at startup to discover available plugins without loading their code.
 *
 * @example
 * ```json
 * {
 *   "id": "editrix.console",
 *   "name": "Console",
 *   "version": "1.0.0",
 *   "description": "Log output and debug console",
 *   "main": "./index.js",
 *   "dependencies": ["editrix.commands", "editrix.layout", "editrix.view"],
 *   "activationEvents": []
 * }
 * ```
 */
export interface PluginManifest {
  /** Unique plugin identifier (reverse-domain style). */
  readonly id: string;
  /** Human-readable display name. */
  readonly name: string;
  /** Semver version string. */
  readonly version: string;
  /** One-line description. */
  readonly description?: string;
  /** Entry point path relative to the plugin folder (default: `'./index.js'`). */
  readonly main?: string;
  /** Plugin IDs this plugin depends on. Prefix with `?` for optional deps. */
  readonly dependencies?: readonly string[];
  /** Events that trigger lazy activation. Empty array or omitted = activate eagerly. */
  readonly activationEvents?: readonly string[];
  /** Author name or object. */
  readonly author?: string;
  /** Compatible Editrix version range (semver, e.g. ">=0.1.0 <1.0.0"). */
  readonly editrix?: string;
  /** API version number (integer). Plugins built for a newer API may not work. */
  readonly apiVersion?: number;
}

/**
 * A discovered plugin: its manifest + the resolved path to load from.
 */
export interface DiscoveredPlugin {
  /** The parsed manifest. */
  readonly manifest: PluginManifest;
  /** Absolute path or URL to the plugin entry file. */
  readonly entryPath: string;
}

/**
 * Validate a manifest object. Returns an error message or undefined if valid.
 */
export function validateManifest(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) {
    return 'Manifest must be a non-null object.';
  }

  const obj = value as Record<string, unknown>;

  if (typeof obj['id'] !== 'string' || obj['id'] === '') {
    return 'Manifest must have a non-empty "id" string.';
  }

  if (typeof obj['name'] !== 'string' || obj['name'] === '') {
    return 'Manifest must have a non-empty "name" string.';
  }

  if (typeof obj['version'] !== 'string' || obj['version'] === '') {
    return 'Manifest must have a non-empty "version" string.';
  }

  if (obj['dependencies'] !== undefined && !Array.isArray(obj['dependencies'])) {
    return '"dependencies" must be an array of strings.';
  }

  return undefined;
}
