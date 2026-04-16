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
  private _expanded = new Set<string>();
  private _selected = new Set<string>();
  private _focusedId: string | undefined;
  private _filterText = '';
  private _hidden = new Set<string>();
  private _listEl: HTMLElement | undefined;

  private readonly _onDidChangeSelection = new Emitter<readonly string[]>();
  private readonly _onDidChangeExpansion = new Emitter<{ id: string; expanded: boolean }>();
  private readonly _onDidChangeVisibility = new Emitter<{ id: string; visible: boolean }>();

  /** Fired when the selection changes. */
  readonly onDidChangeSelection: Event<readonly string[]> = this._onDidChangeSelection.event;

  /** Fired when a node is expanded or collapsed. */
  readonly onDidChangeExpansion: Event<{ id: string; expanded: boolean }> = this._onDidChangeExpansion.event;

  /** Fired when a node's visibility is toggled. */
  readonly onDidChangeVisibility: Event<{ id: string; visible: boolean }> = this._onDidChangeVisibility.event;

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
    }

    this._listEl = this.appendElement(root, 'div', 'editrix-tree-list');
    this._listEl.tabIndex = 0;

    // Keyboard navigation
    this._listEl.addEventListener('keydown', (e) => { this._handleKeyDown(e); });

    this._render();
  }

  override dispose(): void {
    this._onDidChangeSelection.dispose();
    this._onDidChangeExpansion.dispose();
    this._onDidChangeVisibility.dispose();
    super.dispose();
  }

  private _render(): void {
    if (!this._listEl) return;
    this._listEl.innerHTML = '';

    const roots = this._filterText
      ? this._filterTree(this._roots, this._filterText)
      : this._roots;

    if (roots.length === 0) {
      const empty = createElement('div', 'editrix-tree-empty');
      empty.textContent = this._filterText ? 'No matches' : 'No items';
      this._listEl.appendChild(empty);
      return;
    }

    this._renderNodes(roots, 0);
  }

  private _hasSelectedDescendant(nodes: readonly TreeNode[]): boolean {
    for (const node of nodes) {
      if (this._selected.has(node.id)) return true;
      if (node.children && this._expanded.has(node.id) && this._hasSelectedDescendant(node.children)) return true;
    }
    return false;
  }

  private _renderNodes(nodes: readonly TreeNode[], depth: number, parentHidden = false): void {
    const indent = this._options.indentSize ?? 16;

    for (const node of nodes) {
      const hasChildren = node.children !== undefined && node.children.length > 0;
      const isExpanded = this._expanded.has(node.id);
      const isSelected = this._selected.has(node.id);
      const isFocused = this._focusedId === node.id;
      const isParentOfSelected = hasChildren && isExpanded && this._hasSelectedDescendant(node.children);
      const isSelfHidden = this._hidden.has(node.id);
      const isHidden = isSelfHidden || parentHidden;

      const row = createElement('div', 'editrix-tree-row');
      row.dataset['nodeId'] = node.id;
      row.style.paddingLeft = `${String(depth * indent + 4)}px`;

      if (isSelected) row.classList.add('editrix-tree-row--selected');
      if (isFocused) row.classList.add('editrix-tree-row--focused');
      if (isParentOfSelected) row.classList.add('editrix-tree-row--parent-selected');
      if (isHidden) row.classList.add('editrix-tree-row--hidden');

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

      this._listEl?.appendChild(row);

      // Render children if expanded
      if (hasChildren && isExpanded) {
        this._renderNodes(node.children!, depth + 1, isHidden);
      }
    }
  }

  private _handleRowClick(nodeId: string, e: MouseEvent): void {
    this._focusedId = nodeId;

    if (this._options.multiSelect && (e.ctrlKey || e.metaKey)) {
      // Toggle selection
      if (this._selected.has(nodeId)) {
        this._selected.delete(nodeId);
      } else {
        this._selected.add(nodeId);
      }
    } else {
      // Single select
      this._selected.clear();
      this._selected.add(nodeId);
    }

    this._render();
    this._onDidChangeSelection.fire([...this._selected]);
  }

  private _handleKeyDown(e: KeyboardEvent): void {
    const flatIds = this._getFlatVisibleIds();
    const currentIdx = this._focusedId ? flatIds.indexOf(this._focusedId) : -1;

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
          filteredChildren.length > 0 ? { children: filteredChildren } : node.children !== undefined ? { children: node.children } : {},
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
        padding: 0 8px;
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
        background: rgba(255,255,255,0.06);
        border: 1px solid var(--editrix-border);
        border-radius: 4px;
        color: var(--editrix-text-dim);
        font-family: inherit; font-size: 12px;
        cursor: pointer; flex-shrink: 0;
      }
      .editrix-tree-add-btn:hover {
        background: rgba(255,255,255,0.1);
        color: var(--editrix-text);
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
