import type { Event, IDisposable } from '@editrix/common';
import { createServiceId, Emitter, toDisposable } from '@editrix/common';
import type { LayoutNode, TabGroupNode } from './layout-tree.js';
import {
  addPanelToGroup,
  findPanel,
  getAllPanelIds,
  movePanelToGroup as movePanelToGroupOp,
  movePanelToSplit as movePanelToSplitOp,
  removePanel,
  reorderPanel,
  setActiveTab,
} from './layout-tree.js';
import type { IPanelFactory, LayoutRegion, PanelDescriptor } from './panel.js';

/**
 * Central layout service. Manages panel registration and the layout tree.
 *
 * Plugins register panels via descriptors. The layout service maintains
 * the spatial arrangement as an immutable tree and emits change events
 * that the view layer can subscribe to for rendering.
 *
 * @example
 * ```ts
 * const layout = new LayoutService();
 * layout.registerPanel({ id: 'scene', title: 'Scene View', defaultRegion: 'center' });
 * layout.registerPanel({ id: 'inspector', title: 'Inspector', defaultRegion: 'right' });
 * layout.openPanel('scene');
 * layout.openPanel('inspector');
 * ```
 */
export interface ILayoutService extends IDisposable {
  /** Register a panel descriptor. */
  registerPanel(descriptor: PanelDescriptor, factory?: IPanelFactory): IDisposable;

  /** Open a registered panel. Places it in the layout if not already present. */
  openPanel(panelId: string): void;

  /** Close (remove from layout) a panel. Does not unregister it. */
  closePanel(panelId: string): void;

  /** Set a panel as the active tab in its group. */
  activatePanel(panelId: string): void;

  /** Get the current layout tree. */
  getLayout(): LayoutNode;

  /** Replace the entire layout tree (e.g. restoring a saved layout). */
  setLayout(layout: LayoutNode): void;

  /** Get a registered panel descriptor by ID. */
  getDescriptor(panelId: string): PanelDescriptor | undefined;

  /** Get all registered panel descriptors. */
  getAllDescriptors(): readonly PanelDescriptor[];

  /** Reorder a panel within its current tab group. */
  reorderPanelInGroup(panelId: string, newIndex: number): void;

  /** Move a panel to a different tab group. */
  movePanelToGroup(panelId: string, targetPath: readonly number[], insertIndex?: number): void;

  /** Move a panel to a new split beside a target. */
  movePanelToSplit(
    panelId: string,
    targetPath: readonly number[],
    side: 'left' | 'right' | 'top' | 'bottom',
  ): void;

  /** Get all panel IDs currently visible in the layout. */
  getOpenPanelIds(): readonly string[];

  /** Event fired when the layout tree changes. */
  readonly onDidChangeLayout: Event<LayoutNode>;

  /** Event fired when panel registrations change. */
  readonly onDidChangePanels: Event<void>;
}

/** Service identifier for DI. */
export const ILayoutService = createServiceId<ILayoutService>('ILayoutService');

/**
 * Default implementation of {@link ILayoutService}.
 *
 * @example
 * ```ts
 * const service = new LayoutService();
 * service.registerPanel({ id: 'console', title: 'Console', defaultRegion: 'bottom' });
 * service.openPanel('console');
 * ```
 */
export class LayoutService implements ILayoutService {
  private readonly _descriptors = new Map<string, PanelDescriptor>();
  private readonly _factories = new Map<string, IPanelFactory>();
  private _layout: LayoutNode = { type: 'tab-group', panels: [], activeIndex: 0 };

  private readonly _onDidChangeLayout = new Emitter<LayoutNode>();
  private readonly _onDidChangePanels = new Emitter<void>();

  readonly onDidChangeLayout: Event<LayoutNode> = this._onDidChangeLayout.event;
  readonly onDidChangePanels: Event<void> = this._onDidChangePanels.event;

  registerPanel(descriptor: PanelDescriptor, factory?: IPanelFactory): IDisposable {
    if (this._descriptors.has(descriptor.id)) {
      throw new Error(`Panel "${descriptor.id}" is already registered.`);
    }

    this._descriptors.set(descriptor.id, descriptor);
    if (factory) {
      this._factories.set(descriptor.id, factory);
    }
    this._onDidChangePanels.fire();

    return toDisposable(() => {
      this._descriptors.delete(descriptor.id);
      const f = this._factories.get(descriptor.id);
      if (f) {
        f.dispose();
        this._factories.delete(descriptor.id);
      }
      this.closePanel(descriptor.id);
      this._onDidChangePanels.fire();
    });
  }

  openPanel(panelId: string): void {
    if (!this._descriptors.has(panelId)) {
      throw new Error(`Panel "${panelId}" is not registered.`);
    }

    // Already in the layout? Just activate it
    if (findPanel(this._layout, panelId)) {
      this.activatePanel(panelId);
      return;
    }

    // Place into the layout based on defaultRegion
    const descriptor = this._descriptors.get(panelId);
    const region = descriptor?.defaultRegion ?? 'center';
    this._layout = this._insertPanelByRegion(this._layout, panelId, region);
    this._onDidChangeLayout.fire(this._layout);
  }

  closePanel(panelId: string): void {
    if (!findPanel(this._layout, panelId)) return;
    this._layout = removePanel(this._layout, panelId);
    this._onDidChangeLayout.fire(this._layout);
  }

  activatePanel(panelId: string): void {
    this._layout = setActiveTab(this._layout, panelId);
    this._onDidChangeLayout.fire(this._layout);
  }

  getLayout(): LayoutNode {
    return this._layout;
  }

  setLayout(layout: LayoutNode): void {
    this._layout = layout;
    this._onDidChangeLayout.fire(this._layout);
  }

  getDescriptor(panelId: string): PanelDescriptor | undefined {
    return this._descriptors.get(panelId);
  }

  getAllDescriptors(): readonly PanelDescriptor[] {
    return [...this._descriptors.values()];
  }

  reorderPanelInGroup(panelId: string, newIndex: number): void {
    this._layout = reorderPanel(this._layout, panelId, newIndex);
    this._onDidChangeLayout.fire(this._layout);
  }

  movePanelToGroup(panelId: string, targetPath: readonly number[], insertIndex?: number): void {
    this._layout = movePanelToGroupOp(this._layout, panelId, targetPath, insertIndex);
    this._onDidChangeLayout.fire(this._layout);
  }

  movePanelToSplit(
    panelId: string,
    targetPath: readonly number[],
    side: 'left' | 'right' | 'top' | 'bottom',
  ): void {
    this._layout = movePanelToSplitOp(this._layout, panelId, targetPath, side);
    this._onDidChangeLayout.fire(this._layout);
  }

  getOpenPanelIds(): readonly string[] {
    return getAllPanelIds(this._layout);
  }

  dispose(): void {
    for (const factory of this._factories.values()) {
      factory.dispose();
    }
    this._descriptors.clear();
    this._factories.clear();
    this._onDidChangeLayout.dispose();
    this._onDidChangePanels.dispose();
  }

  /**
   * Insert a panel into the layout tree based on its region hint.
   *
   * If the layout is still a single tab-group, it gets promoted to a split
   * with regions. If the target region already exists, the panel is added
   * as a new tab in that region's tab-group.
   */
  private _insertPanelByRegion(
    root: LayoutNode,
    panelId: string,
    region: LayoutRegion,
  ): LayoutNode {
    // Empty layout: just create a tab-group
    if (root.type === 'tab-group' && root.panels.length === 0) {
      return { type: 'tab-group', panels: [panelId], activeIndex: 0 };
    }

    // 'center' region: find the first tab-group in a horizontal split (or root) to add as tab.
    // Only works if root is already a split, meaning regions are established.
    if (region === 'center' && root.type === 'split') {
      return this._addToCenterGroup(root, panelId);
    }

    // For non-center regions (or when root is still a flat tab-group), create a split
    const directionMap: Record<LayoutRegion, 'horizontal' | 'vertical'> = {
      left: 'horizontal',
      right: 'horizontal',
      center: 'horizontal',
      top: 'vertical',
      bottom: 'vertical',
    };
    const direction = directionMap[region];
    const newTab: TabGroupNode = { type: 'tab-group', panels: [panelId], activeIndex: 0 };
    const isAfter = region === 'right' || region === 'bottom';
    const sideWeight = region === 'left' || region === 'right' ? 0.2 : 0.25;

    // If root is already a split in the same direction, insert alongside
    if (root.type === 'split' && root.direction === direction) {
      const newChild = { node: newTab as LayoutNode, weight: sideWeight };
      const scaleFactor = 1 - sideWeight;
      const rescaled = root.children.map((c) => ({ ...c, weight: c.weight * scaleFactor }));
      const children = isAfter ? [...rescaled, newChild] : [newChild, ...rescaled];
      return { type: 'split', direction, children };
    }

    // Wrap root in a new split
    const existingChild = { node: root, weight: 1 - sideWeight };
    const newChild = { node: newTab as LayoutNode, weight: sideWeight };
    const children = isAfter ? [existingChild, newChild] : [newChild, existingChild];
    return { type: 'split', direction, children };
  }

  /**
   * Find the "center" tab-group in a split and add a panel to it.
   * Heuristic: the center is the largest child in a horizontal split,
   * or the first tab-group found by depth-first traversal.
   */
  private _addToCenterGroup(root: LayoutNode, panelId: string): LayoutNode {
    if (root.type === 'tab-group') {
      return addPanelToGroup(root, panelId, []);
    }

    // Find the child with the largest weight (likely the center)
    let bestIdx = 0;
    let bestWeight = 0;
    for (let i = 0; i < root.children.length; i++) {
      const child = root.children[i];
      if (child && child.weight > bestWeight) {
        bestWeight = child.weight;
        bestIdx = i;
      }
    }

    const newChildren = root.children.map((child, i) => {
      if (i !== bestIdx) return child;
      return { ...child, node: this._addToCenterGroup(child.node, panelId) };
    });

    return { ...root, children: newChildren };
  }
}
