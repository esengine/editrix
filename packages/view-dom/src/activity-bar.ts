import type { Event, IDisposable } from '@editrix/common';
import { Emitter, toDisposable } from '@editrix/common';
import { createElement } from './dom-utils.js';
import { createIconElement, getIcon } from './icons.js';

/**
 * A sidebar view descriptor. Registered by plugins to add entries
 * to the activity bar.
 */
export interface SidebarViewDescriptor {
  /** Unique identifier, e.g. `'plugins'`, `'explorer'`. */
  readonly id: string;
  /** Tooltip text shown on hover. */
  readonly title: string;
  /** Icon — a short text/emoji rendered in the activity bar button. */
  readonly icon: string;
  /** Sort priority (lower = higher in the bar). Default: 100. */
  readonly priority?: number;
}

/**
 * The activity bar: a vertical icon strip on the far left.
 *
 * Supports deferred mounting: views can be registered before the
 * activity bar is attached to the DOM.
 *
 * @example
 * ```ts
 * const bar = new ActivityBar();
 * bar.addView({ id: 'plugins', title: 'Plugins', icon: '\u{1F9E9}' });
 * bar.mount(container);  // can be called later
 * ```
 */
export class ActivityBar implements IDisposable {
  private readonly _views: SidebarViewDescriptor[] = [];
  private readonly _buttons = new Map<string, HTMLElement>();
  private readonly _onDidChangeActiveView = new Emitter<string | undefined>();
  private _container: HTMLElement | undefined;
  private _activeViewId: string | undefined;

  readonly onDidChangeActiveView: Event<string | undefined> = this._onDidChangeActiveView.event;

  /** Mount the activity bar DOM into a container. */
  mount(container: HTMLElement): void {
    this._container = container;
    this._container.className = 'editrix-activity-bar';
    this._render();
  }

  /** Add a sidebar view entry. Returns a disposable to remove it. */
  addView(descriptor: SidebarViewDescriptor): IDisposable {
    this._views.push(descriptor);
    this._views.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
    this._render();

    return toDisposable(() => {
      const idx = this._views.indexOf(descriptor);
      if (idx !== -1) {
        this._views.splice(idx, 1);
      }
      this._buttons.delete(descriptor.id);
      if (this._activeViewId === descriptor.id) {
        this._activeViewId = undefined;
        this._onDidChangeActiveView.fire(undefined);
      }
      this._render();
    });
  }

  /** Get the currently active view ID (undefined = sidebar collapsed). */
  get activeViewId(): string | undefined {
    return this._activeViewId;
  }

  /** Programmatically activate a view. */
  setActiveView(viewId: string | undefined): void {
    this._activeViewId = viewId;
    this._updateActiveState();
    this._onDidChangeActiveView.fire(viewId);
  }

  /** Get all registered view descriptors. */
  getViews(): readonly SidebarViewDescriptor[] {
    return this._views;
  }

  dispose(): void {
    if (this._container) {
      this._container.innerHTML = '';
    }
    this._views.length = 0;
    this._buttons.clear();
    this._onDidChangeActiveView.dispose();
  }

  private _render(): void {
    if (!this._container) return;
    this._container.innerHTML = '';

    // Auto-hide when no views registered
    if (this._views.length === 0) {
      this._container.style.display = 'none';
      return;
    }
    this._container.style.display = '';

    for (const view of this._views) {
      const btn = createElement('button', 'editrix-activity-bar-btn');
      btn.title = view.title;
      if (getIcon(view.icon)) {
        btn.appendChild(createIconElement(view.icon, 20));
      } else {
        btn.textContent = view.icon;
      }
      btn.dataset['viewId'] = view.id;

      if (view.id === this._activeViewId) {
        btn.classList.add('editrix-activity-bar-btn--active');
      }

      btn.addEventListener('click', () => {
        if (this._activeViewId === view.id) {
          this._activeViewId = undefined;
        } else {
          this._activeViewId = view.id;
        }
        this._updateActiveState();
        this._onDidChangeActiveView.fire(this._activeViewId);
      });

      this._container.appendChild(btn);
      this._buttons.set(view.id, btn);
    }
  }

  private _updateActiveState(): void {
    for (const [id, btn] of this._buttons) {
      btn.classList.toggle('editrix-activity-bar-btn--active', id === this._activeViewId);
    }
  }
}
