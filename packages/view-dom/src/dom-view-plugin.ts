import { ICommandRegistry } from '@editrix/commands';
import type { IPlugin, IPluginContext } from '@editrix/core';
import { ILayoutService } from '@editrix/layout';
import { IViewAdapter, IViewService } from '@editrix/view';
import { injectDefaultStyles } from './default-styles.js';
import type { DomViewAdapterOptions } from './dom-view-adapter.js';
import { DomViewAdapter } from './dom-view-adapter.js';

/**
 * Create the DOM view plugin with optional configuration.
 *
 * This plugin depends on `editrix.commands`, `editrix.layout`, and `editrix.view`.
 * It creates a {@link DomViewAdapter} and registers it as the {@link IViewAdapter}.
 *
 * @example
 * ```ts
 * kernel.registerPlugin(createDomViewPlugin());
 * // or with custom theme:
 * kernel.registerPlugin(createDomViewPlugin({ theme: myTheme }));
 * ```
 */
export function createDomViewPlugin(options?: DomViewAdapterOptions): IPlugin {
  return {
    descriptor: {
      id: 'editrix.view-dom',
      version: '0.1.0',
      dependencies: ['editrix.commands', 'editrix.layout', 'editrix.view'],
    },
    activate(ctx: IPluginContext) {
      injectDefaultStyles();

      const layoutService = ctx.services.get(ILayoutService);
      const viewService = ctx.services.get(IViewService);
      const commandRegistry = ctx.services.get(ICommandRegistry);

      const adapter = new DomViewAdapter(layoutService, viewService, commandRegistry, options);
      ctx.subscriptions.add(adapter);
      ctx.subscriptions.add(ctx.services.register(IViewAdapter, adapter));
    },
  };
}
