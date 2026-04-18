import { IFileSystemService } from '@editrix/core';
import { IConsoleService } from '@editrix/plugin-console';
import type { IPlugin, IPluginContext } from '@editrix/shell';
import { IDocumentService, ILayoutService, IViewService } from '@editrix/shell';
import { ContentBrowserWidget } from '../content-browser-widget.js';
import { ProjectFilesWidget } from '../project-files-widget.js';
import { IProjectService } from '../services.js';

/**
 * Project Files (left tree) + Content Browser (centre browser/console) panels.
 *
 * Also registers IConsoleService — the console UI lives inside the content
 * browser widget, so the service that other plugins use to log lives here too.
 * The service implementation is just a thin shim that forwards to the widget
 * if it's currently mounted; callers that log before the widget instantiates
 * are silently dropped (matches editor reality — there's no console to print
 * into yet).
 */
export const ProjectPanelsPlugin: IPlugin = {
  descriptor: {
    id: 'app.project-panels',
    version: '1.0.0',
    dependencies: ['editrix.layout', 'editrix.view', 'app.document-sync', 'app.filesystem', 'app.project'],
  },
  activate(ctx: IPluginContext) {
    const layout = ctx.services.get(ILayoutService);
    const view = ctx.services.get(IViewService);
    const documentService = ctx.services.get(IDocumentService);
    const fileSystem = ctx.services.get(IFileSystemService);
    const project = ctx.services.get(IProjectService);

    let contentBrowserWidget: ContentBrowserWidget | undefined;

    const consoleService: IConsoleService = {
      log(level, message, source) {
        contentBrowserWidget?.log(level, message, source);
      },
      clear() {
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
        // Wire double-click on scene files to open in document service
        contentBrowserWidget.onDidOpenFile((filePath) => {
          documentService.open(filePath).catch(() => {
            consoleService.log('error', `Failed to open: ${filePath}`);
          });
        });
        return contentBrowserWidget;
      }),
    );
  },
};
