import type { Event, IDisposable } from '@editrix/common';
import { Emitter, isMac } from '@editrix/common';
import type { IFileSystemService } from '@editrix/core';
import type { TreeNode } from '@editrix/view-dom';
import { BaseWidget, showContextMenu, TreeWidget } from '@editrix/view-dom';
import type { IProjectService } from './services.js';

const REVEAL_LABEL = isMac() ? 'Reveal in Finder' : 'Show in Explorer';

interface ElectronRevealApi {
  revealInFinder(path: string): Promise<{ success: boolean; error?: string }>;
}

function revealApi(): ElectronRevealApi | undefined {
  return (window as unknown as { electronAPI?: ElectronRevealApi }).electronAPI;
}

/** Map file extension to icon name. */
function extToIcon(ext: string, isDir: boolean): string {
  if (isDir) return 'folder';
  switch (ext) {
    case '.json': return 'file';
    case '.ts': case '.js': return 'file';
    case '.png': case '.jpg': case '.jpeg': case '.webp': return 'grid';
    case '.gltf': case '.glb': case '.fbx': case '.obj': return 'box';
    case '.editrix-scene': case '.scene.json': return 'layers';
    default: return 'file';
  }
}

/**
 * Project Files panel — file tree reading from real filesystem via
 * {@link IFileSystemService}. Fires an event when a folder is selected so
 * the asset browser can navigate.
 */
export class ProjectFilesWidget extends BaseWidget {
  private readonly _fileSystem: IFileSystemService;
  private readonly _project: IProjectService;
  private _tree: TreeWidget | undefined;
  private _watchHandle: IDisposable | undefined;
  private _changeSub: IDisposable | undefined;
  private readonly _onDidSelectFolder = new Emitter<string>();
  readonly onDidSelectFolder: Event<string> = this._onDidSelectFolder.event;

  constructor(id: string, fileSystem: IFileSystemService, project: IProjectService) {
    super(id, 'project-files');
    this._fileSystem = fileSystem;
    this._project = project;
  }

  protected override buildContent(root: HTMLElement): void {
    this._injectStyles();

    this._tree = new TreeWidget(`${this.id}-tree`, {
      showFilter: true,
      filterPlaceholder: 'Search...',
    });
    this.subscriptions.add(this._tree);
    this._tree.mount(root);

    this.subscriptions.add(
      this._tree.onDidChangeSelection((ids) => {
        const first = ids[0];
        if (first === undefined) return;
        this._onDidSelectFolder.fire(first);
      }),
    );

    this.subscriptions.add(
      this._tree.onDidRequestContextMenu(({ ids, x, y }) => {
        const path = ids[0];
        if (path === undefined) return;
        showContextMenu({
          x, y,
          items: [
            {
              label: REVEAL_LABEL, icon: 'folder',
              onSelect: () => { void revealApi()?.revealInFinder(path); },
            },
          ],
        });
      }),
    );

    if (this._project.isOpen) {
      void this._loadTree();
      this._startWatching();
    }
  }

  private async _loadTree(): Promise<void> {
    if (!this._tree || !this._project.isOpen) return;
    const roots = await this._readDirRecursive(this._project.path, 0);
    this._tree.setRoots(roots);
  }

  private async _readDirRecursive(dirPath: string, depth: number): Promise<TreeNode[]> {
    const entries = await this._fileSystem.readDir(dirPath);
    const nodes: TreeNode[] = [];

    for (const entry of entries) {
      if (entry.name.endsWith('.meta')) continue;
      const icon = extToIcon(entry.extension, entry.type === 'directory');
      const children = (entry.type === 'directory' && depth < 2)
        ? await this._readDirRecursive(entry.path, depth + 1)
        : undefined;

      nodes.push({
        id: entry.path,
        label: entry.name,
        icon,
        ...(entry.type === 'directory' ? { children: children ?? [] } : {}),
      });
    }

    return nodes;
  }

  private _startWatching(): void {
    if (!this._project.isOpen) return;
    this._watchHandle = this._fileSystem.watch(this._project.path);
    this._changeSub = this._fileSystem.onDidChangeFile(() => {
      // Reload tree on any change. A future iteration could patch the tree
      // in place to preserve scroll/expanded state instead of full rebuild.
      void this._loadTree();
    });
  }

  private _injectStyles(): void {
    const styleId = 'editrix-project-files-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
/* ── Search input: #414141 flat background ── */
.editrix-widget-project-files .editrix-tree-filter-input {
  background: #414141;
  border: none;
  padding: 4px 28px 4px 10px;
  border-radius: 4px;
}
.editrix-widget-project-files .editrix-tree-filter-input::placeholder {
  color: var(--editrix-text-dim);
}
.editrix-widget-project-files .editrix-tree-filter-input:focus {
  border: none;
  box-shadow: 0 0 0 1px var(--editrix-accent);
}
`;
    document.head.appendChild(style);
  }

  override dispose(): void {
    this._changeSub?.dispose();
    this._watchHandle?.dispose();
    this._onDidSelectFolder.dispose();
    super.dispose();
  }
}
