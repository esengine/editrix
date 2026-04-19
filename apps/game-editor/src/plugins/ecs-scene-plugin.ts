import { Emitter } from '@editrix/common';
import { ECSSceneService, IECSSceneService, IEstellaService } from '@editrix/estella';
import type { ESEngineModule } from '@editrix/estella';
import type { IPlugin, IPluginContext } from '@editrix/shell';
import { IECSScenePresence, IInspectorComponentFilter, ISharedRenderContext } from '../services.js';

// Components edited indirectly through other UI surfaces, not the Inspector
// "Add Component" picker. Parent/Children are hierarchy-plumbing; Disabled
// is the wire form for the visibility toggle (set via setVisible).
const ESTELLA_STRUCTURAL_COMPONENTS = new Set<string>(['Parent', 'Children', 'Disabled']);

export const ECSScenePlugin: IPlugin = {
  descriptor: {
    id: 'app.ecs-scene',
    version: '1.0.0',
    dependencies: ['editrix.estella', 'app.render-context', 'app.inspector-filters'],
  },
  activate(ctx: IPluginContext) {
    const estella = ctx.services.get(IEstellaService);
    const renderContextSvc = ctx.services.get(ISharedRenderContext);
    const renderContext = renderContextSvc.context;

    const filter = ctx.services.get(IInspectorComponentFilter);
    ctx.subscriptions.add(
      filter.register((name) => ESTELLA_STRUCTURAL_COMPONENTS.has(name)),
    );

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
