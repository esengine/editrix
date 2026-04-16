import type { IDisposable } from '@editrix/common';
import { createServiceId } from '@editrix/common';
import type { IKernel } from './kernel.js';
import type { DiscoveredPlugin, PluginManifest } from './plugin-manifest.js';
import { validateManifest } from './plugin-manifest.js';
import type { IPlugin } from './plugin.js';

/**
 * Scans a source for available plugins. Platform-specific.
 *
 * The Electron platform provides a filesystem scanner.
 * A web platform might scan a CDN or package registry.
 */
export interface IPluginScanner {
  /** Scan and return all discovered plugins. */
  scan(): Promise<readonly DiscoveredPlugin[]>;
}

/**
 * Loads discovered plugins into a kernel via dynamic `import()`.
 *
 * The loader is the bridge between plugin discovery (scanning manifest files)
 * and plugin activation (registering with the kernel). It handles:
 * - Dynamic import of plugin entry files
 * - Manifest validation
 * - Error isolation (one bad plugin doesn't break others)
 *
 * @example
 * ```ts
 * const loader = new PluginLoader(kernel);
 * const scanner = new FileSystemScanner('/path/to/plugins');
 * const results = await loader.loadFromScanner(scanner);
 * // All valid plugins are now registered with the kernel
 * ```
 */
export interface IPluginLoader extends IDisposable {
  /** Load a single plugin from a discovered entry. */
  load(discovered: DiscoveredPlugin): Promise<void>;

  /** Load all plugins from a scanner. */
  loadFromScanner(scanner: IPluginScanner): Promise<PluginLoadResult[]>;

  /** Load a plugin directly from a URL or path. */
  loadFromPath(entryPath: string, manifest: PluginManifest): Promise<void>;

  /** Get manifests of all successfully loaded plugins. */
  getLoadedManifests(): readonly PluginManifest[];
}

/** Service identifier for DI. */
export const IPluginLoader = createServiceId<IPluginLoader>('IPluginLoader');

/**
 * Result of loading a single plugin.
 */
export interface PluginLoadResult {
  readonly manifest: PluginManifest;
  readonly success: boolean;
  readonly error?: string;
}

/**
 * Default implementation of {@link IPluginLoader}.
 *
 * @example
 * ```ts
 * const loader = new PluginLoader(kernel);
 * await loader.loadFromPath('./plugins/my-plugin/index.js', manifest);
 * ```
 */
export class PluginLoader implements IPluginLoader {
  private readonly _kernel: IKernel;
  private readonly _loaded: PluginManifest[] = [];

  constructor(kernel: IKernel) {
    this._kernel = kernel;
  }

  async load(discovered: DiscoveredPlugin): Promise<void> {
    await this.loadFromPath(discovered.entryPath, discovered.manifest);
  }

  async loadFromScanner(scanner: IPluginScanner): Promise<PluginLoadResult[]> {
    const discovered = await scanner.scan();
    const results: PluginLoadResult[] = [];

    for (const entry of discovered) {
      try {
        await this.load(entry);
        results.push({ manifest: entry.manifest, success: true });
      } catch (err) {
        results.push({
          manifest: entry.manifest,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return results;
  }

  async loadFromPath(entryPath: string, manifest: PluginManifest): Promise<void> {
    // Validate manifest
    const validationError = validateManifest(manifest);
    if (validationError) {
      throw new Error(`Invalid manifest for "${manifest.id}": ${validationError}`);
    }

    // Dynamic import
    const module = await this._importModule(entryPath);
    const plugin = this._extractPlugin(module, manifest);

    // Register with kernel
    this._kernel.registerPlugin(plugin);
    this._loaded.push(manifest);
  }

  getLoadedManifests(): readonly PluginManifest[] {
    return [...this._loaded];
  }

  dispose(): void {
    this._loaded.length = 0;
  }

  /**
   * Dynamic import with error wrapping.
   * Uses `import()` which works in both Node.js and browsers.
   */
  private async _importModule(entryPath: string): Promise<unknown> {
    try {
      return await import(/* webpackIgnore: true */ entryPath) as unknown;
    } catch (cause) {
      throw new Error(`Failed to import plugin from "${entryPath}".`, { cause });
    }
  }

  /**
   * Extract the IPlugin from a loaded module.
   * Expects `export default <IPlugin>` or `module.plugin`.
   */
  private _extractPlugin(module: unknown, manifest: PluginManifest): IPlugin {
    const mod = module as Record<string, unknown>;

    // Prefer default export
    const candidate = mod['default'] ?? mod['plugin'];

    if (!candidate || typeof candidate !== 'object') {
      throw new Error(
        `Plugin "${manifest.id}" does not export a valid plugin object. ` +
          `Expected \`export default <IPlugin>\` or \`export { plugin }\`.`,
      );
    }

    const plugin = candidate as IPlugin;

    if (typeof plugin.activate !== 'function') {
      throw new Error(
        `Plugin "${manifest.id}" export is not a valid IPlugin. ` +
          `It must have a \`descriptor\` and an \`activate\` method.`,
      );
    }

    return plugin;
  }
}
