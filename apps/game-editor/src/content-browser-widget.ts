import type { Event } from '@editrix/common';
import { Emitter, isMac } from '@editrix/common';
import type { FileEntry, IFileSystemService } from '@editrix/core';
import type { IWorkspaceService } from '@editrix/shell';
import type { ContextMenuItem } from '@editrix/view-dom';
import { BaseWidget, createIconElement, ListWidget, showContextMenu } from '@editrix/view-dom';
import { beginAssetDrag, endAssetDrag } from './asset-drag-session.js';

const REVEAL_LABEL = isMac() ? 'Reveal in Finder' : 'Show in Explorer';

/** MIME type used by internal editor drags — distinct from OS file drops. */
export const ASSET_PATH_MIME = 'application/x-editrix-asset-path';

/** MIME emitted by TreeWidget drags (e.g. Hierarchy → Content Browser). */
const TREE_NODE_MIME = 'text/x-editrix-tree-node';

interface ElectronRevealApi {
  revealInFinder(path: string): Promise<{ success: boolean; error?: string }>;
}

function revealApi(): ElectronRevealApi | undefined {
  return (window as unknown as { electronAPI?: ElectronRevealApi }).electronAPI;
}

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

const LEVEL_ICONS: Record<LogLevel, string> = {
  info: '\u{2139}\u{FE0F}',
  warn: '\u{26A0}',
  error: '\u{274C}',
  debug: '\u{1F41B}',
};
const LEVEL_CLASSES: Record<LogLevel, string> = {
  info: 'editrix-cb-log--info',
  warn: 'editrix-cb-log--warn',
  error: 'editrix-cb-log--error',
  debug: 'editrix-cb-log--debug',
};

/** Map file extension to icon name. */
function extToIcon(ext: string, isDir: boolean): string {
  if (isDir) return 'folder';
  switch (ext) {
    case '.esprefab':
      return 'prefab-instance'; // blue cube, matches hierarchy badge
    case '.esanim':
      return 'anim-clip'; // film strip, matches animation tab icon
    case '.json':
      return 'file';
    case '.ts':
    case '.js':
      return 'file';
    case '.png':
    case '.jpg':
    case '.jpeg':
    case '.webp':
      return 'grid';
    case '.gltf':
    case '.glb':
    case '.fbx':
    case '.obj':
      return 'box';
    case '.editrix-scene':
    case '.scene':
      return 'layers';
    default:
      return 'file';
  }
}

/**
 * Combined bottom panel: persistent icon sidebar + switchable content area.
 *
 * Content switches between Asset Browser (real filesystem grid) and Console (log list).
 * Sidebar is always visible.
 */
export class ContentBrowserWidget extends BaseWidget {
  private readonly _fileSystem: IFileSystemService;
  private readonly _project: IWorkspaceService;
  private _activeView: 'assets' | 'console' = 'assets';

  // Sidebar elements
  private _termBtn: HTMLElement | undefined;
  private _folderBtn: HTMLElement | undefined;

  // Content containers
  private _assetContainer: HTMLElement | undefined;
  private _consoleContainer: HTMLElement | undefined;

  // Asset Browser state
  private _currentDirPath = '';
  private _filterText = '';
  private _gridEl: HTMLElement | undefined;
  private _breadcrumbEl: HTMLElement | undefined;
  private _searchInput: HTMLInputElement | undefined;
  private _cachedEntries: readonly FileEntry[] = [];

  // Console state
  private _consoleList: ListWidget | undefined;
  private _entryId = 0;

  // File open event
  private readonly _onDidOpenFile = new Emitter<string>();
  readonly onDidOpenFile: Event<string> = this._onDidOpenFile.event;

  private readonly _onDidSelectAsset = new Emitter<string>();
  readonly onDidSelectAsset: Event<string> = this._onDidSelectAsset.event;

  private readonly _onDidDropTreeNodes = new Emitter<{
    nodeIds: readonly string[];
    targetDirPath: string;
  }>();
  /**
   * Fired when the user drags nodes out of the Hierarchy (or any other
   * widget that speaks `text/x-editrix-tree-node`) onto a folder card or
   * the empty area of the asset grid. `targetDirPath` is the absolute
   * path of the directory that should receive the drop.
   */
  readonly onDidDropTreeNodes: Event<{ nodeIds: readonly string[]; targetDirPath: string }> =
    this._onDidDropTreeNodes.event;

  /**
   * Optional per-asset context menu extender. Called when the user
   * right-clicks a card; the returned items get prepended to the widget's
   * default entries (currently "Reveal in Finder"). The path is the
   * absolute filesystem path of the clicked asset.
   *
   * Kept as an injected builder instead of an event so the plugin that
   * knows asset types can synthesise items without the widget needing to
   * pull in IAssetCatalogService / IPrefabService as deps.
   */
  private readonly _buildCardMenu: ((path: string) => readonly ContextMenuItem[]) | undefined;
  /**
   * Optional extender for the empty-area (grid background) context menu.
   * Invoked on right-click outside any card; the returned items are shown
   * above the widget's defaults. `targetDirPath` is the directory the user
   * is currently browsing — the place new files would land in.
   */
  private readonly _buildEmptyAreaMenu:
    | ((targetDirPath: string) => readonly ContextMenuItem[])
    | undefined;

  constructor(
    id: string,
    fileSystem: IFileSystemService,
    project: IWorkspaceService,
    options?: {
      buildCardMenu?: (path: string) => readonly ContextMenuItem[];
      buildEmptyAreaMenu?: (targetDirPath: string) => readonly ContextMenuItem[];
    },
  ) {
    super(id, 'content-browser');
    this._fileSystem = fileSystem;
    this._project = project;
    this._buildCardMenu = options?.buildCardMenu;
    this._buildEmptyAreaMenu = options?.buildEmptyAreaMenu;
  }

  /** Navigate asset browser to a real directory path. */
  navigateTo(dirPath: string): void {
    this._currentDirPath = dirPath;
    this._filterText = '';
    if (this._searchInput) this._searchInput.value = '';
    this._renderBreadcrumbs();
    void this._loadAndRenderGrid();
  }

  /**
   * Navigate to the folder containing {@link absolutePath}, switch to the
   * assets view, and highlight the target card. If the grid is still
   * loading, the selection is retried on the next animation frame so the
   * card exists by the time we try to match it.
   */
  revealAsset(absolutePath: string): void {
    const slash = absolutePath.lastIndexOf('/');
    const dir = slash >= 0 ? absolutePath.slice(0, slash) : absolutePath;
    this.showView('assets');
    this.navigateTo(dir);
    // Wait for the async grid load to finish; retry a few times before
    // giving up so a user clicking the button on first project open still
    // sees the highlight without us having to plumb the load-completion
    // event through.
    let attempts = 0;
    const trySelect = (): void => {
      if (!this._gridEl) return;
      const card = this._gridEl.querySelector(`[data-id="${CSS.escape(absolutePath)}"]`);
      if (card) {
        this._selectCard(absolutePath);
        card.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (attempts++ < 10) requestAnimationFrame(trySelect);
    };
    requestAnimationFrame(trySelect);
  }

  /** Add a log entry to the console view. */
  log(level: LogLevel, message: string, source?: string): void {
    if (!this._consoleList) return;
    const prefix = LEVEL_ICONS[level];
    const srcTag = source ? `[${source}] ` : '';
    this._consoleList.addItem({
      id: String(this._entryId++),
      text: `${srcTag}${message}`,
      icon: prefix,
      className: LEVEL_CLASSES[level],
    });
  }

  /** Clear console entries. */
  clearConsole(): void {
    this._consoleList?.clear();
  }

  /** Switch to assets or console view. */
  showView(view: 'assets' | 'console'): void {
    this._activeView = view;
    this._updateView();
  }

  protected override buildContent(root: HTMLElement): void {
    this._injectStyles();

    this._currentDirPath = this._project.path;

    // Refresh the visible grid when the watched filesystem reports changes
    // inside the current directory (ignoring .meta sidecars so UUID writes
    // don't cause double-renders).
    this.subscriptions.add(
      this._fileSystem.onDidChangeFile((e) => {
        if (e.path.endsWith('.meta')) return;
        if (!e.path.startsWith(this._currentDirPath)) return;
        if (this._activeView !== 'assets') return;
        void this._loadAndRenderGrid();
      }),
    );

    const outer = this.appendElement(root, 'div', 'editrix-cb-outer');

    // ── Left icon sidebar ──
    const sidebar = this.appendElement(outer, 'div', 'editrix-cb-sidebar');

    this._termBtn = this.appendElement(sidebar, 'div', 'editrix-cb-sidebar-btn');
    this._termBtn.title = 'Console';
    this._termBtn.appendChild(createIconElement('terminal', 16));
    this._termBtn.addEventListener('click', () => {
      this.showView('console');
    });

    this._folderBtn = this.appendElement(
      sidebar,
      'div',
      'editrix-cb-sidebar-btn editrix-cb-sidebar-btn--active',
    );
    this._folderBtn.title = 'Asset Browser';
    this._folderBtn.appendChild(createIconElement('folder', 16));
    this._folderBtn.addEventListener('click', () => {
      this.showView('assets');
    });

    const spacer = this.appendElement(sidebar, 'div');
    spacer.style.flex = '1';

    const grip = this.appendElement(sidebar, 'div', 'editrix-cb-sidebar-grip');
    grip.appendChild(createIconElement('grip', 10));
    grip.draggable = true;
    grip.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('text/x-editrix-panel', 'content-browser');
      document.querySelector('.editrix-root')?.classList.add('editrix-root--dragging');
    });
    grip.addEventListener('dragend', () => {
      document.querySelector('.editrix-root')?.classList.remove('editrix-root--dragging');
    });

    // ── Content area ──
    const content = this.appendElement(outer, 'div', 'editrix-cb-content');

    // Asset Browser view
    this._assetContainer = this.appendElement(content, 'div', 'editrix-cb-view');
    this._buildAssetView(this._assetContainer);

    // Console view (hidden initially)
    this._consoleContainer = this.appendElement(
      content,
      'div',
      'editrix-cb-view editrix-cb-view--hidden',
    );
    this._buildConsoleView(this._consoleContainer);
  }

  // ─── Asset Browser ──────────────────────────────────────

  private _buildAssetView(container: HTMLElement): void {
    const topBar = this.appendElement(container, 'div', 'editrix-cb-topbar');
    this._breadcrumbEl = this.appendElement(topBar, 'div', 'editrix-cb-breadcrumb');

    const searchWrap = this.appendElement(topBar, 'div', 'editrix-cb-search-wrap');
    this._searchInput = this.appendElement(searchWrap, 'input', 'editrix-cb-search-input');
    this._searchInput.type = 'text';
    this._searchInput.placeholder = 'Search...';
    const searchInput = this._searchInput;
    searchInput.addEventListener('input', () => {
      this._filterText = searchInput.value.toLowerCase();
      this._renderGridFromCache();
    });
    const searchIcon = this.appendElement(searchWrap, 'span', 'editrix-cb-search-icon');
    searchIcon.appendChild(createIconElement('search', 14));

    this._gridEl = this.appendElement(container, 'div', 'editrix-cb-grid');
    // Accept entity-drops on the empty area — the drop lands in the
    // currently-browsed directory. Cards intercept dragover with their own
    // listeners for folder-targeted drops; this handler is the fallback.
    this._gridEl.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes(TREE_NODE_MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      this._gridEl?.classList.add('editrix-cb-grid--drop-target');
    });
    this._gridEl.addEventListener('dragleave', (e) => {
      if ((e.target as HTMLElement | null) === this._gridEl) {
        this._gridEl.classList.remove('editrix-cb-grid--drop-target');
      }
    });
    this._gridEl.addEventListener('drop', (e) => {
      const raw = e.dataTransfer?.getData(TREE_NODE_MIME);
      this._gridEl?.classList.remove('editrix-cb-grid--drop-target');
      if (!raw) return;
      e.preventDefault();
      const parsed = this._parseTreeNodeIds(raw);
      if (parsed.length === 0) return;
      this._onDidDropTreeNodes.fire({ nodeIds: parsed, targetDirPath: this._currentDirPath });
    });

    // Right-click on empty grid area (not on a card) → create-new menu.
    this._gridEl.addEventListener('contextmenu', (e) => {
      const target = e.target as HTMLElement | null;
      if (!target || target !== this._gridEl) return;
      e.preventDefault();
      const extra = this._buildEmptyAreaMenu ? this._buildEmptyAreaMenu(this._currentDirPath) : [];
      if (extra.length === 0) return;
      showContextMenu({ x: e.clientX, y: e.clientY, items: extra });
    });

    this._renderBreadcrumbs();
    void this._loadAndRenderGrid();
  }

  /**
   * Convert an absolute asset path to a forward-slash path relative to
   * the project root. Used when announcing an asset drag so drop targets
   * can build `project-asset://editor/...` URLs without having to carry
   * the project service themselves. Returns empty string if the path is
   * outside the project tree — in that case the caller should skip the
   * thumbnail preview rather than constructing a bad URL.
   */
  private _toProjectRelative(absolutePath: string): string {
    const norm = absolutePath.replace(/\\/g, '/');
    const root = this._project.path.replace(/\\/g, '/');
    if (!root) return '';
    if (norm.startsWith(`${root}/`)) return norm.slice(root.length + 1);
    return '';
  }

  private _parseTreeNodeIds(raw: string): string[] {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === 'string');
    } catch {
      /* fall through */
    }
    return [];
  }

  private _renderBreadcrumbs(): void {
    const el = this._breadcrumbEl;
    if (!el) return;
    el.innerHTML = '';

    const root = this._project.path;
    if (!root || !this._currentDirPath) return;

    // "project" root crumb
    const rootCrumb = document.createElement('span');
    rootCrumb.className = 'editrix-cb-crumb';
    rootCrumb.textContent = 'project';
    rootCrumb.addEventListener('click', () => {
      this.navigateTo(root);
    });
    el.appendChild(rootCrumb);

    // Build segments from project root to currentDirPath
    const relative = this._currentDirPath
      .replace(/\\/g, '/')
      .replace(root.replace(/\\/g, '/'), '')
      .replace(/^\//, '');

    if (!relative) return;

    const parts = relative.split('/');
    let accumulated = root.replace(/\\/g, '/');
    for (const part of parts) {
      accumulated += `/${part}`;
      const segPath = accumulated;

      const sep = document.createElement('span');
      sep.className = 'editrix-cb-crumb-sep';
      sep.textContent = '/';
      el.appendChild(sep);

      const crumb = document.createElement('span');
      crumb.className = 'editrix-cb-crumb';
      crumb.textContent = part;
      crumb.addEventListener('click', () => {
        this.navigateTo(segPath);
      });
      el.appendChild(crumb);
    }
  }

  private async _loadAndRenderGrid(): Promise<void> {
    if (!this._currentDirPath) {
      this._cachedEntries = [];
      this._renderGridFromCache();
      return;
    }

    const raw = await this._fileSystem.readDir(this._currentDirPath);
    // Hide .meta sidecars — they're UUID plumbing, not user-visible content.
    this._cachedEntries = raw.filter((e) => !e.name.endsWith('.meta'));
    this._renderGridFromCache();
  }

  private _renderGridFromCache(): void {
    const el = this._gridEl;
    if (!el) return;
    el.innerHTML = '';

    let items = this._cachedEntries;
    if (this._filterText) {
      items = items.filter((n) => n.name.toLowerCase().includes(this._filterText));
    }

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'editrix-cb-empty';
      empty.textContent = this._filterText ? 'No matching items' : 'Empty folder';
      el.appendChild(empty);
      return;
    }

    for (const item of items) {
      const card = document.createElement('div');
      card.className = 'editrix-cb-card';
      card.dataset['id'] = item.path;

      if (item.type !== 'directory') {
        card.draggable = true;
        card.addEventListener('dragstart', (e) => {
          if (!e.dataTransfer) return;
          e.dataTransfer.setData(ASSET_PATH_MIME, item.path);
          e.dataTransfer.effectAllowed = 'copy';
          card.classList.add('editrix-cb-card--dragging');
          // Expose the dragged asset through the session singleton so drop
          // targets (Scene View ghost preview) can render during dragover,
          // when DataTransfer payloads are locked by the spec.
          beginAssetDrag({
            absolutePath: item.path,
            relativePath: this._toProjectRelative(item.path),
            fileName: item.name,
            extension: item.extension.toLowerCase(),
          });
        });
        card.addEventListener('dragend', () => {
          card.classList.remove('editrix-cb-card--dragging');
          endAssetDrag();
        });
      } else {
        // Folder cards accept entity drops → create prefab inside them.
        card.addEventListener('dragover', (e) => {
          if (!e.dataTransfer?.types.includes(TREE_NODE_MIME)) return;
          e.preventDefault();
          e.stopPropagation(); // claim the event before the grid fallback
          e.dataTransfer.dropEffect = 'copy';
          card.classList.add('editrix-cb-card--drop-target');
        });
        card.addEventListener('dragleave', () => {
          card.classList.remove('editrix-cb-card--drop-target');
        });
        card.addEventListener('drop', (e) => {
          card.classList.remove('editrix-cb-card--drop-target');
          const raw = e.dataTransfer?.getData(TREE_NODE_MIME);
          if (!raw) return;
          e.preventDefault();
          e.stopPropagation();
          const nodeIds = this._parseTreeNodeIds(raw);
          if (nodeIds.length === 0) return;
          this._onDidDropTreeNodes.fire({ nodeIds, targetDirPath: item.path });
        });
      }

      const iconWrap = document.createElement('div');
      iconWrap.className = 'editrix-cb-card-icon';
      iconWrap.appendChild(
        createIconElement(extToIcon(item.extension, item.type === 'directory'), 32),
      );
      card.appendChild(iconWrap);

      const label = document.createElement('div');
      label.className = 'editrix-cb-card-label';
      label.textContent = item.name;
      label.title = item.name;
      card.appendChild(label);

      card.addEventListener('click', () => {
        this._selectCard(item.path);
        if (item.type !== 'directory') this._onDidSelectAsset.fire(item.path);
      });

      if (item.type === 'directory') {
        card.addEventListener('dblclick', () => {
          this.navigateTo(item.path);
        });
      } else {
        card.addEventListener('dblclick', () => {
          this._onDidOpenFile.fire(item.path);
        });
      }

      card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this._selectCard(item.path);
        const extra = this._buildCardMenu ? this._buildCardMenu(item.path) : [];
        const items: ContextMenuItem[] =
          extra.length > 0
            ? [
                ...extra,
                { separator: true, label: '' },
                {
                  label: REVEAL_LABEL,
                  icon: 'folder',
                  onSelect: () => {
                    void revealApi()?.revealInFinder(item.path);
                  },
                },
              ]
            : [
                {
                  label: REVEAL_LABEL,
                  icon: 'folder',
                  onSelect: () => {
                    void revealApi()?.revealInFinder(item.path);
                  },
                },
              ];
        showContextMenu({ x: e.clientX, y: e.clientY, items });
      });

      el.appendChild(card);
    }
  }

  private _selectCard(id: string): void {
    if (!this._gridEl) return;
    const prev = this._gridEl.querySelector('.editrix-cb-card--selected');
    if (prev) prev.classList.remove('editrix-cb-card--selected');
    const card = this._gridEl.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (card) card.classList.add('editrix-cb-card--selected');
  }

  // ─── Console ────────────────────────────────────────────

  private _buildConsoleView(container: HTMLElement): void {
    this._consoleList = new ListWidget(`${this.id}-console`, {
      showFilter: true,
      placeholder: 'No log entries',
      autoScroll: true,
    });
    this.subscriptions.add(this._consoleList);
    this._consoleList.mount(container);
  }

  // ─── View switching ─────────────────────────────────────

  private _updateView(): void {
    const isAssets = this._activeView === 'assets';
    this._assetContainer?.classList.toggle('editrix-cb-view--hidden', !isAssets);
    this._consoleContainer?.classList.toggle('editrix-cb-view--hidden', isAssets);
    this._termBtn?.classList.toggle('editrix-cb-sidebar-btn--active', !isAssets);
    this._folderBtn?.classList.toggle('editrix-cb-sidebar-btn--active', isAssets);
  }

  // ─── Styles ─────────────────────────────────────────────

  private _injectStyles(): void {
    const styleId = 'editrix-content-browser-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
.editrix-widget-content-browser {
  background: var(--editrix-background);
}

/* ── Lock content-browser: hide tab bar + block drops ── */
.editrix-tab-group:has([data-panel-id="content-browser"]) > .editrix-tab-bar {
  display: none;
}
.editrix-tab-group:has([data-panel-id="content-browser"]) .editrix-drop-overlay {
  display: none !important;
}

/* ── Outer: sidebar + content ── */
.editrix-cb-outer {
  display: flex;
  width: 100%;
  height: 100%;
}

/* ── Sidebar ── */
.editrix-cb-sidebar {
  width: 28px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 4px 0;
  gap: 2px;
  background: var(--editrix-surface);
  border-right: 1px solid var(--editrix-border);
}

.editrix-cb-sidebar-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 3px;
  cursor: pointer;
  color: var(--editrix-text-dim);
}
.editrix-cb-sidebar-btn:hover {
  color: var(--editrix-text);
  background: rgba(255, 255, 255, 0.08);
}
.editrix-cb-sidebar-btn--active {
  color: var(--editrix-text);
  background: rgba(255, 255, 255, 0.1);
}
.editrix-cb-sidebar-btn--active::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 3px;
  right: 3px;
  height: 2px;
  background: var(--editrix-accent);
  border-radius: 1px;
}

.editrix-cb-sidebar-grip {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--editrix-text-dim);
  opacity: 0.5;
  padding: 4px 0;
  cursor: grab;
}
.editrix-cb-sidebar-grip:hover { opacity: 0.8; }
.editrix-cb-sidebar-grip:active { cursor: grabbing; }

/* ── Content area ── */
.editrix-cb-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  position: relative;
}

.editrix-cb-view {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.editrix-cb-view--hidden {
  display: none;
}

/* ── Topbar: breadcrumb + search ── */
.editrix-cb-topbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  background: var(--editrix-surface);
  border-bottom: 1px solid var(--editrix-border);
  flex-shrink: 0;
  min-height: 30px;
}

.editrix-cb-breadcrumb {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 1;
  overflow: hidden;
  font-size: 12px;
}

.editrix-cb-crumb {
  color: var(--editrix-text-dim);
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 3px;
  white-space: nowrap;
}
.editrix-cb-crumb:hover {
  color: var(--editrix-text);
  background: rgba(255, 255, 255, 0.06);
}
.editrix-cb-crumb:last-child {
  color: var(--editrix-text);
  font-weight: 600;
}

.editrix-cb-crumb-sep {
  color: var(--editrix-text-dim);
  opacity: 0.4;
  flex-shrink: 0;
  padding: 0 2px;
  font-size: 12px;
}

/* ── Search (flat #414141) ── */
.editrix-cb-search-wrap {
  position: relative;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  width: 160px;
}
.editrix-cb-search-input {
  width: 100%;
  background: #414141;
  border: none;
  color: var(--editrix-text);
  padding: 4px 28px 4px 10px;
  border-radius: 4px;
  font-family: inherit;
  font-size: 12px;
  outline: none;
}
.editrix-cb-search-input::placeholder { color: var(--editrix-text-dim); }
.editrix-cb-search-input:focus { box-shadow: 0 0 0 1px var(--editrix-accent); }
.editrix-cb-search-icon {
  position: absolute;
  right: 7px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--editrix-text-dim);
  display: flex;
  align-items: center;
  pointer-events: none;
}

/* ── Grid ── */
.editrix-cb-grid {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
  gap: 6px;
  align-content: start;
}

.editrix-cb-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 4px 6px;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 0.06s;
}
.editrix-cb-card:hover { background: rgba(255, 255, 255, 0.04); }
.editrix-cb-card--selected {
  border-color: var(--editrix-accent);
  background: rgba(74, 143, 255, 0.1);
}
.editrix-cb-card--dragging {
  opacity: 0.45;
}
.editrix-cb-card--drop-target {
  border-color: #5aa4ff;
  background: rgba(90, 164, 255, 0.18);
}
.editrix-cb-grid--drop-target {
  outline: 2px dashed rgba(90, 164, 255, 0.5);
  outline-offset: -6px;
}
.editrix-cb-card-icon {
  width: 44px; height: 44px;
  display: flex; align-items: center; justify-content: center;
  color: var(--editrix-text-dim);
  margin-bottom: 4px;
}
.editrix-cb-card-label {
  font-size: 11px;
  color: var(--editrix-text);
  text-align: center;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.editrix-cb-empty {
  padding: 24px;
  text-align: center;
  color: var(--editrix-text-dim);
  font-size: 12px;
  grid-column: 1 / -1;
}

/* ── Console list — allow text selection, no truncation ── */
.editrix-cb-view .editrix-list-container {
  user-select: text;
  cursor: text;
}
/* Override the generic list's single-line ellipsis — log messages need to
   stay readable at full length. Each row grows to fit, long text wraps. */
.editrix-cb-view .editrix-list-item {
  align-items: flex-start;
  padding: 3px 8px;
}
.editrix-cb-view .editrix-list-item-text {
  white-space: pre-wrap;
  word-break: break-word;
  overflow: visible;
  text-overflow: clip;
  line-height: 1.4;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
}
.editrix-cb-view .editrix-list-filter-input {
  background: #414141;
  border: none;
  border-radius: 4px;
}
.editrix-cb-view .editrix-list-filter-input:focus {
  box-shadow: 0 0 0 1px var(--editrix-accent);
}
.editrix-cb-log--warn { color: var(--editrix-warning); }
.editrix-cb-log--error { color: var(--editrix-error); }
.editrix-cb-log--debug { color: var(--editrix-text-dim); }
`;
    document.head.appendChild(style);
  }

  override dispose(): void {
    this._onDidOpenFile.dispose();
    this._onDidSelectAsset.dispose();
    this._onDidDropTreeNodes.dispose();
    super.dispose();
  }
}
