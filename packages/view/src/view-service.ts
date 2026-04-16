import type { Event, IDisposable } from '@editrix/common';
import { createServiceId, Emitter, toDisposable } from '@editrix/common';
import type { IWidget, WidgetFactory } from './widget.js';

/**
 * Central view service. Manages widget factories and active widget instances.
 *
 * Plugins register widget factories for their panel types.
 * When the layout service opens a panel, the view service creates the
 * corresponding widget and manages its lifecycle.
 *
 * @example
 * ```ts
 * const viewService = new ViewService();
 * viewService.registerFactory('scene', (panelId) => new SceneWidget(panelId));
 * const widget = viewService.createWidget('scene');
 * widget.mount(container);
 * ```
 */
export interface IViewService extends IDisposable {
  /** Register a widget factory for a panel ID. */
  registerFactory(panelId: string, factory: WidgetFactory): IDisposable;

  /** Create a widget instance for a panel. */
  createWidget(panelId: string): IWidget;

  /** Get an active widget by panel ID. */
  getWidget(panelId: string): IWidget | undefined;

  /** Destroy a widget instance. */
  destroyWidget(panelId: string): void;

  /** Get all active widget panel IDs. */
  getActiveWidgetIds(): readonly string[];

  /** Event fired when a widget is created or destroyed. */
  readonly onDidChangeWidgets: Event<string>;
}

/** Service identifier for DI. */
export const IViewService = createServiceId<IViewService>('IViewService');

/**
 * Default implementation of {@link IViewService}.
 *
 * @example
 * ```ts
 * const service = new ViewService();
 * service.registerFactory('inspector', (id) => new InspectorWidget(id));
 * ```
 */
export class ViewService implements IViewService {
  private readonly _factories = new Map<string, WidgetFactory>();
  private readonly _widgets = new Map<string, IWidget>();
  private readonly _onDidChange = new Emitter<string>();

  readonly onDidChangeWidgets: Event<string> = this._onDidChange.event;

  registerFactory(panelId: string, factory: WidgetFactory): IDisposable {
    if (this._factories.has(panelId)) {
      throw new Error(`Widget factory for panel "${panelId}" is already registered.`);
    }

    this._factories.set(panelId, factory);

    return toDisposable(() => {
      this._factories.delete(panelId);
      this.destroyWidget(panelId);
    });
  }

  createWidget(panelId: string): IWidget {
    const existing = this._widgets.get(panelId);
    if (existing) return existing;

    const factory = this._factories.get(panelId);
    if (!factory) {
      throw new Error(
        `No widget factory registered for panel "${panelId}". ` +
          `Register a factory before creating the widget.`,
      );
    }

    const widget = factory(panelId);
    this._widgets.set(panelId, widget);
    this._onDidChange.fire(panelId);
    return widget;
  }

  getWidget(panelId: string): IWidget | undefined {
    return this._widgets.get(panelId);
  }

  destroyWidget(panelId: string): void {
    const widget = this._widgets.get(panelId);
    if (!widget) return;

    widget.dispose();
    this._widgets.delete(panelId);
    this._onDidChange.fire(panelId);
  }

  getActiveWidgetIds(): readonly string[] {
    return [...this._widgets.keys()];
  }

  dispose(): void {
    for (const widget of this._widgets.values()) {
      widget.dispose();
    }
    this._widgets.clear();
    this._factories.clear();
    this._onDidChange.dispose();
  }
}
