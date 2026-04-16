import type { PropertyDescriptor, PropertyGroup } from '@editrix/properties';
import { createElement } from '../dom-utils.js';
import { createIconElement, getIcon } from '../icons.js';
import { BaseWidget } from './base-widget.js';

/** Callback when a property value is changed via the UI. */
export type PropertyChangeHandler = (key: string, value: unknown) => void;

/**
 * Inspector-style property grid with collapsible component cards,
 * drag-to-adjust numeric fields, and auto-generated controls.
 *
 * @example
 * ```ts
 * const grid = new PropertyGridWidget('inspector', {
 *   onChange: (key, value) => scene.setProperty(nodeId, key, value),
 * });
 * grid.setData(groups, currentValues);
 * ```
 */
export class PropertyGridWidget extends BaseWidget {
  private readonly _onChange: PropertyChangeHandler | undefined;
  private _groups: readonly PropertyGroup[] = [];
  private _values: Record<string, unknown> = {};
  private _collapsed = new Set<string>();
  private _contentEl: HTMLElement | undefined;

  constructor(id: string, options?: PropertyGridOptions) {
    super(id, 'property-grid');
    this._onChange = options?.onChange;
  }

  setData(groups: readonly PropertyGroup[], values: Record<string, unknown>): void {
    this._groups = groups;
    this._values = { ...values };
    this._renderGrid();
  }

  updateValue(key: string, value: unknown): void {
    this._values[key] = value;
    this._renderGrid();
  }

  protected buildContent(root: HTMLElement): void {
    this._injectStyles();

    // Filter bar — icon inside input
    const filterBar = this.appendElement(root, 'div', 'editrix-inspector-filter');
    const filterWrap = createElement('div', 'editrix-inspector-filter-wrap');
    const filterInput = createElement('input', 'editrix-inspector-filter-input');
    filterInput.type = 'text';
    filterInput.placeholder = 'Filter...';
    filterWrap.appendChild(filterInput);
    const filterIcon = createElement('span', 'editrix-inspector-filter-icon');
    if (getIcon('filter')) {
      filterIcon.appendChild(createIconElement('filter', 13));
    }
    filterWrap.appendChild(filterIcon);
    filterBar.appendChild(filterWrap);
    const filterMore = createElement('span', 'editrix-inspector-filter-more');
    if (getIcon('more-vertical')) {
      filterMore.appendChild(createIconElement('more-vertical', 14));
    }
    filterBar.appendChild(filterMore);

    // Add Component button with SVG icon
    const addBtn = this.appendElement(root, 'button', 'editrix-inspector-add-btn');
    if (getIcon('plus-circle')) {
      addBtn.appendChild(createIconElement('plus-circle', 14));
    }
    const addLabel = createElement('span');
    addLabel.textContent = 'Add Component';
    addBtn.appendChild(addLabel);

    this._contentEl = this.appendElement(root, 'div', 'editrix-inspector');
    this._renderGrid();
  }

  private _renderGrid(): void {
    if (!this._contentEl) return;
    this._contentEl.innerHTML = '';

    if (this._groups.length === 0) {
      const empty = createElement('div', 'editrix-inspector-empty');
      empty.textContent = 'Select a node to inspect';
      this._contentEl.appendChild(empty);
      return;
    }

    for (const group of this._groups) {
      this._renderCard(group);
    }
  }

  private _renderCard(group: PropertyGroup): void {
    if (!this._contentEl) return;

    const card = createElement('div', 'editrix-inspector-card');
    const isCollapsed = this._collapsed.has(group.id);

    // Header — dark bar with chevron + icon + title + more
    const header = createElement('div', 'editrix-inspector-card-header');

    const chevron = createElement('span', 'editrix-inspector-chevron');
    if (getIcon(isCollapsed ? 'chevron-right' : 'chevron-down')) {
      chevron.appendChild(createIconElement(isCollapsed ? 'chevron-right' : 'chevron-down', 14));
    }
    header.appendChild(chevron);

    // Component icon
    if (getIcon('settings')) {
      const ico = createIconElement('settings', 14);
      ico.style.opacity = '0.6';
      header.appendChild(ico);
    }

    const title = createElement('span', 'editrix-inspector-card-title');
    title.textContent = group.label;
    header.appendChild(title);

    const menu = createElement('span', 'editrix-inspector-card-menu');
    menu.textContent = '\u22EF';
    header.appendChild(menu);

    header.addEventListener('click', () => {
      if (this._collapsed.has(group.id)) {
        this._collapsed.delete(group.id);
      } else {
        this._collapsed.add(group.id);
      }
      this._renderGrid();
    });

    card.appendChild(header);

    // Body — stacked layout: label row then control row
    if (!isCollapsed) {
      const body = createElement('div', 'editrix-inspector-card-body');
      const props = group.properties;
      let i = 0;
      while (i < props.length) {
        const p = props[i]!;
        const base = p.key.replace(/\.x$/, '');
        const pY = props[i + 1];
        const pZ = props[i + 2];
        if (p.key.endsWith('.x') && pY?.key === `${base}.y` && pZ?.key === `${base}.z`) {
          body.appendChild(this._renderVectorRow(base.split('.').pop() ?? base, p, pY, pZ));
          i += 3;
        } else {
          body.appendChild(this._renderProperty(p));
          i++;
        }
      }
      card.appendChild(body);
    }

    this._contentEl.appendChild(card);
  }

  /** Render vector property: label on own row, XYZ inputs on next row (full width). */
  private _renderVectorRow(label: string, px: PropertyDescriptor, py: PropertyDescriptor, pz: PropertyDescriptor): HTMLElement {
    const row = createElement('div', 'editrix-inspector-stacked-row');

    const lbl = createElement('label', 'editrix-inspector-label');
    lbl.textContent = label.charAt(0).toUpperCase() + label.slice(1);
    row.appendChild(lbl);

    const fields = createElement('div', 'editrix-inspector-vector-fields');
    const axes: Array<{ prop: PropertyDescriptor; axis: string; color: string }> = [
      { prop: px, axis: 'X', color: 'var(--editrix-axis-x)' },
      { prop: py, axis: 'Y', color: 'var(--editrix-axis-y)' },
      { prop: pz, axis: 'Z', color: 'var(--editrix-axis-z)' },
    ];

    for (const { prop, axis, color } of axes) {
      const field = createElement('div', 'editrix-inspector-vector-field');
      field.style.borderLeftColor = color;

      const axisLabel = createElement('span', 'editrix-inspector-axis-label');
      axisLabel.textContent = axis;
      field.appendChild(axisLabel);

      const input = createElement('input', 'editrix-inspector-input editrix-inspector-vector-input');
      input.type = 'number';
      input.value = String(this._values[prop.key] ?? 0);
      input.addEventListener('change', () => { this._fireChange(prop.key, parseFloat(input.value)); });

      // Drag-to-adjust on axis label
      this._setupDragAdjust(axisLabel, prop);

      field.appendChild(input);
      fields.appendChild(field);
    }

    row.appendChild(fields);
    return row;
  }

  /** Render a single property. Bool uses inline row; others use stacked layout. */
  private _renderProperty(prop: PropertyDescriptor): HTMLElement {
    // Boolean: label and checkbox on the SAME row
    if (prop.type === 'boolean') {
      const row = createElement('div', 'editrix-inspector-inline-row');
      const label = createElement('label', 'editrix-inspector-label');
      label.textContent = prop.label;
      if (prop.description) label.title = prop.description;
      row.appendChild(label);
      const control = this._createControl(prop);
      row.appendChild(control);
      return row;
    }

    // All others: label above, control below (stacked)
    const row = createElement('div', 'editrix-inspector-stacked-row');

    const label = createElement('label', 'editrix-inspector-label');
    label.textContent = prop.label;
    if (prop.description) label.title = prop.description;

    if (prop.type === 'number' || prop.type === 'range') {
      label.classList.add('editrix-inspector-label--draggable');
      this._setupDragAdjust(label, prop);
    }

    row.appendChild(label);

    const control = this._createControl(prop);
    row.appendChild(control);

    return row;
  }

  private _createControl(prop: PropertyDescriptor): HTMLElement {
    const wrapper = createElement('div', 'editrix-inspector-control');
    const value = this._values[prop.key];
    const readOnly = prop.readOnly ?? false;

    switch (prop.type) {
      case 'boolean': {
        const cb = createElement('input', 'editrix-inspector-checkbox');
        cb.type = 'checkbox';
        cb.checked = value as boolean;
        cb.disabled = readOnly;
        cb.addEventListener('change', () => { this._fireChange(prop.key, cb.checked); });
        wrapper.appendChild(cb);
        break;
      }

      case 'number': {
        const input = createElement('input', 'editrix-inspector-input');
        input.type = 'number';
        input.value = String(value ?? 0);
        input.readOnly = readOnly;
        input.addEventListener('change', () => { this._fireChange(prop.key, parseFloat(input.value)); });
        wrapper.appendChild(input);
        break;
      }

      case 'string': {
        const input = createElement('input', 'editrix-inspector-input');
        input.type = 'text';
        input.value = value as string ?? '';
        input.readOnly = readOnly;
        input.addEventListener('change', () => { this._fireChange(prop.key, input.value); });
        wrapper.appendChild(input);
        break;
      }

      case 'enum': {
        const select = createElement('select', 'editrix-inspector-select');
        select.disabled = readOnly;
        for (const v of prop.enumValues ?? []) {
          const opt = createElement('option');
          opt.value = v;
          opt.textContent = v;
          if (v === value) opt.selected = true;
          select.appendChild(opt);
        }
        select.addEventListener('change', () => { this._fireChange(prop.key, select.value); });
        wrapper.appendChild(select);
        break;
      }

      case 'range': {
        const row = createElement('div', 'editrix-inspector-range-row');
        const input = createElement('input', 'editrix-inspector-input');
        input.type = 'number';
        input.min = String(prop.min ?? 0);
        input.max = String(prop.max ?? 100);
        input.step = String(prop.step ?? 1);
        input.value = String(value ?? 0);
        input.readOnly = readOnly;

        const slider = createElement('input', 'editrix-inspector-slider');
        slider.type = 'range';
        slider.min = String(prop.min ?? 0);
        slider.max = String(prop.max ?? 100);
        slider.step = String(prop.step ?? 1);
        slider.value = String(value ?? 0);
        slider.disabled = readOnly;

        slider.addEventListener('input', () => {
          input.value = slider.value;
          this._fireChange(prop.key, parseFloat(slider.value));
        });
        input.addEventListener('change', () => {
          slider.value = input.value;
          this._fireChange(prop.key, parseFloat(input.value));
        });

        row.appendChild(slider);
        row.appendChild(input);
        wrapper.appendChild(row);
        break;
      }

      case 'color': {
        const row = createElement('div', 'editrix-inspector-color-row');
        const swatch = createElement('input', 'editrix-inspector-color');
        swatch.type = 'color';
        swatch.value = value as string ?? '#000000';
        swatch.disabled = readOnly;

        const hex = createElement('input', 'editrix-inspector-input');
        hex.type = 'text';
        hex.value = value as string ?? '#000000';
        hex.readOnly = readOnly;

        swatch.addEventListener('input', () => {
          hex.value = swatch.value;
          this._fireChange(prop.key, swatch.value);
        });
        hex.addEventListener('change', () => {
          swatch.value = hex.value;
          this._fireChange(prop.key, hex.value);
        });

        row.appendChild(swatch);
        row.appendChild(hex);
        wrapper.appendChild(row);
        break;
      }

      case 'object':
      case 'array':
      case 'vector2':
      case 'vector3': {
        const fallback = createElement('span', 'editrix-inspector-readonly');
        fallback.textContent = value !== undefined ? JSON.stringify(value) : '—';
        wrapper.appendChild(fallback);
        break;
      }
    }

    return wrapper;
  }

  /** Drag-to-adjust: hold mouse on label, drag left/right to change numeric value. */
  private _setupDragAdjust(label: HTMLElement, prop: PropertyDescriptor): void {
    const ratio = prop.step ?? (prop.type === 'range' ? 0.1 : 0.1);

    label.addEventListener('mousedown', (startEvent) => {
      startEvent.preventDefault();
      const startX = startEvent.clientX;
      const startValue = this._values[prop.key] as number ?? 0;
      label.classList.add('editrix-inspector-label--dragging');

      const onMove = (e: MouseEvent): void => {
        const delta = (e.clientX - startX) * ratio;
        let newValue = startValue + delta;
        if (prop.min !== undefined) newValue = Math.max(prop.min, newValue);
        if (prop.max !== undefined) newValue = Math.min(prop.max, newValue);
        newValue = Math.round(newValue / ratio) * ratio;
        this._fireChange(prop.key, newValue);
        this._renderGrid();
      };

      const onUp = (): void => {
        label.classList.remove('editrix-inspector-label--dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  private _fireChange(key: string, value: unknown): void {
    this._values[key] = value;
    this._onChange?.(key, value);
  }

  private _injectStyles(): void {
    if (document.getElementById('editrix-inspector-styles')) return;
    const style = document.createElement('style');
    style.id = 'editrix-inspector-styles';
    style.textContent = `
      /* ── Filter bar ── */
      .editrix-inspector-filter {
        display: flex; align-items: center; gap: 4px;
        padding: 4px 8px; flex-shrink: 0;
      }
      .editrix-inspector-filter-wrap {
        flex: 1; position: relative; display: flex; align-items: center;
      }
      .editrix-inspector-filter-input {
        width: 100%;
        background: rgba(0,0,0,0.3);
        border: 1px solid var(--editrix-border);
        color: var(--editrix-text);
        padding: 4px 28px 4px 8px;
        border-radius: 4px;
        font-family: inherit; font-size: 12px; outline: none;
      }
      .editrix-inspector-filter-input:focus { border-color: var(--editrix-accent); }
      .editrix-inspector-filter-icon {
        position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
        color: var(--editrix-text-dim); cursor: pointer;
        display: flex; align-items: center; padding: 2px;
      }
      .editrix-inspector-filter-icon:hover { color: var(--editrix-text); }
      .editrix-inspector-filter-more {
        color: var(--editrix-text-dim); cursor: pointer;
        display: flex; align-items: center; padding: 2px; flex-shrink: 0;
      }
      .editrix-inspector-filter-more:hover { color: var(--editrix-text); }

      /* ── Add Component button ── */
      .editrix-inspector-add-btn {
        display: flex; align-items: center; justify-content: center; gap: 6px;
        margin: 4px 8px 6px; padding: 5px 0;
        background: rgba(255,255,255,0.06);
        border: 1px solid var(--editrix-border);
        border-radius: 4px;
        color: var(--editrix-text-dim);
        font-family: inherit; font-size: 12px;
        cursor: pointer; flex-shrink: 0;
      }
      .editrix-inspector-add-btn:hover {
        background: rgba(255,255,255,0.1); color: var(--editrix-text);
      }

      /* ── Scrollable inspector body ── */
      .editrix-inspector {
        flex: 1; overflow-y: auto;
        padding: 0 6px 6px;
        display: flex; flex-direction: column;
        gap: 6px;
      }
      .editrix-inspector-empty {
        padding: 24px; text-align: center;
        color: var(--editrix-text-dim); font-size: 12px;
      }

      /* ── Component section = rounded card ── */
      .editrix-inspector-card {
        background: rgba(255,255,255,0.04);
        border-radius: 6px;
        overflow: hidden;
        border: 1px solid rgba(255,255,255,0.04);
      }

      /* Section header — raised bar at top of card */
      .editrix-inspector-card-header {
        display: flex; align-items: center; gap: 6px;
        padding: 0 10px; height: 30px;
        background: rgba(255,255,255,0.07);
        cursor: pointer; user-select: none;
      }
      .editrix-inspector-card-header:hover {
        background: rgba(255,255,255,0.09);
      }
      .editrix-inspector-chevron {
        width: 16px; height: 16px;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0; color: var(--editrix-text-dim);
      }
      .editrix-inspector-card-title {
        flex: 1; font-size: 12px; font-weight: 600;
        text-align: center;
      }
      .editrix-inspector-card-menu {
        font-size: 16px; color: var(--editrix-text-dim);
        opacity: 0.4; cursor: pointer; padding: 0 4px;
      }
      .editrix-inspector-card-header:hover .editrix-inspector-card-menu {
        opacity: 0.7;
      }
      .editrix-inspector-card-body {
        padding: 8px 10px 10px;
      }

      /* ── Stacked property row: label above, control below ── */
      .editrix-inspector-stacked-row {
        display: flex; flex-direction: column;
        gap: 3px; margin-bottom: 6px;
      }
      .editrix-inspector-stacked-row:last-child { margin-bottom: 0; }

      /* Inline row: label left, control right (for booleans etc) */
      .editrix-inspector-inline-row {
        display: flex; align-items: center;
        justify-content: space-between;
        gap: 8px; margin-bottom: 6px;
        padding: 4px 8px;
        background: #3D3D3D;
        border-radius: 4px;
      }
      .editrix-inspector-inline-row:last-child { margin-bottom: 0; }
      .editrix-inspector-inline-row .editrix-inspector-label {
        flex: 1; font-size: 12px;
      }
      .editrix-inspector-inline-row .editrix-inspector-control {
        width: auto; flex-shrink: 0;
      }
      .editrix-inspector-label {
        font-size: 11px; color: var(--editrix-text-dim);
        user-select: none;
      }
      .editrix-inspector-label--draggable { cursor: ew-resize; }
      .editrix-inspector-label--dragging { color: var(--editrix-accent); }
      .editrix-inspector-control { width: 100%; }

      /* ── Input fields ── */
      .editrix-inspector-input {
        width: 100%;
        background: #3D3D3D;
        border: none;
        color: var(--editrix-text);
        padding: 5px 8px;
        border-radius: 4px;
        font-family: inherit; font-size: 12px;
        outline: none; text-align: center;
        -moz-appearance: textfield;
      }
      .editrix-inspector-input::-webkit-inner-spin-button,
      .editrix-inspector-input::-webkit-outer-spin-button {
        -webkit-appearance: none; margin: 0;
      }
      .editrix-inspector-input:focus {
        outline: 1px solid var(--editrix-accent);
      }

      /* Select / dropdown */
      .editrix-inspector-select {
        width: 100%;
        background: #3D3D3D;
        border: none;
        color: var(--editrix-text);
        padding: 5px 8px;
        border-radius: 4px;
        font-family: inherit; font-size: 12px;
        outline: none;
        cursor: pointer;
        appearance: none;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23aaaaaa' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 8px center;
        padding-right: 28px;
      }
      .editrix-inspector-select:focus {
        outline: 1px solid var(--editrix-accent);
      }
      .editrix-inspector-select option {
        background: #3D3D3D;
        color: var(--editrix-text);
      }

      /* Checkbox — inline with label, not stacked */
      .editrix-inspector-checkbox {
        width: 16px; height: 16px;
        accent-color: var(--editrix-accent);
        cursor: pointer;
      }
      .editrix-inspector-readonly {
        font-size: 12px; color: var(--editrix-text-dim);
      }

      /* ── Range row ── */
      .editrix-inspector-range-row {
        display: flex; gap: 6px; align-items: center;
      }
      .editrix-inspector-range-row .editrix-inspector-input {
        width: 60px; flex-shrink: 0;
      }
      .editrix-inspector-slider {
        flex: 1; accent-color: var(--editrix-accent); height: 4px;
      }

      /* ── Color row ── */
      .editrix-inspector-color-row {
        display: flex; gap: 6px; align-items: center;
      }
      .editrix-inspector-color {
        width: 28px; height: 24px;
        border: 1px solid var(--editrix-border);
        border-radius: 4px; cursor: pointer; padding: 0; flex-shrink: 0;
      }
      .editrix-inspector-color-row .editrix-inspector-input { flex: 1; }

      /* ── Vector row: XYZ fields ── */
      .editrix-inspector-vector-fields {
        display: flex; gap: 6px;
      }
      .editrix-inspector-vector-field {
        flex: 1;
        display: flex; align-items: stretch;
        min-width: 0;
        border-radius: 3px; overflow: hidden;
        border: none;
        border-left: 3px solid var(--editrix-text-dim);
        background: #3D3D3D;
      }
      .editrix-inspector-axis-label {
        display: flex; align-items: center; justify-content: center;
        width: 20px; font-size: 11px; font-weight: 600;
        color: var(--editrix-text-dim); flex-shrink: 0;
        background: #4D4D4D;
        cursor: ew-resize; user-select: none;
      }
      .editrix-inspector-vector-input {
        border: none !important; border-radius: 0 !important;
        background: transparent !important;
        flex: 1; min-width: 0;
        padding: 5px 4px; font-size: 12px;
        text-align: center; color: var(--editrix-text);
        font-family: inherit; outline: none;
        -moz-appearance: textfield;
      }
      .editrix-inspector-vector-input::-webkit-inner-spin-button,
      .editrix-inspector-vector-input::-webkit-outer-spin-button {
        -webkit-appearance: none; margin: 0;
      }
      .editrix-inspector-vector-input:focus {
        background: rgba(255,255,255,0.03) !important;
      }
    `;
    document.head.appendChild(style);
  }
}

/** Options for creating a {@link PropertyGridWidget}. */
export interface PropertyGridOptions {
  readonly onChange?: PropertyChangeHandler;
}
