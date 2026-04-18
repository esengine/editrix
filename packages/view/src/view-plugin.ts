import type { IPlugin, IPluginContext } from '@editrix/core';
import { IViewService, ViewService } from './view-service.js';

/** Stable plugin id — dependents should import this rather than hard-coding the string. */
export const ViewPluginId = 'editrix.view' as const;

/**
 * Built-in plugin that registers the view service.
 *
 * @example
 * ```ts
 * kernel.registerPlugin(ViewPlugin);
 * await kernel.start();
 * const view = kernel.services.get(IViewService);
 * ```
 */
export const ViewPlugin: IPlugin = {
  descriptor: {
    id: ViewPluginId,
    version: '0.1.0',
  },
  activate(ctx: IPluginContext) {
    const viewService = new ViewService();
    ctx.subscriptions.add(viewService);
    ctx.subscriptions.add(ctx.services.register(IViewService, viewService));
  },
};
