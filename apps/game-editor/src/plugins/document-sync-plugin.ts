import { IFileSystemService } from '@editrix/core';
import type { IECSSceneService, SceneData } from '@editrix/estella';
import type { IPlugin, IPluginContext } from '@editrix/shell';
import { DocumentService, ICommandRegistry, IDocumentService, ISelectionService } from '@editrix/shell';
import { showConfirmDialog } from '../dialogs.js';
import { IECSScenePresence, IPlayModeService, IProjectService } from '../services.js';

interface ElectronFileApi {
  selectFile(options?: {
    title?: string;
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
  }): Promise<string | null>;
}

function getElectronFileApi(): ElectronFileApi | undefined {
  return (window as unknown as { electronAPI?: ElectronFileApi }).electronAPI;
}

const DEFAULT_SCENE_RELATIVE = 'scenes/main.scene.json';

export const DocumentSyncPlugin: IPlugin = {
  descriptor: {
    id: 'app.document-sync',
    version: '1.0.0',
    dependencies: ['app.ecs-scene', 'app.filesystem', 'app.project', 'app.play-mode'],
  },
  activate(ctx: IPluginContext) {
    const presence = ctx.services.get(IECSScenePresence);
    const fileSystem = ctx.services.get(IFileSystemService);
    const project = ctx.services.get(IProjectService);
    const selection = ctx.services.get(ISelectionService);
    const playMode = ctx.services.get(IPlayModeService);

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
        async load(filePath, content): Promise<void> {
          // Single-scene contract: opening a second scene closes the first.
          const priorScenes = documentService
            .getOpenDocuments()
            .filter((d) => d.filePath !== filePath && d.filePath.endsWith('.scene.json'));
          for (const prior of priorScenes) {
            if (prior.dirty) {
              const ok = await showConfirmDialog(
                `Opening "${filePath.split('/').pop() ?? ''}" will close "${prior.name}" with unsaved changes.`,
                { okLabel: 'Discard changes', destructive: true },
              );
              if (!ok) throw new Error('Open cancelled by user.');
            }
            documentService.close(prior.filePath);
          }

          const data = parseSceneData(content, filePath);
          if (presence.current) {
            applyScene(presence.current, data);
          } else {
            pendingScene = data;
          }
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
        // Initial scene is set before dirty wiring so seeded entities
        // aren't treated as user edits.
        await chooseInitialScene(ecs);
        wireDirtyMarkers(ctx, documentService, ecs);
      })();
    }));

    // Last scene doc closed → tear down play + selection + ECS together.
    // Stop must precede clear so the snapshot restore writes into live state.
    ctx.subscriptions.add(
      documentService.onDidChangeDocuments(() => {
        const hasSceneDoc = documentService
          .getOpenDocuments()
          .some((d) => d.extension === '.scene.json' || d.filePath.endsWith('.scene.json'));
        if (hasSceneDoc) return;

        pendingScene = undefined;
        if (playMode.isInPlay) playMode.stop();
        selection.clearSelection();
        if (presence.current) {
          presence.current.deserialize({ version: 1, name: '', entities: [] });
        }
      }),
    );

    const chooseInitialScene = async (ecs: IECSSceneService): Promise<void> => {
      if (pendingScene) {
        applyScene(ecs, pendingScene);
        pendingScene = undefined;
        return;
      }

      if (project.isOpen) {
        const scenePath = project.resolve(DEFAULT_SCENE_RELATIVE);

        try {
          if (await fileSystem.exists(scenePath)) {
            await documentService.open(scenePath);
            return;
          }
        } catch {
          return;
        }

        try {
          await fileSystem.mkdir(project.resolve('scenes'));
          await fileSystem.writeFile(scenePath, emptySceneJson());
          await documentService.open(scenePath);
        } catch (err) {
          console.warn(
            `[document-sync] Could not initialise ${DEFAULT_SCENE_RELATIVE}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    };

    const commands = ctx.services.get(ICommandRegistry);

    ctx.subscriptions.add(
      commands.register({
        id: 'scene.new',
        title: 'New Scene',
        category: 'Scene',
        async execute(): Promise<void> {
          if (!project.isOpen) return;
          const scenesDir = project.resolve('scenes');
          await fileSystem.mkdir(scenesDir);
          const scenePath = await nextUntitledScenePath(fileSystem, scenesDir);
          await fileSystem.writeFile(scenePath, emptySceneJson());
          await documentService.open(scenePath);
        },
      }),
    );

    ctx.subscriptions.add(
      commands.register({
        id: 'scene.open',
        title: 'Open Scene...',
        category: 'Scene',
        async execute(): Promise<void> {
          const api = getElectronFileApi();
          if (!api) return;
          const defaultPath = project.isOpen ? project.resolve('scenes') : undefined;
          const picked = await api.selectFile({
            title: 'Open Scene',
            ...(defaultPath !== undefined ? { defaultPath } : {}),
            filters: [
              { name: 'Scene Files', extensions: ['scene.json', 'json'] },
              { name: 'All Files', extensions: ['*'] },
            ],
          });
          if (!picked) return;
          try {
            await documentService.open(picked);
          } catch (err) {
            await showConfirmDialog(
              err instanceof Error ? err.message : String(err),
              { okLabel: 'OK' },
            );
          }
        },
      }),
    );
  },
};

async function nextUntitledScenePath(
  fileSystem: IFileSystemService,
  scenesDir: string,
): Promise<string> {
  for (let i = 1; i < 10_000; i++) {
    const candidate = `${scenesDir}/untitled-${String(i)}.scene.json`;
    if (!(await fileSystem.exists(candidate))) return candidate;
  }
  throw new Error('Could not allocate an untitled scene filename.');
}

function parseSceneData(raw: string, filePath: string): SceneData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(
      `"${filePath}" is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`"${filePath}" does not contain a scene object.`);
  }
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj['entities'])) {
    if ('nodeTypes' in obj || '$type' in obj) {
      throw new Error(
        `"${filePath}" is in the old SceneService format and is not supported. ` +
        `Delete the file (or replace its contents with {"version":1,"name":"...","entities":[]}) ` +
        `and reopen the project — the editor will seed a fresh ECS scene.`,
      );
    }
    throw new Error(`"${filePath}" is missing the required "entities" array.`);
  }
  return {
    version: typeof obj['version'] === 'number' ? obj['version'] : 1,
    name: typeof obj['name'] === 'string' ? obj['name'] : 'Scene',
    entities: obj['entities'] as SceneData['entities'],
  };
}

function applyScene(ecs: IECSSceneService, data: SceneData): void {
  ecs.deserialize(data);
  // Empty-entities file = fresh template; seed Camera + Shape so viewport
  // isn't blank on create-project.
  if (data.entities.length === 0) {
    seedDefaultScene(ecs);
  }
}

function seedDefaultScene(ecs: IECSSceneService): void {
  const camId = ecs.createEntity('Main Camera');
  ecs.addComponent(camId, 'Camera');
  ecs.setProperty(camId, 'Camera', 'isActive', true);
  ecs.setProperty(camId, 'Transform', 'position.z', 200);

  const shapeId = ecs.createEntity('Test Shape');
  ecs.addComponent(shapeId, 'ShapeRenderer');
}

function emptySceneJson(): string {
  return `${JSON.stringify({ version: 1, name: 'Main Scene', entities: [] }, null, 2)}\n`;
}

function wireDirtyMarkers(
  ctx: IPluginContext,
  documentService: DocumentService,
  ecs: IECSSceneService,
): void {
  const markDirty = (): void => {
    const active = documentService.activeDocument;
    if (active) documentService.setDirty(active, true);
  };
  ctx.subscriptions.add(ecs.onHierarchyChanged(markDirty));
  ctx.subscriptions.add(ecs.onPropertyChanged(markDirty));
  ctx.subscriptions.add(ecs.onComponentAdded(markDirty));
  ctx.subscriptions.add(ecs.onComponentRemoved(markDirty));
}
