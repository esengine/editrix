import { IEstellaService } from '@editrix/estella';
import type { IPlugin, IPluginContext } from '@editrix/shell';
import { ILayoutService, ISelectionService, IUndoRedoService, IViewService } from '@editrix/shell';
import { SceneViewWidget } from '../scene-view-widget.js';
import { IECSScenePresence, ISharedRenderContext } from '../services.js';

/**
 * Scene View panel — interactive editor viewport. Holds a {@link SceneViewWidget}
 * that renders the current ECS scene against the shared render context, and
 * wires up the scene's editor camera once WASM is ready.
 */
export const SceneViewPlugin: IPlugin = {
  descriptor: {
    id: 'app.scene-view',
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

    let widget: SceneViewWidget | undefined;

    ctx.subscriptions.add(presence.onDidBind((ecs) => {
      widget?.setECSScene(ecs);
    }));

    ctx.subscriptions.add(layout.registerPanel({
      id: 'scene-view', title: 'Scene View', defaultRegion: 'center', closable: false, draggable: false,
    }));
    ctx.subscriptions.add(view.registerFactory('scene-view', (id) => {
      widget = new SceneViewWidget(id, renderContextSvc.context, selection, undoRedo);
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
