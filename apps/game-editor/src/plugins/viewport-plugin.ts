import { IEstellaService } from '@editrix/estella';
import type { IPlugin, IPluginContext } from '@editrix/shell';
import { ILayoutService, ISelectionService, IUndoRedoService, IViewService } from '@editrix/shell';
import { IECSScenePresence, ISharedRenderContext } from '../services.js';
import { ViewportWidget } from '../viewport-widget.js';

/**
 * Viewport panel plugin. Replaces the previous SceneView + GameView panels
 * with a single panel that hosts both as toggleable modes inside a segmented
 * control. The two are perspectives of the same scene rather than separate
 * documents, so a single panel models that more honestly than two tab-grouped
 * panels did.
 *
 * Panel is fixed (closable: false, draggable: false) so the layout-renderer
 * suppresses its tab header — the viewport reads as a clean canvas with the
 * mode toggle as its only chrome.
 */
export const ViewportPlugin: IPlugin = {
  descriptor: {
    id: 'app.viewport',
    version: '1.0.0',
    dependencies: ['editrix.layout', 'editrix.view', 'app.render-context', 'app.ecs-scene'],
  },
  activate(ctx: IPluginContext) {
    const layout = ctx.services.get(ILayoutService);
    const view = ctx.services.get(IViewService);
    const selection = ctx.services.get(ISelectionService);
    const undoRedo = ctx.services.get(IUndoRedoService);
    const estella = ctx.services.get(IEstellaService);
    const renderContextSvc = ctx.services.get(ISharedRenderContext);
    const presence = ctx.services.get(IECSScenePresence);

    let widget: ViewportWidget | undefined;

    ctx.subscriptions.add(presence.onDidBind((ecs) => {
      widget?.setECSScene(ecs);
    }));

    ctx.subscriptions.add(layout.registerPanel({
      id: 'viewport', title: 'Viewport', defaultRegion: 'center', closable: false, draggable: false,
    }));
    ctx.subscriptions.add(view.registerFactory('viewport', (id) => {
      widget = new ViewportWidget(id, renderContextSvc.context, selection, undoRedo);
      if (presence.current) widget.setECSScene(presence.current);
      if (estella.isReady && estella.module) {
        widget.initCamera(estella.module);
      } else {
        const sub = estella.onReady((module) => {
          widget?.initCamera(module);
          sub.dispose();
        });
        ctx.subscriptions.add(sub);
      }
      return widget;
    }));
  },
};
