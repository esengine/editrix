import type { Event, IDisposable } from '@editrix/common';
import { createServiceId } from '@editrix/common';

/**
 * Abstract input event — platform-agnostic representation of user input.
 */
export interface InputEvent {
  readonly type:
    | 'keydown'
    | 'keyup'
    | 'pointerdown'
    | 'pointermove'
    | 'pointerup'
    | 'wheel'
    | 'textinput';
  /** Key string for keyboard events (e.g. `'Ctrl+S'`). */
  readonly key?: string;
  /** Text for text input events. */
  readonly text?: string;
  /** Pointer coordinates relative to the container. */
  readonly x?: number;
  readonly y?: number;
  /** Prevent the platform from handling this event. */
  preventDefault(): void;
}

/**
 * Platform adapter — the bridge between the framework and the rendering platform.
 *
 * Each platform (DOM, terminal, native, WebGL) provides one adapter.
 * The framework calls adapter methods; the adapter translates to platform-specific operations.
 *
 * @example
 * ```ts
 * // DOM adapter would implement:
 * class DomViewAdapter implements IViewAdapter {
 *   mount(container: HTMLElement) { ... }
 *   ...
 * }
 * ```
 */
export interface IViewAdapter extends IDisposable {
  /** Platform name (e.g. `'dom'`, `'terminal'`, `'webgl'`). */
  readonly platform: string;

  /** Mount the editor shell into a platform-specific container. */
  mount(container: unknown): void;

  /** Unmount and clean up platform resources. */
  unmount(): void;

  /** Request a re-render on the next frame. */
  requestRender(): void;

  /** Abstract input events from the platform. */
  readonly onInput: Event<InputEvent>;

  /** Whether the adapter is currently mounted. */
  readonly isMounted: boolean;
}

/** Service identifier for DI. */
export const IViewAdapter = createServiceId<IViewAdapter>('IViewAdapter');
