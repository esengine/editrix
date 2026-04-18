import type { ICommandRegistry } from '@editrix/commands';
import type { Event } from '@editrix/common';
import { DisposableStore, Emitter } from '@editrix/common';
import type { ILayoutService, LayoutNode } from '@editrix/layout';
import { removePanel } from '@editrix/layout';
import type { InputEvent, IViewAdapter, IViewService } from '@editrix/view';
import { ActivityBar } from './activity-bar.js';
import { CommandPalette } from './command-palette.js';
import { DocumentTabBar } from './document-tab-bar.js';
import { createElement } from './dom-utils.js';
import { EditorToolbar } from './editor-toolbar.js';
import { LayoutRenderer } from './layout-renderer.js';
import { MenuBar } from './menu-bar.js';
import { showQuickPick } from './quick-pick.js';
import { Sidebar } from './sidebar.js';
import { StatusBar } from './status-bar.js';
import type { EditorTheme } from './theme.js';
import { applyTheme, DARK_THEME } from './theme.js';

/**
 * Configuration for the DOM view adapter.
 */
export interface DomViewAdapterOptions {
  /** Theme to apply. Defaults to {@link DARK_THEME}. */
  readonly theme?: EditorTheme;
}

/**
 * DOM implementation of {@link IViewAdapter}.
 *
 * Renders the editor shell with this structure:
 * ```
 * ┌──────────────────────────────────────────┐
 * │ ActivityBar │ Sidebar │ Main Editor Area  │
 * │  (icons)    │(collaps)│ (layout tree)     │
 * ├──────────────────────────────────────────┤
 * │              Status Bar                  │
 * └──────────────────────────────────────────┘
 * ```
 *
 * ActivityBar and Sidebar are created in the constructor so plugins
 * can register views during activation (before mount).
 *
 * @example
 * ```ts
 * const adapter = new DomViewAdapter(layoutService, viewService, commandRegistry);
 * adapter.activityBar.addView({ id: 'plugins', title: 'Plugins', icon: '\u{1F9E9}' });
 * adapter.mount(document.getElementById('app')!);
 * ```
 */
export class DomViewAdapter implements IViewAdapter {
  readonly platform = 'dom';

  private readonly _layoutService: ILayoutService;
  private readonly _viewService: IViewService;
  private readonly _theme: EditorTheme;

  private readonly _subscriptions = new DisposableStore();
  private readonly _onInput = new Emitter<InputEvent>();
  private readonly _commandPalette: CommandPalette;
  private readonly _menuBar = new MenuBar();
  private readonly _editorToolbar = new EditorToolbar();
  private readonly _documentTabBar = new DocumentTabBar();
  private readonly _statusBar = new StatusBar();
  private readonly _activityBar = new ActivityBar();
  private readonly _sidebar = new Sidebar();

  private _container: HTMLElement | undefined;
  private _layoutContainer: HTMLElement | undefined;
  private _layoutRenderer: LayoutRenderer | undefined;
  private _isMounted = false;

  readonly onInput: Event<InputEvent> = this._onInput.event;

  get isMounted(): boolean {
    return this._isMounted;
  }

  constructor(
    layoutService: ILayoutService,
    viewService: IViewService,
    commandRegistry: ICommandRegistry,
    options?: DomViewAdapterOptions,
  ) {
    this._layoutService = layoutService;
    this._viewService = viewService;
    this._theme = options?.theme ?? DARK_THEME;
    this._commandPalette = new CommandPalette(commandRegistry);

    // Wire activity bar → sidebar
    this._subscriptions.add(
      this._activityBar.onDidChangeActiveView((viewId) => {
        if (viewId) {
          const desc = this._activityBar.getViews().find((v) => v.id === viewId);
          this._sidebar.showView(viewId, desc?.title);
        } else {
          this._sidebar.collapse();
        }
      }),
    );
  }

  mount(container: unknown): void {
    if (!(container instanceof HTMLElement)) {
      throw new Error('DomViewAdapter.mount() requires an HTMLElement container.');
    }

    this._container = container;
    this._container.className = 'editrix-root';
    this._isMounted = true;

    applyTheme(document.documentElement, this._theme);

    // Shell: MenuBar → Toolbar → [ActivityBar | Sidebar | MainArea] → StatusBar
    const menuBarEl = createElement('div');
    this._container.appendChild(menuBarEl);
    this._menuBar.mount(menuBarEl);

    const toolbarEl = createElement('div');
    this._container.appendChild(toolbarEl);
    this._editorToolbar.mount(toolbarEl);

    const documentTabsEl = createElement('div');
    this._container.appendChild(documentTabsEl);
    this._documentTabBar.mount(documentTabsEl);

    const rootDropTop = this._createRootDropStrip('top');
    this._container.appendChild(rootDropTop);

    const workArea = createElement('div', 'editrix-work-area');
    this._container.appendChild(workArea);

    const rootDropBottom = this._createRootDropStrip('bottom');
    this._container.appendChild(rootDropBottom);

    const statusBarContainer = createElement('div', 'editrix-statusbar-area');
    this._container.appendChild(statusBarContainer);

    // Activity bar
    const activityBarEl = createElement('div');
    workArea.appendChild(activityBarEl);
    this._activityBar.mount(activityBarEl);

    // Sidebar
    const sidebarEl = createElement('div');
    workArea.appendChild(sidebarEl);
    this._sidebar.mount(sidebarEl);

    // Root drop: left (between sidebar and main area)
    const rootDropLeft = this._createRootDropStrip('left');
    workArea.appendChild(rootDropLeft);

    // Main editor area
    this._layoutContainer = createElement('div', 'editrix-main-area');
    workArea.appendChild(this._layoutContainer);

    // Root drop: right
    const rootDropRight = this._createRootDropStrip('right');
    workArea.appendChild(rootDropRight);

    // Listen for drag start/end to show root drop zones — but only
    // for panel drags. Any other drag source (inspector component
    // reorder, future list-reorder widgets, etc.) must NOT trigger
    // the root-level dock hints.
    const onDragStart = (e: DragEvent): void => {
      if (!e.dataTransfer?.types.includes('text/x-editrix-panel')) return;
      this._container?.classList.add('editrix-root--dragging');
    };
    const onDragEnd = (): void => { this._container?.classList.remove('editrix-root--dragging'); };
    document.addEventListener('dragstart', onDragStart);
    document.addEventListener('dragend', onDragEnd);
    this._subscriptions.add({
      dispose: () => {
        document.removeEventListener('dragstart', onDragStart);
        document.removeEventListener('dragend', onDragEnd);
      },
    });

    // Status bar
    this._statusBar.mount(statusBarContainer);

    // Layout renderer
    this._layoutRenderer = new LayoutRenderer(
      this._layoutContainer,
      (panelId) => this._viewService.createWidget(panelId),
      (panelId) => { this._layoutService.activatePanel(panelId); },
      (panelId) => { this._layoutService.closePanel(panelId); },
      (panelId, targetPath, position) => {
        if (position === 'center') {
          this._layoutService.movePanelToGroup(panelId, targetPath);
        } else {
          this._layoutService.movePanelToSplit(panelId, targetPath, position);
        }
      },
      // onTabAdd: show a quick-pick of all panels not currently open in any
      // group, scoped to the group the user clicked + on. App plugins
      // register their panels via ILayoutService; we just present the list.
      (_groupPath, anchor) => { this._showAddPanelPicker(anchor); },
      (panelId) => this._layoutService.getDescriptor(panelId)?.title ?? panelId,
      (panelId) => this._layoutService.getDescriptor(panelId)?.draggable !== false,
      (panelId) => this._layoutService.getDescriptor(panelId)?.closable !== false,
    );
    this._subscriptions.add(this._layoutRenderer);

    // Command palette overlay
    this._commandPalette.mount(this._container);
    this._subscriptions.add(this._commandPalette);

    // Layout change subscription
    this._subscriptions.add(
      this._layoutService.onDidChangeLayout((layout) => {
        this._renderLayout(layout);
      }),
    );

    this._renderLayout(this._layoutService.getLayout());
    this._subscriptions.add(this._setupKeyboardHandler());
  }

  unmount(): void {
    this._subscriptions.dispose();
    if (this._container) {
      this._container.innerHTML = '';
    }
    this._isMounted = false;
  }

  requestRender(): void {
    if (this._layoutRenderer) {
      this._renderLayout(this._layoutService.getLayout());
    }
  }

  /** The top menu bar. */
  get menuBar(): MenuBar {
    return this._menuBar;
  }

  /** The editor toolbar (below menu bar). */
  get editorToolbar(): EditorToolbar {
    return this._editorToolbar;
  }

  /**
   * Document tab bar above the work area. Hidden by default; shows when the
   * app calls setItems() with at least one entry. Apps wire this to whatever
   * "open file" abstraction they use (typically IDocumentService).
   */
  get documentTabBar(): DocumentTabBar {
    return this._documentTabBar;
  }

  /** The activity bar for registering sidebar views. */
  get activityBar(): ActivityBar {
    return this._activityBar;
  }

  /** The sidebar for registering view content. */
  get sidebar(): Sidebar {
    return this._sidebar;
  }

  /** The status bar. */
  get statusBar(): StatusBar {
    return this._statusBar;
  }

  /** The command palette. */
  get commandPalette(): CommandPalette {
    return this._commandPalette;
  }

  dispose(): void {
    this.unmount();
    this._onInput.dispose();
    this._menuBar.dispose();
    this._editorToolbar.dispose();
    this._documentTabBar.dispose();
    this._statusBar.dispose();
    this._activityBar.dispose();
    this._sidebar.dispose();
  }

  private _renderLayout(layout: LayoutNode): void {
    this._layoutRenderer?.render(layout);
  }

  /**
   * Show a quick-pick of all panels currently registered but not open.
   * Wired to the "+" button on every tab-group header so users have an
   * obvious way to bring back a closed panel.
   */
  private _showAddPanelPicker(anchor: HTMLElement): void {
    const all = this._layoutService.getAllDescriptors();
    const openIds = new Set(this._layoutService.getOpenPanelIds());
    const closed = all.filter((d) => !openIds.has(d.id));
    if (closed.length === 0) return;
    showQuickPick({
      items: closed.map((d) => ({
        id: d.id,
        label: d.title,
        ...(d.icon !== undefined ? { icon: d.icon } : {}),
      })),
      anchor,
      placeholder: 'Open panel...',
      onSelect: (item) => { this._layoutService.openPanel(item.id); },
    });
  }

  private _setupKeyboardHandler(): { dispose(): void } {
    const handler = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        if (this._commandPalette.isOpen) {
          this._commandPalette.close();
        } else {
          this._commandPalette.open();
        }
        return;
      }

      this._onInput.fire({
        type: 'keydown',
        key: this._buildKeyString(e),
        preventDefault: () => { e.preventDefault(); },
      });
    };

    document.addEventListener('keydown', handler);
    return { dispose: () => { document.removeEventListener('keydown', handler); } };
  }

  private _buildKeyString(e: KeyboardEvent): string {
    const parts: string[] = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Meta');
    if (!['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
      parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
    }
    return parts.join('+');
  }

  /**
   * Add root-level edge drop zones to the main editor area.
   * Dropping here creates a full-width/full-height split at the root of the layout tree.
   */
  private _createRootDropStrip(side: 'left' | 'right' | 'top' | 'bottom'): HTMLElement {
    const strip = createElement('div', `editrix-root-drop editrix-root-drop--${side}`);

    const isPanelDrag = (e: DragEvent): boolean =>
      e.dataTransfer?.types.includes('text/x-editrix-panel') ?? false;

    strip.addEventListener('dragover', (e) => {
      if (!isPanelDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      strip.classList.add('editrix-root-drop--active');
    });

    strip.addEventListener('dragleave', () => {
      strip.classList.remove('editrix-root-drop--active');
    });

    strip.addEventListener('drop', (e) => {
      if (!isPanelDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      strip.classList.remove('editrix-root-drop--active');
      this._container?.classList.remove('editrix-root--dragging');
      const draggedId = e.dataTransfer?.getData('text/x-editrix-panel');
      if (draggedId) {
        this._rootDrop(draggedId, side);
      }
    });

    return strip;
  }

  private _rootDrop(panelId: string, side: 'left' | 'right' | 'top' | 'bottom'): void {
    const tree = removePanel(this._layoutService.getLayout(), panelId);

    const direction = (side === 'left' || side === 'right') ? 'horizontal' : 'vertical';
    const isAfter = side === 'right' || side === 'bottom';
    const newTab = { type: 'tab-group' as const, panels: [panelId], activeIndex: 0 };
    const sideWeight = side === 'left' || side === 'right' ? 0.2 : 0.25;

    const existingChild = { node: tree, weight: 1 - sideWeight };
    const newChild = { node: newTab, weight: sideWeight };
    const children = isAfter ? [existingChild, newChild] : [newChild, existingChild];

    this._layoutService.setLayout({ type: 'split', direction, children });
  }
}
