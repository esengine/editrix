import type { IDisposable } from '@editrix/common';
import { toDisposable } from '@editrix/common';
import type { IWidget } from '@editrix/view';
import { clearChildren, createElement } from './dom-utils.js';

/**
 * Factory that creates a widget for a sidebar view.
 */
export type SidebarWidgetFactory = (viewId: string) => IWidget;

/**
 * The sidebar panel: a collapsible content area next to the activity bar.
 *
 * Shows the content of the currently active sidebar view.
 * When no view is active, the sidebar collapses to zero width.
 *
 * Supports deferred mounting: factories can be registered before the
 * sidebar is mounted to the DOM.
 *
 * @example
 * ```ts
 * const sidebar = new Sidebar();
 * sidebar.registerView('plugins', (id) => new PluginManagerWidget(id));
 * sidebar.mount(container);  // can be called later
 * sidebar.showView('plugins');
 * ```
 */
export class Sidebar implements IDisposable {
  private readonly _factories = new Map<string, SidebarWidgetFactory>();
  private readonly _widgets = new Map<string, IWidget>();
  private _container: HTMLElement | undefined;
  private _headerEl: HTMLElement | undefined;
  private _contentEl: HTMLElement | undefined;
  private _activeViewId: string | undefined;
  private _pendingTitle: string | undefined;

  /** Mount the sidebar DOM into a container. */
  mount(container: HTMLElement): void {
    this._container = container;
    this._container.className = 'editrix-sidebar';

    this._headerEl = createElement('div', 'editrix-sidebar-header');
    this._contentEl = createElement('div', 'editrix-sidebar-content');

    this._container.appendChild(this._headerEl);
    this._container.appendChild(this._contentEl);

    if (this._activeViewId) {
      this.showView(this._activeViewId, this._pendingTitle);
    } else {
      this._container.style.width = '0';
      this._container.style.borderRight = 'none';
    }
  }

  /** Register a widget factory for a sidebar view. */
  registerView(viewId: string, factory: SidebarWidgetFactory): IDisposable {
    this._factories.set(viewId, factory);

    return toDisposable(() => {
      this._factories.delete(viewId);
      const widget = this._widgets.get(viewId);
      if (widget) {
        widget.dispose();
        this._widgets.delete(viewId);
      }
      if (this._activeViewId === viewId) {
        this.collapse();
      }
    });
  }

  /** Show a specific sidebar view by ID. */
  showView(viewId: string, title?: string): void {
    this._activeViewId = viewId;
    this._pendingTitle = title;

    // If not mounted yet, defer rendering
    if (!this._container || !this._headerEl || !this._contentEl) return;

    this._container.style.width = '';
    this._container.style.borderRight = '';
    this._headerEl.textContent = title ?? viewId;

    let widget = this._widgets.get(viewId);
    if (!widget) {
      const factory = this._factories.get(viewId);
      if (!factory) return;
      widget = factory(viewId);
      this._widgets.set(viewId, widget);
    }

    clearChildren(this._contentEl);
    widget.mount(this._contentEl);
  }

  /** Collapse the sidebar (hide). */
  collapse(): void {
    this._activeViewId = undefined;
    this._pendingTitle = undefined;
    if (this._container) {
      this._container.style.width = '0';
      this._container.style.borderRight = 'none';
    }
  }

  /** Whether the sidebar is currently visible. */
  get isVisible(): boolean {
    return this._activeViewId !== undefined;
  }

  /** The currently active view ID. */
  get activeViewId(): string | undefined {
    return this._activeViewId;
  }

  dispose(): void {
    for (const widget of this._widgets.values()) {
      widget.dispose();
    }
    this._widgets.clear();
    this._factories.clear();
    if (this._container) {
      this._container.innerHTML = '';
    }
  }
}
