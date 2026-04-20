import { createElement } from '../dom-utils.js';
import { BaseWidget } from './base-widget.js';

/**
 * A single item in a list widget.
 */
export interface ListItem {
  /** Unique identifier. */
  readonly id: string;
  /** Primary text. */
  readonly text: string;
  /** Optional secondary text (rendered dimmer). */
  readonly detail?: string;
  /** Optional CSS class for the item row. */
  readonly className?: string;
  /** Optional icon (rendered as text prefix). */
  readonly icon?: string;
}

/**
 * A scrollable list widget. Used for panels that display lists of items
 * (Console log entries, Hierarchy nodes, asset browser, etc.).
 *
 * Supports filtering via a built-in search bar, item selection,
 * and dynamic item addition/removal.
 *
 * @example
 * ```ts
 * const list = new ListWidget('console', {
 *   showFilter: true,
 *   placeholder: 'No log entries',
 *   onItemClick: (item) => console.log('Clicked:', item.id),
 * });
 * list.addItem({ id: '1', text: 'Hello world' });
 * ```
 */
export class ListWidget extends BaseWidget {
  private readonly _items: ListItem[] = [];
  private readonly _options: ListWidgetOptions;
  private _listContainer: HTMLElement | undefined;
  private _filterInput: HTMLInputElement | undefined;
  private _emptyPlaceholder: HTMLElement | undefined;
  private _filterText = '';
  private _selectedId: string | undefined;
  private _externalFilter: ((item: ListItem) => boolean) | undefined;

  constructor(id: string, options: ListWidgetOptions = {}) {
    super(id, 'list');
    this._options = options;
  }

  /** Add an item to the end of the list. */
  addItem(item: ListItem): void {
    this._items.push(item);

    // Fast path: append single row if no filters active, avoiding full re-render
    // that would destroy text selection in existing rows.
    if (this._listContainer && !this._filterText && !this._externalFilter) {
      // Remove empty placeholder if present
      if (this._items.length === 1 && this._emptyPlaceholder?.parentNode === this._listContainer) {
        this._listContainer.removeChild(this._emptyPlaceholder);
      }
      this._listContainer.appendChild(this._buildRow(item));
    } else {
      this._renderList();
    }

    if (this._options.autoScroll !== false) {
      this._scrollToBottom();
    }
  }

  /** Remove an item by ID. */
  removeItem(id: string): void {
    const idx = this._items.findIndex((i) => i.id === id);
    if (idx !== -1) {
      this._items.splice(idx, 1);
      this._renderList();
    }
  }

  /** Clear all items. */
  clear(): void {
    this._items.length = 0;
    this._renderList();
  }

  /** Get all current items. */
  getItems(): readonly ListItem[] {
    return this._items;
  }

  /** Set the selected item by ID. */
  setSelected(id: string | undefined): void {
    this._selectedId = id;
    this._renderList();
  }

  /** Set an external filter function. Pass undefined to clear. Re-renders the list. */
  setExternalFilter(filter: ((item: ListItem) => boolean) | undefined): void {
    this._externalFilter = filter;
    this._renderList();
  }

  protected buildContent(root: HTMLElement): void {
    // Optional filter bar
    if (this._options.showFilter) {
      const filterBar = this.appendElement(root, 'div', 'editrix-list-filter');
      this._filterInput = createElement('input', 'editrix-list-filter-input');
      this._filterInput.type = 'text';
      this._filterInput.placeholder = 'Filter...';
      this._filterInput.addEventListener('input', () => {
        this._filterText = this._filterInput?.value.toLowerCase() ?? '';
        this._renderList();
      });
      filterBar.appendChild(this._filterInput);
    }

    // Scrollable list
    this._listContainer = this.appendElement(root, 'div', 'editrix-list-container');
    this._listContainer.style.flex = '1';
    this._listContainer.style.overflowY = 'auto';

    // Empty placeholder
    this._emptyPlaceholder = createElement('div', 'editrix-list-empty');
    this._emptyPlaceholder.textContent = this._options.placeholder ?? 'No items';

    this._renderList();
  }

  private _buildRow(item: ListItem): HTMLElement {
    const row = createElement('div', 'editrix-list-item');
    if (item.className) {
      row.classList.add(item.className);
    }
    if (item.id === this._selectedId) {
      row.classList.add('editrix-list-item--selected');
    }

    if (item.icon) {
      const icon = createElement('span', 'editrix-list-item-icon');
      icon.textContent = item.icon;
      row.appendChild(icon);
    }

    const text = createElement('span', 'editrix-list-item-text');
    text.textContent = item.text;
    row.appendChild(text);

    if (item.detail) {
      const detail = createElement('span', 'editrix-list-item-detail');
      detail.textContent = item.detail;
      row.appendChild(detail);
    }

    row.addEventListener('click', () => {
      // Skip selection change if user is selecting text
      const sel = window.getSelection();
      if (sel && sel.toString().length > 0) return;

      // Toggle selected class without full re-render to preserve DOM state
      if (this._selectedId !== item.id) {
        const prev = this._listContainer?.querySelector('.editrix-list-item--selected');
        prev?.classList.remove('editrix-list-item--selected');
        row.classList.add('editrix-list-item--selected');
        this._selectedId = item.id;
      }
      this._options.onItemClick?.(item);
    });

    return row;
  }

  private _renderList(): void {
    if (!this._listContainer) return;

    this._listContainer.innerHTML = '';

    let filtered = this._externalFilter ? this._items.filter(this._externalFilter) : this._items;

    if (this._filterText) {
      filtered = filtered.filter(
        (i) =>
          i.text.toLowerCase().includes(this._filterText) ||
          (i.detail?.toLowerCase().includes(this._filterText) ?? false),
      );
    }

    if (filtered.length === 0 && this._emptyPlaceholder) {
      this._listContainer.appendChild(this._emptyPlaceholder);
      return;
    }

    for (const item of filtered) {
      this._listContainer.appendChild(this._buildRow(item));
    }
  }

  private _scrollToBottom(): void {
    if (this._listContainer) {
      this._listContainer.scrollTop = this._listContainer.scrollHeight;
    }
  }
}

/**
 * Options for creating a {@link ListWidget}.
 */
export interface ListWidgetOptions {
  /** Show a filter/search input at the top. Default: false. */
  readonly showFilter?: boolean;
  /** Text shown when the list is empty. */
  readonly placeholder?: string;
  /** Auto-scroll to bottom when items are added. Default: true. */
  readonly autoScroll?: boolean;
  /** Callback when an item is clicked. */
  readonly onItemClick?: (item: ListItem) => void;
}
