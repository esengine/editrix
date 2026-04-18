import type { IPlugin, IPluginContext } from '@editrix/shell';
import { IDocumentService, IViewAdapter } from '@editrix/shell';
import type { DocumentTabItem } from '@editrix/view-dom';
import { DomViewAdapter } from '@editrix/view-dom';
import { showConfirmDialog } from '../dialogs.js';
import { IProjectService } from '../services.js';

interface ElectronFileApi {
  selectFile(options?: {
    title?: string;
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
  }): Promise<string | null>;
}

function getFileApi(): ElectronFileApi | undefined {
  return (window as unknown as { electronAPI?: ElectronFileApi }).electronAPI;
}

/**
 * Bridges the framework's IDocumentService to the DOM-side DocumentTabBar.
 *
 * Responsibilities:
 *   - Mirror open documents into the tab bar (label = filename, dirty marker
 *     reflects setDirty state).
 *   - Sync tab activation to documentService.setActive when the user clicks.
 *   - Confirm-on-close when a document has unsaved changes.
 *   - Wire the "+" button to a native file picker filtered to scene files
 *     (defaults to the current project's scenes/ directory).
 *
 * Document-tab-bar visibility is owned by the widget itself (hidden when
 * there are zero items), so a fresh editor with no documents looks clean.
 */
export const DocumentTabsPlugin: IPlugin = {
  descriptor: {
    id: 'app.document-tabs',
    version: '1.0.0',
    dependencies: ['app.document-sync', 'editrix.view'],
  },
  activate(ctx: IPluginContext) {
    // Resolve the DOM view adapter directly so we can reach the chrome-level
    // document tab bar. View packages keep this generic — apps decide which
    // DOM container to populate.
    const viewAdapter = ctx.services.get(IViewAdapter);
    if (!(viewAdapter instanceof DomViewAdapter)) {
      // No tab bar available on a non-DOM backend — silently skip.
      return;
    }
    const tabBar = viewAdapter.documentTabBar;
    const documentService = ctx.services.get(IDocumentService);
    const project = ctx.services.get(IProjectService);

    /** Re-render tab items from the document service. */
    const refresh = (): void => {
      const docs = documentService.getOpenDocuments();
      const items: DocumentTabItem[] = docs.map((doc) => ({
        id: doc.filePath,
        label: doc.name,
        icon: iconForExtension(doc.extension),
        dirty: doc.dirty,
      }));
      tabBar.setItems(items);
      tabBar.setActive(documentService.activeDocument ?? undefined);
    };

    refresh();

    ctx.subscriptions.add(documentService.onDidChangeDocuments(refresh));
    ctx.subscriptions.add(documentService.onDidChangeActive(refresh));
    ctx.subscriptions.add(documentService.onDidChangeDirty(refresh));

    // User clicks a tab → activate that document.
    ctx.subscriptions.add(tabBar.onDidSelect((id) => {
      documentService.setActive(id);
    }));

    // User clicks × → confirm if dirty, then close.
    ctx.subscriptions.add(tabBar.onDidRequestClose((id) => {
      void closeWithConfirm(id);
    }));

    // User clicks + → native file picker scoped to scene files.
    ctx.subscriptions.add(tabBar.onDidRequestAdd(() => {
      void openFilePicker();
    }));

    async function closeWithConfirm(filePath: string): Promise<void> {
      const doc = documentService.getOpenDocuments().find((d) => d.filePath === filePath);
      if (!doc) return;
      if (doc.dirty) {
        const ok = await showConfirmDialog(
          `"${doc.name}" has unsaved changes. Close without saving?`,
          { okLabel: 'Discard changes', destructive: true },
        );
        if (!ok) return;
      }
      documentService.close(filePath);
    }

    async function openFilePicker(): Promise<void> {
      const api = getFileApi();
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
        // The document handler chain wraps errors with context; surface that.
        await showConfirmDialog(
          err instanceof Error ? err.message : String(err),
          { okLabel: 'OK' },
        );
      }
    }
  },
};

/** Pick a tab icon based on file extension. Falls back to generic 'file'. */
function iconForExtension(ext: string): string {
  switch (ext) {
    case '.json':
      return 'layers';
    case '.ts':
    case '.js':
      return 'file';
    case '.png':
    case '.jpg':
    case '.jpeg':
    case '.webp':
      return 'grid';
    default:
      return 'layers';
  }
}
