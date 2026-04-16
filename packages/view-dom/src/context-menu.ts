import { createElement } from './dom-utils.js';
import { createIconElement, getIcon } from './icons.js';

/**
 * A single item in a context menu.
 */
export interface ContextMenuItem {
  /** Display label. Ignored when `separator` is true. */
  readonly label: string;
  /** Icon name from the icon registry. */
  readonly icon?: string;
  /** Keyboard shortcut hint displayed on the right side. */
  readonly shortcut?: string;
  /** Whether the item is disabled (grayed out, not clickable). */
  readonly disabled?: boolean;
  /** Render as a horizontal divider instead of a clickable item. */
  readonly separator?: boolean;
  /** Render with error/danger color for destructive actions. */
  readonly destructive?: boolean;
  /** Callback when the item is selected. */
  readonly onSelect?: () => void;
}

/**
 * Options for {@link showContextMenu}.
 */
export interface ContextMenuOptions {
  /** Menu items to display. */
  readonly items: readonly ContextMenuItem[];
  /** Horizontal position (clientX). */
  readonly x: number;
  /** Vertical position (clientY). */
  readonly y: number;
}

let activeCleanup: (() => void) | undefined;

/**
 * Show a context menu at the given screen position.
 *
 * Only one context menu can be open at a time — opening a new one closes
 * the previous. The menu closes on click-outside or Escape.
 *
 * @example
 * ```ts
 * showContextMenu({
 *   x: e.clientX,
 *   y: e.clientY,
 *   items: [
 *     { label: 'Rename', shortcut: 'F2' },
 *     { separator: true, label: '' },
 *     { label: 'Delete', icon: 'x', shortcut: 'Del', destructive: true,
 *       onSelect: () => deleteEntity() },
 *   ],
 * });
 * ```
 */
export function showContextMenu(options: ContextMenuOptions): void {
  injectStyles();
  closeActiveMenu();

  const { items, x, y } = options;
  const menu = createElement('div', 'editrix-context-menu');
  menu.tabIndex = 0;

  let focusedIndex = -1;
  const selectableItems: { el: HTMLElement; item: ContextMenuItem }[] = [];

  for (const item of items) {
    if (item.separator) {
      menu.appendChild(createElement('div', 'editrix-context-sep'));
      continue;
    }

    const row = createElement('div', 'editrix-context-item');
    if (item.disabled) row.classList.add('editrix-context-item--disabled');
    if (item.destructive && !item.disabled) row.classList.add('editrix-context-item--destructive');

    // Icon slot (fixed width to align labels)
    const iconSlot = createElement('span', 'editrix-context-icon');
    if (item.icon && getIcon(item.icon)) {
      iconSlot.appendChild(createIconElement(item.icon, 14));
    }
    row.appendChild(iconSlot);

    // Label
    const label = createElement('span', 'editrix-context-label');
    label.textContent = item.label;
    row.appendChild(label);

    // Shortcut
    if (item.shortcut) {
      const shortcut = createElement('span', 'editrix-context-shortcut');
      shortcut.textContent = item.shortcut;
      row.appendChild(shortcut);
    }

    if (!item.disabled) {
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        closeActiveMenu();
        item.onSelect?.();
      });
      row.addEventListener('mouseenter', () => {
        setFocus(selectableItems.indexOf(entry));
      });
    }

    const entry = { el: row, item };
    selectableItems.push(entry);
    menu.appendChild(row);
  }

  // ── Keyboard navigation ──
  const setFocus = (index: number): void => {
    if (index < 0 || index >= selectableItems.length) return;
    // Skip disabled items
    const item = selectableItems[index];
    if (item?.item.disabled) return;
    if (focusedIndex >= 0) {
      selectableItems[focusedIndex]?.el.classList.remove('editrix-context-item--focused');
    }
    focusedIndex = index;
    item?.el.classList.add('editrix-context-item--focused');
  };

  const moveFocus = (dir: 1 | -1): void => {
    let next = focusedIndex + dir;
    let attempts = selectableItems.length;
    while (attempts-- > 0) {
      if (next < 0) next = selectableItems.length - 1;
      if (next >= selectableItems.length) next = 0;
      if (!selectableItems[next]?.item.disabled) {
        setFocus(next);
        return;
      }
      next += dir;
    }
  };

  menu.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        moveFocus(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveFocus(-1);
        break;
      case 'Enter': {
        e.preventDefault();
        const focused = selectableItems[focusedIndex];
        if (focused && !focused.item.disabled) {
          closeActiveMenu();
          focused.item.onSelect?.();
        }
        break;
      }
      case 'Escape':
        e.preventDefault();
        closeActiveMenu();
        break;
    }
  });

  // ── Position with viewport boundary check ──
  menu.style.visibility = 'hidden';
  document.body.appendChild(menu);

  const menuRect = menu.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = x + menuRect.width > vw ? vw - menuRect.width - 4 : x;
  const top = y + menuRect.height > vh ? vh - menuRect.height - 4 : y;
  menu.style.left = `${Math.max(0, left)}px`;
  menu.style.top = `${Math.max(0, top)}px`;
  menu.style.visibility = '';

  menu.focus();

  // ── Close on click-outside ──
  const onMouseDown = (e: MouseEvent): void => {
    if (!menu.contains(e.target as Node)) {
      closeActiveMenu();
    }
  };
  requestAnimationFrame(() => { document.addEventListener('mousedown', onMouseDown); });

  // ── Track active menu for cleanup ──
  activeCleanup = () => {
    document.removeEventListener('mousedown', onMouseDown);
    menu.remove();
    activeCleanup = undefined;
  };
}

function closeActiveMenu(): void {
  activeCleanup?.();
}

// ── Styles ──

let stylesInjected = false;

function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;

  const style = document.createElement('style');
  style.id = 'editrix-context-menu-styles';
  style.textContent = `
    .editrix-context-menu {
      position: fixed;
      z-index: 9500;
      min-width: 200px;
      background: var(--editrix-surface);
      border: 1px solid var(--editrix-border);
      border-radius: 6px;
      padding: 4px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
      outline: none;
    }
    .editrix-context-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      border-radius: 4px;
      font-size: 12px;
      cursor: pointer;
      color: var(--editrix-text);
      user-select: none;
    }
    .editrix-context-item:hover:not(.editrix-context-item--disabled) {
      background: var(--editrix-accent);
      color: var(--editrix-accent-text);
    }
    .editrix-context-item--focused:not(.editrix-context-item--disabled) {
      background: var(--editrix-accent);
      color: var(--editrix-accent-text);
    }
    .editrix-context-item--disabled {
      opacity: 0.38;
      cursor: default;
    }
    .editrix-context-item--destructive {
      color: var(--editrix-error);
    }
    .editrix-context-item--destructive:hover,
    .editrix-context-item--destructive.editrix-context-item--focused {
      background: var(--editrix-error);
      color: var(--editrix-accent-text);
    }
    .editrix-context-icon {
      width: 16px;
      height: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .editrix-context-label {
      flex: 1;
    }
    .editrix-context-shortcut {
      color: var(--editrix-text-dim);
      font-size: 11px;
      margin-left: 16px;
      flex-shrink: 0;
    }
    .editrix-context-item:hover .editrix-context-shortcut,
    .editrix-context-item--focused .editrix-context-shortcut {
      color: inherit;
      opacity: 0.7;
    }
    .editrix-context-sep {
      height: 1px;
      background: var(--editrix-border);
      margin: 3px 6px;
    }
  `;
  document.head.appendChild(style);
}
