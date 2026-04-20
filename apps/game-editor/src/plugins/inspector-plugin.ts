/**
 * Inspector plugin shell — wires {@link setupInspectorPanel} into the
 * kernel's plugin graph.
 *
 * Panel behaviour (property grid, asset inspector, prefab override UI,
 * add/remove/reorder component flows) lives in
 * {@link ../plugins/inspector-panel}. This file just resolves the
 * dependencies and forwards them.
 */

import type { IPlugin, IPluginContext } from '@editrix/shell';
import { ILayoutService, ISelectionService, IUndoRedoService, IViewService } from '@editrix/shell';
import {
  IAssetCatalogService,
  IECSScenePresence,
  IInspectorComponentFilter,
  IPrefabService,
  ISharedRenderContext,
} from '../services.js';
import { setupInspectorPanel } from './inspector-panel.js';

export const InspectorPlugin: IPlugin = {
  descriptor: {
    id: 'app.inspector',
    version: '1.0.0',
    dependencies: [
      'editrix.layout',
      'editrix.view',
      'editrix.properties',
      'app.ecs-scene',
      'app.inspector-filters',
      'app.asset-catalog',
      'app.prefab',
    ],
  },
  activate(ctx: IPluginContext) {
    setupInspectorPanel({
      layout: ctx.services.get(ILayoutService),
      view: ctx.services.get(IViewService),
      selection: ctx.services.get(ISelectionService),
      undoRedo: ctx.services.get(IUndoRedoService),
      presence: ctx.services.get(IECSScenePresence),
      renderContextSvc: ctx.services.get(ISharedRenderContext),
      componentFilter: ctx.services.get(IInspectorComponentFilter),
      catalog: ctx.services.get(IAssetCatalogService),
      prefabService: ctx.services.get(IPrefabService),
      services: ctx.services,
      subscriptions: ctx.subscriptions,
    });
  },
};
