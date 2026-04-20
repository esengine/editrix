import { formatKeyForDisplay } from '@editrix/commands';
import type { Event, IDisposable } from '@editrix/common';
import { Emitter, toDisposable } from '@editrix/common';
import { createElement } from './dom-utils.js';
import { createIconElement, getIcon } from './icons.js';

/** A single menu item (action or separator). */
export interface MenuItem {
  readonly id: string;
  readonly label: string;
  readonly shortcut?: string;
  readonly separator?: boolean;
  readonly onClick?: () => void;
}

/** A top-level menu with a label and dropdown items. */
export interface MenuDescriptor {
  readonly id: string;
  readonly label: string;
  readonly items: readonly MenuItem[];
}

/** A top-level tab descriptor for the integrated tab bar. */
export interface MenuBarTab {
  readonly id: string;
  readonly label: string;
  /** Icon name from the icon registry (e.g. 'play', 'file', 'grid'). */
  readonly icon?: string;
  /** Accent color for the left indicator bar. */
  readonly color?: string;
  readonly closable?: boolean;
  /** Whether this tab can be dragged to dock elsewhere. Default: true. */
  readonly draggable?: boolean;
  /** Show a ● dot instead of × (indicates unsaved changes). */
  readonly modified?: boolean;
}

/**
 * Top-level menu bar rendered at the very top of the editor.
 *
 * Integrates menu items on the left and document tabs on the right
 * Menus on the left, document tabs in the center.
 */
export class MenuBar implements IDisposable {
  private readonly _menus: MenuDescriptor[] = [];
  private readonly _tabs: MenuBarTab[] = [];
  private _activeTabId: string | undefined;
  private _container: HTMLElement | undefined;
  private _activeMenu: string | undefined;
  private _selectedItemIndex = 0;
  private _previouslyFocused: HTMLElement | null = null;
  private _rightSection: HTMLElement | undefined;
  private _appIconName: string | undefined;

  private readonly _onDidSelectTab = new Emitter<string>();
  private readonly _onDidCloseTab = new Emitter<string>();
  private readonly _onDidRequestNewTab = new Emitter<void>();

  /** Fired when a tab is clicked. */
  readonly onDidSelectTab: Event<string> = this._onDidSelectTab.event;
  /** Fired when a tab close button is clicked. */
  readonly onDidCloseTab: Event<string> = this._onDidCloseTab.event;
  /** Fired when the "+" button is clicked. */
  readonly onDidRequestNewTab: Event<void> = this._onDidRequestNewTab.event;

  /** Set an app icon (from icon registry) shown before the menus. */
  setAppIcon(iconName: string): void {
    this._appIconName = iconName;
    this._render();
  }

  mount(container: HTMLElement): void {
    this._container = container;
    this._container.className = 'editrix-menubar';
    this._render();

    document.addEventListener('click', this._onDocClick);
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onWindowBlur);
  }

  addMenu(menu: MenuDescriptor): IDisposable {
    this._menus.push(menu);
    this._render();
    return toDisposable(() => {
      const idx = this._menus.indexOf(menu);
      if (idx !== -1) this._menus.splice(idx, 1);
      this._render();
    });
  }

  /** Add a tab to the integrated tab bar. */
  addTab(tab: MenuBarTab): IDisposable {
    this._tabs.push(tab);
    if (this._tabs.length === 1) this._activeTabId = tab.id;
    this._render();
    return toDisposable(() => {
      const idx = this._tabs.indexOf(tab);
      if (idx !== -1) this._tabs.splice(idx, 1);
      if (this._activeTabId === tab.id) {
        this._activeTabId = this._tabs[0]?.id;
      }
      this._render();
    });
  }

  /** Set the active tab by ID. */
  setActiveTab(tabId: string): void {
    this._activeTabId = tabId;
    this._render();
  }

  dispose(): void {
    document.removeEventListener('click', this._onDocClick);
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onWindowBlur);
    document.body.removeAttribute('data-alt-down');
    this._onDidSelectTab.dispose();
    this._onDidCloseTab.dispose();
    this._onDidRequestNewTab.dispose();
    if (this._container) this._container.innerHTML = '';
  }

  private readonly _onDocClick = (): void => {
    if (this._activeMenu) {
      this._closeMenu();
    }
  };

  private readonly _onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Alt') document.body.dataset['altDown'] = 'true';

    // Alt+mnemonic opens a top-level menu from anywhere. Browsers use
    // Alt+shift for their own menu UI so only respond to plain Alt.
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key.length === 1) {
      const menu = this._findMenuByMnemonic(e.key);
      if (menu) {
        e.preventDefault();
        this._openMenu(menu.id);
        return;
      }
    }

    if (this._activeMenu === undefined) return;

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        this._closeMenu();
        break;
      case 'ArrowDown':
        e.preventDefault();
        this._moveSelection(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        this._moveSelection(-1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        this._cycleMenu(1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        this._cycleMenu(-1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        this._activateSelected();
        break;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
          // Mnemonic-in-dropdown: plain letter jumps to and triggers
          // the matching item without requiring Alt.
          const activated = this._activateItemByMnemonic(e.key);
          if (activated) e.preventDefault();
        }
    }
  };

  private readonly _onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === 'Alt') delete document.body.dataset['altDown'];
  };

  private readonly _onWindowBlur = (): void => {
    delete document.body.dataset['altDown'];
  };

  private _openMenu(menuId: string): void {
    if (this._activeMenu !== menuId) {
      this._previouslyFocused =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    this._activeMenu = menuId;
    this._selectedItemIndex = this._firstActivatableIndex(menuId) ?? 0;
    this._render();
  }

  private _closeMenu(): void {
    if (this._activeMenu === undefined) return;
    this._activeMenu = undefined;
    const toRestore = this._previouslyFocused;
    this._previouslyFocused = null;
    this._render();
    if (toRestore && document.contains(toRestore)) {
      try {
        toRestore.focus();
      } catch {
        /* element may no longer be focusable */
      }
    }
  }

  private _moveSelection(delta: number): void {
    const menu = this._menus.find((m) => m.id === this._activeMenu);
    if (!menu) return;
    const count = menu.items.length;
    if (count === 0) return;
    let i = this._selectedItemIndex;
    for (let step = 0; step < count; step++) {
      i = (i + delta + count) % count;
      if (menu.items[i]?.separator !== true) {
        this._selectedItemIndex = i;
        this._render();
        return;
      }
    }
  }

  private _cycleMenu(delta: number): void {
    if (this._menus.length === 0) return;
    const currentIdx = this._menus.findIndex((m) => m.id === this._activeMenu);
    const nextIdx = (currentIdx + delta + this._menus.length) % this._menus.length;
    const next = this._menus[nextIdx];
    if (next) this._openMenu(next.id);
  }

  private _activateSelected(): void {
    const menu = this._menus.find((m) => m.id === this._activeMenu);
    const item = menu?.items[this._selectedItemIndex];
    if (!item || item.separator === true) return;
    this._closeMenu();
    item.onClick?.();
  }

  private _activateItemByMnemonic(key: string): boolean {
    const menu = this._menus.find((m) => m.id === this._activeMenu);
    if (!menu) return false;
    const lower = key.toLowerCase();
    const idx = menu.items.findIndex((item) => {
      if (item.separator === true) return false;
      return mnemonicOf(item.label)?.toLowerCase() === lower;
    });
    if (idx === -1) return false;
    this._selectedItemIndex = idx;
    this._activateSelected();
    return true;
  }

  private _firstActivatableIndex(menuId: string): number | undefined {
    const menu = this._menus.find((m) => m.id === menuId);
    if (!menu) return undefined;
    for (let i = 0; i < menu.items.length; i++) {
      if (menu.items[i]?.separator !== true) return i;
    }
    return undefined;
  }

  private _findMenuByMnemonic(key: string): MenuDescriptor | undefined {
    const lower = key.toLowerCase();
    return this._menus.find((m) => mnemonicOf(m.label)?.toLowerCase() === lower);
  }

  private _render(): void {
    if (!this._container) return;

    // Detach rightSection before clearing so external content survives re-renders
    if (this._rightSection?.parentNode) {
      this._rightSection.remove();
    }
    this._container.innerHTML = '';

    // App icon
    if (this._appIconName && getIcon(this._appIconName)) {
      const iconWrapper = createElement('div', 'editrix-menubar-app-icon');
      iconWrapper.appendChild(createIconElement(this._appIconName, 18));
      this._container.appendChild(iconWrapper);
    }

    // Left section: menu items
    const menuSection = createElement('div', 'editrix-menubar-menus');
    for (const menu of this._menus) {
      const trigger = createElement('div', 'editrix-menubar-item');
      const triggerLabel = createElement('span', 'editrix-menubar-item-label');
      appendMnemonicLabel(triggerLabel, menu.label);
      trigger.appendChild(triggerLabel);

      if (menu.id === this._activeMenu) {
        trigger.classList.add('editrix-menubar-item--active');

        const dropdown = createElement('div', 'editrix-menubar-dropdown');
        for (let i = 0; i < menu.items.length; i++) {
          const item = menu.items[i];
          if (!item) continue;
          if (item.separator) {
            dropdown.appendChild(createElement('div', 'editrix-menubar-separator'));
            continue;
          }
          const row = createElement('div', 'editrix-menubar-dropdown-item');
          if (i === this._selectedItemIndex) {
            row.classList.add('editrix-menubar-dropdown-item--selected');
          }
          const label = createElement('span');
          appendMnemonicLabel(label, item.label);
          row.appendChild(label);

          if (item.shortcut) {
            const shortcut = createElement('span', 'editrix-menubar-shortcut');
            shortcut.textContent = formatKeyForDisplay(item.shortcut);
            row.appendChild(shortcut);
          }

          row.addEventListener('mouseenter', () => {
            if (this._selectedItemIndex !== i) {
              this._selectedItemIndex = i;
              this._render();
            }
          });
          row.addEventListener('click', (e) => {
            e.stopPropagation();
            this._closeMenu();
            item.onClick?.();
          });
          dropdown.appendChild(row);
        }
        trigger.appendChild(dropdown);
      }

      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this._activeMenu === menu.id) {
          this._closeMenu();
        } else {
          this._openMenu(menu.id);
        }
      });

      trigger.addEventListener('mouseenter', () => {
        if (this._activeMenu && this._activeMenu !== menu.id) {
          this._openMenu(menu.id);
        }
      });

      menuSection.appendChild(trigger);
    }
    this._container.appendChild(menuSection);

    // Center section: integrated document tabs (always rendered as spacer)
    {
      const tabSection = createElement('div', 'editrix-menubar-tabs');

      for (const tab of this._tabs) {
        const tabEl = createElement('div', 'editrix-menubar-tab');
        const isActive = tab.id === this._activeTabId;
        if (isActive) {
          tabEl.classList.add('editrix-menubar-tab--active');
        }

        // Colored left indicator bar
        const indicator = createElement('span', 'editrix-menubar-tab-indicator');
        if (tab.color) {
          indicator.style.background = tab.color;
        }
        tabEl.appendChild(indicator);

        // SVG icon from registry
        if (tab.icon && getIcon(tab.icon)) {
          const iconEl = createIconElement(tab.icon, 14);
          iconEl.classList.add('editrix-menubar-tab-icon');
          if (tab.color) {
            iconEl.style.color = tab.color;
          }
          tabEl.appendChild(iconEl);
        }

        // Title
        const labelEl = createElement('span', 'editrix-menubar-tab-label');
        labelEl.textContent = tab.label;
        tabEl.appendChild(labelEl);

        // Modified dot or close button — always visible
        if (tab.modified) {
          const dot = createElement('span', 'editrix-menubar-tab-modified');
          dot.textContent = '\u25CF';
          tabEl.appendChild(dot);
        }
        if (tab.closable !== false) {
          const closeBtn = createElement('span', 'editrix-menubar-tab-close');
          closeBtn.textContent = '\u00d7';
          closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._onDidCloseTab.fire(tab.id);
          });
          tabEl.appendChild(closeBtn);
        }

        // Drag support — only explicitly draggable tabs can be docked
        if (tab.draggable === true) {
          tabEl.classList.add('editrix-menubar-tab--draggable');
          tabEl.draggable = true;
          tabEl.addEventListener('dragstart', (e) => {
            e.dataTransfer?.setData('text/x-editrix-panel', tab.id);
            document.querySelector('.editrix-root')?.classList.add('editrix-root--dragging');
          });
          tabEl.addEventListener('dragend', () => {
            document.querySelector('.editrix-root')?.classList.remove('editrix-root--dragging');
          });
        }

        tabEl.addEventListener('click', (e) => {
          e.stopPropagation();
          this._activeTabId = tab.id;
          this._render();
          this._onDidSelectTab.fire(tab.id);
        });

        tabSection.appendChild(tabEl);
      }

      // "+" add tab button
      const addBtn = createElement('div', 'editrix-menubar-tab-add');
      addBtn.textContent = '+';
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._onDidRequestNewTab.fire();
      });
      tabSection.appendChild(addBtn);

      this._container.appendChild(tabSection);
    }

    // Right section: reuse existing or create new
    this._rightSection ??= createElement('div', 'editrix-menubar-right');
    this._container.appendChild(this._rightSection);
  }

  /** Get the right section container to mount external controls (e.g. play buttons). */
  get rightSection(): HTMLElement | undefined {
    return this._rightSection;
  }
}

/**
 * Extract the mnemonic character from a label. `&F`ile → 'F'. Falls back
 * to the first alphanumeric character so callers that haven't opted in
 * still get sensible Alt+key behavior. A literal `&&` escapes the
 * marker and does not produce a mnemonic.
 */
function mnemonicOf(label: string): string | undefined {
  const idx = findMnemonicIndex(label);
  if (idx === -1) {
    for (const ch of label) {
      if (/[A-Za-z0-9]/.test(ch)) return ch;
    }
    return undefined;
  }
  return label[idx + 1];
}

function findMnemonicIndex(label: string): number {
  for (let i = 0; i < label.length - 1; i++) {
    if (label[i] !== '&') continue;
    if (label[i + 1] === '&') {
      i++; // skip the escaped pair
      continue;
    }
    return i;
  }
  return -1;
}

/**
 * Render `label` into `target`, underlining the mnemonic character
 * (`&F`ile → F is underlined). Unmarked labels fall back to plain text.
 */
function appendMnemonicLabel(target: HTMLElement, label: string): void {
  const idx = findMnemonicIndex(label);
  if (idx === -1) {
    // No explicit `&` — fall back to underlining the first alphanumeric
    // char so callers get Windows-style hints without opting in.
    const match = /[A-Za-z0-9]/.exec(label);
    if (!match) {
      target.textContent = label;
      return;
    }
    const at = match.index;
    if (at > 0) target.appendChild(document.createTextNode(label.slice(0, at)));
    const u = document.createElement('u');
    u.className = 'editrix-menubar-mnemonic';
    u.textContent = match[0];
    target.appendChild(u);
    if (at + 1 < label.length) {
      target.appendChild(document.createTextNode(label.slice(at + 1)));
    }
    return;
  }
  const before = label.slice(0, idx).replace(/&&/g, '&');
  const mnem = label[idx + 1] ?? '';
  const after = label.slice(idx + 2).replace(/&&/g, '&');
  if (before) target.appendChild(document.createTextNode(before));
  const u = document.createElement('u');
  u.className = 'editrix-menubar-mnemonic';
  u.textContent = mnem;
  target.appendChild(u);
  if (after) target.appendChild(document.createTextNode(after));
}
