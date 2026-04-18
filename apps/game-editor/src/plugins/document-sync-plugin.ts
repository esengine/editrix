import { IFileSystemService } from '@editrix/core';
import type { IECSSceneService, SceneData } from '@editrix/estella';
import type { IPlugin, IPluginContext } from '@editrix/shell';
import { DocumentService, IDocumentService } from '@editrix/shell';
import { IECSScenePresence } from '../services.js';

/**
 * Owns the document service and the .scene.json file handler. Bridges the
 * gap between the synchronous document-open flow and the asynchronous ECS
 * runtime: parsed scene data that arrives before the ECS module is ready
 * is buffered and applied as soon as ECSScenePlugin's presence binds.
 *
 * Also owns "what the user sees on a fresh editor": if no scene was queued
 * before binding, seeds a default empty-project scene (Camera + Shape) so
 * the viewport isn't blank.
 *
 * Wires every ECS state-mutation event to setDirty on the active document.
 */
export const DocumentSyncPlugin: IPlugin = {
  descriptor: {
    id: 'app.document-sync',
    version: '1.0.0',
    dependencies: ['app.ecs-scene', 'app.filesystem'],
  },
  activate(ctx: IPluginContext) {
    const presence = ctx.services.get(IECSScenePresence);
    const fileSystem = ctx.services.get(IFileSystemService);

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
      if (pendingScene) {
        ecs.deserialize(pendingScene);
        pendingScene = undefined;
      } else {
        seedDefaultScene(ecs);
      }
      wireDirtyMarkers(ctx, documentService, ecs);
    }));
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
