import type { IPlugin, IPluginContext } from '@editrix/shell';
import { SharedRenderContext } from '../render-context.js';
import { ISharedRenderContext } from '../services.js';

/**
 * Owns the single {@link SharedRenderContext} used by both Scene View and
 * Game View. Registered as a service so any panel that needs to render or
 * trigger a redraw can resolve it without going through closures.
 */
export const RenderContextPlugin: IPlugin = {
  descriptor: {
    id: 'app.render-context',
    version: '1.0.0',
  },
  activate(ctx: IPluginContext) {
    const context = new SharedRenderContext();
    ctx.subscriptions.add(context);
    ctx.subscriptions.add(ctx.services.register(ISharedRenderContext, { context }));
  },
};
