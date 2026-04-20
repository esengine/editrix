import type { IDisposable } from '@editrix/common';

/**
 * A widget is the abstract unit of UI content in the framework.
 *
 * Widgets are platform-agnostic — they describe what to render,
 * not how. The platform adapter (DOM, terminal, native) interprets
 * the widget tree and produces actual UI.
 *
 * This is the contract that panel implementations must fulfill.
 */
export interface IWidget extends IDisposable {
  /** Unique widget instance ID. */
  readonly id: string;

  /**
   * Called when the widget is first mounted into the view.
   * The `container` type depends on the platform adapter
   * (e.g. HTMLElement for DOM, screen region for terminal).
   */
  mount(container: unknown): void;

  /** Called when the widget's allocated size changes. */
  resize(width: number, height: number): void;

  /** Called when the widget gains focus. */
  focus(): void;

  /** Whether the widget currently has focus. */
  readonly hasFocus: boolean;

  /**
   * Return a JSON-serializable snapshot of the widget's view state —
   * scroll position, expanded-tree rows, input draft, etc. Used by the
   * view service to survive widget dispose/re-create pairs (plugin
   * hot-reload, factory re-registration). Return undefined (or omit
   * this method entirely) when the widget has nothing worth saving.
   */
  getState?(): unknown;

  /**
   * Restore a snapshot previously returned by {@link getState}. Called
   * after {@link mount} when the view service has persisted state from
   * a prior instance. Implementations should degrade gracefully when
   * the payload is malformed or from a newer schema.
   */
  setState?(state: unknown): void;
}

/**
 * Factory function that creates a widget for a specific panel.
 * Registered via the view service; called when a panel becomes visible.
 */
export type WidgetFactory = (panelId: string) => IWidget;
