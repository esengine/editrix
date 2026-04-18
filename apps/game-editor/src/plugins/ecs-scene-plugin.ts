import { Emitter } from '@editrix/common';
import { ECSSceneService, IECSSceneService, IEstellaService } from '@editrix/estella';
import type { ESEngineModule } from '@editrix/estella';
import type { IPlugin, IPluginContext } from '@editrix/shell';
import { IECSScenePresence, ISharedRenderContext } from '../services.js';

/**
 * Listens for the WASM module to become ready, instantiates ECSSceneService
 * against the shared render context, and registers it as IECSSceneService.
 *
 * Also exposes IECSScenePresence so panel plugins don't need to know about
 * estella's ready signal — they subscribe to onDidBind for the late binding
 * and receive the scene the moment it's available.
 *
 * This plugin is intentionally minimal: it does not seed initial entities
 * (DocumentSyncPlugin owns that policy — it's the one that knows whether a
 * scene file should be loaded instead of a default seed).
 */
export const ECSScenePlugin: IPlugin = {
  descriptor: {
    id: 'app.ecs-scene',
    version: '1.0.0',
    dependencies: ['editrix.estella', 'app.render-context'],
  },
  activate(ctx: IPluginContext) {
    const estella = ctx.services.get(IEstellaService);
    const renderContextSvc = ctx.services.get(ISharedRenderContext);
    const renderContext = renderContextSvc.context;

    const onDidBind = new Emitter<IECSSceneService>();
    ctx.subscriptions.add(onDidBind);
    let current: IECSSceneService | undefined;

    const presence: IECSScenePresence = {
      get current() {
        return current;
      },
      onDidBind: onDidBind.event,
    };
    ctx.subscriptions.add(ctx.services.register(IECSScenePresence, presence));

    const initECS = (module: ESEngineModule): void => {
      if (current) return;
      if (!renderContext.init(module)) return;
      const registry = renderContext.registry;
      if (!registry) return;

      const ecs = new ECSSceneService(module, registry, () => { renderContext.requestRender(); });
      ctx.subscriptions.add(ecs);
      ctx.subscriptions.add(ctx.services.register(IECSSceneService, ecs));
      current = ecs;

      onDidBind.fire(ecs);
    };

    if (estella.isReady && estella.module) {
      initECS(estella.module);
    } else {
      const sub = estella.onReady((module) => {
        initECS(module);
        sub.dispose();
      });
      ctx.subscriptions.add(sub);
    }
  },
};
