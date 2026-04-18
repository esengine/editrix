import { describe, expect, it, vi } from 'vitest';
import { createExtensionPointId, createServiceId } from '@editrix/common';
import type { IPlugin, IPluginContext } from '../src/plugin.js';
import { createKernel } from '../src/kernel.js';

// Helper to create a minimal plugin
function createPlugin(
  id: string,
  opts: {
    dependencies?: string[];
    activationEvents?: string[];
    activate?: (ctx: IPluginContext) => void | Promise<void>;
    deactivate?: () => void | Promise<void>;
  } = {},
): IPlugin {
  return {
    descriptor: {
      id,
      version: '1.0.0',
      dependencies: opts.dependencies,
      activationEvents: opts.activationEvents,
    },
    activate: opts.activate ?? (() => {}),
    deactivate: opts.deactivate,
  };
}

describe('Kernel', () => {
  describe('registerPlugin', () => {
    it('should register a plugin', () => {
      const kernel = createKernel();
      const plugin = createPlugin('test.plugin');

      // Should not throw
      kernel.registerPlugin(plugin);
    });

    it('should throw when registering a plugin with duplicate ID', () => {
      const kernel = createKernel();
      kernel.registerPlugin(createPlugin('test.plugin'));

      expect(() => kernel.registerPlugin(createPlugin('test.plugin'))).toThrow(
        'Plugin "test.plugin" is already registered.',
      );
    });
  });

  describe('activatePlugin', () => {
    it('should activate a plugin', async () => {
      const kernel = createKernel();
      const activate = vi.fn();
      kernel.registerPlugin(createPlugin('test.plugin', { activate }));

      await kernel.activatePlugin('test.plugin');

      expect(activate).toHaveBeenCalledOnce();
    });

    it('should pass a valid plugin context', async () => {
      const kernel = createKernel();
      let receivedCtx: IPluginContext | undefined;

      kernel.registerPlugin(
        createPlugin('test.plugin', {
          activate: (ctx) => {
            receivedCtx = ctx;
          },
        }),
      );

      await kernel.activatePlugin('test.plugin');

      expect(receivedCtx).toBeDefined();
      expect(receivedCtx!.services).toBe(kernel.services);
      expect(receivedCtx!.events).toBe(kernel.events);
      expect(receivedCtx!.extensionPoints).toBe(kernel.extensionPoints);
      expect(receivedCtx!.subscriptions).toBeDefined();
    });

    it('should throw when activating unregistered plugin', async () => {
      const kernel = createKernel();

      await expect(kernel.activatePlugin('nonexistent')).rejects.toThrow(
        'Plugin "nonexistent" is not registered.',
      );
    });

    it('should not activate twice', async () => {
      const kernel = createKernel();
      const activate = vi.fn();
      kernel.registerPlugin(createPlugin('test.plugin', { activate }));

      await kernel.activatePlugin('test.plugin');
      await kernel.activatePlugin('test.plugin');

      expect(activate).toHaveBeenCalledOnce();
    });

    it('should activate dependencies first', async () => {
      const kernel = createKernel();
      const order: string[] = [];

      kernel.registerPlugin(
        createPlugin('dep.a', {
          activate: () => {
            order.push('a');
          },
        }),
      );
      kernel.registerPlugin(
        createPlugin('dep.b', {
          dependencies: ['dep.a'],
          activate: () => {
            order.push('b');
          },
        }),
      );

      await kernel.activatePlugin('dep.b');

      expect(order).toEqual(['a', 'b']);
    });

    it('should throw on missing required dependency', async () => {
      const kernel = createKernel();
      kernel.registerPlugin(
        createPlugin('child', { dependencies: ['missing.dep'] }),
      );

      await expect(kernel.activatePlugin('child')).rejects.toThrow(
        'Plugin "child" requires "missing.dep", but it is not registered.',
      );
    });

    it('should skip missing optional dependencies', async () => {
      const kernel = createKernel();
      const activate = vi.fn();
      kernel.registerPlugin(
        createPlugin('child', {
          dependencies: ['?optional.dep'],
          activate,
        }),
      );

      await kernel.activatePlugin('child');
      expect(activate).toHaveBeenCalledOnce();
    });

    it('should fire onDidActivatePlugin event', async () => {
      const kernel = createKernel();
      kernel.registerPlugin(createPlugin('test.plugin'));
      const handler = vi.fn();

      kernel.onDidActivatePlugin(handler);
      await kernel.activatePlugin('test.plugin');

      expect(handler).toHaveBeenCalledWith('test.plugin');
    });

    it('should wrap activation errors with cause', async () => {
      const kernel = createKernel();
      const originalError = new Error('boom');

      kernel.registerPlugin(
        createPlugin('bad.plugin', {
          activate: () => {
            throw originalError;
          },
        }),
      );

      try {
        await kernel.activatePlugin('bad.plugin');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toBe('Plugin "bad.plugin" failed to activate.');
        expect((err as Error).cause).toBe(originalError);
      }
    });

    it('should dispose subscriptions if activate throws', async () => {
      const kernel = createKernel();
      const cleanup = vi.fn();

      kernel.registerPlugin(
        createPlugin('bad.plugin', {
          activate: (ctx) => {
            ctx.subscriptions.add({ dispose: cleanup });
            throw new Error('boom');
          },
        }),
      );

      await expect(kernel.activatePlugin('bad.plugin')).rejects.toThrow('failed to activate');
      expect(cleanup).toHaveBeenCalledOnce();
    });

    it('should let concurrent callers share the in-flight activation', async () => {
      // Plugin A's activate registers a service asynchronously.
      // Plugin B (which depends on A) consumes that service. If A is mid-activation
      // when something else calls activatePlugin('A'), the second caller must
      // observe the same completion point — not return early on the Activating state.
      const kernel = createKernel();
      const IFoo = createServiceId<{ value: number }>('IFoo');
      let resolveActivate: (() => void) | undefined;
      const activateGate = new Promise<void>((r) => {
        resolveActivate = r;
      });

      kernel.registerPlugin(
        createPlugin('a', {
          activate: async (ctx) => {
            await activateGate;
            ctx.subscriptions.add(ctx.services.register(IFoo, { value: 42 }));
          },
        }),
      );

      const first = kernel.activatePlugin('a');
      // Second concurrent caller should not get back `undefined` synchronously
      // and proceed before the service is registered.
      const second = kernel.activatePlugin('a');

      resolveActivate!();
      await Promise.all([first, second]);

      expect(kernel.services.has(IFoo)).toBe(true);
    });
  });

  describe('deactivatePlugin', () => {
    it('should call deactivate and dispose subscriptions', async () => {
      const kernel = createKernel();
      const deactivate = vi.fn();
      const cleanup = vi.fn();

      kernel.registerPlugin(
        createPlugin('test.plugin', {
          activate: (ctx) => {
            ctx.subscriptions.add({ dispose: cleanup });
          },
          deactivate,
        }),
      );

      await kernel.activatePlugin('test.plugin');
      await kernel.deactivatePlugin('test.plugin');

      expect(deactivate).toHaveBeenCalledOnce();
      expect(cleanup).toHaveBeenCalledOnce();
    });

    it('should deactivate dependents first', async () => {
      const kernel = createKernel();
      const order: string[] = [];

      kernel.registerPlugin(
        createPlugin('base', {
          deactivate: () => {
            order.push('base');
          },
        }),
      );
      kernel.registerPlugin(
        createPlugin('child', {
          dependencies: ['base'],
          deactivate: () => {
            order.push('child');
          },
        }),
      );

      await kernel.start();
      await kernel.deactivatePlugin('base');

      expect(order).toEqual(['child', 'base']);
    });

    it('should fire onDidDeactivatePlugin event', async () => {
      const kernel = createKernel();
      kernel.registerPlugin(createPlugin('test.plugin'));
      const handler = vi.fn();

      await kernel.activatePlugin('test.plugin');
      kernel.onDidDeactivatePlugin(handler);
      await kernel.deactivatePlugin('test.plugin');

      expect(handler).toHaveBeenCalledWith('test.plugin');
    });

    it('should be safe to call on already-deactivated plugin', async () => {
      const kernel = createKernel();
      kernel.registerPlugin(createPlugin('test.plugin'));

      // Not activated, should not throw
      await kernel.deactivatePlugin('test.plugin');
    });
  });

  describe('start', () => {
    it('should activate all eager plugins in dependency order', async () => {
      const kernel = createKernel();
      const order: string[] = [];

      kernel.registerPlugin(
        createPlugin('a', {
          activate: () => {
            order.push('a');
          },
        }),
      );
      kernel.registerPlugin(
        createPlugin('b', {
          dependencies: ['a'],
          activate: () => {
            order.push('b');
          },
        }),
      );
      kernel.registerPlugin(
        createPlugin('c', {
          dependencies: ['b'],
          activate: () => {
            order.push('c');
          },
        }),
      );

      await kernel.start();

      expect(order).toEqual(['a', 'b', 'c']);
    });

    it('should skip lazy plugins with activationEvents', async () => {
      const kernel = createKernel();
      const eagerActivate = vi.fn();
      const lazyActivate = vi.fn();

      kernel.registerPlugin(createPlugin('eager', { activate: eagerActivate }));
      kernel.registerPlugin(
        createPlugin('lazy', {
          activationEvents: ['onCommand:test'],
          activate: lazyActivate,
        }),
      );

      await kernel.start();

      expect(eagerActivate).toHaveBeenCalledOnce();
      expect(lazyActivate).not.toHaveBeenCalled();
    });

    it('should detect circular dependencies', async () => {
      const kernel = createKernel();
      kernel.registerPlugin(createPlugin('a', { dependencies: ['b'] }));
      kernel.registerPlugin(createPlugin('b', { dependencies: ['a'] }));

      await expect(kernel.start()).rejects.toThrow('Circular plugin dependency detected');
    });
  });

  describe('shutdown', () => {
    it('should deactivate all plugins in reverse order', async () => {
      const kernel = createKernel();
      const order: string[] = [];

      kernel.registerPlugin(
        createPlugin('a', {
          deactivate: () => {
            order.push('a');
          },
        }),
      );
      kernel.registerPlugin(
        createPlugin('b', {
          dependencies: ['a'],
          deactivate: () => {
            order.push('b');
          },
        }),
      );

      await kernel.start();
      await kernel.shutdown();

      expect(order).toEqual(['b', 'a']);
    });

    it('should keep deactivating remaining plugins when one throws and aggregate the errors', async () => {
      const kernel = createKernel();
      const deactivated: string[] = [];

      kernel.registerPlugin(
        createPlugin('clean', {
          deactivate: () => {
            deactivated.push('clean');
          },
        }),
      );
      kernel.registerPlugin(
        createPlugin('bad', {
          deactivate: () => {
            throw new Error('teardown failed');
          },
        }),
      );
      kernel.registerPlugin(
        createPlugin('also-clean', {
          deactivate: () => {
            deactivated.push('also-clean');
          },
        }),
      );

      await kernel.start();

      let aggregate: AggregateError | undefined;
      try {
        await kernel.shutdown();
      } catch (err) {
        aggregate = err as AggregateError;
      }

      expect(aggregate).toBeInstanceOf(AggregateError);
      expect(aggregate!.errors).toHaveLength(1);
      expect((aggregate!.errors[0] as Error).message).toContain('"bad"');
      // The other two plugins still got their deactivate called.
      expect(deactivated).toContain('clean');
      expect(deactivated).toContain('also-clean');
    });
  });

  describe('plugin interop via services and extension points', () => {
    it('should allow plugins to register and consume services', async () => {
      const kernel = createKernel();
      const IGreeter = createServiceId<{ greet(): string }>('IGreeter');

      kernel.registerPlugin(
        createPlugin('provider', {
          activate: (ctx) => {
            ctx.subscriptions.add(
              ctx.services.register(IGreeter, { greet: () => 'hello' }),
            );
          },
        }),
      );

      kernel.registerPlugin(
        createPlugin('consumer', {
          dependencies: ['provider'],
          activate: (ctx) => {
            const greeter = ctx.services.get(IGreeter);
            expect(greeter.greet()).toBe('hello');
          },
        }),
      );

      await kernel.start();
    });

    it('should allow plugins to declare and contribute to extension points', async () => {
      const kernel = createKernel();
      const ThemesEP = createExtensionPointId<{ name: string }>('themes');

      kernel.registerPlugin(
        createPlugin('theme-host', {
          activate: (ctx) => {
            ctx.extensionPoints.declare(ThemesEP);
          },
        }),
      );

      kernel.registerPlugin(
        createPlugin('dark-theme', {
          dependencies: ['theme-host'],
          activate: (ctx) => {
            ctx.subscriptions.add(
              ctx.extensionPoints.contribute(ThemesEP, { name: 'dark' }),
            );
          },
        }),
      );

      await kernel.start();

      const themes = kernel.extensionPoints.getContributions(ThemesEP);
      expect(themes).toHaveLength(1);
      expect(themes[0]!.name).toBe('dark');
    });
  });
});
