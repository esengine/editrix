/**
 * A layout tree describes the spatial arrangement of panels.
 *
 * The tree is composed of three node types:
 * - `SplitNode`: divides space horizontally or vertically between children
 * - `TabGroupNode`: holds multiple panels as tabs (only one visible at a time)
 * - `PanelLeaf`: a leaf referencing a panel by ID
 *
 * The tree is a plain data structure (no classes, no methods).
 * It can be serialized to JSON and restored for layout persistence.
 *
 * @example
 * ```ts
 * const layout: LayoutNode = {
 *   type: 'split',
 *   direction: 'horizontal',
 *   children: [
 *     { type: 'tab-group', panels: ['hierarchy'], activeIndex: 0, weight: 0.2 },
 *     { type: 'tab-group', panels: ['scene-view'], activeIndex: 0, weight: 0.6 },
 *     { type: 'tab-group', panels: ['inspector'], activeIndex: 0, weight: 0.2 },
 *   ],
 * };
 * ```
 */
export type LayoutNode = SplitNode | TabGroupNode;

/**
 * Divides space between children along an axis.
 */
export interface SplitNode {
  readonly type: 'split';
  /** Split direction. */
  readonly direction: 'horizontal' | 'vertical';
  /** Child nodes. Each child has a `weight` controlling its share of space. */
  readonly children: readonly LayoutChild[];
}

/**
 * A child within a split node. Wraps a node with a weight.
 */
export interface LayoutChild {
  /** The child node. */
  readonly node: LayoutNode;
  /** Proportional weight (0–1). All sibling weights should sum to 1. */
  readonly weight: number;
}

/**
 * A group of panels displayed as tabs. Only one is visible at a time.
 */
export interface TabGroupNode {
  readonly type: 'tab-group';
  /** Panel IDs in this tab group. */
  readonly panels: readonly string[];
  /** Index of the currently active (visible) panel. */
  readonly activeIndex: number;
}

// ─── Immutable tree operations ───────────────────────────

/**
 * Find the tab group containing a specific panel ID.
 * Returns the node and the path of indices to reach it, or undefined.
 */
export function findPanel(
  root: LayoutNode,
  panelId: string,
): { node: TabGroupNode; path: readonly number[] } | undefined {
  return findPanelInner(root, panelId, []);
}

function findPanelInner(
  node: LayoutNode,
  panelId: string,
  path: number[],
): { node: TabGroupNode; path: readonly number[] } | undefined {
  if (node.type === 'tab-group') {
    if (node.panels.includes(panelId)) {
      return { node, path };
    }
    return undefined;
  }

  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    if (!child) continue;
    const result = findPanelInner(child.node, panelId, [...path, i]);
    if (result) return result;
  }

  return undefined;
}

/**
 * Add a panel to a tab group at the given path.
 * Returns a new tree (immutable operation).
 */
export function addPanelToGroup(
  root: LayoutNode,
  panelId: string,
  targetPath: readonly number[],
): LayoutNode {
  return updateAtPath(root, targetPath, (node) => {
    if (node.type !== 'tab-group') return node;
    return {
      ...node,
      panels: [...node.panels, panelId],
      activeIndex: node.panels.length,
    };
  });
}

/**
 * Remove a panel from the tree. If the tab group becomes empty, it is removed.
 * Returns a new tree (immutable operation).
 */
export function removePanel(root: LayoutNode, panelId: string): LayoutNode {
  return removePanelInner(root, panelId);
}

function removePanelInner(node: LayoutNode, panelId: string): LayoutNode {
  if (node.type === 'tab-group') {
    const filtered = node.panels.filter((id) => id !== panelId);
    const newActive = Math.min(node.activeIndex, Math.max(0, filtered.length - 1));
    return { ...node, panels: filtered, activeIndex: newActive };
  }

  const newChildren = node.children
    .map((child) => ({
      ...child,
      node: removePanelInner(child.node, panelId),
    }))
    // Remove empty tab groups
    .filter((child) => {
      if (child.node.type === 'tab-group' && child.node.panels.length === 0) return false;
      return true;
    });

  // Re-normalize weights
  const totalWeight = newChildren.reduce((sum, c) => sum + c.weight, 0);
  const normalized = newChildren.map((c) => ({
    ...c,
    weight: totalWeight > 0 ? c.weight / totalWeight : 0,
  }));

  return { ...node, children: normalized };
}

/**
 * Set the active tab in a tab group.
 * Returns a new tree (immutable operation).
 */
export function setActiveTab(root: LayoutNode, panelId: string): LayoutNode {
  const found = findPanel(root, panelId);
  if (!found) return root;

  return updateAtPath(root, found.path, (node) => {
    if (node.type !== 'tab-group') return node;
    const idx = node.panels.indexOf(panelId);
    if (idx === -1) return node;
    return { ...node, activeIndex: idx };
  });
}

/**
 * Collect all panel IDs in the tree.
 */
export function getAllPanelIds(root: LayoutNode): string[] {
  const result: string[] = [];
  collectPanels(root, result);
  return result;
}

function collectPanels(node: LayoutNode, result: string[]): void {
  if (node.type === 'tab-group') {
    result.push(...node.panels);
    return;
  }
  for (const child of node.children) {
    collectPanels(child.node, result);
  }
}

/**
 * Serialize a layout tree to a JSON-compatible object.
 */
export function serializeLayout(root: LayoutNode): unknown {
  return JSON.parse(JSON.stringify(root)) as unknown;
}

// ─── Internal helpers ────────────────────────────────────

function updateAtPath(
  node: LayoutNode,
  path: readonly number[],
  updater: (node: LayoutNode) => LayoutNode,
): LayoutNode {
  if (path.length === 0) {
    return updater(node);
  }

  if (node.type !== 'split') return node;

  const [head, ...rest] = path;
  const newChildren = node.children.map((child, i) => {
    if (i !== head) return child;
    return { ...child, node: updateAtPath(child.node, rest, updater) };
  });

  return { ...node, children: newChildren };
}

function pathsEqual(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Reorder a panel within its tab group.
 * Returns a new tree (immutable operation).
 */
export function reorderPanel(root: LayoutNode, panelId: string, newIndex: number): LayoutNode {
  const found = findPanel(root, panelId);
  if (!found) return root;

  return updateAtPath(root, found.path, (node) => {
    if (node.type !== 'tab-group') return node;
    const panels = [...node.panels];
    const oldIndex = panels.indexOf(panelId);
    if (oldIndex === -1) return node;

    panels.splice(oldIndex, 1);
    const clampedIndex = Math.max(0, Math.min(newIndex, panels.length));
    panels.splice(clampedIndex, 0, panelId);

    return { ...node, panels, activeIndex: clampedIndex };
  });
}

/**
 * Move a panel from its current tab group to a target tab group at a specific position.
 * If the source group becomes empty it is cleaned up.
 * Returns a new tree (immutable operation).
 */
export function movePanelToGroup(
  root: LayoutNode,
  panelId: string,
  targetPath: readonly number[],
  insertIndex?: number,
): LayoutNode {
  // Check if panel is already in the target group
  const source = findPanel(root, panelId);
  if (source && pathsEqual(source.path, targetPath)) {
    // Same group — reorder instead of remove+insert
    return reorderPanel(root, panelId, insertIndex ?? source.node.panels.length);
  }

  // Remove from source
  let tree = removePanel(root, panelId);

  // Insert into target
  tree = updateAtPath(tree, targetPath, (node) => {
    if (node.type !== 'tab-group') return node;
    const panels = [...node.panels];
    const idx = insertIndex ?? panels.length;
    panels.splice(idx, 0, panelId);
    return { ...node, panels, activeIndex: idx };
  });

  return tree;
}

/**
 * Move a panel to a new split beside a target group.
 * Creates a new split with the target and the moved panel side-by-side.
 */
export function movePanelToSplit(
  root: LayoutNode,
  panelId: string,
  targetPath: readonly number[],
  side: 'left' | 'right' | 'top' | 'bottom',
): LayoutNode {
  // If this is the only panel in the target group, splitting makes no sense
  const source = findPanel(root, panelId);
  if (source && pathsEqual(source.path, targetPath) && source.node.panels.length === 1) {
    return root;
  }

  let tree = removePanel(root, panelId);

  const direction = side === 'left' || side === 'right' ? 'horizontal' : 'vertical';
  const isAfter = side === 'right' || side === 'bottom';
  const newTab: TabGroupNode = { type: 'tab-group', panels: [panelId], activeIndex: 0 };

  tree = updateAtPath(tree, targetPath, (node) => {
    const existingChild = { node, weight: 0.5 };
    const newChild = { node: newTab as LayoutNode, weight: 0.5 };
    const children = isAfter ? [existingChild, newChild] : [newChild, existingChild];
    return { type: 'split', direction, children } as LayoutNode;
  });

  return tree;
}
