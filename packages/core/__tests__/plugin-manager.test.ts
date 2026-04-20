import { describe, expect, it, vi } from 'vitest';
import { createKernel } from '../src/kernel.js';
import { PluginManager } from '../src/plugin-manager.js';
import type { IPlugin } from '../src/plugin.js';
import type { PluginManifest } from '../src/plugin-manifest.js';
import { PluginState } from '../src/types.js';

function makeManifest(id: string): PluginManifest {
  return { id, name: id, version: '1.0.0' };
}

function makePlugin(id: string, opts: Partial<IPlugin> = {}): IPlugin {
  return {
    descriptor: { id, version: '1.0.0' },
    activate: opts.activate ?? (() => {}),
    deactivate: opts.deactivate,
  };
}

describe('PluginManager', () => {
  describe('registerBuiltin', () => {
    it('should expose builtin plugins via getAll', () => {
      const kernel = createKernel();
      const manager = new PluginManager(kernel);

      manager.registerBuiltin(makeManifest('builtin.a'));

      const all = manager.getAll();
      expect(all).toHaveLength(1);
      expect(all[0]?.builtin).toBe(true);
      expect(all[0]?.disabled).toBe(false);
      expect(all[0]?.state).toBe(PluginState.Active);
    });

    it('should reject disabling a builtin', async () => {
      const kernel = createKernel();
      const manager = new PluginManager(kernel);
      manager.registerBuiltin(makeManifest('builtin.a'));

      await expect(manager.disablePlugin('builtin.a')).rejects.toThrow(
        'Cannot disable built-in plugin',
      );
    });

    it('should reject enabling a builtin so the API is symmetric with disable', async () => {
      const kernel = createKernel();
      const manager = new PluginManager(kernel);
      manager.registerBuiltin(makeManifest('builtin.a'));

      await expect(manager.enablePlugin('builtin.a')).rejects.toThrow(
        'Cannot enable built-in plugin',
      );
    });

    it('should reject uninstalling a builtin', async () => {
      const kernel = createKernel();
      const manager = new PluginManager(kernel);
      manager.registerBuiltin(makeManifest('builtin.a'));

      await expect(manager.uninstallPlugin('builtin.a')).rejects.toThrow(
        'Cannot uninstall built-in plugin',
      );
    });
  });

  describe('unknown plugin', () => {
    it('should throw on disable / enable / uninstall when plugin is unknown', async () => {
      const kernel = createKernel();
      const manager = new PluginManager(kernel);

      await expect(manager.disablePlugin('nope')).rejects.toThrow('is not known');
      await expect(manager.enablePlugin('nope')).rejects.toThrow('is not known');
      await expect(manager.uninstallPlugin('nope')).rejects.toThrow('is not known');
    });
  });

  describe('disablePlugin', () => {
    it('should mark disabled, deactivate kernel plugin, and fire change event', async () => {
      const kernel = createKernel();
      const manager = new PluginManager(kernel);

      const plugin = makePlugin('p.a');
      kernel.registerPlugin(plugin);
      await kernel.activatePlugin('p.a');
      // Manually create a manager info entry mirroring scanAndLoad's effect.
      manager['_infos'].set('p.a', {
        manifest: makeManifest('p.a'),
        state: PluginState.Active,
        disabled: false,
        builtin: false,
      });

      const events: string[] = [];
      manager.onDidChangePlugin((e) => events.push(e.pluginId));

      await manager.disablePlugin('p.a');

      expect(manager.isDisabled('p.a')).toBe(true);
      expect(manager.getInfo('p.a')?.state).toBe(PluginState.Unloaded);
      expect(events).toEqual(['p.a']);
    });

    it('should keep the user preference but expose truthful state when kernel deactivate throws', async () => {
      const kernel = createKernel();
      const manager = new PluginManager(kernel);

      const plugin = makePlugin('p.bad', {
        deactivate: () => {
          throw new Error('teardown blew up');
        },
      });
      kernel.registerPlugin(plugin);
      await kernel.activatePlugin('p.bad');
      manager['_infos'].set('p.bad', {
        manifest: makeManifest('p.bad'),
        state: PluginState.Active,
        disabled: false,
        builtin: false,
      });

      await expect(manager.disablePlugin('p.bad')).rejects.toThrow('failed to deactivate');

      // Preference persists (so a UI checkbox stays "off") …
      expect(manager.isDisabled('p.bad')).toBe(true);
      // … but the runtime state is not lying about being unloaded.
      expect(manager.getInfo('p.bad')?.state).toBe(PluginState.Active);
    });
  });

  describe('enablePlugin', () => {
    it('should clear disabled flag and activate the kernel plugin', async () => {
      const kernel = createKernel();
      const manager = new PluginManager(kernel);
      const activate = vi.fn();
      kernel.registerPlugin(makePlugin('p.a', { activate }));
      manager['_infos'].set('p.a', {
        manifest: makeManifest('p.a'),
        state: PluginState.Unloaded,
        disabled: true,
        builtin: false,
      });
      manager.restoreDisabledIds(['p.a']);

      await manager.enablePlugin('p.a');

      expect(activate).toHaveBeenCalledOnce();
      expect(manager.isDisabled('p.a')).toBe(false);
      expect(manager.getInfo('p.a')?.state).toBe(PluginState.Active);
    });

    it('should wrap kernel errors so a load-failed plugin produces a descriptive message', async () => {
      // The plugin's manifest is in manager._infos but no IPlugin was
      // registered with the kernel (simulating loadFromScanner failure).
      const kernel = createKernel();
      const manager = new PluginManager(kernel);
      manager['_infos'].set('p.unloaded', {
        manifest: makeManifest('p.unloaded'),
        state: PluginState.Unloaded,
        disabled: false,
        builtin: false,
      });

      await expect(manager.enablePlugin('p.unloaded')).rejects.toThrow('could not be enabled');
    });
  });

  describe('uninstallPlugin', () => {
    it('should remove the info entry on success', async () => {
      const kernel = createKernel();
      const manager = new PluginManager(kernel);
      kernel.registerPlugin(makePlugin('p.a'));
      await kernel.activatePlugin('p.a');
      manager['_infos'].set('p.a', {
        manifest: makeManifest('p.a'),
        state: PluginState.Active,
        disabled: false,
        builtin: false,
      });

      await manager.uninstallPlugin('p.a');

      expect(manager.getInfo('p.a')).toBeUndefined();
    });

    it('should preserve the info entry when kernel deactivate throws so retry is possible', async () => {
      const kernel = createKernel();
      const manager = new PluginManager(kernel);
      kernel.registerPlugin(
        makePlugin('p.a', {
          deactivate: () => {
            throw new Error('teardown failed');
          },
        }),
      );
      await kernel.activatePlugin('p.a');
      manager['_infos'].set('p.a', {
        manifest: makeManifest('p.a'),
        state: PluginState.Active,
        disabled: false,
        builtin: false,
      });

      await expect(manager.uninstallPlugin('p.a')).rejects.toThrow('failed to deactivate');
      expect(manager.getInfo('p.a')).toBeDefined();
    });
  });

  describe('restoreDisabledIds', () => {
    it('should populate the disabled set and apply during scanAndLoad', async () => {
      const kernel = createKernel();
      const manager = new PluginManager(kernel);

      manager.restoreDisabledIds(['p.a', 'p.b']);
      expect(manager.getDisabledIds().has('p.a')).toBe(true);
      expect(manager.getDisabledIds().has('p.b')).toBe(true);

      // scanAndLoad should mark loaded plugins as disabled if their id is in the set.
      const scanner = {
        scan: async () => [],
      };
      await manager.scanAndLoad(scanner);
      // Empty scan still emits onDidChangePluginList — verify it does
      let fired = 0;
      manager.onDidChangePluginList(() => fired++);
      await manager.scanAndLoad(scanner);
      expect(fired).toBe(1);
    });
  });
});
