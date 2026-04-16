import type { Command, ICommandRegistry } from '@editrix/commands';
import type { IDisposable } from '@editrix/common';
import { DisposableStore, toDisposable } from '@editrix/common';
import { createElement } from './dom-utils.js';

/**
 * DOM-based command palette overlay.
 *
 * Opens as a centered modal with a search input. Filters commands by title
 * as the user types. Enter executes the selected command.
 *
 * @example
 * ```ts
 * const palette = new CommandPalette(commandRegistry);
 * palette.mount(document.body);
 * palette.open();
 * ```
 */
export class CommandPalette implements IDisposable {
  private readonly _commandRegistry: ICommandRegistry;
  private readonly _subscriptions = new DisposableStore();
  private _overlay: HTMLElement | undefined;
  private _input: HTMLInputElement | undefined;
  private _list: HTMLElement | undefined;
  private _isOpen = false;
  private _selectedIndex = 0;
  private _filteredCommands: Command[] = [];

  constructor(commandRegistry: ICommandRegistry) {
    this._commandRegistry = commandRegistry;
  }

  /**
   * Mount the palette into a container (typically document.body).
   * The palette is hidden until {@link open} is called.
   */
  mount(container: HTMLElement): void {
    this._overlay = createElement('div', 'editrix-palette-overlay');
    this._overlay.style.display = 'none';

    const dialog = createElement('div', 'editrix-palette-dialog');

    this._input = createElement('input', 'editrix-palette-input');
    this._input.type = 'text';
    this._input.placeholder = 'Type a command...';
    dialog.appendChild(this._input);

    this._list = createElement('div', 'editrix-palette-list');
    dialog.appendChild(this._list);

    this._overlay.appendChild(dialog);
    container.appendChild(this._overlay);

    // Event handlers
    this._subscriptions.add(toDisposable(() => {
      this._overlay?.remove();
    }));

    this._input.addEventListener('input', () => {
      this._filter();
    });

    this._input.addEventListener('keydown', (e) => {
      this._handleKeydown(e);
    });

    this._overlay.addEventListener('click', (e) => {
      if (e.target === this._overlay) {
        this.close();
      }
    });
  }

  /** Open the command palette. */
  open(): void {
    if (!this._overlay || !this._input) return;
    this._isOpen = true;
    this._overlay.style.display = '';
    this._input.value = '';
    this._selectedIndex = 0;
    this._filter();
    this._input.focus();
  }

  /** Close the command palette. */
  close(): void {
    if (!this._overlay) return;
    this._isOpen = false;
    this._overlay.style.display = 'none';
  }

  /** Whether the palette is currently open. */
  get isOpen(): boolean {
    return this._isOpen;
  }

  dispose(): void {
    this._subscriptions.dispose();
  }

  private _filter(): void {
    if (!this._input || !this._list) return;

    const query = this._input.value.toLowerCase();
    const all = this._commandRegistry.getAll();

    this._filteredCommands = query === ''
      ? [...all]
      : all.filter((cmd) => {
          const searchText = `${cmd.category ?? ''} ${cmd.title}`.toLowerCase();
          return searchText.includes(query);
        });

    this._selectedIndex = Math.min(this._selectedIndex, Math.max(0, this._filteredCommands.length - 1));
    this._renderList();
  }

  private _renderList(): void {
    if (!this._list) return;

    this._list.innerHTML = '';

    if (this._filteredCommands.length === 0) {
      const empty = createElement('div', 'editrix-palette-empty');
      empty.textContent = 'No commands found';
      this._list.appendChild(empty);
      return;
    }

    for (let i = 0; i < this._filteredCommands.length; i++) {
      const cmd = this._filteredCommands[i];
      if (!cmd) continue;
      const item = createElement('div', 'editrix-palette-item');
      if (i === this._selectedIndex) {
        item.classList.add('editrix-palette-item--selected');
      }

      if (cmd.category) {
        const cat = createElement('span', 'editrix-palette-category');
        cat.textContent = cmd.category + ': ';
        item.appendChild(cat);
      }

      const title = createElement('span', 'editrix-palette-title');
      title.textContent = cmd.title;
      item.appendChild(title);

      item.addEventListener('click', () => {
        void this._execute(cmd.id);
      });

      this._list.appendChild(item);
    }
  }

  private _handleKeydown(e: KeyboardEvent): void {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this._selectedIndex = Math.min(this._selectedIndex + 1, this._filteredCommands.length - 1);
        this._renderList();
        break;

      case 'ArrowUp':
        e.preventDefault();
        this._selectedIndex = Math.max(this._selectedIndex - 1, 0);
        this._renderList();
        break;

      case 'Enter': {
        e.preventDefault();
        const cmd = this._filteredCommands[this._selectedIndex];
        if (cmd) {
          void this._execute(cmd.id);
        }
        break;
      }

      case 'Escape':
        this.close();
        break;
    }
  }

  private async _execute(commandId: string): Promise<void> {
    this.close();
    await this._commandRegistry.execute(commandId);
  }
}
