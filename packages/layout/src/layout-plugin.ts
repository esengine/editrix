import type { IPlugin, IPluginContext } from '@editrix/core';
import { ILayoutService, LayoutService } from './layout-service.js';

/**
 * Built-in plugin that registers the layout service.
 *
 * @example
 * ```ts
 * kernel.registerPlugin(LayoutPlugin);
 * await kernel.start();
 * const layout = kernel.services.get(ILayoutService);
 * ```
 */
export const LayoutPlugin: IPlugin = {
  descriptor: {
    id: 'editrix.layout',
    version: '0.1.0',
  },
  activate(ctx: IPluginContext) {
    const layoutService = new LayoutService();
    ctx.subscriptions.add(layoutService);
    ctx.subscriptions.add(ctx.services.register(ILayoutService, layoutService));
  },
};
