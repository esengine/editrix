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
 * The plugin API version this build of the framework understands. Bump
 * when a breaking change ships in the IPlugin contract (new required
 * methods, changed service IDs, etc.).
 */
export const CURRENT_API_VERSION = 1;

/**
 * Oldest plugin API version this build still accepts. Keep equal to
 * CURRENT_API_VERSION until we commit to multi-version compatibility.
 */
export const MIN_SUPPORTED_API_VERSION = 1;

/**
 * Check whether a manifest's declared apiVersion is compatible with the
 * current framework build. Returns a human-readable reason when
 * incompatible (loader should reject), or undefined when compatible.
 *
 * Manifests without an apiVersion are treated as compatible — the field
 * is opt-in so legacy plugins continue to load.
 */
export function checkApiCompatibility(manifest: PluginManifest): string | undefined {
  const v = manifest.apiVersion;
  if (v === undefined) return undefined;
  if (!Number.isInteger(v)) {
    return `Plugin "${manifest.id}" has non-integer apiVersion ${String(v)}.`;
  }
  if (v > CURRENT_API_VERSION) {
    return (
      `Plugin "${manifest.id}" requires API v${String(v)}, but this build ` +
      `provides v${String(CURRENT_API_VERSION)}. Upgrade the editor.`
    );
  }
  if (v < MIN_SUPPORTED_API_VERSION) {
    return (
      `Plugin "${manifest.id}" targets API v${String(v)}, older than the ` +
      `minimum supported v${String(MIN_SUPPORTED_API_VERSION)}. Rebuild the plugin.`
    );
  }
  return undefined;
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
