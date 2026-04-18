import type { IPlugin, IPluginContext } from '@editrix/shell';
import { ILayoutService, IViewService } from '@editrix/shell';
import { GameViewWidget } from '../game-view-widget.js';
import { ISharedRenderContext } from '../services.js';

/**
 * Game View panel — runtime preview of the scene the way the engine would
 * present it (no editor gizmos). Shares the render context with Scene View
 * so the same compiled scene drives both surfaces.
 */
export const GameViewPlugin: IPlugin = {
  descriptor: {
    id: 'app.game-view',
    version: '1.0.0',
    dependencies: ['editrix.layout', 'editrix.view', 'app.render-context'],
  },
  activate(ctx: IPluginContext) {
    const layout = ctx.services.get(ILayoutService);
    const view = ctx.services.get(IViewService);
    const renderContextSvc = ctx.services.get(ISharedRenderContext);

    ctx.subscriptions.add(layout.registerPanel({
      id: 'game-view', title: 'Game View', defaultRegion: 'center', closable: false, draggable: false,
    }));
    ctx.subscriptions.add(view.registerFactory('game-view', (id) => {
      return new GameViewWidget(id, renderContextSvc.context);
    }));
  },
};
