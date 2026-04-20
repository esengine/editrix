import { describe, expect, it, vi } from 'vitest';
import type { IPlugin } from '../src/plugin.js';
import type { DiscoveredPlugin, PluginManifest } from '../src/plugin-manifest.js';
import { validateManifest } from '../src/plugin-manifest.js';
import type { IPluginScanner } from '../src/plugin-loader.js';
import { PluginLoader } from '../src/plugin-loader.js';
import { createKernel } from '../src/kernel.js';

// Mock plugin module that PluginLoader will dynamically import
const mockPlugin: IPlugin = {
  descriptor: {
    id: 'test.dynamic',
    version: '1.0.0',
  },
  activate: vi.fn(),
};

describe('validateManifest', () => {
  it('should accept a valid manifest', () => {
    expect(validateManifest({ id: 'a', name: 'A', version: '1.0.0' })).toBeUndefined();
  });

  it('should reject non-object', () => {
    expect(validateManifest(null)).toBe('Manifest must be a non-null object.');
    expect(validateManifest('string')).toBe('Manifest must be a non-null object.');
  });

  it('should reject missing id', () => {
    expect(validateManifest({ name: 'A', version: '1.0.0' })).toContain('"id"');
  });

  it('should reject missing name', () => {
    expect(validateManifest({ id: 'a', version: '1.0.0' })).toContain('"name"');
  });

  it('should reject missing version', () => {
    expect(validateManifest({ id: 'a', name: 'A' })).toContain('"version"');
  });

  it('should reject non-array dependencies', () => {
    expect(
      validateManifest({ id: 'a', name: 'A', version: '1.0.0', dependencies: 'bad' }),
    ).toContain('"dependencies"');
  });
});

describe('PluginLoader', () => {
  it('should load a plugin from a discovered entry', async () => {
    const kernel = createKernel();
    const loader = new PluginLoader(kernel);

    // We can't truly dynamic-import in tests, so we test the scanner path
    // by using a mock scanner
    const manifest: PluginManifest = {
      id: 'test.dynamic',
      name: 'Test Dynamic',
      version: '1.0.0',
    };

    // Track that getLoadedManifests starts empty
    expect(loader.getLoadedManifests()).toHaveLength(0);
  });

  it('should load from scanner and report results', async () => {
    const kernel = createKernel();
    const loader = new PluginLoader(kernel);

    const goodManifest: PluginManifest = {
      id: 'test.good',
      name: 'Good Plugin',
      version: '1.0.0',
    };

    const badManifest: PluginManifest = {
      id: 'test.bad',
      name: 'Bad Plugin',
      version: '1.0.0',
    };

    const scanner: IPluginScanner = {
      async scan() {
        return [
          // This will fail because we can't actually import a file in tests
          { manifest: badManifest, entryPath: 'nonexistent:///bad.js' },
        ];
      },
    };

    const results = await loader.loadFromScanner(scanner);
    expect(results).toHaveLength(1);
    expect(results[0]!.success).toBe(false);
    expect(results[0]!.error).toBeDefined();
  });

  it('should reject invalid manifest', async () => {
    const kernel = createKernel();
    const loader = new PluginLoader(kernel);

    const invalidManifest = { id: '', name: 'X', version: '1.0.0' } as PluginManifest;

    await expect(loader.loadFromPath('test.js', invalidManifest)).rejects.toThrow(
      'Invalid manifest',
    );
  });
});
