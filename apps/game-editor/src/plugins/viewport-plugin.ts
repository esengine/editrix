import { IEstellaService, type IECSSceneService } from '@editrix/estella';
import type { IPlugin, IPluginContext } from '@editrix/shell';
import { IDocumentService, ILayoutService, ISelectionService, IUndoRedoService, IViewService } from '@editrix/shell';
import { AnimationEditorWidget } from '../animation-editor-widget.js';
import {
  entityRef,
  IAnimationService,
  IAssetCatalogService,
  IECSScenePresence,
  IPrefabService,
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
    dependencies: ['editrix.layout', 'editrix.view', 'app.render-context', 'app.ecs-scene', 'app.asset-catalog', 'app.project', 'app.document-sync', 'app.prefab', 'app.animation'],
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
    const prefabService = ctx.services.get(IPrefabService);
    const animationService = ctx.services.get(IAnimationService);

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

      // Prefab Mode banner: bind to the active document. When a `.esprefab`
      // tab is focused, the viewport shows an "Editing Prefab: X" banner
      // with an Exit button that simply closes that tab (restoring the
      // previous scene via the snapshot-swap layer).
      const refreshPrefabBanner = (): void => {
        const activePath = documentService.activeDocument;
        if (activePath?.endsWith('.esprefab') === true) {
          const leaf = activePath.split('/').pop() ?? 'Prefab';
          widget?.setPrefabBanner({
            title: `Editing Prefab: ${leaf}`,
            onExit: () => { documentService.close(activePath); },
          });
        } else {
          widget?.setPrefabBanner(undefined);
        }
      };
      ctx.subscriptions.add(documentService.onDidChangeActive(refreshPrefabBanner));
      ctx.subscriptions.add(documentService.onDidChangeDocuments(refreshPrefabBanner));
      refreshPrefabBanner();

      // Animation Mode overlay. `.esanim` docs mount a dedicated editor
      // widget over the viewport body; anything else hides it without
      // tearing down. One widget instance is reused across clips — we
      // just rebind its document pointer. This keeps the DOM subtree
      // warm across tab-swaps and avoids re-allocating on every switch.
      let animWidget: AnimationEditorWidget | undefined;
      const refreshAnimation = (): void => {
        const activePath = documentService.activeDocument;
        if (activePath?.endsWith('.esanim') === true) {
          animWidget ??= new AnimationEditorWidget(`${id}-anim`, animationService, catalog, project);
          animWidget.setOnExit(() => { documentService.close(activePath); });
          widget?.setAnimationEditor(animWidget);
          animWidget.setDocument(activePath);
        } else {
          widget?.setAnimationEditor(undefined);
          animWidget?.setDocument(undefined);
        }
      };
      ctx.subscriptions.add(documentService.onDidChangeActive(refreshAnimation));
      ctx.subscriptions.add(documentService.onDidChangeDocuments(refreshAnimation));
      ctx.subscriptions.add({ dispose: () => { animWidget?.dispose(); } });
      refreshAnimation();

      ctx.subscriptions.add(widget.onDidDropAsset(({ absolutePath, worldX, worldY, hitEntityId }) => {
        const rel = toProjectRelative(absolutePath, project.path);
        if (rel === undefined) return;
        const entry = catalog.getByPath(rel);
        if (!entry) return;

        if (entry.type === 'scene') {
          documentService.open(absolutePath).catch(() => { /* doc-sync surfaces failure */ });
          return;
        }
        if (entry.type === 'prefab') {
          // Instantiate the prefab at the drop world position. Selection
          // flips to the instance root so the user can immediately keep
          // editing. Errors surface via the service's warn path (console).
          void (async (): Promise<void> => {
            try {
              const rootEntityId = await prefabService.instantiate(entry.uuid, { position: { x: worldX, y: worldY } });
              selection.select([entityRef(rootEntityId)]);
              const ecs = presence.current;
              if (!ecs) return;
              undoRedo.push({
                label: `Instantiate ${entry.relativePath.split('/').pop() ?? 'Prefab'}`,
                undo: () => { ecs.destroyEntity(rootEntityId); selection.clearSelection(); },
                // Redo instantiates a fresh copy (new entity ids). Select that
                // copy so the user stays oriented. Fire-and-forget — if it
                // fails the console will show it.
                redo: () => {
                  void prefabService.instantiate(entry.uuid, { position: { x: worldX, y: worldY } })
                    .then((newRootId) => { selection.select([entityRef(newRootId)]); });
                },
              });
            } catch { /* prefab-plugin already logged */ }
          })();
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
