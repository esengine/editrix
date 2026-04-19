import { IFileSystemService } from '@editrix/core';
import type { LogLevel } from '@editrix/plugin-console';
import { IConsoleService } from '@editrix/plugin-console';
import type { IPlugin, IPluginContext } from '@editrix/shell';
import { ICommandRegistry, IDocumentService, ILayoutService, ISelectionService, IViewService } from '@editrix/shell';
import type { ContextMenuItem } from '@editrix/view-dom';
import { ContentBrowserWidget } from '../content-browser-widget.js';
import { showConfirmDialog, showInputDialog } from '../dialogs.js';
import { ProjectFilesWidget } from '../project-files-widget.js';
import { assetRef, IAssetCatalogService, IAssetRevealService, IECSScenePresence, IPrefabService, IProjectService, parseSelectionRef } from '../services.js';

const CONSOLE_BUFFER_MAX = 500;

function toProjectRelative(abs: string, projectPath: string): string | undefined {
  if (!projectPath) return undefined;
  const root = projectPath.endsWith('/') ? projectPath : projectPath + '/';
  if (abs === projectPath) return '';
  if (!abs.startsWith(root)) return undefined;
  return abs.slice(root.length);
}

/**
 * Pick an unused `.esprefab` filename in `dir` based on `baseName`.
 * First tries `<baseName>.esprefab`; if it exists, probes `_2`, `_3`, …
 * up to a reasonable bound. The caller is expected to have ensured `dir`
 * exists via `mkdir` already.
 */
async function uniquePrefabPath(
  fileSystem: IFileSystemService,
  dir: string,
  baseName: string,
): Promise<string> {
  const primary = `${dir}/${baseName}.esprefab`;
  if (!(await fileSystem.exists(primary))) return primary;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${dir}/${baseName}_${String(i)}.esprefab`;
    if (!(await fileSystem.exists(candidate))) return candidate;
  }
  throw new Error(`Could not allocate a unique filename for "${baseName}" in ${dir}`);
}

export const ProjectPanelsPlugin: IPlugin = {
  descriptor: {
    id: 'app.project-panels',
    version: '1.0.0',
    dependencies: ['editrix.layout', 'editrix.view', 'app.document-sync', 'app.filesystem', 'app.project', 'app.asset-catalog', 'app.prefab', 'app.animation'],
  },
  activate(ctx: IPluginContext) {
    const layout = ctx.services.get(ILayoutService);
    const view = ctx.services.get(IViewService);
    const documentService = ctx.services.get(IDocumentService);
    const fileSystem = ctx.services.get(IFileSystemService);
    const project = ctx.services.get(IProjectService);
    const selection = ctx.services.get(ISelectionService);
    const catalog = ctx.services.get(IAssetCatalogService);
    const prefabService = ctx.services.get(IPrefabService);
    const presence = ctx.services.get(IECSScenePresence);
    const commands = ctx.services.get(ICommandRegistry);

    let contentBrowserWidget: ContentBrowserWidget | undefined;

    interface PendingLog { readonly level: LogLevel; readonly message: string; readonly source: string | undefined }
    const pending: PendingLog[] = [];

    const consoleService: IConsoleService = {
      log(level, message, source) {
        if (contentBrowserWidget) {
          contentBrowserWidget.log(level, message, source);
          return;
        }
        if (pending.length < CONSOLE_BUFFER_MAX) {
          pending.push({ level, message, source });
        }
      },
      clear() {
        pending.length = 0;
        contentBrowserWidget?.clearConsole();
      },
    };
    ctx.subscriptions.add(ctx.services.register(IConsoleService, consoleService));

    ctx.subscriptions.add(ctx.services.register(IAssetRevealService, {
      revealByUuid(uuid: string): void {
        const entry = catalog.getByUuid(uuid);
        if (!entry) return;
        contentBrowserWidget?.revealAsset(entry.absolutePath);
      },
    }));

    /**
     * Resolve an incoming batch of Hierarchy drag node ids into entity
     * numbers, filter out anything that can't be made into a prefab
     * (already an instance / no project open), then create `.esprefab`
     * files inside `targetDirPath`. Filenames are derived from entity
     * names with a `_N` disambiguator if a file already exists.
     */
    /**
     * Prompt + write a `.esprefab` variant alongside the base file. Asks
     * for a filename, defaulting to `<base>_variant.esprefab`; the new
     * file is dropped in the base's own folder.
     */
    const createVariantFromAsset = async (baseUuid: string, basePath: string): Promise<void> => {
      const slash = basePath.lastIndexOf('/');
      const dir = slash >= 0 ? basePath.slice(0, slash) : basePath;
      const baseLeaf = (slash >= 0 ? basePath.slice(slash + 1) : basePath).replace(/\.esprefab$/, '');
      const suggested = `${baseLeaf}_variant.esprefab`;

      const entered = await showInputDialog('Create Variant', {
        initialValue: suggested,
        placeholder: 'filename.esprefab',
        okLabel: 'Create',
      });
      if (!entered) return;
      const filename = entered.trim().endsWith('.esprefab')
        ? entered.trim()
        : `${entered.trim()}.esprefab`;
      const filePath = `${dir}/${filename}`;

      if (await fileSystem.exists(filePath)) {
        const ok = await showConfirmDialog(
          `${filename} already exists. Overwrite?`,
          { okLabel: 'Overwrite', destructive: true },
        );
        if (!ok) return;
      }

      try {
        await prefabService.createVariant(baseUuid, filePath);
      } catch (err) {
        consoleService.log(
          'error',
          `Create variant: ${err instanceof Error ? err.message : String(err)}`,
          'prefab',
        );
      }
    };

    const createPrefabsFromHierarchyDrop = async (
      nodeIds: readonly string[],
      targetDirPath: string,
    ): Promise<void> => {
      const ecs = presence.current;
      if (!ecs || !project.isOpen || !targetDirPath) return;

      const entityIds: number[] = [];
      for (const raw of nodeIds) {
        const parsed = parseSelectionRef(raw);
        if (parsed?.kind !== 'entity') continue;
        if (prefabService.isInsideInstance(parsed.id)) continue;
        entityIds.push(parsed.id);
      }
      if (entityIds.length === 0) return;

      await fileSystem.mkdir(targetDirPath);

      for (const entityId of entityIds) {
        const rawName = ecs.getName(entityId) || 'Prefab';
        const safe = rawName.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'Prefab';
        const filePath = await uniquePrefabPath(fileSystem, targetDirPath, safe);
        try {
          await prefabService.createPrefab(entityId, filePath);
        } catch (err) {
          consoleService.log(
            'error',
            `Create prefab for "${rawName}": ${err instanceof Error ? err.message : String(err)}`,
            'prefab',
          );
        }
      }
    };

    // ── Project Files ──
    ctx.subscriptions.add(
      layout.registerPanel({ id: 'project-files', title: 'Project Files', defaultRegion: 'left' }),
    );
    ctx.subscriptions.add(
      view.registerFactory('project-files', (id) => {
        const widget = new ProjectFilesWidget(id, fileSystem, project);
        widget.onDidSelectFolder((folderPath) => {
          if (contentBrowserWidget) {
            contentBrowserWidget.navigateTo(folderPath);
            contentBrowserWidget.showView('assets');
          }
        });
        return widget;
      }),
    );

    // ── Content Browser ──
    ctx.subscriptions.add(
      layout.registerPanel({
        id: 'content-browser', title: 'Content Browser', defaultRegion: 'center',
        closable: false, draggable: false,
      }),
    );
    ctx.subscriptions.add(
      view.registerFactory('content-browser', (id) => {
        const buildCardMenu = (path: string): readonly ContextMenuItem[] => {
          // `.esprefab` cards get a "Create Variant..." item. Other asset
          // types fall through — the widget supplies its own default items
          // (Reveal in Finder).
          if (!path.endsWith('.esprefab')) return [];
          const rel = toProjectRelative(path, project.path);
          if (rel === undefined) return [];
          const asset = catalog.getByPath(rel);
          if (!asset) return [];
          return [{
            label: 'Create Variant...', icon: 'plus-circle',
            onSelect: () => { void createVariantFromAsset(asset.uuid, path); },
          }];
        };
        const buildEmptyAreaMenu = (targetDirPath: string): readonly ContextMenuItem[] => [
          {
            label: 'New Animation Clip...', icon: 'plus-circle',
            onSelect: () => {
              void commands.execute('animation.newClip', { targetDirPath });
            },
          },
        ];
        contentBrowserWidget = new ContentBrowserWidget(id, fileSystem, project, { buildCardMenu, buildEmptyAreaMenu });
        // Flush logs that arrived before the widget mounted.
        for (const entry of pending) {
          contentBrowserWidget.log(entry.level, entry.message, entry.source);
        }
        pending.length = 0;
        contentBrowserWidget.onDidOpenFile((filePath) => {
          documentService.open(filePath).catch((err: unknown) => {
            const reason = err instanceof Error ? (err.cause instanceof Error ? err.cause.message : err.message) : String(err);
            consoleService.log('error', `Failed to open ${filePath}: ${reason}`);
          });
        });
        contentBrowserWidget.onDidSelectAsset((filePath) => {
          if (filePath.endsWith('.meta')) return;
          const rel = toProjectRelative(filePath, project.path);
          if (rel === undefined) return;
          const entry = catalog.getByPath(rel);
          if (!entry) return;
          selection.select([assetRef(entry.uuid)]);
        });
        contentBrowserWidget.onDidDropTreeNodes(({ nodeIds, targetDirPath }) => {
          void createPrefabsFromHierarchyDrop(nodeIds, targetDirPath);
        });
        return contentBrowserWidget;
      }),
    );
  },
};
