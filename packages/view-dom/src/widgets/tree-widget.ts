import type { Event } from '@editrix/common';
import { Emitter } from '@editrix/common';
import { createElement } from '../dom-utils.js';
import { createIconElement, getIcon } from '../icons.js';
import { BaseWidget } from './base-widget.js';

/**
 * A node in the tree data model.
 */
export interface TreeNode {
  /** Unique identifier. */
  readonly id: string;
  /** Display label. */
  readonly label: string;
  /** Icon name from the icon registry. */
  readonly icon?: string;
  /**
   * Extra CSS class applied to the label span. Callers can use this to
   * theme specific rows (e.g. blue for prefab instance roots) without
   * injecting arbitrary markup into the label text.
   */
  readonly labelClassName?: string;
  /** Child nodes. Empty/undefined = leaf node. */
  readonly children?: readonly TreeNode[];
}

/**
 * Options for creating a {@link TreeWidget}.
 */
export interface TreeWidgetOptions {
  /** Allow selecting multiple nodes (with Ctrl/Shift). Default: false. */
  readonly multiSelect?: boolean;
  /** Indent size per level in pixels. Default: 16. */
  readonly indentSize?: number;
  /** Show a search/filter input at the top. Default: false. */
  readonly showFilter?: boolean;
  /** Show a visibility toggle (eye icon) on each node. Default: false. */
  readonly showVisibility?: boolean;
  /** Placeholder text for the filter input. Default: "Filter...". */
  readonly filterPlaceholder?: string;
  /** Show an "Add" action button below the filter. Default: false. */
  readonly showAddButton?: boolean;
  /** Label for the add button. Default: "Add Entity". */
  readonly addButtonLabel?: string;
  /** Enable drag-and-drop reordering / reparenting. Default: false. */
  readonly enableDrag?: boolean;
  /** Pre-drop gate — return false to suppress the indicator and reject. */
  readonly canDrop?: (
    sourceIds: readonly string[],
    targetId: string,
    position: 'before' | 'after' | 'inside',
  ) => boolean;
}

/**
 * A tree view widget with expand/collapse, selection, keyboard navigation,
 * and drag reordering.
 *
 * @example
 * ```ts
 * const tree = new TreeWidget('hierarchy', {});
 * tree.setRoots([
 *   { id: 'world', label: 'World', children: [
 *     { id: 'player', label: 'Player', icon: 'box' },
 *     { id: 'enemy', label: 'Enemy', icon: 'box' },
 *   ]},
 * ]);
 * tree.onDidChangeSelection((ids) => console.log('Selected:', ids));
 * ```
 */
export class TreeWidget extends BaseWidget {
  private readonly _options: TreeWidgetOptions;
  private _roots: readonly TreeNode[] = [];
  private readonly _expanded = new Set<string>();
  private _selected = new Set<string>();
  private _focusedId: string | undefined;
  private _filterText = '';
  private readonly _hidden = new Set<string>();
  private _listEl: HTMLElement | undefined;
  // dataTransfer values are unreadable during dragover (security); cached here.
  private _dragSourceIds: readonly string[] | undefined;
  private _dropIndicatorRow: HTMLElement | undefined;
  private _autoExpand: { nodeId: string; timer: ReturnType<typeof setTimeout> } | undefined;
  // Shift-click range anchor — the last non-shift click.
  private _selectionAnchor: string | undefined;

  private readonly _onDidChangeSelection = new Emitter<readonly string[]>();
  private readonly _onDidChangeExpansion = new Emitter<{ id: string; expanded: boolean }>();
  private readonly _onDidChangeVisibility = new Emitter<{ id: string; visible: boolean }>();
  private readonly _onDidRequestAdd = new Emitter<void>();
  private readonly _onDidRequestDelete = new Emitter<readonly string[]>();
  private readonly _onDidRequestRename = new Emitter<string>();
  private readonly _onDidRequestDuplicate = new Emitter<readonly string[]>();
  private readonly _onDidRequestContextMenu = new Emitter<{
    ids: readonly string[];
    x: number;
    y: number;
  }>();
  private readonly _onDidRequestDrop = new Emitter<{
    sourceIds: readonly string[];
    targetId: string;
    position: 'before' | 'after' | 'inside';
  }>();

  /** Fired when the selection changes. */
  readonly onDidChangeSelection: Event<readonly string[]> = this._onDidChangeSelection.event;

  /** Fired when a node is expanded or collapsed. */
  readonly onDidChangeExpansion: Event<{ id: string; expanded: boolean }> =
    this._onDidChangeExpansion.event;

  /** Fired when a node's visibility is toggled. */
  readonly onDidChangeVisibility: Event<{ id: string; visible: boolean }> =
    this._onDidChangeVisibility.event;

  /** Fired when the "Add" button is clicked. */
  readonly onDidRequestAdd: Event<void> = this._onDidRequestAdd.event;

  /** Fired when Delete or Backspace is pressed with nodes selected. */
  readonly onDidRequestDelete: Event<readonly string[]> = this._onDidRequestDelete.event;

  /** Fired when F2 is pressed on a focused node. The id is the node to rename. */
  readonly onDidRequestRename: Event<string> = this._onDidRequestRename.event;

  /** Fired when Ctrl/Cmd+D is pressed with nodes selected. */
  readonly onDidRequestDuplicate: Event<readonly string[]> = this._onDidRequestDuplicate.event;

  /** Fired on right-click, providing selected IDs and mouse position. */
  readonly onDidRequestContextMenu: Event<{ ids: readonly string[]; x: number; y: number }> =
    this._onDidRequestContextMenu.event;

  /** Fired on drop. `position` is 'before' | 'after' (sibling) or 'inside' (child). */
  readonly onDidRequestDrop: Event<{
    sourceIds: readonly string[];
    targetId: string;
    position: 'before' | 'after' | 'inside';
  }> = this._onDidRequestDrop.event;

  constructor(id: string, options: TreeWidgetOptions = {}) {
    super(id, 'tree');
    this._options = options;
  }

  /** Set the root nodes of the tree. Triggers a full re-render. */
  setRoots(roots: readonly TreeNode[]): void {
    this._roots = roots;
    this._render();
  }

  /** Get the current root nodes. */
  getRoots(): readonly TreeNode[] {
    return this._roots;
  }

  /** Get currently selected node IDs. */
  getSelection(): readonly string[] {
    return [...this._selected];
  }

  /** Programmatically select nodes. */
  setSelection(ids: readonly string[]): void {
    this._selected = new Set(ids);
    this._render();
    this._onDidChangeSelection.fire([...this._selected]);
  }

  /** Expand a node by ID. */
  expand(nodeId: string): void {
    if (!this._expanded.has(nodeId)) {
      this._expanded.add(nodeId);
      this._render();
      this._onDidChangeExpansion.fire({ id: nodeId, expanded: true });
    }
  }

  /** Collapse a node by ID. */
  collapse(nodeId: string): void {
    if (this._expanded.has(nodeId)) {
      this._expanded.delete(nodeId);
      this._render();
      this._onDidChangeExpansion.fire({ id: nodeId, expanded: false });
    }
  }

  /** Whether a node is visible (not hidden). */
  isVisible(nodeId: string): boolean {
    return !this._hidden.has(nodeId);
  }

  /** Set a node's visibility. */
  setVisible(nodeId: string, visible: boolean): void {
    if (visible) {
      this._hidden.delete(nodeId);
    } else {
      this._hidden.add(nodeId);
    }
    this._render();
    this._onDidChangeVisibility.fire({ id: nodeId, visible });
  }

  /** Expand all nodes recursively. */
  expandAll(): void {
    const expandRecursive = (nodes: readonly TreeNode[]): void => {
      for (const node of nodes) {
        if (node.children && node.children.length > 0) {
          this._expanded.add(node.id);
          expandRecursive(node.children);
        }
      }
    };
    expandRecursive(this._roots);
    this._render();
  }

  /** Collapse all nodes. */
  collapseAll(): void {
    this._expanded.clear();
    this._render();
  }

  protected buildContent(root: HTMLElement): void {
    this._injectStyles();

    // Filter bar — icon inside input, more button outside
    if (this._options.showFilter) {
      const filterBar = this.appendElement(root, 'div', 'editrix-tree-filter');

      // Input wrapper with icon inside
      const inputWrap = createElement('div', 'editrix-tree-filter-wrap');
      const input = createElement('input', 'editrix-tree-filter-input');
      input.type = 'text';
      input.placeholder = this._options.filterPlaceholder ?? 'Filter...';
      input.addEventListener('input', () => {
        this._filterText = input.value.toLowerCase();
        this._render();
      });
      inputWrap.appendChild(input);
      const funnelBtn = createElement('span', 'editrix-tree-filter-icon');
      if (getIcon('filter')) {
        funnelBtn.appendChild(createIconElement('filter', 13));
      }
      inputWrap.appendChild(funnelBtn);
      filterBar.appendChild(inputWrap);

      // More button outside input
      const moreBtn = createElement('span', 'editrix-tree-filter-more');
      if (getIcon('more-vertical')) {
        moreBtn.appendChild(createIconElement('more-vertical', 14));
      }
      filterBar.appendChild(moreBtn);
    }

    // Add entity button with SVG icon
    if (this._options.showAddButton) {
      const addBtn = this.appendElement(root, 'button', 'editrix-tree-add-btn');
      if (getIcon('plus-circle')) {
        addBtn.appendChild(createIconElement('plus-circle', 14));
      }
      const addLabel = createElement('span');
      addLabel.textContent = this._options.addButtonLabel ?? 'Add Entity';
      addBtn.appendChild(addLabel);
      addBtn.addEventListener('click', () => {
        this._onDidRequestAdd.fire();
      });
    }

    this._listEl = this.appendElement(root, 'div', 'editrix-tree-list');
    this._listEl.tabIndex = 0;

    this._listEl.addEventListener('keydown', (e) => {
      this._handleKeyDown(e);
    });

    // List-level drag fallback: drops landing in the blank space below the
    // last row resolve to "after the last row" — the one position the
    // per-row 25/50/25 zones can't reach.
    if (this._options.enableDrag !== false) {
      this._listEl.addEventListener('dragover', (e) => {
        this._handleListDragover(e);
      });
      this._listEl.addEventListener('dragleave', (e) => {
        if (this._listEl?.contains(e.relatedTarget as Node | null)) return;
        this._clearDropIndicator();
      });
      this._listEl.addEventListener('drop', (e) => {
        this._handleListDrop(e);
      });
    }

    this._render();
  }

  private _handleListDragover(e: DragEvent): void {
    const sources = this._dragSourceIds;
    if (!sources || sources.length === 0) return;
    if ((e.target as HTMLElement | null)?.closest('.editrix-tree-row')) return;

    const lastRow = this._listEl?.lastElementChild as HTMLElement | null;
    if (!lastRow?.classList.contains('editrix-tree-row')) return;
    const lastId = lastRow.dataset['nodeId'];
    if (!lastId || sources.includes(lastId)) return;
    if (this._options.canDrop && !this._options.canDrop(sources, lastId, 'after')) return;

    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    this._setDropIndicator(lastRow, 'after');
  }

  private _handleListDrop(e: DragEvent): void {
    if ((e.target as HTMLElement | null)?.closest('.editrix-tree-row')) return;
    const raw = e.dataTransfer?.getData('text/x-editrix-tree-node');
    this._clearDropIndicator();
    if (!raw) return;
    let sources: string[];
    try {
      sources = JSON.parse(raw) as string[];
    } catch {
      return;
    }
    if (!Array.isArray(sources) || sources.length === 0) return;
    const lastRow = this._listEl?.lastElementChild as HTMLElement | null;
    if (!lastRow?.classList.contains('editrix-tree-row')) return;
    const lastId = lastRow.dataset['nodeId'];
    if (!lastId || sources.includes(lastId)) return;
    if (this._options.canDrop && !this._options.canDrop(sources, lastId, 'after')) return;
    e.preventDefault();
    this._onDidRequestDrop.fire({ sourceIds: sources, targetId: lastId, position: 'after' });
  }

  private _collectSelectedInDocumentOrder(): string[] {
    const out: string[] = [];
    const walk = (nodes: readonly TreeNode[]): void => {
      for (const node of nodes) {
        if (this._selected.has(node.id)) out.push(node.id);
        if (node.children && this._expanded.has(node.id)) walk(node.children);
      }
    };
    walk(this._roots);
    return out;
  }

  override dispose(): void {
    this._onDidChangeSelection.dispose();
    this._onDidChangeExpansion.dispose();
    this._onDidChangeVisibility.dispose();
    this._onDidRequestAdd.dispose();
    this._onDidRequestRename.dispose();
    this._onDidRequestDuplicate.dispose();
    this._onDidRequestDelete.dispose();
    this._onDidRequestContextMenu.dispose();
    super.dispose();
  }

  private _render(): void {
    if (!this._listEl) return;
    this._listEl.innerHTML = '';

    const roots = this._filterText ? this._filterTree(this._roots, this._filterText) : this._roots;

    if (roots.length === 0) {
      const empty = createElement('div', 'editrix-tree-empty');
      empty.textContent = this._filterText ? 'No matches' : 'No items';
      this._listEl.appendChild(empty);
      return;
    }

    this._renderNodes(roots, 0, false, []);
  }

  private _hasSelectedDescendant(nodes: readonly TreeNode[]): boolean {
    for (const node of nodes) {
      if (this._selected.has(node.id)) return true;
      if (
        node.children &&
        this._expanded.has(node.id) &&
        this._hasSelectedDescendant(node.children)
      )
        return true;
    }
    return false;
  }

  /**
   * @param guides Array of booleans, one per ancestor depth.
   *               true = ancestor at that depth has more siblings below → draw continuing line.
   *               false = ancestor was the last child → no line at that depth.
   */
  private _renderNodes(
    nodes: readonly TreeNode[],
    depth: number,
    parentHidden: boolean,
    guides: boolean[],
  ): void {
    const indent = this._options.indentSize ?? 16;

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (!node) continue;
      const isLastChild = i === nodes.length - 1;
      const hasChildren = node.children !== undefined && node.children.length > 0;
      const isExpanded = this._expanded.has(node.id);
      const isSelected = this._selected.has(node.id);
      const isFocused = this._focusedId === node.id;
      const isParentOfSelected =
        hasChildren && isExpanded && this._hasSelectedDescendant(node.children);
      const isSelfHidden = this._hidden.has(node.id);
      const isHidden = isSelfHidden || parentHidden;

      const row = createElement('div', 'editrix-tree-row');
      row.dataset['nodeId'] = node.id;

      if (isSelected) row.classList.add('editrix-tree-row--selected');
      if (isFocused) row.classList.add('editrix-tree-row--focused');
      if (isParentOfSelected) row.classList.add('editrix-tree-row--parent-selected');
      if (isHidden) row.classList.add('editrix-tree-row--hidden');

      // Indent guides — one vertical line segment per ancestor level
      for (let g = 0; g < depth; g++) {
        const guide = createElement('span', 'editrix-tree-guide');
        guide.style.width = `${String(indent)}px`;
        if (guides[g]) {
          guide.classList.add('editrix-tree-guide--active');
        }
        row.appendChild(guide);
      }

      // Arrow (SVG chevron) or leaf dot
      const arrow = createElement('span', 'editrix-tree-arrow');
      if (hasChildren) {
        arrow.classList.add('editrix-tree-arrow--interactive');
        const chevronName = isExpanded ? 'chevron-down' : 'chevron-right';
        if (getIcon(chevronName)) {
          arrow.appendChild(createIconElement(chevronName, 14));
        }
        arrow.addEventListener('click', (e) => {
          e.stopPropagation();
          if (isExpanded) this.collapse(node.id);
          else this.expand(node.id);
        });
      } else {
        arrow.classList.add('editrix-tree-arrow--leaf');
      }
      row.appendChild(arrow);

      // Icon
      if (node.icon && getIcon(node.icon)) {
        row.appendChild(createIconElement(node.icon, 14));
      }

      // Label
      const label = createElement('span', 'editrix-tree-label');
      if (node.labelClassName) label.classList.add(node.labelClassName);
      label.textContent = node.label;
      row.appendChild(label);

      // Visibility toggle (eye icon)
      if (this._options.showVisibility) {
        const isNodeVisible = !this._hidden.has(node.id);
        const eyeBtn = createElement('span', 'editrix-tree-eye');
        const iconName = isNodeVisible ? 'eye' : 'eye-off';
        if (getIcon(iconName)) {
          eyeBtn.appendChild(createIconElement(iconName, 12));
        } else {
          eyeBtn.textContent = isNodeVisible ? '\u{25C9}' : '\u{25CE}';
        }
        eyeBtn.classList.toggle('editrix-tree-eye--hidden', !isNodeVisible);
        eyeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          this.setVisible(node.id, !isNodeVisible);
        });
        eyeBtn.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          e.preventDefault();
        });
        row.appendChild(eyeBtn);
      }

      // Right-click = context menu
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        // If the right-clicked node isn't selected, select it first
        if (!this._selected.has(node.id)) {
          this._selected.clear();
          this._selected.add(node.id);
          this._focusedId = node.id;
          this._render();
          this._onDidChangeSelection.fire([...this._selected]);
        }
        this._onDidRequestContextMenu.fire({
          ids: [...this._selected],
          x: e.clientX,
          y: e.clientY,
        });
      });

      // Click = select
      row.addEventListener('click', (e) => {
        this._handleRowClick(node.id, e);
      });

      // Double-click = expand/collapse
      row.addEventListener('dblclick', () => {
        if (hasChildren) {
          if (isExpanded) this.collapse(node.id);
          else this.expand(node.id);
        }
      });

      if (this._options.enableDrag !== false) {
        row.draggable = true;
        row.addEventListener('dragstart', (e) => {
          const sources = this._selected.has(node.id)
            ? this._collectSelectedInDocumentOrder()
            : [node.id];
          if (!this._selected.has(node.id)) {
            this._selected = new Set([node.id]);
            this._focusedId = node.id;
            // Skipping _render() here — re-rendering mid-dragstart aborts
            // the native drag session.
            this._onDidChangeSelection.fire([node.id]);
          }

          e.dataTransfer?.setData('text/x-editrix-tree-node', JSON.stringify(sources));
          // `copyMove` so drop targets outside the tree (e.g. Content
          // Browser folder cards creating prefabs) can use dropEffect='copy'
          // while internal tree reparenting still uses 'move'. Without this
          // a copy-typed drop is silently rejected by the browser.
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copyMove';
          this._dragSourceIds = sources;

          const sourceSet = new Set(sources);
          this._listEl?.querySelectorAll('.editrix-tree-row').forEach((el) => {
            const id = (el as HTMLElement).dataset['nodeId'];
            if (id && sourceSet.has(id)) el.classList.add('editrix-tree-row--dragging');
          });
        });
        row.addEventListener('dragend', () => {
          this._listEl?.querySelectorAll('.editrix-tree-row--dragging').forEach((el) => {
            el.classList.remove('editrix-tree-row--dragging');
          });
          this._dragSourceIds = undefined;
          this._clearDropIndicator();
        });
        row.addEventListener('dragover', (e) => {
          const sources = e.dataTransfer?.types.includes('text/x-editrix-tree-node')
            ? this._dragSourceIds
            : undefined;
          if (!sources || sources.length === 0) return;
          if (sources.includes(node.id)) return;

          const rect = row.getBoundingClientRect();
          const relY = (e.clientY - rect.top) / rect.height;
          const position: 'before' | 'after' | 'inside' =
            relY < 0.25 ? 'before' : relY > 0.75 ? 'after' : 'inside';

          if (this._options.canDrop && !this._options.canDrop(sources, node.id, position)) {
            return;
          }

          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
          this._setDropIndicator(row, position);
          this._updateAutoExpand(node, position);
        });
        row.addEventListener('dragleave', (e) => {
          if (row.contains(e.relatedTarget as Node | null)) return;
          this._clearDropIndicator();
        });
        row.addEventListener('drop', (e) => {
          e.preventDefault();
          const raw = e.dataTransfer?.getData('text/x-editrix-tree-node');
          this._clearDropIndicator();
          if (!raw) return;
          let sources: string[];
          try {
            sources = JSON.parse(raw) as string[];
          } catch {
            return;
          }
          if (!Array.isArray(sources) || sources.length === 0) return;
          if (sources.includes(node.id)) return;
          const rect = row.getBoundingClientRect();
          const relY = (e.clientY - rect.top) / rect.height;
          const position: 'before' | 'after' | 'inside' =
            relY < 0.25 ? 'before' : relY > 0.75 ? 'after' : 'inside';
          if (this._options.canDrop && !this._options.canDrop(sources, node.id, position)) return;
          this._onDidRequestDrop.fire({ sourceIds: sources, targetId: node.id, position });
        });
      }

      this._listEl?.appendChild(row);

      // Render children if expanded
      if (hasChildren && isExpanded) {
        const childGuides = [...guides, !isLastChild];
        this._renderNodes(node.children, depth + 1, isHidden, childGuides);
      }
    }
  }

  private _handleRowClick(nodeId: string, e: MouseEvent): void {
    this._focusedId = nodeId;

    if (this._options.multiSelect && e.shiftKey && this._selectionAnchor !== undefined) {
      const flat = this._getFlatVisibleIds();
      const a = flat.indexOf(this._selectionAnchor);
      const b = flat.indexOf(nodeId);
      if (a !== -1 && b !== -1) {
        const [from, to] = a < b ? [a, b] : [b, a];
        this._selected = new Set(flat.slice(from, to + 1));
      } else {
        this._selected = new Set([nodeId]);
      }
    } else if (this._options.multiSelect && (e.ctrlKey || e.metaKey)) {
      if (this._selected.has(nodeId)) {
        this._selected.delete(nodeId);
      } else {
        this._selected.add(nodeId);
      }
      this._selectionAnchor = nodeId;
    } else {
      this._selected = new Set([nodeId]);
      this._selectionAnchor = nodeId;
    }

    this._render();
    this._onDidChangeSelection.fire([...this._selected]);
  }

  private _handleKeyDown(e: KeyboardEvent): void {
    const flatIds = this._getFlatVisibleIds();
    const currentIdx = this._focusedId !== undefined ? flatIds.indexOf(this._focusedId) : -1;

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const nextIdx = Math.min(currentIdx + 1, flatIds.length - 1);
        const nextId = flatIds[nextIdx];
        if (nextId) {
          this._focusedId = nextId;
          this._selected.clear();
          this._selected.add(nextId);
          this._render();
          this._onDidChangeSelection.fire([...this._selected]);
        }
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const prevIdx = Math.max(currentIdx - 1, 0);
        const prevId = flatIds[prevIdx];
        if (prevId) {
          this._focusedId = prevId;
          this._selected.clear();
          this._selected.add(prevId);
          this._render();
          this._onDidChangeSelection.fire([...this._selected]);
        }
        break;
      }
      case 'ArrowRight': {
        if (this._focusedId) {
          this.expand(this._focusedId);
        }
        break;
      }
      case 'ArrowLeft': {
        if (this._focusedId) {
          this.collapse(this._focusedId);
        }
        break;
      }
      case 'Delete':
      case 'Backspace': {
        e.preventDefault();
        if (this._selected.size > 0) {
          this._onDidRequestDelete.fire([...this._selected]);
        }
        break;
      }
      case 'F2': {
        if (this._focusedId) {
          e.preventDefault();
          this._onDidRequestRename.fire(this._focusedId);
        }
        break;
      }
      case 'd':
      case 'D': {
        if ((e.ctrlKey || e.metaKey) && this._selected.size > 0) {
          e.preventDefault();
          this._onDidRequestDuplicate.fire([...this._selected]);
        }
        break;
      }
    }
  }

  /** Get a flat list of visible node IDs (expanded nodes show their children). */
  private _getFlatVisibleIds(): string[] {
    const result: string[] = [];
    const collect = (nodes: readonly TreeNode[]): void => {
      for (const node of nodes) {
        result.push(node.id);
        if (node.children && this._expanded.has(node.id)) {
          collect(node.children);
        }
      }
    };
    collect(this._roots);
    return result;
  }

  /**
   * Recursively filter the tree, keeping nodes that match and their ancestors.
   */
  private _filterTree(nodes: readonly TreeNode[], query: string): TreeNode[] {
    const result: TreeNode[] = [];
    for (const node of nodes) {
      const labelMatch = node.label.toLowerCase().includes(query);
      const filteredChildren = node.children ? this._filterTree(node.children, query) : [];

      if (labelMatch || filteredChildren.length > 0) {
        const newNode: TreeNode = Object.assign(
          { id: node.id, label: node.label },
          node.icon !== undefined ? { icon: node.icon } : {},
          node.labelClassName !== undefined ? { labelClassName: node.labelClassName } : {},
          filteredChildren.length > 0
            ? { children: filteredChildren }
            : node.children !== undefined
              ? { children: node.children }
              : {},
        );
        result.push(newNode);
        // Auto-expand matching parents
        if (filteredChildren.length > 0) {
          this._expanded.add(node.id);
        }
      }
    }
    return result;
  }

  private _setDropIndicator(row: HTMLElement, position: 'before' | 'after' | 'inside'): void {
    if (this._dropIndicatorRow && this._dropIndicatorRow !== row) {
      this._dropIndicatorRow.classList.remove(
        'editrix-tree-row--drop-before',
        'editrix-tree-row--drop-after',
        'editrix-tree-row--drop-inside',
      );
    }
    row.classList.remove(
      'editrix-tree-row--drop-before',
      'editrix-tree-row--drop-after',
      'editrix-tree-row--drop-inside',
    );
    row.classList.add(`editrix-tree-row--drop-${position}`);
    this._dropIndicatorRow = row;
  }

  private _clearDropIndicator(): void {
    if (this._dropIndicatorRow) {
      this._dropIndicatorRow.classList.remove(
        'editrix-tree-row--drop-before',
        'editrix-tree-row--drop-after',
        'editrix-tree-row--drop-inside',
      );
      this._dropIndicatorRow = undefined;
    }
    this._cancelAutoExpand();
  }

  // ~500ms hover on a collapsed row with children expands it mid-drag so
  // the user can reach descendants without letting go to click the chevron.
  private _updateAutoExpand(node: TreeNode, position: 'before' | 'after' | 'inside'): void {
    const eligible =
      position === 'inside' &&
      node.children !== undefined &&
      node.children.length > 0 &&
      !this._expanded.has(node.id);
    if (!eligible) {
      this._cancelAutoExpand();
      return;
    }
    if (this._autoExpand?.nodeId === node.id) return;
    this._cancelAutoExpand();
    const nodeId = node.id;
    const timer = setTimeout(() => {
      this._autoExpand = undefined;
      this.expand(nodeId);
    }, 500);
    this._autoExpand = { nodeId, timer };
  }

  private _cancelAutoExpand(): void {
    if (!this._autoExpand) return;
    clearTimeout(this._autoExpand.timer);
    this._autoExpand = undefined;
  }

  private _injectStyles(): void {
    if (document.getElementById('editrix-tree-styles')) return;
    const style = document.createElement('style');
    style.id = 'editrix-tree-styles';
    style.textContent = `
      .editrix-tree-list {
        flex: 1;
        overflow-y: auto;
        outline: none;
        padding: 2px 0;
      }
      .editrix-tree-empty {
        padding: 16px;
        text-align: center;
        color: var(--editrix-text-dim);
        font-size: 12px;
      }

      /* ── Row ── */
      .editrix-tree-row {
        display: flex;
        align-items: center;
        gap: 3px;
        padding: 0 8px 0 4px;
        cursor: pointer;
        font-size: 12px;
        height: 24px;
        margin: 1px 6px;
        border: 1px solid transparent;
        border-radius: 4px;
        transition: background 0.06s;
      }
      .editrix-tree-row:hover {
        background: rgba(255, 255, 255, 0.04);
      }
      /* Selected = blue outline border with rounded corners, subtle fill */
      .editrix-tree-row--selected {
        border-color: var(--editrix-accent) !important;
        background: rgba(74, 143, 255, 0.08) !important;
      }
      .editrix-tree-row--selected:hover {
        background: rgba(74, 143, 255, 0.13) !important;
      }
      .editrix-tree-row--focused:not(.editrix-tree-row--selected) {
        background: rgba(255,255,255,0.05);
      }
      .editrix-tree-row--parent-selected {
        background: rgba(255, 255, 255, 0.03);
      }

      /* Drag-and-drop indicators (before/after = 2px line, inside = fill). */
      .editrix-tree-row--dragging {
        opacity: 0.4;
      }
      .editrix-tree-row--drop-before,
      .editrix-tree-row--drop-after {
        position: relative;
      }
      .editrix-tree-row--drop-before::before,
      .editrix-tree-row--drop-after::after {
        content: '';
        position: absolute;
        left: 6px;
        right: 6px;
        height: 2px;
        background: var(--editrix-accent);
        pointer-events: none;
      }
      .editrix-tree-row--drop-before::before { top: -1px; }
      .editrix-tree-row--drop-after::after   { bottom: -1px; }
      .editrix-tree-row--drop-inside {
        background: rgba(74, 143, 255, 0.18) !important;
        border-color: var(--editrix-accent) !important;
      }

      /* ── Indent guides ── */
      .editrix-tree-guide {
        position: relative;
        height: 100%;
        flex-shrink: 0;
      }
      .editrix-tree-guide--active::before {
        content: '';
        position: absolute;
        left: 50%;
        top: 0;
        bottom: 0;
        width: 1px;
        background: rgba(255, 255, 255, 0.08);
      }

      /* ── Arrow (SVG chevron) / Leaf dot ── */
      .editrix-tree-arrow {
        width: 16px; height: 16px;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0;
        color: var(--editrix-text-dim);
      }
      .editrix-tree-arrow--leaf::before {
        content: '';
        width: 4px; height: 4px;
        border-radius: 50%;
        background: var(--editrix-text-dim);
        opacity: 0.4;
      }
      .editrix-tree-arrow--interactive { cursor: pointer; }
      .editrix-tree-arrow--interactive:hover { color: var(--editrix-text); }

      /* ── Label ── */
      .editrix-tree-label {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* ── Add button ── */
      .editrix-tree-add-btn {
        display: flex; align-items: center; justify-content: center;
        gap: 6px;
        margin: 4px 8px; padding: 5px 0;
        background: rgba(255,255,255,0.08);
        border: 1px dashed rgba(255,255,255,0.15);
        border-radius: 4px;
        color: var(--editrix-text);
        font-family: inherit; font-size: 12px;
        cursor: pointer; flex-shrink: 0;
        transition: background 0.1s, border-color 0.1s;
      }
      .editrix-tree-add-btn:hover {
        background: rgba(74, 143, 255, 0.12);
        border-color: var(--editrix-accent);
        color: var(--editrix-accent);
      }
      .editrix-tree-add-btn:active {
        background: rgba(74, 143, 255, 0.18);
      }

      /* ── Filter ── */
      .editrix-tree-filter {
        display: flex; align-items: center; gap: 4px;
        padding: 4px 8px;
        flex-shrink: 0;
      }
      .editrix-tree-filter-wrap {
        flex: 1;
        position: relative;
        display: flex;
        align-items: center;
      }
      .editrix-tree-filter-input {
        width: 100%;
        background: var(--editrix-background);
        border: 1px solid var(--editrix-border);
        color: var(--editrix-text);
        padding: 3px 28px 3px 8px;
        border-radius: 3px;
        font-family: inherit;
        font-size: 12px;
        outline: none;
      }
      .editrix-tree-filter-input:focus {
        border-color: var(--editrix-accent);
      }
      .editrix-tree-filter-icon {
        position: absolute;
        right: 4px; top: 50%; transform: translateY(-50%);
        color: var(--editrix-text-dim); cursor: pointer;
        display: flex; align-items: center;
        padding: 2px;
      }
      .editrix-tree-filter-icon:hover { color: var(--editrix-text); }
      .editrix-tree-filter-more {
        color: var(--editrix-text-dim); cursor: pointer;
        display: flex; align-items: center;
        padding: 2px 2px;
        flex-shrink: 0;
      }
      .editrix-tree-filter-more:hover { color: var(--editrix-text); }

      /* ── Eye icon — always visible ── */
      .editrix-tree-eye {
        flex-shrink: 0;
        cursor: pointer;
        opacity: 0.55;
        padding: 0 2px;
        display: flex;
        align-items: center;
        color: var(--editrix-text-dim);
        font-size: 11px;
        transition: opacity 0.1s;
      }
      .editrix-tree-row:hover .editrix-tree-eye { opacity: 0.75; }
      .editrix-tree-eye:hover { opacity: 1 !important; color: var(--editrix-text); }
      .editrix-tree-eye--hidden { opacity: 0.2 !important; }
      .editrix-tree-row:hover .editrix-tree-eye--hidden { opacity: 0.4; }

      /* ── Hidden row ── */
      .editrix-tree-row--hidden { opacity: 0.5; }
      .editrix-tree-row--hidden .editrix-tree-label {
        color: var(--editrix-text-dim);
      }
    `;
    document.head.appendChild(style);
  }
}
