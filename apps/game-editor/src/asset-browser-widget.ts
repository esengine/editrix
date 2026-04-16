import { BaseWidget, createIconElement } from '@editrix/view-dom';
import type { ProjectFileNode } from './project-data.js';
import {
  buildBreadcrumbs,
  fileTypeToIcon,
  getFolderContents,
  PROJECT_FILES,
} from './project-data.js';

/**
 * Asset Browser panel — breadcrumb bar + grid view.
 *
 * Sidebar is handled by the separate ContentSidebarWidget.
 */
export class AssetBrowserWidget extends BaseWidget {
  private _currentFolderId = 'assets';
  private _filterText = '';
  private _gridEl: HTMLElement | undefined;
  private _breadcrumbEl: HTMLElement | undefined;
  private _searchInput: HTMLInputElement | undefined;
  private _selectedCardId: string | undefined;

  constructor(id: string) {
    super(id, 'asset-browser');
  }

  /** Navigate to a folder and re-render. */
  navigateTo(folderId: string): void {
    this._currentFolderId = folderId;
    this._filterText = '';
    this._selectedCardId = undefined;
    if (this._searchInput) this._searchInput.value = '';
    this._renderBreadcrumbs();
    this._renderGrid();
  }

  protected buildContent(root: HTMLElement): void {
    this._injectStyles();

    // Top breadcrumb bar
    const topBar = this.appendElement(root, 'div', 'editrix-ab-topbar');
    this._breadcrumbEl = this.appendElement(topBar, 'div', 'editrix-ab-breadcrumb');

    const searchWrap = this.appendElement(topBar, 'div', 'editrix-ab-search-wrap');
    this._searchInput = this.appendElement(searchWrap, 'input', 'editrix-ab-search-input');
    this._searchInput.type = 'text';
    this._searchInput.placeholder = 'Search...';
    this._searchInput.addEventListener('input', () => {
      this._filterText = this._searchInput!.value.toLowerCase();
      this._renderGrid();
    });
    const searchIcon = this.appendElement(searchWrap, 'span', 'editrix-ab-search-icon');
    searchIcon.appendChild(createIconElement('search', 14));

    // Grid area
    this._gridEl = this.appendElement(root, 'div', 'editrix-ab-grid');

    this._renderBreadcrumbs();
    this._renderGrid();
  }

  private _renderBreadcrumbs(): void {
    const el = this._breadcrumbEl;
    if (!el) return;
    el.innerHTML = '';

    const rootCrumb = document.createElement('span');
    rootCrumb.className = 'editrix-ab-crumb';
    rootCrumb.textContent = 'project';
    rootCrumb.addEventListener('click', () => { this.navigateTo('root'); });
    el.appendChild(rootCrumb);

    const segments = buildBreadcrumbs(PROJECT_FILES, this._currentFolderId);
    for (const seg of segments) {
      const sep = document.createElement('span');
      sep.className = 'editrix-ab-crumb-sep';
      sep.textContent = '/';
      el.appendChild(sep);

      const crumb = document.createElement('span');
      crumb.className = 'editrix-ab-crumb';
      crumb.textContent = seg.label;
      crumb.addEventListener('click', () => { this.navigateTo(seg.id); });
      el.appendChild(crumb);
    }
  }

  private _renderGrid(): void {
    const el = this._gridEl;
    if (!el) return;
    el.innerHTML = '';

    let items: readonly ProjectFileNode[] = getFolderContents(
      PROJECT_FILES,
      this._currentFolderId,
    );

    if (this._filterText) {
      items = items.filter((n) => n.name.toLowerCase().includes(this._filterText));
    }

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'editrix-ab-empty';
      empty.textContent = this._filterText ? 'No matching items' : 'Empty folder';
      el.appendChild(empty);
      return;
    }

    for (const item of items) {
      const card = document.createElement('div');
      card.className = 'editrix-ab-card';
      card.dataset['id'] = item.id;

      const iconWrap = document.createElement('div');
      iconWrap.className = 'editrix-ab-card-icon';
      iconWrap.appendChild(createIconElement(fileTypeToIcon(item), 32));
      card.appendChild(iconWrap);

      const label = document.createElement('div');
      label.className = 'editrix-ab-card-label';
      label.textContent = item.name;
      label.title = item.name;
      card.appendChild(label);

      card.addEventListener('click', () => { this._selectCard(item.id); });

      if (item.type === 'folder') {
        card.addEventListener('dblclick', () => { this.navigateTo(item.id); });
      }

      el.appendChild(card);
    }
  }

  private _selectCard(id: string): void {
    if (!this._gridEl) return;
    const prev = this._gridEl.querySelector('.editrix-ab-card--selected');
    if (prev) prev.classList.remove('editrix-ab-card--selected');
    this._selectedCardId = id;
    const card = this._gridEl.querySelector(`[data-id="${id}"]`);
    if (card) card.classList.add('editrix-ab-card--selected');
  }

  private _injectStyles(): void {
    const styleId = 'editrix-asset-browser-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
.editrix-widget-asset-browser {
  background: var(--editrix-background);
}

/* ── Top bar: breadcrumb + search ── */
.editrix-ab-topbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  background: var(--editrix-surface);
  border-bottom: 1px solid var(--editrix-border);
  flex-shrink: 0;
  min-height: 30px;
}

.editrix-ab-breadcrumb {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 1;
  overflow: hidden;
  font-size: 12px;
}

.editrix-ab-crumb {
  color: var(--editrix-text-dim);
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 3px;
  white-space: nowrap;
}
.editrix-ab-crumb:hover {
  color: var(--editrix-text);
  background: rgba(255, 255, 255, 0.06);
}
.editrix-ab-crumb:last-child {
  color: var(--editrix-text);
  font-weight: 600;
}

.editrix-ab-crumb-sep {
  color: var(--editrix-text-dim);
  opacity: 0.4;
  flex-shrink: 0;
  padding: 0 2px;
  font-size: 12px;
}

/* ── Search input (flat #414141, no border) ── */
.editrix-ab-search-wrap {
  position: relative;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  width: 160px;
}

.editrix-ab-search-input {
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
.editrix-ab-search-input::placeholder {
  color: var(--editrix-text-dim);
}
.editrix-ab-search-input:focus {
  box-shadow: 0 0 0 1px var(--editrix-accent);
}

.editrix-ab-search-icon {
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
.editrix-ab-grid {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
  gap: 6px;
  align-content: start;
}

.editrix-ab-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 4px 6px;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 0.06s;
}
.editrix-ab-card:hover {
  background: rgba(255, 255, 255, 0.04);
}
.editrix-ab-card--selected {
  border-color: var(--editrix-accent);
  background: rgba(74, 143, 255, 0.1);
}

.editrix-ab-card-icon {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--editrix-text-dim);
  margin-bottom: 4px;
}

.editrix-ab-card-label {
  font-size: 11px;
  color: var(--editrix-text);
  text-align: center;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.editrix-ab-empty {
  padding: 24px;
  text-align: center;
  color: var(--editrix-text-dim);
  font-size: 12px;
  grid-column: 1 / -1;
}
`;
    document.head.appendChild(style);
  }

  dispose(): void {
    super.dispose();
  }
}
