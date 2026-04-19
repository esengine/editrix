import { IEstellaService, type IECSSceneService } from '@editrix/estella';
import type { IPlugin, IPluginContext } from '@editrix/shell';
import { IDocumentService, ILayoutService, ISelectionService, IUndoRedoService, IViewService } from '@editrix/shell';
import {
  entityRef,
  IAssetCatalogService,
  IECSScenePresence,
  IProjectService,
  ISharedRenderContext,
} from '../services.js';
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
    dependencies: ['editrix.layout', 'editrix.view', 'app.render-context', 'app.ecs-scene', 'app.asset-catalog', 'app.project', 'app.document-sync'],
  },
  activate(ctx: IPluginContext) {
    const layout = ctx.services.get(ILayoutService);
    const view = ctx.services.get(IViewService);
    const selection = ctx.services.get(ISelectionService);
    const undoRedo = ctx.services.get(IUndoRedoService);
    const estella = ctx.services.get(IEstellaService);
    const renderContextSvc = ctx.services.get(ISharedRenderContext);
    const presence = ctx.services.get(IECSScenePresence);
    const catalog = ctx.services.get(IAssetCatalogService);
    const project = ctx.services.get(IProjectService);
    const documentService = ctx.services.get(IDocumentService);

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

      ctx.subscriptions.add(widget.onDidDropAsset(({ absolutePath, worldX, worldY, hitEntityId }) => {
        const rel = toProjectRelative(absolutePath, project.path);
        if (rel === undefined) return;
        const entry = catalog.getByPath(rel);
        if (!entry) return;

        if (entry.type === 'scene') {
          documentService.open(absolutePath).catch(() => { /* doc-sync surfaces failure */ });
          return;
        }
        if (entry.type !== 'image') return;

        const ecs = presence.current;
        if (!ecs) return;

        if (hitEntityId !== undefined && ecs.hasComponent(hitEntityId, 'Sprite')) {
          replaceSpriteTexture(ecs, undoRedo, hitEntityId, entry.uuid);
          selection.select([entityRef(hitEntityId)]);
        } else {
          const newId = createSpriteEntity(ecs, undoRedo, entry.uuid, entry.relativePath, worldX, worldY);
          if (newId !== undefined) selection.select([entityRef(newId)]);
        }
      }));

      return widget;
    }));
  },
};

function toProjectRelative(abs: string, projectPath: string): string | undefined {
  if (!projectPath) return undefined;
  const root = projectPath.endsWith('/') ? projectPath : projectPath + '/';
  if (abs === projectPath) return '';
  if (!abs.startsWith(root)) return undefined;
  return abs.slice(root.length);
}

const ASSET_METADATA_KEY = 'asset:Sprite.texture';

function replaceSpriteTexture(
  ecs: IECSSceneService, undoRedo: IUndoRedoService, entityId: number, newUuid: string,
): void {
  const prev = ecs.getEntityMetadata(entityId, ASSET_METADATA_KEY);
  const prevUuid = typeof prev === 'string' ? prev : undefined;
  if (prevUuid === newUuid) return;
  ecs.setEntityMetadata(entityId, ASSET_METADATA_KEY, newUuid);
  undoRedo.push({
    label: 'Replace Sprite Texture',
    undo: () => { ecs.setEntityMetadata(entityId, ASSET_METADATA_KEY, prevUuid); },
    redo: () => { ecs.setEntityMetadata(entityId, ASSET_METADATA_KEY, newUuid); },
  });
}

function deriveEntityName(relativePath: string): string {
  const slash = relativePath.lastIndexOf('/');
  const file = slash >= 0 ? relativePath.slice(slash + 1) : relativePath;
  const dot = file.lastIndexOf('.');
  return dot > 0 ? file.slice(0, dot) : file;
}

function createSpriteEntity(
  ecs: IECSSceneService, undoRedo: IUndoRedoService,
  uuid: string, relativePath: string, worldX: number, worldY: number,
): number | undefined {
  const name = deriveEntityName(relativePath);
  const id = ecs.createEntity(name);
  ecs.setProperty(id, 'Transform', 'position.x', worldX);
  ecs.setProperty(id, 'Transform', 'position.y', worldY);
  ecs.addComponent(id, 'Sprite');
  ecs.setEntityMetadata(id, ASSET_METADATA_KEY, uuid);

  undoRedo.push({
    label: 'Create Sprite from Asset',
    undo: () => { ecs.destroyEntity(id); },
    redo: () => {
      createSpriteEntity(ecs, undoRedo, uuid, relativePath, worldX, worldY);
    },
  });

  return id;
}
