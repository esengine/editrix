import type { IDisposable } from '@editrix/common';
import { toDisposable } from '@editrix/common';
import { createElement } from '../dom-utils.js';
import { createIconElement, getIcon } from '../icons.js';

/** Describes a button in a {@link Toolbar}. */
export interface ToolbarAction {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  readonly tooltip?: string;
  readonly toggled?: boolean;
  readonly onClick: () => void;
}

/**
 * A horizontal toolbar for panel-local actions.
 *
 * @example
 * ```ts
 * const toolbar = new Toolbar(container);
 * toolbar.addAction({ id: 'clear', label: 'Clear', icon: 'trash', onClick: () => {} });
 * ```
 */
export class Toolbar implements IDisposable {
  private readonly _container: HTMLElement;
  private readonly _actions = new Map<string, { action: ToolbarAction; element: HTMLElement }>();

  constructor(container: HTMLElement) {
    this._container = container;
    this._container.className = 'editrix-toolbar';
    this._injectStyles();
  }

  addAction(action: ToolbarAction): IDisposable {
    const btn = createElement('button', 'editrix-toolbar-btn');
    btn.title = action.tooltip ?? action.label;

    if (action.icon && getIcon(action.icon)) {
      btn.appendChild(createIconElement(action.icon, 14));
    }
    if (action.label) {
      const labelSpan = createElement('span');
      labelSpan.textContent = action.label;
      btn.appendChild(labelSpan);
    }

    if (action.toggled) {
      btn.classList.add('editrix-toolbar-btn--toggled');
    }

    btn.addEventListener('click', action.onClick);
    this._container.appendChild(btn);
    this._actions.set(action.id, { action, element: btn });

    return toDisposable(() => {
      btn.remove();
      this._actions.delete(action.id);
    });
  }

  setToggled(id: string, toggled: boolean): void {
    const entry = this._actions.get(id);
    if (!entry) return;
    entry.element.classList.toggle('editrix-toolbar-btn--toggled', toggled);
  }

  dispose(): void {
    this._container.innerHTML = '';
    this._actions.clear();
  }

  private _injectStyles(): void {
    if (document.getElementById('editrix-toolbar-styles')) return;

    const style = document.createElement('style');
    style.id = 'editrix-toolbar-styles';
    style.textContent = `
      .editrix-toolbar {
        display: flex;
        align-items: center;
        gap: 3px;
        padding: 3px 6px;
        background: var(--editrix-surface);
        border-bottom: 1px solid var(--editrix-border);
        flex-shrink: 0;
        min-height: 30px;
      }
      .editrix-toolbar-btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        background: transparent;
        border: 1px solid transparent;
        color: var(--editrix-text-dim);
        font-size: 11px;
        padding: 3px 8px;
        border-radius: 3px;
        cursor: pointer;
        font-family: inherit;
        transition: all 0.12s ease;
      }
      .editrix-toolbar-btn:hover {
        color: var(--editrix-text);
        background: rgba(255, 255, 255, 0.08);
        border-color: var(--editrix-border);
      }
      .editrix-toolbar-btn:active {
        background: rgba(255, 255, 255, 0.12);
      }
      .editrix-toolbar-btn--toggled {
        color: var(--editrix-accent-text);
        background: var(--editrix-accent);
        border-color: var(--editrix-accent);
      }
      .editrix-toolbar-btn--toggled:hover {
        opacity: 0.9;
        color: var(--editrix-accent-text);
        background: var(--editrix-accent);
        border-color: var(--editrix-accent);
      }
    `;
    document.head.appendChild(style);
  }
}
