import type { IPluginScanner } from '@editrix/shell';
import type { DiscoveredPlugin } from '@editrix/core';

/**
 * Filesystem API subset used by the scanner.
 */
interface FsAPI {
  readDir(dirPath: string): Promise<{ name: string; path: string; type: string }[]>;
  readFile(filePath: string): Promise<string>;
  exists(filePath: string): Promise<boolean>;
}

function getFsAPI(): FsAPI | undefined {
  return (window as unknown as { electronAPI?: { fs: FsAPI } }).electronAPI?.fs;
}

/**
 * Scans the project's `plugins/` directory for local plugins.
 *
 * Each plugin is a subdirectory containing a `plugin.json` manifest
 * and a compiled `.js` entry file.
 *
 * ```
 * plugins/
 *   my-plugin/
 *     plugin.json     ← manifest (id, name, version, main)
 *     index.js        ← compiled entry point (ESM, default export)
 *     src/
 *       index.ts      ← source (for development)
 * ```
 *
 * @example
 * ```ts
 * const scanner = new LocalPluginScanner('/project/path');
 * const discovered = await scanner.scan();
 * ```
 */
export class LocalPluginScanner implements IPluginScanner {
  private readonly _projectPath: string;

  constructor(projectPath: string) {
    this._projectPath = projectPath.replace(/\\/g, '/');
  }

  async scan(): Promise<readonly DiscoveredPlugin[]> {
    const fs = getFsAPI();
    if (!fs) return [];

    const pluginsDir = `${this._projectPath}/plugins`;
    const dirExists = await fs.exists(pluginsDir);
    if (!dirExists) return [];

    const entries = await fs.readDir(pluginsDir);
    const results: DiscoveredPlugin[] = [];

    for (const entry of entries) {
      if (entry.type !== 'directory') continue;

      const manifestPath = `${entry.path}/plugin.json`;
      const manifestExists = await fs.exists(manifestPath);
      if (!manifestExists) continue;

      try {
        const raw = await fs.readFile(manifestPath);
        const manifest = JSON.parse(raw) as {
          id?: string;
          name?: string;
          version?: string;
          main?: string;
          description?: string;
          dependencies?: string[];
          activationEvents?: string[];
          author?: string;
          editrix?: string;
          apiVersion?: number;
        };

        if (!manifest.id || !manifest.name || !manifest.version) continue;

        const mainFile = manifest.main ?? 'dist/index.js';
        const entryPath = `${entry.path}/${mainFile}`;

        results.push({
          manifest: {
            id: manifest.id,
            name: manifest.name,
            version: manifest.version,
            description: manifest.description,
            main: mainFile,
            dependencies: manifest.dependencies,
            activationEvents: manifest.activationEvents,
            editrix: manifest.editrix,
            apiVersion: manifest.apiVersion,
            author: manifest.author,
          },
          // file:// URL for dynamic import() in Electron renderer
          entryPath: `file:///${entryPath.replace(/\\/g, '/')}`,
        });
      } catch {
        // Skip plugins with invalid manifests
      }
    }

    return results;
  }
}
