import { createElement } from './dom-utils.js';
import { createIconElement, getIcon } from './icons.js';

/**
 * A single item in a quick pick list.
 */
export interface QuickPickItem {
  /** Unique identifier returned on selection. */
  readonly id: string;
  /** Primary display text. */
  readonly label: string;
  /** Secondary description shown in dimmed text. */
  readonly description?: string;
  /** Icon name from the icon registry. */
  readonly icon?: string;
  /** Whether the item is shown but not selectable (e.g. already-added component). */
  readonly disabled?: boolean;
}

/**
 * Options for {@link showQuickPick}.
 */
export interface QuickPickOptions {
  /** Items to display in the pick list. */
  readonly items: readonly QuickPickItem[];
  /** Element to anchor the popup near. */
  readonly anchor: HTMLElement;
  /** Placeholder text for the search input. */
  readonly placeholder?: string;
  /** Callback when an item is selected. */
  readonly onSelect: (item: QuickPickItem) => void;
}

let activeCleanup: (() => void) | undefined;

/**
 * Show an anchored, searchable pick list near a DOM element.
 *
 * Only one quick pick can be open at a time. The list filters as the user
 * types. Keyboard navigation with Up/Down/Enter/Escape is supported.
 *
 * @example
 * ```ts
 * showQuickPick({
 *   items: components.map(c => ({ id: c, label: c })),
 *   anchor: addButton,
 *   placeholder: 'Search components...',
 *   onSelect: (item) => addComponent(item.id),
 * });
 * ```
 */
export function showQuickPick(options: QuickPickOptions): void {
  injectStyles();
  closeActivePopup();

  const { items, anchor, placeholder, onSelect } = options;

  const popup = createElement('div', 'editrix-quick-pick');

  // ── Search input ──
  const input = createElement('input', 'editrix-quick-pick-input');
  input.type = 'text';
  input.placeholder = placeholder ?? 'Search...';
  popup.appendChild(input);

  // ── Scrollable list ──
  const list = createElement('div', 'editrix-quick-pick-list');
  popup.appendChild(list);

  let filtered = [...items];
  let selectedIndex = findFirstEnabled(filtered, 0, 1);

  // Row DOM nodes indexed by the position in `filtered`. Kept so we can
  // update only the --selected class instead of rebuilding the list on
  // every hover — a full rebuild destroys the element the user was
  // mousing down on and the click gesture never completes.
  let rowEls: (HTMLElement | null)[] = [];

  const updateSelectedClass = (): void => {
    for (let i = 0; i < rowEls.length; i++) {
      const el = rowEls[i];
      if (!el) continue;
      el.classList.toggle('editrix-quick-pick-item--selected', i === selectedIndex);
    }
  };

  const renderList = (): void => {
    list.innerHTML = '';
    rowEls = [];

    if (filtered.length === 0) {
      const empty = createElement('div', 'editrix-quick-pick-empty');
      empty.textContent = 'No matches';
      list.appendChild(empty);
      return;
    }

    for (let i = 0; i < filtered.length; i++) {
      const item = filtered[i];
      if (!item) {
        rowEls.push(null);
        continue;
      }
      const row = createElement('div', 'editrix-quick-pick-item');

      if (item.disabled) row.classList.add('editrix-quick-pick-item--disabled');
      if (i === selectedIndex) row.classList.add('editrix-quick-pick-item--selected');

      // Icon
      if (item.icon && getIcon(item.icon)) {
        const icon = createElement('span', 'editrix-quick-pick-icon');
        icon.appendChild(createIconElement(item.icon, 14));
        row.appendChild(icon);
      }

      // Label
      const label = createElement('span', 'editrix-quick-pick-label');
      label.textContent = item.label;
      row.appendChild(label);

      // Description
      if (item.description) {
        const desc = createElement('span', 'editrix-quick-pick-desc');
        desc.textContent = item.description;
        row.appendChild(desc);
      }

      // Check mark for disabled (already added)
      if (item.disabled) {
        const check = createElement('span', 'editrix-quick-pick-check');
        check.textContent = '\u2713';
        row.appendChild(check);
      }

      if (!item.disabled) {
        // Capture the index the row belongs to now. The filtered array
        // doesn't change until the user types; using `i` in the closure
        // is stable for the life of this row instance.
        const rowIndex = i;
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          closeActivePopup();
          onSelect(item);
        });
        row.addEventListener('mouseenter', () => {
          // Only repaint the selected class — do NOT rebuild rows,
          // or an in-progress click loses its target element.
          selectedIndex = rowIndex;
          updateSelectedClass();
        });
      }

      list.appendChild(row);
      rowEls.push(row);
    }
  };

  // ── Filter on input ──
  input.addEventListener('input', () => {
    const query = input.value.toLowerCase();
    filtered = query === ''
      ? [...items]
      : items.filter((item) => {
          const text = `${item.label} ${item.description ?? ''}`.toLowerCase();
          return text.includes(query);
        });
    selectedIndex = findFirstEnabled(filtered, 0, 1);
    renderList();
  });

  // ── Keyboard navigation ──
  input.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const next = findFirstEnabled(filtered, selectedIndex + 1, 1);
        if (next !== -1) { selectedIndex = next; updateSelectedClass(); }
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const prev = findFirstEnabled(filtered, selectedIndex - 1, -1);
        if (prev !== -1) { selectedIndex = prev; updateSelectedClass(); }
        break;
      }
      case 'Enter': {
        e.preventDefault();
        const item = filtered[selectedIndex];
        if (item && !item.disabled) {
          closeActivePopup();
          onSelect(item);
        }
        break;
      }
      case 'Escape':
        e.preventDefault();
        closeActivePopup();
        break;
    }
  });

  renderList();

  // ── Position anchored to element ──
  popup.style.visibility = 'hidden';
  document.body.appendChild(popup);

  const anchorRect = anchor.getBoundingClientRect();
  const popupRect = popup.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Prefer below anchor, flip above if no room
  let top: number;
  if (anchorRect.bottom + 4 + popupRect.height <= vh) {
    top = anchorRect.bottom + 4;
  } else if (anchorRect.top - 4 - popupRect.height >= 0) {
    top = anchorRect.top - popupRect.height - 4;
  } else {
    top = Math.max(4, vh - popupRect.height - 4);
  }

  // Match anchor width or use popup's natural width, whichever is larger
  const width = Math.max(anchorRect.width, popupRect.width);
  let left = anchorRect.left;
  if (left + width > vw) left = vw - width - 4;

  popup.style.left = `${Math.max(0, left)}px`;
  popup.style.top = `${Math.max(0, top)}px`;
  popup.style.width = `${width}px`;
  popup.style.visibility = '';

  input.focus();

  // ── Close on click-outside ──
  const onMouseDown = (e: MouseEvent): void => {
    if (!popup.contains(e.target as Node)) {
      closeActivePopup();
    }
  };
  requestAnimationFrame(() => { document.addEventListener('mousedown', onMouseDown); });

  // ── Track ──
  activeCleanup = () => {
    document.removeEventListener('mousedown', onMouseDown);
    popup.remove();
    activeCleanup = undefined;
  };
}

/** Find the first non-disabled item index starting from `start` in direction `dir`. */
function findFirstEnabled(items: readonly QuickPickItem[], start: number, dir: 1 | -1): number {
  let i = start;
  let attempts = items.length;
  while (attempts-- > 0 && i >= 0 && i < items.length) {
    if (!items[i]?.disabled) return i;
    i += dir;
  }
  return -1;
}

function closeActivePopup(): void {
  activeCleanup?.();
}

// ── Styles ──

let stylesInjected = false;

function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;

  const style = document.createElement('style');
  style.id = 'editrix-quick-pick-styles';
  style.textContent = `
    .editrix-quick-pick {
      position: fixed;
      z-index: 9600;
      min-width: 220px;
      max-width: 360px;
      background: #2b2b2b;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 6px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .editrix-quick-pick-input {
      width: 100%;
      box-sizing: border-box;
      background: rgba(0, 0, 0, 0.3);
      border: none;
      border-bottom: 1px solid var(--editrix-border);
      color: var(--editrix-text);
      padding: 8px 10px;
      font-family: inherit;
      font-size: 12px;
      outline: none;
    }
    .editrix-quick-pick-input:focus {
      background: rgba(0, 0, 0, 0.4);
    }
    .editrix-quick-pick-input::placeholder {
      color: var(--editrix-text-dim);
    }
    .editrix-quick-pick-list {
      max-height: 300px;
      overflow-y: auto;
      padding: 4px;
    }
    .editrix-quick-pick-empty {
      padding: 16px;
      text-align: center;
      color: var(--editrix-text-dim);
      font-size: 12px;
    }
    .editrix-quick-pick-item {
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
    .editrix-quick-pick-item:hover:not(.editrix-quick-pick-item--disabled) {
      background: rgba(255, 255, 255, 0.06);
    }
    .editrix-quick-pick-item--selected:not(.editrix-quick-pick-item--disabled) {
      background: var(--editrix-accent);
      color: var(--editrix-accent-text);
    }
    .editrix-quick-pick-item--disabled {
      opacity: 0.38;
      cursor: default;
    }
    .editrix-quick-pick-icon {
      width: 16px;
      height: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .editrix-quick-pick-label {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .editrix-quick-pick-desc {
      color: var(--editrix-text-dim);
      font-size: 11px;
      flex-shrink: 0;
    }
    .editrix-quick-pick-item--selected .editrix-quick-pick-desc {
      color: inherit;
      opacity: 0.7;
    }
    .editrix-quick-pick-check {
      color: var(--editrix-text-dim);
      font-size: 11px;
      flex-shrink: 0;
    }
  `;
  document.head.appendChild(style);
}
