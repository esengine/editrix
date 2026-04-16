import type { IDisposable } from '@editrix/common';
import { toDisposable } from '@editrix/common';
import { createElement } from './dom-utils.js';

/**
 * A status bar item descriptor.
 */
export interface StatusBarItem {
  /** Unique identifier. */
  readonly id: string;
  /** Text content to display. */
  readonly text: string;
  /** Alignment: left or right side of the bar. */
  readonly alignment: 'left' | 'right';
  /** Sort priority within the same alignment (higher = closer to edge). */
  readonly priority?: number;
  /** Optional click handler. */
  readonly onClick?: () => void;
}

/**
 * DOM-based status bar rendered at the bottom of the editor.
 *
 * Plugins add items to the status bar via {@link addItem}.
 *
 * @example
 * ```ts
 * const bar = new StatusBar();
 * bar.mount(document.getElementById('statusbar')!);
 * bar.addItem({ id: 'line', text: 'Ln 1, Col 1', alignment: 'left' });
 * ```
 */
export class StatusBar implements IDisposable {
  private readonly _items = new Map<string, StatusBarItem>();
  private _container: HTMLElement | undefined;
  private _leftSection: HTMLElement | undefined;
  private _rightSection: HTMLElement | undefined;

  /** Mount the status bar into a container. */
  mount(container: HTMLElement): void {
    this._container = container;
    this._container.className = 'editrix-statusbar';

    this._leftSection = createElement('div', 'editrix-statusbar-section editrix-statusbar-left');
    this._rightSection = createElement('div', 'editrix-statusbar-section editrix-statusbar-right');

    this._container.appendChild(this._leftSection);
    this._container.appendChild(this._rightSection);
  }

  /** Add or update a status bar item. Returns a disposable to remove it. */
  addItem(item: StatusBarItem): IDisposable {
    this._items.set(item.id, item);
    this._render();

    return toDisposable(() => {
      this._items.delete(item.id);
      this._render();
    });
  }

  /** Update the text of an existing item. */
  updateItem(id: string, text: string): void {
    const item = this._items.get(id);
    if (!item) return;
    this._items.set(id, { ...item, text });
    this._render();
  }

  dispose(): void {
    this._items.clear();
    if (this._container) {
      this._container.innerHTML = '';
    }
  }

  private _render(): void {
    if (!this._leftSection || !this._rightSection) return;

    this._leftSection.innerHTML = '';
    this._rightSection.innerHTML = '';

    const sorted = [...this._items.values()].sort(
      (a, b) => (a.priority ?? 0) - (b.priority ?? 0),
    );

    for (const item of sorted) {
      const el = createElement('span', 'editrix-statusbar-item');
      el.textContent = item.text;
      el.dataset['itemId'] = item.id;

      if (item.onClick) {
        el.classList.add('editrix-statusbar-item--clickable');
        el.addEventListener('click', item.onClick);
      }

      if (item.alignment === 'left') {
        this._leftSection.appendChild(el);
      } else {
        this._rightSection.appendChild(el);
      }
    }
  }
}
