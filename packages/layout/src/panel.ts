import type { IDisposable } from '@editrix/common';

/**
 * Descriptor for a panel that can be placed in the layout.
 *
 * Panels are the leaf-level content areas in the editor.
 * A game editor might have panels like Scene View, Inspector, Hierarchy, Console.
 * Plugins register panel descriptors; the layout system manages their placement.
 */
export interface PanelDescriptor {
  /** Unique panel identifier, e.g. `'scene-view'`, `'inspector'`. */
  readonly id: string;
  /** Human-readable title displayed on the tab. */
  readonly title: string;
  /** Optional icon identifier (interpretation is up to the view layer). */
  readonly icon?: string;
  /** Whether this panel can be closed by the user. Default: true. */
  readonly closable?: boolean;
  /** Whether this panel can be dragged/docked to other positions. Default: true. */
  readonly draggable?: boolean;
  /** Default region hint for initial placement. */
  readonly defaultRegion?: LayoutRegion;
}

/**
 * Named regions for initial panel placement.
 * The actual pixel layout is determined by the layout tree,
 * but these hints tell the layout where to place a panel initially.
 */
export type LayoutRegion = 'center' | 'left' | 'right' | 'bottom' | 'top';

/**
 * A panel factory creates and destroys panel content.
 *
 * The layout system calls `create` when a panel becomes visible
 * and `dispose` when it is removed. The returned object is opaque
 * to the layout — only the view layer interprets it.
 */
export interface IPanelFactory extends IDisposable {
  /** The descriptor this factory produces. */
  readonly descriptor: PanelDescriptor;
}
