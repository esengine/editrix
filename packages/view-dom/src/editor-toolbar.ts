import type { IDisposable } from '@editrix/common';
import { toDisposable } from '@editrix/common';
import { createElement } from './dom-utils.js';
import { createIconElement, getIcon } from './icons.js';

/** A toolbar button descriptor. */
export interface EditorToolbarItem {
  readonly id: string;
  readonly icon: string;
  readonly tooltip: string;
  readonly group?: 'left' | 'center' | 'right';
  readonly toggled?: boolean;
  /** Render the button as disabled — greyed out, pointer ignored. */
  readonly disabled?: boolean;
  readonly onClick: () => void;
}

/**
 * Editor-level toolbar below the menu bar.
 * Supports left/center/right grouped items, like tool buttons and play controls.
 */
export class EditorToolbar implements IDisposable {
  private readonly _items: EditorToolbarItem[] = [];
  private _container: HTMLElement | undefined;

  mount(container: HTMLElement): void {
    this._container = container;
    this._container.className = 'editrix-editor-toolbar';
    this._render();
  }

  addItem(item: EditorToolbarItem): IDisposable {
    this._items.push(item);
    this._render();
    return toDisposable(() => {
      const idx = this._items.indexOf(item);
      if (idx !== -1) this._items.splice(idx, 1);
      this._render();
    });
  }

  setToggled(itemId: string, toggled: boolean): void {
    this._patch(itemId, { toggled });
  }

  setDisabled(itemId: string, disabled: boolean): void {
    this._patch(itemId, { disabled });
  }

  setTooltip(itemId: string, tooltip: string): void {
    this._patch(itemId, { tooltip });
  }

  private _patch(itemId: string, patch: Partial<EditorToolbarItem>): void {
    const idx = this._items.findIndex((i) => i.id === itemId);
    if (idx === -1) return;
    const current = this._items[idx];
    if (!current) return;
    this._items[idx] = { ...current, ...patch };
    this._render();
  }

  dispose(): void {
    if (this._container) this._container.innerHTML = '';
  }

  private _render(): void {
    if (!this._container) return;
    this._container.innerHTML = '';

    // Auto-hide toolbar when no items
    if (this._items.length === 0) {
      this._container.style.display = 'none';
      return;
    }
    this._container.style.display = '';

    const leftSection = createElement(
      'div',
      'editrix-editor-toolbar-section editrix-editor-toolbar-left',
    );
    const centerSection = createElement(
      'div',
      'editrix-editor-toolbar-section editrix-editor-toolbar-center',
    );
    const rightSection = createElement(
      'div',
      'editrix-editor-toolbar-section editrix-editor-toolbar-right',
    );

    for (const item of this._items) {
      const btn = createElement('button', 'editrix-editor-toolbar-btn');
      btn.title = item.tooltip;

      if (getIcon(item.icon)) {
        btn.appendChild(createIconElement(item.icon, 16));
      } else {
        btn.textContent = item.icon;
      }

      if (item.toggled) btn.classList.add('editrix-editor-toolbar-btn--toggled');
      if (item.disabled === true) btn.disabled = true;

      btn.addEventListener('click', () => {
        if (item.disabled === true) return;
        item.onClick();
      });

      const group = item.group ?? 'left';
      if (group === 'center') centerSection.appendChild(btn);
      else if (group === 'right') rightSection.appendChild(btn);
      else leftSection.appendChild(btn);
    }

    this._container.appendChild(leftSection);
    this._container.appendChild(centerSection);
    this._container.appendChild(rightSection);
  }
}
