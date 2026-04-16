import { DisposableStore } from '@editrix/common';
import type { IWidget } from '@editrix/view';
import { createElement } from '../dom-utils.js';

/**
 * Base class for all DOM-based widgets.
 *
 * Provides common infrastructure: root element creation, subscription
 * management, focus tracking, and a structured lifecycle.
 *
 * Subclasses override {@link buildContent} to populate the widget,
 * and optionally {@link onResize} to handle size changes.
 *
 * @example
 * ```ts
 * class MyPanelWidget extends BaseWidget {
 *   constructor(id: string) {
 *     super(id, 'my-panel');
 *   }
 *
 *   protected buildContent(root: HTMLElement): void {
 *     const p = document.createElement('p');
 *     p.textContent = 'Hello from my panel!';
 *     root.appendChild(p);
 *   }
 * }
 * ```
 */
export abstract class BaseWidget implements IWidget {
  readonly id: string;
  protected readonly subscriptions = new DisposableStore();
  protected root: HTMLElement | undefined;
  private _hasFocus = false;

  constructor(id: string, private readonly _cssClass: string) {
    this.id = id;
  }

  mount(container: unknown): void {
    const parent = container as HTMLElement;

    // Idempotent: if already built, just re-attach the existing DOM
    if (this.root) {
      parent.appendChild(this.root);
      return;
    }

    this.root = createElement('div', `editrix-widget editrix-widget-${this._cssClass}`);
    this.root.style.width = '100%';
    this.root.style.height = '100%';
    this.root.style.overflow = 'hidden';
    this.root.style.display = 'flex';
    this.root.style.flexDirection = 'column';

    this.buildContent(this.root);
    parent.appendChild(this.root);
  }

  /** Get the root DOM element (available after mount). */
  getRootElement(): HTMLElement | undefined {
    return this.root;
  }

  resize(width: number, height: number): void {
    this.onResize(width, height);
  }

  focus(): void {
    this._hasFocus = true;
    this.root?.focus();
  }

  get hasFocus(): boolean {
    return this._hasFocus;
  }

  dispose(): void {
    this.subscriptions.dispose();
    this.root?.remove();
    this.root = undefined;
  }

  /**
   * Subclasses implement this to build the widget's DOM content.
   * Called once during {@link mount}.
   */
  protected abstract buildContent(root: HTMLElement): void;

  /**
   * Called when the widget's allocated size changes.
   * Override to react to size changes (e.g. canvas resize).
   */
  protected onResize(_width: number, _height: number): void {}

  /**
   * Helper: create an element and append it to a parent.
   */
  protected appendElement<K extends keyof HTMLElementTagNameMap>(
    parent: HTMLElement,
    tag: K,
    className?: string,
  ): HTMLElementTagNameMap[K] {
    const el = createElement(tag, className);
    parent.appendChild(el);
    return el;
  }
}
