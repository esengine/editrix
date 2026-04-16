import type { Event, IDisposable } from '@editrix/common';
import { DisposableStore, Emitter } from '@editrix/common';
import type { LayoutNode } from '@editrix/layout';
import type { IWidget } from '@editrix/view';
import { clearChildren, createElement } from './dom-utils.js';
import { createIconElement, getIcon } from './icons.js';

/**
 * Callback to resolve a widget for a panel ID.
 */
export type WidgetResolver = (panelId: string) => IWidget | undefined;

/**
 * Callback when a tab is clicked.
 */
export type TabClickHandler = (panelId: string) => void;

/**
 * Callback when a panel close button is clicked.
 */
export type PanelCloseHandler = (panelId: string) => void;

/**
 * Callback when the "+" button in a tab bar is clicked.
 */
export type TabAddHandler = (path: readonly number[]) => void;

/**
 * Callback to resolve a display title for a panel ID.
 */
export type TitleResolver = (panelId: string) => string;

/**
 * Callback to check if a panel can be dragged.
 */
export type DraggableResolver = (panelId: string) => boolean;

/**
 * Callback when a tab is dropped onto a target.
 */
export type TabDropHandler = (
  panelId: string,
  targetPath: readonly number[],
  position: 'center' | 'left' | 'right' | 'top' | 'bottom',
  insertIndex?: number,
) => void;

/**
 * Renders a {@link LayoutNode} tree into DOM elements.
 *
 * Tracks which panel group currently has focus. Only the focused group
 * displays the accent-colored active tab; unfocused groups show a
 * dimmed active tab.
 *
 * @example
 * ```ts
 * const renderer = new LayoutRenderer(container, resolver, onTabClick, onClose);
 * renderer.render(layoutTree);
 * ```
 */
export class LayoutRenderer implements IDisposable {
  private readonly _container: HTMLElement;
  private readonly _widgetResolver: WidgetResolver;
  private readonly _onTabClick: TabClickHandler;
  private readonly _onClose: PanelCloseHandler;
  private readonly _onTabDrop: TabDropHandler | undefined;
  private readonly _onTabAdd: TabAddHandler | undefined;
  private readonly _titleResolver: TitleResolver | undefined;
  private readonly _draggableResolver: DraggableResolver | undefined;
  private readonly _subscriptions = new DisposableStore();
  private readonly _mountedWidgets = new Map<string, HTMLElement>();
  private readonly _onDidChangeFocus = new Emitter<string | undefined>();

  private _focusedPanelId: string | undefined;
  private _tabGroupElements: { el: HTMLElement; panelIds: readonly string[] }[] = [];
  private _currentPath: number[] = [];

  /** Event fired when the focused panel changes. */
  readonly onDidChangeFocus: Event<string | undefined> = this._onDidChangeFocus.event;

  /** The currently focused panel ID. */
  get focusedPanelId(): string | undefined {
    return this._focusedPanelId;
  }

  constructor(
    container: HTMLElement,
    widgetResolver: WidgetResolver,
    onTabClick: TabClickHandler,
    onClose: PanelCloseHandler,
    onTabDrop?: TabDropHandler,
    onTabAdd?: TabAddHandler,
    titleResolver?: TitleResolver,
    draggableResolver?: DraggableResolver,
  ) {
    this._container = container;
    this._widgetResolver = widgetResolver;
    this._onTabClick = onTabClick;
    this._onClose = onClose;
    this._onTabDrop = onTabDrop;
    this._onTabAdd = onTabAdd;
    this._titleResolver = titleResolver;
    this._draggableResolver = draggableResolver;
  }

  /**
   * Render a layout tree into the container.
   */
  render(root: LayoutNode): void {
    this._unmountAll();
    clearChildren(this._container);
    this._tabGroupElements = [];
    this._currentPath = [];
    const el = this._renderNode(root);
    this._container.appendChild(el);
  }

  dispose(): void {
    this._unmountAll();
    clearChildren(this._container);
    this._subscriptions.dispose();
    this._onDidChangeFocus.dispose();
  }

  private _setFocus(panelId: string): void {
    if (this._focusedPanelId === panelId) return;
    this._focusedPanelId = panelId;
    this._updateFocusStyles();
    this._onDidChangeFocus.fire(panelId);
  }

  private _updateFocusStyles(): void {
    for (const entry of this._tabGroupElements) {
      const isFocused = entry.panelIds.includes(this._focusedPanelId ?? '');
      entry.el.classList.toggle('editrix-tab-group--focused', isFocused);
    }
  }

  private _renderNode(node: LayoutNode): HTMLElement {
    if (node.type === 'tab-group') {
      return this._renderTabGroup(node);
    }
    return this._renderSplit(node);
  }

  private _renderSplit(node: LayoutNode & { type: 'split' }): HTMLElement {
    const el = createElement('div', 'editrix-split');
    el.dataset['direction'] = node.direction;
    const childEls: HTMLElement[] = [];

    for (let ci = 0; ci < node.children.length; ci++) {
      const child = node.children[ci];
      if (!child) continue;
      const childWrapper = createElement('div', 'editrix-split-child');
      childWrapper.style.flex = String(child.weight);

      this._currentPath.push(ci);
      childWrapper.appendChild(this._renderNode(child.node));
      this._currentPath.pop();

      el.appendChild(childWrapper);
      childEls.push(childWrapper);

      if (child !== node.children[node.children.length - 1]) {
        const handle = createElement('div', 'editrix-resize-handle');
        handle.dataset['direction'] = node.direction;
        el.appendChild(handle);

        const idx = childEls.length - 1;
        this._setupResizeHandle(handle, childEls, idx, node.direction);
      }
    }

    return el;
  }

  private _setupResizeHandle(
    handle: HTMLElement,
    children: HTMLElement[],
    leftIndex: number,
    direction: 'horizontal' | 'vertical',
  ): void {
    const isHorizontal = direction === 'horizontal';

    handle.addEventListener('mousedown', (startEvent) => {
      startEvent.preventDefault();
      handle.classList.add('editrix-resize-handle--dragging');

      const leftEl = children[leftIndex];
      const rightEl = children[leftIndex + 1];
      if (!leftEl || !rightEl) return;

      const leftStart = isHorizontal ? leftEl.offsetWidth : leftEl.offsetHeight;
      const rightStart = isHorizontal ? rightEl.offsetWidth : rightEl.offsetHeight;
      const totalSize = leftStart + rightStart;
      const startPos = isHorizontal ? startEvent.clientX : startEvent.clientY;

      const onMouseMove = (e: MouseEvent): void => {
        const delta = (isHorizontal ? e.clientX : e.clientY) - startPos;
        const newLeft = Math.max(50, Math.min(totalSize - 50, leftStart + delta));
        const newRight = totalSize - newLeft;

        leftEl.style.flex = String(newLeft / totalSize);
        rightEl.style.flex = String(newRight / totalSize);
      };

      const onMouseUp = (): void => {
        handle.classList.remove('editrix-resize-handle--dragging');
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  private _renderTabGroup(node: LayoutNode & { type: 'tab-group' }): HTMLElement {
    const el = createElement('div', 'editrix-tab-group');
    const isFocused = node.panels.includes(this._focusedPanelId ?? '');
    if (isFocused) {
      el.classList.add('editrix-tab-group--focused');
    }

    this._tabGroupElements.push({ el, panelIds: node.panels });

    if (node.panels.length === 0) {
      el.classList.add('editrix-tab-group--empty');
      const placeholder = createElement('div', 'editrix-empty-placeholder');
      placeholder.textContent = 'Drop a panel here';
      el.appendChild(placeholder);
      return el;
    }

    // Compute path for this tab-group (used for drop targeting)
    const groupPath = this._currentPath.slice();

    // Tab bar
    const tabBar = createElement('div', 'editrix-tab-bar');

    // Drag handle on left (⠿ grip dots)
    const grip = createElement('span', 'editrix-tab-grip');
    if (getIcon('grip')) {
      grip.appendChild(createIconElement('grip', 12));
    }
    // Only allow grip drag if the active panel is draggable
    const activeForGrip = node.panels[node.activeIndex];
    const gripDraggable = activeForGrip ? (this._draggableResolver?.(activeForGrip) ?? true) : true;
    grip.draggable = gripDraggable;
    grip.addEventListener('dragstart', (e) => {
      const activeId = node.panels[node.activeIndex];
      if (activeId) {
        e.dataTransfer?.setData('text/x-editrix-panel', activeId);
      }
    });
    tabBar.appendChild(grip);

    // Drop zone: reorder within this group or receive from another
    tabBar.addEventListener('dragover', (e) => {
      e.preventDefault();
      tabBar.classList.add('editrix-tab-bar--dragover');
    });
    tabBar.addEventListener('dragleave', () => {
      tabBar.classList.remove('editrix-tab-bar--dragover');
    });
    tabBar.addEventListener('drop', (e) => {
      e.preventDefault();
      tabBar.classList.remove('editrix-tab-bar--dragover');
      document.querySelector('.editrix-root')?.classList.remove('editrix-root--dragging');
      const draggedId = e.dataTransfer?.getData('text/x-editrix-panel');
      if (draggedId && this._onTabDrop) {
        this._onTabDrop(draggedId, groupPath, 'center');
      }
    });

    for (let i = 0; i < node.panels.length; i++) {
      const panelId = node.panels[i];
      if (!panelId) continue;
      const tab = createElement('button', 'editrix-tab');
      tab.textContent = this._titleResolver ? this._titleResolver(panelId) : panelId;
      tab.dataset['panelId'] = panelId;

      // Draggable (respect descriptor.draggable)
      const panelDraggable = this._draggableResolver?.(panelId) ?? true;
      tab.draggable = panelDraggable;
      tab.addEventListener('dragstart', (e) => {
        if (!panelDraggable) { e.preventDefault(); return; }
        e.dataTransfer?.setData('text/x-editrix-panel', panelId);
        tab.classList.add('editrix-tab--dragging');
      });
      tab.addEventListener('dragend', () => {
        tab.classList.remove('editrix-tab--dragging');
      });

      if (i === node.activeIndex) {
        tab.classList.add('editrix-tab--active');
      }

      tab.addEventListener('click', () => {
        this._setFocus(panelId);
        this._onTabClick(panelId);
      });

      const closeBtn = createElement('span', 'editrix-tab-close');
      closeBtn.textContent = '\u00d7';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._onClose(panelId);
      });
      tab.appendChild(closeBtn);

      tabBar.appendChild(tab);
    }

    // Spacer to push + and ⋮ to the right
    const spacer = createElement('span', 'editrix-tab-spacer');
    tabBar.appendChild(spacer);

    // "+" add tab button
    const addBtn = createElement('span', 'editrix-tab-add');
    addBtn.textContent = '+';
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._onTabAdd?.(groupPath);
    });
    tabBar.appendChild(addBtn);

    // "⋮" more menu button
    const moreBtn = createElement('span', 'editrix-tab-more');
    if (getIcon('more-vertical')) {
      moreBtn.appendChild(createIconElement('more-vertical', 14));
    }
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._showPaneContextMenu(e, groupPath);
    });
    tabBar.appendChild(moreBtn);

    el.appendChild(tabBar);

    // Panel content with drop zone overlay
    const content = createElement('div', 'editrix-panel-content');
    content.style.position = 'relative';

    // Drop zone overlay — 5 zones: top, bottom, left, right, center
    const overlay = createElement('div', 'editrix-drop-overlay');
    const zones: { el: HTMLElement; side: 'left' | 'right' | 'top' | 'bottom' | 'center' }[] = [];
    for (const side of ['left', 'right', 'top', 'bottom', 'center'] as const) {
      const zone = createElement('div', `editrix-drop-zone editrix-drop-zone--${side}`);
      zone.dataset['side'] = side;
      overlay.appendChild(zone);
      zones.push({ el: zone, side });

      zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.add('editrix-drop-zone--active');
      });

      zone.addEventListener('dragleave', () => {
        zone.classList.remove('editrix-drop-zone--active');
      });

      zone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        overlay.classList.remove('editrix-drop-overlay--visible');
        zone.classList.remove('editrix-drop-zone--active');
        document.querySelector('.editrix-root')?.classList.remove('editrix-root--dragging');
        const draggedId = e.dataTransfer?.getData('text/x-editrix-panel');
        if (draggedId && this._onTabDrop) {
          this._onTabDrop(draggedId, groupPath, side);
        }
      });
    }
    content.appendChild(overlay);

    // Show overlay on dragenter, hide on dragleave/drop
    let dragCounter = 0;
    content.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragCounter++;
      overlay.classList.add('editrix-drop-overlay--visible');
    });
    content.addEventListener('dragleave', () => {
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        overlay.classList.remove('editrix-drop-overlay--visible');
        for (const z of zones) z.el.classList.remove('editrix-drop-zone--active');
      }
    });
    content.addEventListener('dragover', (e) => { e.preventDefault(); });

    content.addEventListener('mousedown', () => {
      const activePanelId = node.panels[node.activeIndex];
      if (activePanelId) {
        this._setFocus(activePanelId);
      }
    });

    // Right-click context menu for split/merge — only on the panel chrome, not widget content
    content.addEventListener('contextmenu', (e) => {
      // Skip if the right-click originated inside widget content (let widgets handle their own)
      if (e.target !== content) return;
      e.preventDefault();
      this._showPaneContextMenu(e, groupPath);
    });

    const activePanelId = node.panels[node.activeIndex];
    if (activePanelId) {
      this._mountWidget(activePanelId, content);
    }
    el.appendChild(content);

    return el;
  }

  private _showPaneContextMenu(e: MouseEvent, _path: readonly number[]): void {
    // Remove any existing context menu
    document.querySelector('.editrix-pane-context-menu')?.remove();

    const menu = createElement('div', 'editrix-pane-context-menu');
    const items = [
      { label: 'Split Horizontal', icon: 'layout' },
      { label: 'Split Vertical', icon: 'layout' },
      { separator: true },
      { label: 'Close Pane', icon: 'x' },
    ];

    for (const item of items) {
      if ('separator' in item && item.separator) {
        menu.appendChild(createElement('div', 'editrix-pane-context-sep'));
        continue;
      }
      const row = createElement('div', 'editrix-pane-context-item');
      if (item.icon && getIcon(item.icon)) {
        row.appendChild(createIconElement(item.icon, 14));
      }
      const lbl = createElement('span');
      lbl.textContent = item.label ?? '';
      row.appendChild(lbl);
      row.addEventListener('click', () => { menu.remove(); });
      menu.appendChild(row);
    }

    // Append first (hidden) to measure, then position with boundary check
    menu.style.visibility = 'hidden';
    document.body.appendChild(menu);

    const menuRect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = e.clientX + menuRect.width > vw ? vw - menuRect.width - 4 : e.clientX;
    const top = e.clientY + menuRect.height > vh ? vh - menuRect.height - 4 : e.clientY;
    menu.style.left = `${Math.max(0, left)}px`;
    menu.style.top = `${Math.max(0, top)}px`;
    menu.style.visibility = '';

    const close = (): void => {
      menu.remove();
      document.removeEventListener('mousedown', close);
    };
    setTimeout(() => { document.addEventListener('mousedown', close); }, 0);
  }

  private _mountWidget(panelId: string, container: HTMLElement): void {
    let widget: IWidget | undefined;
    try {
      widget = this._widgetResolver(panelId);
    } catch {
      // Widget factory not registered for this panel — render placeholder
    }

    if (widget) {
      widget.mount(container);
      this._mountedWidgets.set(panelId, container);
    } else {
      const placeholder = createElement('div', 'editrix-widget-placeholder');
      placeholder.textContent = panelId;
      container.appendChild(placeholder);
    }
  }

  private _unmountAll(): void {
    this._mountedWidgets.clear();
  }
}
