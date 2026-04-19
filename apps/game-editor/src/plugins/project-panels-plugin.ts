import { IFileSystemService } from '@editrix/core';
import type { LogLevel } from '@editrix/plugin-console';
import { IConsoleService } from '@editrix/plugin-console';
import type { IPlugin, IPluginContext } from '@editrix/shell';
import { IDocumentService, ILayoutService, ISelectionService, IViewService } from '@editrix/shell';
import { ContentBrowserWidget } from '../content-browser-widget.js';
import { ProjectFilesWidget } from '../project-files-widget.js';
import { assetRef, IAssetCatalogService, IProjectService } from '../services.js';

const CONSOLE_BUFFER_MAX = 500;

function toProjectRelative(abs: string, projectPath: string): string | undefined {
  if (!projectPath) return undefined;
  const root = projectPath.endsWith('/') ? projectPath : projectPath + '/';
  if (abs === projectPath) return '';
  if (!abs.startsWith(root)) return undefined;
  return abs.slice(root.length);
}

export const ProjectPanelsPlugin: IPlugin = {
  descriptor: {
    id: 'app.project-panels',
    version: '1.0.0',
    dependencies: ['editrix.layout', 'editrix.view', 'app.document-sync', 'app.filesystem', 'app.project', 'app.asset-catalog'],
  },
  activate(ctx: IPluginContext) {
    const layout = ctx.services.get(ILayoutService);
    const view = ctx.services.get(IViewService);
    const documentService = ctx.services.get(IDocumentService);
    const fileSystem = ctx.services.get(IFileSystemService);
    const project = ctx.services.get(IProjectService);
    const selection = ctx.services.get(ISelectionService);
    const catalog = ctx.services.get(IAssetCatalogService);

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
        contentBrowserWidget = new ContentBrowserWidget(id, fileSystem, project);
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
        return contentBrowserWidget;
      }),
    );
  },
};
