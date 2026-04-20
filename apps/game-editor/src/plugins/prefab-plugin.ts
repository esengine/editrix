/**
 * Prefab plugin shell — wires {@link createPrefabInstanceService} into the
 * kernel's plugin + DI graph.
 *
 * All behaviour lives in {@link createPrefabInstanceService} (instance
 * tracking, override diff, hot reload, prefab-mode document handler, tab
 * snapshot/restore). This file just resolves the service's dependencies
 * from `IPluginContext.services` and registers the result on the DI
 * container.
 */

import { IFileSystemService } from '@editrix/core';
import type { IPlugin, IPluginContext } from '@editrix/shell';
import { IDocumentService, ISelectionService } from '@editrix/shell';
import {
  IAssetCatalogService,
  IECSScenePresence,
  IPlayModeService,
  IPrefabService,
  IProjectService,
} from '../services.js';
import { createPrefabInstanceService } from './prefab-instance-service.js';

export const PrefabPlugin: IPlugin = {
  descriptor: {
    id: 'app.prefab',
    version: '1.0.0',
    dependencies: [
      'app.ecs-scene',
      'app.filesystem',
      'app.project',
      'app.asset-catalog',
      'app.play-mode',
      'app.document-sync',
    ],
  },
  activate(ctx: IPluginContext) {
    const service = createPrefabInstanceService({
      presence: ctx.services.get(IECSScenePresence),
      fileSystem: ctx.services.get(IFileSystemService),
      project: ctx.services.get(IProjectService),
      catalog: ctx.services.get(IAssetCatalogService),
      playMode: ctx.services.get(IPlayModeService),
      documentService: ctx.services.get(IDocumentService),
      selection: ctx.services.get(ISelectionService),
      subscriptions: ctx.subscriptions,
    });
    ctx.subscriptions.add(ctx.services.register(IPrefabService, service));
  },
};
