import { IFileSystemService } from '@editrix/core';
import type { IECSSceneService, SceneData } from '@editrix/estella';
import type { IPlugin, IPluginContext } from '@editrix/shell';
import { DocumentService, IDocumentService } from '@editrix/shell';
import { IECSScenePresence, IProjectService } from '../services.js';

const DEFAULT_SCENE_RELATIVE = 'scenes/main.scene.json';

/**
 * Owns the document service and the .scene.json file handler. Bridges the
 * gap between the synchronous document-open flow and the asynchronous ECS
 * runtime: parsed scene data that arrives before the ECS module is ready
 * is buffered and applied as soon as ECSScenePlugin's presence binds.
 *
 * Also owns "what the user sees on a fresh editor". On bind, exactly one of
 * the following runs (so the seed never collides with an autoload):
 *   1. If something already called documentService.open() before bind, the
 *      buffered SceneData is applied.
 *   2. Else, if the project has a default scene file at scenes/main.scene.json,
 *      it's opened automatically.
 *   3. Else, a default empty-project scene (Camera + Shape) is seeded.
 *
 * Wires every ECS state-mutation event to setDirty on the active document.
 */
export const DocumentSyncPlugin: IPlugin = {
  descriptor: {
    id: 'app.document-sync',
    version: '1.0.0',
    dependencies: ['app.ecs-scene', 'app.filesystem', 'app.project'],
  },
  activate(ctx: IPluginContext) {
    const presence = ctx.services.get(IECSScenePresence);
    const fileSystem = ctx.services.get(IFileSystemService);
    const project = ctx.services.get(IProjectService);

    const documentService = new DocumentService(
      (path) => fileSystem.readFile(path),
      (path, content) => fileSystem.writeFile(path, content),
    );
    ctx.subscriptions.add(documentService);
    ctx.subscriptions.add(ctx.services.register(IDocumentService, documentService));

    let pendingScene: SceneData | undefined;

    ctx.subscriptions.add(
      documentService.registerHandler({
        extensions: ['.scene.json'],
        load(_filePath, content): Promise<void> {
          const data = JSON.parse(content) as SceneData;
          if (presence.current) {
            presence.current.deserialize(data);
          } else {
            // ECS not ready yet — buffer; onDidBind below will drain it.
            pendingScene = data;
          }
          return Promise.resolve();
        },
        serialize(_filePath): Promise<string> {
          if (!presence.current) {
            throw new Error('Cannot save scene — ECS runtime is not ready yet.');
          }
          return Promise.resolve(JSON.stringify(presence.current.serialize(), null, 2));
        },
      }),
    );

    ctx.subscriptions.add(presence.onDidBind((ecs) => {
      void (async (): Promise<void> => {
        // Run the initial-scene decision first so any entities it creates
        // don't leak into dirty tracking — those entities are the file's
        // canonical state, not a user edit.
        await chooseInitialScene(ecs);
        wireDirtyMarkers(ctx, documentService, ecs);
      })();
    }));

    /**
     * Decides what to put on screen the first time the ECS scene binds, in
     * priority order. Each path is mutually exclusive — exactly one runs.
     */
    const chooseInitialScene = async (ecs: IECSSceneService): Promise<void> => {
      // 1. Something already called documentService.open() before WASM loaded.
      if (pendingScene) {
        ecs.deserialize(pendingScene);
        pendingScene = undefined;
        return;
      }

      // 2. Project has a default scene file — open it through the document
      //    service so the document tab appears and dirty tracking starts.
      if (project.isOpen) {
        const scenePath = project.resolve(DEFAULT_SCENE_RELATIVE);
        try {
          if (await fileSystem.exists(scenePath)) {
            await documentService.open(scenePath);
            return;
          }
        } catch {
          // Fall through to seed — the file existed but failed to load.
          // The error already logs through the document handler chain.
        }
      }

      // 3. Brand-new project: seed a minimal scene so the viewport isn't blank.
      seedDefaultScene(ecs);
    };
  },
};

function seedDefaultScene(ecs: IECSSceneService): void {
  const camId = ecs.createEntity('Main Camera');
  ecs.addComponent(camId, 'Camera');
  ecs.setProperty(camId, 'Camera', 'isActive', true);
  ecs.setProperty(camId, 'Transform', 'position.z', 200);

  const shapeId = ecs.createEntity('Test Shape');
  ecs.addComponent(shapeId, 'ShapeRenderer');
}

function wireDirtyMarkers(
  ctx: IPluginContext,
  documentService: DocumentService,
  ecs: IECSSceneService,
): void {
  // Mark active document dirty whenever ECS state changes (entity create/destroy,
  // hierarchy reparent, component add/remove, property edit). Selection-only
  // events are excluded — those don't dirty the file.
  const markDirty = (): void => {
    const active = documentService.activeDocument;
    if (active) documentService.setDirty(active, true);
  };
  ctx.subscriptions.add(ecs.onHierarchyChanged(markDirty));
  ctx.subscriptions.add(ecs.onPropertyChanged(markDirty));
  ctx.subscriptions.add(ecs.onComponentAdded(markDirty));
  ctx.subscriptions.add(ecs.onComponentRemoved(markDirty));
}
