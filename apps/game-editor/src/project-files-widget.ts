import type { Event } from '@editrix/common';
import { Emitter } from '@editrix/common';
import type { TreeNode } from '@editrix/view-dom';
import { BaseWidget, TreeWidget } from '@editrix/view-dom';

/** Electron filesystem API exposed via preload. */
interface FsAPI {
  readDir(dirPath: string): Promise<{ name: string; path: string; type: string; extension: string }[]>;
  watch(dirPath: string): Promise<string | null>;
  unwatch(watchId: string): Promise<void>;
  onChange(callback: (event: { kind: string; path: string }) => void): void;
}

function getFsAPI(): FsAPI | undefined {
  return (window as unknown as { electronAPI?: { fs: FsAPI } }).electronAPI?.fs;
}

function getProjectPath(): string {
  return (window as unknown as { electronAPI?: { getProjectPath(): string } }).electronAPI?.getProjectPath() ?? '';
}

/** Map file extension to icon name. */
function extToIcon(ext: string, isDir: boolean): string {
  if (isDir) return 'folder';
  switch (ext) {
    case '.json': return 'file';
    case '.ts': case '.js': return 'file';
    case '.png': case '.jpg': case '.jpeg': case '.webp': return 'grid';
    case '.gltf': case '.glb': case '.fbx': case '.obj': return 'box';
    case '.editrix-scene': return 'layers';
    default: return 'file';
  }
}

/**
 * Project Files panel — file tree reading from real filesystem.
 *
 * Reads the project directory from disk, displays as a tree.
 * Fires an event when a folder is selected so the Asset Browser can navigate.
 */
export class ProjectFilesWidget extends BaseWidget {
  private _tree: TreeWidget | undefined;
  private _projectPath = '';
  private _watchId: string | null = null;
  private readonly _onDidSelectFolder = new Emitter<string>();
  readonly onDidSelectFolder: Event<string> = this._onDidSelectFolder.event;

  constructor(id: string) {
    super(id, 'project-files');
  }

  protected buildContent(root: HTMLElement): void {
    this._injectStyles();

    this._tree = new TreeWidget(`${this.id}-tree`, {
      showFilter: true,
      filterPlaceholder: 'Search...',
    });
    this.subscriptions.add(this._tree);
    this._tree.mount(root);

    this.subscriptions.add(
      this._tree.onDidChangeSelection((ids) => {
        if (ids.length === 0) return;
        this._onDidSelectFolder.fire(ids[0]!);
      }),
    );

    // Load project files
    this._projectPath = getProjectPath();
    if (this._projectPath) {
      this._loadTree();
      this._startWatching();
    }
  }

  private async _loadTree(): Promise<void> {
    if (!this._tree || !this._projectPath) return;
    const roots = await this._readDirRecursive(this._projectPath, 0);
    this._tree.setRoots(roots);
  }

  private async _readDirRecursive(dirPath: string, depth: number): Promise<TreeNode[]> {
    const fs = getFsAPI();
    if (!fs) return [];

    const entries = await fs.readDir(dirPath);
    const nodes: TreeNode[] = [];

    for (const entry of entries) {
      const icon = extToIcon(entry.extension, entry.type === 'directory');
      const children = (entry.type === 'directory' && depth < 2)
        ? await this._readDirRecursive(entry.path, depth + 1)
        : undefined;

      nodes.push({
        id: entry.path,
        label: entry.name,
        icon,
        children: entry.type === 'directory' ? (children ?? []) : undefined,
      });
    }

    return nodes;
  }

  private async _startWatching(): Promise<void> {
    const fs = getFsAPI();
    if (!fs || !this._projectPath) return;

    this._watchId = await fs.watch(this._projectPath);
    fs.onChange(() => {
      // Debounce: reload tree on file changes
      this._loadTree();
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

  dispose(): void {
    if (this._watchId) {
      getFsAPI()?.unwatch(this._watchId);
    }
    this._onDidSelectFolder.dispose();
    super.dispose();
  }
}
