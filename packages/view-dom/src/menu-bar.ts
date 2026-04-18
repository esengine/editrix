import type { Event, IDisposable } from '@editrix/common';
import { Emitter, toDisposable } from '@editrix/common';
import { formatKeyForDisplay } from '@editrix/commands';
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
    this._onDidSelectTab.dispose();
    this._onDidCloseTab.dispose();
    this._onDidRequestNewTab.dispose();
    if (this._container) this._container.innerHTML = '';
  }

  private readonly _onDocClick = (): void => {
    if (this._activeMenu) {
      this._activeMenu = undefined;
      this._render();
    }
  };

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
      trigger.textContent = menu.label;

      if (menu.id === this._activeMenu) {
        trigger.classList.add('editrix-menubar-item--active');

        const dropdown = createElement('div', 'editrix-menubar-dropdown');
        for (const item of menu.items) {
          if (item.separator) {
            dropdown.appendChild(createElement('div', 'editrix-menubar-separator'));
            continue;
          }
          const row = createElement('div', 'editrix-menubar-dropdown-item');
          const label = createElement('span');
          label.textContent = item.label;
          row.appendChild(label);

          if (item.shortcut) {
            const shortcut = createElement('span', 'editrix-menubar-shortcut');
            shortcut.textContent = formatKeyForDisplay(item.shortcut);
            row.appendChild(shortcut);
          }

          row.addEventListener('click', (e) => {
            e.stopPropagation();
            this._activeMenu = undefined;
            this._render();
            item.onClick?.();
          });
          dropdown.appendChild(row);
        }
        trigger.appendChild(dropdown);
      }

      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        this._activeMenu = this._activeMenu === menu.id ? undefined : menu.id;
        this._render();
      });

      trigger.addEventListener('mouseenter', () => {
        if (this._activeMenu && this._activeMenu !== menu.id) {
          this._activeMenu = menu.id;
          this._render();
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
