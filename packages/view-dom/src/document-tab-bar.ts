import type { Event, IDisposable } from '@editrix/common';
import { Emitter } from '@editrix/common';
import { createElement } from './dom-utils.js';
import { createIconElement, getIcon } from './icons.js';

/**
 * A document entry rendered as a tab.
 *
 * Generic over the document model — this widget knows nothing about file paths
 * or scenes. The app passes whatever id makes sense (we recommend the absolute
 * file path) and supplies a display name.
 */
export interface DocumentTabItem {
  /** Stable identifier (used for selection, close, and tab uniqueness). */
  readonly id: string;
  /** Display name shown on the tab. */
  readonly label: string;
  /** Optional icon name from the icon registry. */
  readonly icon?: string;
  /** Whether the document has unsaved changes — renders a dot before the label. */
  readonly dirty?: boolean;
}

/**
 * Top-of-editor tab bar showing one tab per open document.
 *
 * This widget is a pure-DOM "dumb" component:
 *   - The app supplies the items via {@link setItems}.
 *   - Active tab is set via {@link setActive}.
 *   - User actions fire events; the app does the work
 *     (open file, save-confirm on close, etc).
 *
 * Visual conventions:
 *   - Active tab uses a brighter background and a thin top accent line.
 *   - Dirty marker is a 6px filled circle BEFORE the label (Mac/VS Code style).
 *   - Close button (×) appears on hover or when active.
 *   - "+" trailing button opens whatever the app wires onAdd to.
 */
export class DocumentTabBar implements IDisposable {
  private _container: HTMLElement | undefined;
  private _items: readonly DocumentTabItem[] = [];
  private _activeId: string | undefined;

  private readonly _onDidSelect = new Emitter<string>();
  private readonly _onDidRequestClose = new Emitter<string>();
  private readonly _onDidRequestAdd = new Emitter<void>();

  readonly onDidSelect: Event<string> = this._onDidSelect.event;
  readonly onDidRequestClose: Event<string> = this._onDidRequestClose.event;
  readonly onDidRequestAdd: Event<void> = this._onDidRequestAdd.event;

  mount(container: HTMLElement): void {
    this._container = container;
    this._container.className = 'editrix-doctabs';
    this._injectStyles();
    this._render();
    this._applyVisibility();
  }

  setItems(items: readonly DocumentTabItem[]): void {
    this._items = items;
    this._render();
    this._applyVisibility();
  }

  private _applyVisibility(): void {
    if (!this._container) return;
    // Hide the whole bar when there's nothing to show — saves vertical
    // space in a fresh project where no document is open.
    this._container.style.display = this._items.length === 0 ? 'none' : '';
  }

  setActive(id: string | undefined): void {
    this._activeId = id;
    this._render();
  }

  dispose(): void {
    if (this._container) this._container.innerHTML = '';
    this._onDidSelect.dispose();
    this._onDidRequestClose.dispose();
    this._onDidRequestAdd.dispose();
  }

  private _render(): void {
    if (!this._container) return;
    this._container.innerHTML = '';

    // Tab strip
    const strip = createElement('div', 'editrix-doctabs-strip');
    for (const item of this._items) {
      strip.appendChild(this._renderTab(item));
    }

    // Trailing "+" button
    const addBtn = createElement('button', 'editrix-doctabs-add');
    addBtn.title = 'Open file';
    addBtn.setAttribute('aria-label', 'Open file');
    if (getIcon('plus')) {
      addBtn.appendChild(createIconElement('plus', 14));
    } else {
      addBtn.textContent = '+';
    }
    addBtn.addEventListener('click', () => {
      this._onDidRequestAdd.fire();
    });
    strip.appendChild(addBtn);

    this._container.appendChild(strip);
  }

  private _renderTab(item: DocumentTabItem): HTMLElement {
    const tab = createElement('div', 'editrix-doctab');
    if (item.id === this._activeId) tab.classList.add('editrix-doctab--active');
    if (item.dirty) tab.classList.add('editrix-doctab--dirty');
    tab.dataset['id'] = item.id;
    tab.title = item.label;

    // Dirty dot — present in DOM either way so layout doesn't shift on
    // dirty toggle (CSS controls visibility).
    const dot = createElement('span', 'editrix-doctab-dot');
    tab.appendChild(dot);

    // Icon
    if (item.icon !== undefined && getIcon(item.icon)) {
      tab.appendChild(createIconElement(item.icon, 14));
    }

    // Label
    const label = createElement('span', 'editrix-doctab-label');
    label.textContent = item.label;
    tab.appendChild(label);

    // Close button
    const close = createElement('button', 'editrix-doctab-close');
    close.title = 'Close';
    close.setAttribute('aria-label', 'Close');
    if (getIcon('x')) {
      close.appendChild(createIconElement('x', 12));
    } else {
      close.textContent = '×';
    }
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      this._onDidRequestClose.fire(item.id);
    });
    tab.appendChild(close);

    tab.addEventListener('click', () => {
      this._onDidSelect.fire(item.id);
    });
    // Middle-click closes — common convention from web browsers.
    tab.addEventListener('auxclick', (e) => {
      if ((e as MouseEvent).button === 1) {
        e.preventDefault();
        this._onDidRequestClose.fire(item.id);
      }
    });

    return tab;
  }

  private _injectStyles(): void {
    const styleId = 'editrix-doctabs-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
.editrix-doctabs {
  display: flex;
  align-items: stretch;
  background: var(--editrix-bg-deep, #1c1c20);
  border-bottom: 1px solid var(--editrix-border, #303034);
  height: 30px;
  flex-shrink: 0;
}
.editrix-doctabs-strip {
  display: flex;
  align-items: stretch;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
  flex: 1;
}
.editrix-doctabs-strip::-webkit-scrollbar { height: 0; }

.editrix-doctab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px 0 10px;
  height: 100%;
  cursor: pointer;
  color: var(--editrix-text-dim, #8a8a90);
  border-right: 1px solid var(--editrix-border, #303034);
  font-size: 12px;
  user-select: none;
  position: relative;
  min-width: 100px;
  max-width: 240px;
}
.editrix-doctab:hover {
  color: var(--editrix-text, #d4d4d8);
  background: var(--editrix-bg-hover, rgba(255,255,255,0.03));
}
.editrix-doctab--active {
  color: var(--editrix-text, #ececf0);
  background: var(--editrix-bg-panel, #25252a);
  box-shadow: inset 0 2px 0 0 var(--editrix-accent, #4a8fff);
}

.editrix-doctab-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0;
  flex-shrink: 0;
  transition: opacity 0.1s;
}
.editrix-doctab--dirty .editrix-doctab-dot { opacity: 1; }

.editrix-doctab-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.editrix-doctab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  border-radius: 3px;
  padding: 0;
  opacity: 0;
  flex-shrink: 0;
}
.editrix-doctab:hover .editrix-doctab-close,
.editrix-doctab--active .editrix-doctab-close {
  opacity: 0.7;
}
.editrix-doctab-close:hover {
  opacity: 1 !important;
  background: var(--editrix-bg-hover, rgba(255,255,255,0.08));
}
/* When dirty, the close button is replaced visually by the dot — but we
   still allow click-to-close on hover. */
.editrix-doctab--dirty:not(:hover):not(.editrix-doctab--active) .editrix-doctab-close {
  display: none;
}

.editrix-doctabs-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  background: transparent;
  color: var(--editrix-text-dim, #8a8a90);
  cursor: pointer;
  font-size: 16px;
  padding: 0;
  flex-shrink: 0;
}
.editrix-doctabs-add:hover {
  color: var(--editrix-text, #d4d4d8);
  background: var(--editrix-bg-hover, rgba(255,255,255,0.04));
}
`;
    document.head.appendChild(style);
  }
}
