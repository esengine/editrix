import type { Event } from '@editrix/common';
import { Emitter } from '@editrix/common';
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
  private readonly _collapsed = new Set<string>();
  private _contentEl: HTMLElement | undefined;
  private _addBtnEl: HTMLElement | undefined;
  /**
   * Which component card is currently being dragged, or null if no
   * drag is in progress. Set in `dragstart`, cleared in `dragend`.
   * Needed because `DataTransfer.getData()` only returns values
   * during `drop`, not during `dragover` — we need the identity on
   * every dragover to know whether to show the drop indicator.
   */
  private _draggingComponentId: string | null = null;

  private readonly _onDidRequestAddComponent = new Emitter<void>();
  private readonly _onDidRequestComponentMenu = new Emitter<{ componentId: string; anchor: HTMLElement }>();
  private readonly _onDidReorderComponent = new Emitter<ComponentReorderEvent>();

  /** Fired when the "Add Component" button is clicked. */
  readonly onDidRequestAddComponent: Event<void> = this._onDidRequestAddComponent.event;

  /** Fired when a component card's menu button (⋯) is clicked. */
  readonly onDidRequestComponentMenu: Event<{ componentId: string; anchor: HTMLElement }> =
    this._onDidRequestComponentMenu.event;

  /**
   * Fired when the user drags a component card and drops it on another.
   * Consumer is expected to splice its own component-order model (the
   * widget does not mutate `_groups` itself — data ownership stays
   * with the caller so `setData()` remains the single source of
   * truth).
   */
  readonly onDidReorderComponent: Event<ComponentReorderEvent> = this._onDidReorderComponent.event;

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

    // Add Component button with SVG icon (hidden when no entity selected)
    this._addBtnEl = this.appendElement(root, 'button', 'editrix-inspector-add-btn');
    if (getIcon('plus-circle')) {
      this._addBtnEl.appendChild(createIconElement('plus-circle', 14));
    }
    const addLabel = createElement('span');
    addLabel.textContent = 'Add Component';
    this._addBtnEl.appendChild(addLabel);
    this._addBtnEl.addEventListener('click', () => { this._onDidRequestAddComponent.fire(); });

    this._contentEl = this.appendElement(root, 'div', 'editrix-inspector');
    this._renderGrid();
  }

  private _renderGrid(): void {
    if (!this._contentEl) return;
    this._contentEl.innerHTML = '';

    // Hide Add Component button when no entity is selected
    if (this._addBtnEl) {
      this._addBtnEl.style.display = this._groups.length === 0 ? 'none' : '';
    }

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

    // Title group (icon + name, centered together)
    const titleGroup = createElement('span', 'editrix-inspector-card-title');
    const groupIcon = group.icon ?? 'component';
    if (getIcon(groupIcon)) {
      const ico = createIconElement(groupIcon, 14);
      ico.style.opacity = '0.6';
      titleGroup.appendChild(ico);
    }
    const titleText = createElement('span');
    titleText.textContent = group.label;
    titleGroup.appendChild(titleText);
    header.appendChild(titleGroup);

    const menu = createElement('span', 'editrix-inspector-card-menu');
    menu.textContent = '\u22EF';
    menu.addEventListener('click', (e) => {
      e.stopPropagation();
      this._onDidRequestComponentMenu.fire({ componentId: group.id, anchor: menu });
    });
    header.appendChild(menu);

    header.addEventListener('click', () => {
      if (this._collapsed.has(group.id)) {
        this._collapsed.delete(group.id);
      } else {
        this._collapsed.add(group.id);
      }
      this._renderGrid();
    });

    // Drag to reorder. Native HTML5 drag so the browser handles the
    // ghost + cursor; collapse click still fires because a click under
    // the drag-start threshold doesn't trigger dragstart.
    header.draggable = true;
    header.dataset['componentId'] = group.id;
    header.addEventListener('dragstart', (e) => {
      if (!e.dataTransfer) return;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/x-editrix-component', group.id);
      this._draggingComponentId = group.id;
      header.classList.add('editrix-inspector-card-header--dragging');
    });
    header.addEventListener('dragend', () => {
      this._draggingComponentId = null;
      header.classList.remove('editrix-inspector-card-header--dragging');
      // Clear any drop indicator that lingered past dragleave.
      this._contentEl?.querySelectorAll('.editrix-inspector-card-header--drop-above, .editrix-inspector-card-header--drop-below')
        .forEach((el) => { el.classList.remove(
          'editrix-inspector-card-header--drop-above',
          'editrix-inspector-card-header--drop-below',
        ); });
    });
    header.addEventListener('dragover', (e) => {
      const sourceId = this._draggingComponentId;
      if (!sourceId || sourceId === group.id) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      const rect = header.getBoundingClientRect();
      const above = e.clientY < rect.top + rect.height / 2;
      header.classList.toggle('editrix-inspector-card-header--drop-above', above);
      header.classList.toggle('editrix-inspector-card-header--drop-below', !above);
    });
    header.addEventListener('dragleave', () => {
      header.classList.remove(
        'editrix-inspector-card-header--drop-above',
        'editrix-inspector-card-header--drop-below',
      );
    });
    header.addEventListener('drop', (e) => {
      e.preventDefault();
      const sourceId = e.dataTransfer?.getData('application/x-editrix-component') ?? '';
      header.classList.remove(
        'editrix-inspector-card-header--drop-above',
        'editrix-inspector-card-header--drop-below',
      );
      if (!sourceId || sourceId === group.id) return;
      const rect = header.getBoundingClientRect();
      const position: 'before' | 'after' = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
      this._onDidReorderComponent.fire({ componentId: sourceId, targetId: group.id, position });
    });

    card.appendChild(header);

    // Body — stacked layout: label row then control row
    if (!isCollapsed) {
      const body = createElement('div', 'editrix-inspector-card-body');
      const props = group.properties;
      let i = 0;
      while (i < props.length) {
        const p = props[i];
        if (!p) break;
        if (p.key.endsWith('.r')) {
          // Color: r/g/b/a
          const base = p.key.replace(/\.r$/, '');
          const pG = props[i + 1];
          const pB = props[i + 2];
          const pA = props[i + 3];
          if (pG?.key === `${base}.g` && pB?.key === `${base}.b` && pA?.key === `${base}.a`) {
            body.appendChild(this._renderColorRow(base.split('.').pop() ?? base, [p, pG, pB, pA]));
            i += 4;
            continue;
          }
        }
        if (p.key.endsWith('.x')) {
          const base = p.key.replace(/\.x$/, '');
          const pY = props[i + 1];
          const pZ = props[i + 2];
          const pW = props[i + 3];
          if (pY?.key === `${base}.y` && pZ?.key === `${base}.z` && pW?.key === `${base}.w`) {
            body.appendChild(this._renderVectorNRow(base.split('.').pop() ?? base, [p, pY, pZ, pW]));
            i += 4;
          } else if (pY?.key === `${base}.y` && pZ?.key === `${base}.z`) {
            body.appendChild(this._renderVectorNRow(base.split('.').pop() ?? base, [p, pY, pZ]));
            i += 3;
          } else if (pY?.key === `${base}.y`) {
            body.appendChild(this._renderVectorNRow(base.split('.').pop() ?? base, [p, pY]));
            i += 2;
          } else {
            body.appendChild(this._renderProperty(p));
            i++;
          }
        } else {
          body.appendChild(this._renderProperty(p));
          i++;
        }
      }
      card.appendChild(body);
    }

    this._contentEl.appendChild(card);
  }

  /** Axis colors by index: X=red, Y=green, Z=blue, W=purple */
  private static readonly _axisColors = [
    'var(--editrix-axis-x)', 'var(--editrix-axis-y)',
    'var(--editrix-axis-z)', 'var(--editrix-axis-w, #b080ff)',
  ];
  private static readonly _axisLabels = ['X', 'Y', 'Z', 'W'];

  /** Render N-component vector property: label on own row, inputs below. vec4 uses 2×2 grid. */
  private _renderVectorNRow(label: string, props: PropertyDescriptor[]): HTMLElement {
    const row = createElement('div', 'editrix-inspector-stacked-row');

    const lbl = createElement('label', 'editrix-inspector-label');
    lbl.textContent = label.charAt(0).toUpperCase() + label.slice(1);
    row.appendChild(lbl);

    if (props.length === 4) {
      // 2×2 grid for vec4
      const grid = createElement('div', 'editrix-inspector-vector-grid');
      for (let idx = 0; idx < 4; idx++) {
        const p = props[idx];
        if (p) grid.appendChild(this._renderVectorField(p, idx));
      }
      row.appendChild(grid);
    } else {
      const fields = createElement('div', 'editrix-inspector-vector-fields');
      for (let idx = 0; idx < props.length; idx++) {
        const p = props[idx];
        if (p) fields.appendChild(this._renderVectorField(p, idx));
      }
      row.appendChild(fields);
    }

    return row;
  }

  private _renderVectorField(prop: PropertyDescriptor, idx: number): HTMLElement {
    const field = createElement('div', 'editrix-inspector-vector-field');
    field.style.borderLeftColor = PropertyGridWidget._axisColors[idx] ?? 'var(--editrix-text-dim)';

    const axisLabel = createElement('span', 'editrix-inspector-axis-label');
    axisLabel.textContent = PropertyGridWidget._axisLabels[idx] ?? '';
    field.appendChild(axisLabel);

    const input = createElement('input', 'editrix-inspector-input editrix-inspector-vector-input');
    input.type = 'number';
    input.value = String(parseFloat(Number(this._values[prop.key] ?? 0).toPrecision(7)));
    input.addEventListener('change', () => { this._fireChange(prop.key, parseFloat(input.value)); });

    this._setupDragAdjust(axisLabel, prop);

    field.appendChild(input);
    return field;
  }

  /** Render color property: swatch + RGBA inputs in 2×2 grid. */
  private _renderColorRow(label: string, props: PropertyDescriptor[]): HTMLElement {
    const row = createElement('div', 'editrix-inspector-stacked-row');

    const lbl = createElement('label', 'editrix-inspector-label');
    lbl.textContent = label.charAt(0).toUpperCase() + label.slice(1);
    row.appendChild(lbl);

    const container = createElement('div', 'editrix-inspector-color-container');

    // Collect input refs so the picker can update them
    const inputs: HTMLInputElement[] = [];

    // Color swatch (preview) — click to open custom picker
    const swatch = createElement('div', 'editrix-inspector-color-swatch');

    const pR = props[0], pG2 = props[1], pB2 = props[2];
    const getRGB = (): [number, number, number] => [
      Number(this._values[pR?.key ?? ''] ?? 1),
      Number(this._values[pG2?.key ?? ''] ?? 1),
      Number(this._values[pB2?.key ?? ''] ?? 1),
    ];

    const updateSwatch = (): void => {
      const [cr, cg, cb] = getRGB();
      swatch.style.background = `rgb(${Math.round(cr * 255)},${Math.round(cg * 255)},${Math.round(cb * 255)})`;
    };
    updateSwatch();

    const setRGBFromPicker = (r: number, g: number, b: number): void => {
      const vals = [r, g, b];
      for (let ci = 0; ci < 3; ci++) {
        const cp = props[ci];
        const cv = vals[ci];
        if (!cp || cv === undefined) continue;
        this._values[cp.key] = cv;
        this._fireChange(cp.key, cv);
        const inp = inputs[ci];
        if (inp) inp.value = String(parseFloat(cv.toPrecision(4)));
      }
      updateSwatch();
    };

    swatch.addEventListener('click', () => {
      const [r, g, b] = getRGB();
      this._openColorPicker(swatch, r, g, b, setRGBFromPicker);
    });

    container.appendChild(swatch);

    // RGBA grid (2×2)
    const grid = createElement('div', 'editrix-inspector-vector-grid');
    const labels = ['R', 'G', 'B', 'A'];
    const colors = ['#e05555', '#55b853', '#5588e0', '#aaaaaa'];

    for (let idx = 0; idx < 4; idx++) {
      const prop = props[idx];
      if (!prop) continue;
      const field = createElement('div', 'editrix-inspector-vector-field');
      field.style.borderLeftColor = colors[idx] ?? '#aaa';

      const axisLabel = createElement('span', 'editrix-inspector-axis-label');
      axisLabel.textContent = labels[idx] ?? '';
      field.appendChild(axisLabel);

      const input = createElement('input', 'editrix-inspector-input editrix-inspector-vector-input');
      input.type = 'number';
      input.step = '0.01';
      input.min = '0';
      input.max = '1';
      input.value = String(parseFloat(Number(this._values[prop.key] ?? 0).toPrecision(4)));
      input.addEventListener('change', () => {
        const v = Math.max(0, Math.min(1, parseFloat(input.value) || 0));
        this._values[prop.key] = v;
        this._fireChange(prop.key, v);
        updateSwatch();
      });

      // Drag-to-adjust on axis label (clamped 0–1)
      this._setupDragAdjust(axisLabel, { ...prop, min: 0, max: 1, step: 0.01 });

      inputs.push(input);
      field.appendChild(input);
      grid.appendChild(field);
    }

    container.appendChild(grid);
    row.appendChild(container);
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
        input.value = String(parseFloat(Number(value ?? 0).toPrecision(7)));
        input.readOnly = readOnly;
        input.addEventListener('change', () => { this._fireChange(prop.key, parseFloat(input.value)); });
        wrapper.appendChild(input);
        break;
      }

      case 'string': {
        const input = createElement('input', 'editrix-inspector-input');
        input.type = 'text';
        input.value = (value as string | undefined) ?? '';
        input.readOnly = readOnly;
        input.addEventListener('change', () => { this._fireChange(prop.key, input.value); });
        wrapper.appendChild(input);
        break;
      }

      case 'enum': {
        const select = createElement('select', 'editrix-inspector-select');
        select.disabled = readOnly;
        const enumValues = prop.enumValues ?? [];
        for (let ei = 0; ei < enumValues.length; ei++) {
          const opt = createElement('option');
          opt.value = String(ei);
          opt.textContent = enumValues[ei] ?? '';
          if (ei === value) opt.selected = true;
          select.appendChild(opt);
        }
        select.addEventListener('change', () => { this._fireChange(prop.key, parseInt(select.value, 10)); });
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
        input.value = String(Number(value ?? 0));
        input.readOnly = readOnly;

        const slider = createElement('input', 'editrix-inspector-slider');
        slider.type = 'range';
        slider.min = String(prop.min ?? 0);
        slider.max = String(prop.max ?? 100);
        slider.step = String(prop.step ?? 1);
        slider.value = String(Number(value ?? 0));
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
        swatch.value = (value as string | undefined) ?? '#000000';
        swatch.disabled = readOnly;

        const hex = createElement('input', 'editrix-inspector-input');
        hex.type = 'text';
        hex.value = (value as string | undefined) ?? '#000000';
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

      case 'asset':
      case 'entity': {
        // Reference types render as a read-only handle until a real picker UI
        // ships with the asset pipeline. The value is typically a UUID string
        // (asset) or numeric id (entity); callers can read/copy it but can't
        // edit through the inspector yet.
        const ref = createElement('span', 'editrix-inspector-readonly');
        if (value === undefined || value === null || value === '' || value === 0) {
          ref.textContent = '— none —';
          ref.classList.add('editrix-inspector-readonly--empty');
        } else {
          // Asset uuids and entity numeric handles both stringify cleanly;
          // anything else (an unexpected object) falls back to JSON.
          const display = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
            ? String(value)
            : JSON.stringify(value);
          ref.textContent = `${prop.type}:${display}`;
        }
        wrapper.appendChild(ref);
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
      const startValue = (this._values[prop.key] as number | undefined) ?? 0;
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

  // ── Color Picker ──────────────────────────────────────

  private _colorPickerEl: HTMLElement | undefined;

  private _openColorPicker(
    anchor: HTMLElement, r: number, g: number, b: number,
    onChange: (r: number, g: number, b: number) => void,
  ): void {
    this._colorPickerEl?.remove();

    // ── Color conversion helpers ──
    const rgbToHsv = (rr: number, gg: number, bb: number): [number, number, number] => {
      const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb), d = max - min;
      const s = max === 0 ? 0 : d / max, v = max;
      let h = 0;
      if (d !== 0) {
        if (max === rr) h = ((gg - bb) / d + 6) % 6;
        else if (max === gg) h = (bb - rr) / d + 2;
        else h = (rr - gg) / d + 4;
        h /= 6;
      }
      return [h, s, v];
    };
    const hsvToRgb = (h: number, s: number, v: number): [number, number, number] => {
      const i = Math.floor(h * 6), f = h * 6 - i;
      const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
      switch (i % 6) {
        case 0: return [v, t, p];
        case 1: return [q, v, p];
        case 2: return [p, v, t];
        case 3: return [p, q, v];
        case 4: return [t, p, v];
        default: return [v, p, q];
      }
    };
    const rgbToHex = (rr: number, gg: number, bb: number): string =>
      '#' + [rr, gg, bb].map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('');

    let [hue, sat, val] = rgbToHsv(r, g, b);
    let mode: 'hex' | 'rgb' | 'hsv' = 'hex';
    let currentInputs: HTMLInputElement[] = [];

    // ── Popup container ──
    const popup = createElement('div', 'editrix-color-picker');
    this._colorPickerEl = popup;

    // ── SV area ──
    const svArea = createElement('div', 'editrix-cp-sv');
    const svCursor = createElement('div', 'editrix-cp-sv-cursor');
    svArea.appendChild(svCursor);
    const updateSV = (): void => {
      const [hr, hg, hb] = hsvToRgb(hue, 1, 1);
      svArea.style.background = `rgb(${Math.round(hr * 255)},${Math.round(hg * 255)},${Math.round(hb * 255)})`;
      svCursor.style.left = `${sat * 100}%`;
      svCursor.style.top = `${(1 - val) * 100}%`;
    };
    const handleSV = (e: MouseEvent): void => {
      const r2 = svArea.getBoundingClientRect();
      sat = Math.max(0, Math.min(1, (e.clientX - r2.left) / r2.width));
      val = Math.max(0, Math.min(1, 1 - (e.clientY - r2.top) / r2.height));
      update();
    };
    svArea.addEventListener('mousedown', (e) => {
      e.preventDefault(); handleSV(e);
      const onMove = (ev: MouseEvent): void => { handleSV(ev); };
      const onUp = (): void => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
      document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
    });
    popup.appendChild(svArea);

    // ── Hue bar ──
    const hueBar = createElement('div', 'editrix-cp-hue');
    const hueCursor = createElement('div', 'editrix-cp-hue-cursor');
    hueBar.appendChild(hueCursor);
    const handleHue = (e: MouseEvent): void => {
      const r2 = hueBar.getBoundingClientRect();
      hue = Math.max(0, Math.min(1, (e.clientX - r2.left) / r2.width));
      update();
    };
    hueBar.addEventListener('mousedown', (e) => {
      e.preventDefault(); handleHue(e);
      const onMove = (ev: MouseEvent): void => { handleHue(ev); };
      const onUp = (): void => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
      document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
    });
    popup.appendChild(hueBar);

    // ── Toolbar: preview + mode dropdown + eyedropper ──
    const toolbar = createElement('div', 'editrix-cp-toolbar');

    const previewEl = createElement('div', 'editrix-cp-preview');
    toolbar.appendChild(previewEl);

    const modeSelect = createElement('select', 'editrix-cp-mode-select');
    for (const m of ['Hex', 'RGB', 'HSV']) {
      const opt = createElement('option');
      opt.value = m.toLowerCase();
      opt.textContent = m;
      modeSelect.appendChild(opt);
    }
    modeSelect.addEventListener('change', () => {
      mode = modeSelect.value as typeof mode;
      renderInputRow();
      syncInputs();
    });
    toolbar.appendChild(modeSelect);

    // Eyedropper button
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const hasEyeDropper = typeof (window as any).EyeDropper === 'function';
    const eyedropperBtn = createElement('button', 'editrix-cp-eyedropper-btn');
    eyedropperBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3L15 6"/></svg>';
    eyedropperBtn.title = hasEyeDropper ? 'Pick color from screen' : 'Eyedropper not supported';
    if (!hasEyeDropper) eyedropperBtn.classList.add('editrix-cp-eyedropper-btn--disabled');
    else {
      eyedropperBtn.addEventListener('click', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        const ED = (window as any).EyeDropper as new () => { open(): Promise<{ sRGBHex: string }> };
        new ED().open().then((result) => {
          const hex = result.sRGBHex;
          const nr = parseInt(hex.slice(1, 3), 16) / 255;
          const ng = parseInt(hex.slice(3, 5), 16) / 255;
          const nb = parseInt(hex.slice(5, 7), 16) / 255;
          [hue, sat, val] = rgbToHsv(nr, ng, nb);
          update();
        }).catch(() => { /* user cancelled */ });
      });
    }
    toolbar.appendChild(eyedropperBtn);
    popup.appendChild(toolbar);

    // ── Mode-specific input area ──
    const inputArea = createElement('div', 'editrix-cp-input-area');

    const renderInputRow = (): void => {
      inputArea.innerHTML = '';
      currentInputs = [];

      if (mode === 'hex') {
        const row = createElement('div', 'editrix-cp-input-row');
        const label = createElement('span', 'editrix-cp-field-label');
        label.textContent = '#';
        const input = createElement('input', 'editrix-cp-field-input');
        input.type = 'text'; input.maxLength = 7;
        input.addEventListener('change', () => {
          const hex = input.value.trim();
          if (/^#?[0-9a-fA-F]{6}$/.test(hex)) {
            const h = hex.startsWith('#') ? hex : '#' + hex;
            const nr = parseInt(h.slice(1, 3), 16) / 255;
            const ng = parseInt(h.slice(3, 5), 16) / 255;
            const nb = parseInt(h.slice(5, 7), 16) / 255;
            [hue, sat, val] = rgbToHsv(nr, ng, nb);
            update();
          }
        });
        currentInputs.push(input);
        row.appendChild(label); row.appendChild(input);
        inputArea.appendChild(row);
      } else {
        const labels = mode === 'rgb' ? ['R', 'G', 'B'] : ['H', 'S', 'V'];
        const row = createElement('div', 'editrix-cp-input-row');
        for (let i = 0; i < 3; i++) {
          const label = createElement('span', 'editrix-cp-field-label');
          label.textContent = labels[i] ?? '';
          const input = createElement('input', 'editrix-cp-field-input');
          input.type = 'number';
          if (mode === 'rgb') { input.min = '0'; input.max = '255'; input.step = '1'; }
          else { input.min = '0'; input.max = i === 0 ? '360' : '100'; input.step = '1'; }
          const idx = i;
          input.addEventListener('change', () => {
            const v = parseFloat(input.value) || 0;
            if (mode === 'rgb') {
              const [cr, cg, cb] = hsvToRgb(hue, sat, val);
              const rgb: [number, number, number] = [cr, cg, cb];
              rgb[idx] = Math.max(0, Math.min(255, v)) / 255;
              [hue, sat, val] = rgbToHsv(...rgb);
            } else {
              if (idx === 0) hue = Math.max(0, Math.min(360, v)) / 360;
              else if (idx === 1) sat = Math.max(0, Math.min(100, v)) / 100;
              else val = Math.max(0, Math.min(100, v)) / 100;
            }
            update();
          });
          currentInputs.push(input);
          row.appendChild(label); row.appendChild(input);
        }
        inputArea.appendChild(row);
      }
    };

    const syncInputs = (): void => {
      const [nr, ng, nb] = hsvToRgb(hue, sat, val);
      if (mode === 'hex') {
        if (currentInputs[0] && document.activeElement !== currentInputs[0])
          currentInputs[0].value = rgbToHex(nr, ng, nb);
      } else if (mode === 'rgb') {
        const vals = [Math.round(nr * 255), Math.round(ng * 255), Math.round(nb * 255)];
        for (let i = 0; i < 3; i++) {
          const inp = currentInputs[i];
          if (inp && document.activeElement !== inp) inp.value = String(vals[i]);
        }
      } else {
        const vals = [Math.round(hue * 360), Math.round(sat * 100), Math.round(val * 100)];
        for (let i = 0; i < 3; i++) {
          const inp = currentInputs[i];
          if (inp && document.activeElement !== inp) inp.value = String(vals[i]);
        }
      }
    };

    renderInputRow();
    popup.appendChild(inputArea);

    // ── Central update ──
    const update = (): void => {
      const [nr, ng, nb] = hsvToRgb(hue, sat, val);
      onChange(nr, ng, nb);
      previewEl.style.background = rgbToHex(nr, ng, nb);
      updateSV();
      hueCursor.style.left = `${hue * 100}%`;
      syncInputs();
    };

    // ── Init ──
    previewEl.style.background = rgbToHex(r, g, b);
    updateSV();
    hueCursor.style.left = `${hue * 100}%`;
    syncInputs();

    // Append hidden, measure, then position with boundary check
    popup.style.visibility = 'hidden';
    document.body.appendChild(popup);

    const anchorRect = anchor.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = anchorRect.left + popupRect.width > vw ? vw - popupRect.width - 4 : anchorRect.left;
    const top = anchorRect.bottom + 4 + popupRect.height > vh ? anchorRect.top - popupRect.height - 4 : anchorRect.bottom + 4;
    popup.style.left = `${Math.max(0, left)}px`;
    popup.style.top = `${Math.max(0, top)}px`;
    popup.style.visibility = '';

    // Close on click outside
    const closeOnClick = (e: MouseEvent): void => {
      if (!popup.contains(e.target as Node) && e.target !== anchor) {
        popup.remove();
        this._colorPickerEl = undefined;
        document.removeEventListener('mousedown', closeOnClick);
      }
    };
    requestAnimationFrame(() => { document.addEventListener('mousedown', closeOnClick); });
  }

  override dispose(): void {
    this._onDidRequestAddComponent.dispose();
    this._onDidRequestComponentMenu.dispose();
    this._onDidReorderComponent.dispose();
    this._colorPickerEl?.remove();
    super.dispose();
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
        background: rgba(255,255,255,0.08);
        border: 1px dashed rgba(255,255,255,0.15);
        border-radius: 4px;
        color: var(--editrix-text);
        font-family: inherit; font-size: 12px;
        cursor: pointer; flex-shrink: 0;
        transition: background 0.1s, border-color 0.1s;
      }
      .editrix-inspector-add-btn:hover {
        background: rgba(74, 143, 255, 0.12);
        border-color: var(--editrix-accent);
        color: var(--editrix-accent);
      }
      .editrix-inspector-add-btn:active {
        background: rgba(74, 143, 255, 0.18);
      }

      /* ── Scrollable inspector body ── */
      .editrix-inspector {
        flex: 1; min-height: 0; overflow-y: auto;
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
        flex-shrink: 0;
      }

      /* Section header — raised bar at top of card */
      .editrix-inspector-card-header {
        display: flex; align-items: center; gap: 6px;
        padding: 0 10px; height: 30px;
        background: rgba(255,255,255,0.07);
        cursor: pointer; user-select: none;
        position: relative;
      }
      .editrix-inspector-card-header:hover {
        background: rgba(255,255,255,0.09);
      }
      /* Drag-to-reorder visual states.
         The drop indicator mirrors the layout dock overlay's feel:
         a translucent accent-coloured zone fills the half of the
         header where the dragged card will land, capped by a solid
         accent bar so the exact insertion line is unambiguous. */
      .editrix-inspector-card-header--dragging {
        opacity: 0.4;
      }
      .editrix-inspector-card-header--drop-above,
      .editrix-inspector-card-header--drop-below {
        /* Cancel the normal hover background so the indicator reads. */
        background: rgba(255, 255, 255, 0.07);
      }
      .editrix-inspector-card-header--drop-above::before {
        content: '';
        position: absolute; left: 0; right: 0; top: 0; height: 50%;
        background: linear-gradient(
          to bottom,
          color-mix(in srgb, var(--editrix-accent) 40%, transparent),
          color-mix(in srgb, var(--editrix-accent) 10%, transparent)
        );
        border-top: 3px solid var(--editrix-accent);
        pointer-events: none;
        box-shadow: 0 0 12px color-mix(in srgb, var(--editrix-accent) 50%, transparent);
      }
      .editrix-inspector-card-header--drop-below::after {
        content: '';
        position: absolute; left: 0; right: 0; bottom: 0; height: 50%;
        background: linear-gradient(
          to top,
          color-mix(in srgb, var(--editrix-accent) 40%, transparent),
          color-mix(in srgb, var(--editrix-accent) 10%, transparent)
        );
        border-bottom: 3px solid var(--editrix-accent);
        pointer-events: none;
        box-shadow: 0 0 12px color-mix(in srgb, var(--editrix-accent) 50%, transparent);
      }
      .editrix-inspector-chevron {
        width: 16px; height: 16px;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0; color: var(--editrix-text-dim);
      }
      .editrix-inspector-card-title {
        flex: 1; font-size: 12px; font-weight: 600;
        text-align: center;
        display: flex; align-items: center; justify-content: center;
        gap: 6px;
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
      .editrix-inspector-color-container {
        display: flex; gap: 6px; align-items: stretch;
      }
      .editrix-inspector-color-swatch {
        width: 32px; flex-shrink: 0;
        border-radius: 4px;
        border: 1px solid rgba(255,255,255,0.1);
        cursor: pointer;
      }

      /* ── Color Picker Popup ── */
      .editrix-color-picker {
        position: fixed; z-index: 1000;
        width: 220px; padding: 8px;
        background: #2b2b2b; border: 1px solid rgba(255,255,255,0.12);
        border-radius: 6px; box-shadow: 0 8px 24px rgba(0,0,0,0.5);
        display: flex; flex-direction: column; gap: 8px;
      }
      .editrix-cp-sv {
        width: 100%; height: 150px; position: relative; cursor: crosshair;
        border-radius: 4px; overflow: hidden;
        background: red;
      }
      .editrix-cp-sv::before {
        content: ''; position: absolute; inset: 0;
        background: linear-gradient(to right, #fff, transparent);
      }
      .editrix-cp-sv::after {
        content: ''; position: absolute; inset: 0;
        background: linear-gradient(to top, #000, transparent);
      }
      .editrix-cp-sv-cursor {
        position: absolute; width: 12px; height: 12px; z-index: 1;
        border: 2px solid #fff; border-radius: 50%;
        box-shadow: 0 0 2px rgba(0,0,0,0.6);
        transform: translate(-50%, -50%); pointer-events: none;
      }
      .editrix-cp-hue {
        width: 100%; height: 14px; position: relative; cursor: crosshair;
        border-radius: 3px;
        background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
      }
      .editrix-cp-hue-cursor {
        position: absolute; top: -1px; width: 6px; height: 16px;
        background: #fff; border-radius: 2px;
        box-shadow: 0 0 3px rgba(0,0,0,0.5);
        transform: translateX(-50%); pointer-events: none;
      }
      /* Toolbar: preview + mode + eyedropper */
      .editrix-cp-toolbar {
        display: flex; align-items: center; gap: 6px;
      }
      .editrix-cp-preview {
        width: 24px; height: 24px; border-radius: 4px; flex-shrink: 0;
        border: 1px solid rgba(255,255,255,0.12);
      }
      .editrix-cp-mode-select {
        flex: 1; min-width: 0;
        background: #3D3D3D; border: none; border-radius: 4px;
        padding: 4px 22px 4px 8px; font-size: 11px; font-family: inherit;
        color: var(--editrix-text); outline: none; cursor: pointer;
        appearance: none;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23aaaaaa' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
        background-repeat: no-repeat; background-position: right 6px center;
      }
      .editrix-cp-mode-select option { background: #3D3D3D; color: var(--editrix-text); }
      .editrix-cp-eyedropper-btn {
        width: 24px; height: 24px;
        display: flex; align-items: center; justify-content: center;
        background: #3D3D3D; border: none; border-radius: 4px;
        color: var(--editrix-text-dim); cursor: pointer; flex-shrink: 0;
      }
      .editrix-cp-eyedropper-btn:hover { background: #454545; color: var(--editrix-text); }
      .editrix-cp-eyedropper-btn:focus { outline: none; }
      .editrix-cp-eyedropper-btn:active { background: #505050; }
      .editrix-cp-eyedropper-btn--disabled { opacity: 0.3; pointer-events: none; }

      /* Mode-specific input area */
      .editrix-cp-input-area { display: flex; flex-direction: column; gap: 4px; }
      .editrix-cp-input-row { display: flex; align-items: center; gap: 4px; }
      .editrix-cp-field-label {
        font-size: 11px; color: var(--editrix-text-dim);
        width: 14px; text-align: center; flex-shrink: 0; user-select: none;
      }
      .editrix-cp-field-input {
        flex: 1; min-width: 0;
        background: #3D3D3D; border: none; border-radius: 4px;
        padding: 4px 6px; font-size: 12px; font-family: inherit;
        color: var(--editrix-text); outline: none; text-align: center;
        -moz-appearance: textfield;
      }
      .editrix-cp-field-input::-webkit-inner-spin-button,
      .editrix-cp-field-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
      .editrix-cp-field-input:focus { background: #454545; }
      .editrix-inspector-color-container .editrix-inspector-vector-grid { flex: 1; }

      /* ── Vector row: label above, fields below ── */
      .editrix-inspector-vector-fields {
        display: flex; gap: 5px;
      }
      .editrix-inspector-vector-grid {
        display: grid; grid-template-columns: 1fr 1fr; gap: 5px;
      }
      .editrix-inspector-vector-field {
        flex: 1;
        display: flex; align-items: stretch;
        min-width: 0;
        border-radius: 4px;
        overflow: hidden;
        border-left: 3px solid var(--editrix-text-dim);
      }
      .editrix-inspector-axis-label {
        display: flex; align-items: center; justify-content: center;
        width: 20px; font-size: 11px; font-weight: normal;
        color: rgba(255,255,255,0.85); flex-shrink: 0;
        background: #46474C;
        cursor: ew-resize; user-select: none;
      }
      .editrix-inspector-vector-input {
        border: none !important; border-radius: 0 !important;
        background: #36373B !important;
        flex: 1; min-width: 0;
        padding: 5px 6px; font-size: 12px;
        text-align: center; color: var(--editrix-text);
        font-family: inherit; outline: none;
        -moz-appearance: textfield;
      }
      .editrix-inspector-vector-input::-webkit-inner-spin-button,
      .editrix-inspector-vector-input::-webkit-outer-spin-button {
        -webkit-appearance: none; margin: 0;
      }
      .editrix-inspector-vector-input:focus {
        background: #3E3F44 !important;
      }
    `;
    document.head.appendChild(style);
  }
}

/** Options for creating a {@link PropertyGridWidget}. */
export interface PropertyGridOptions {
  readonly onChange?: PropertyChangeHandler;
}

/**
 * Emitted by {@link PropertyGridWidget.onDidReorderComponent} when the user
 * drops a dragged component card on another.
 *
 * - `componentId`  — the card that was picked up
 * - `targetId`     — the card dropped onto (never equal to componentId)
 * - `position`     — whether the dragged card should land before or after
 *                    the target in the final order
 */
export interface ComponentReorderEvent {
  readonly componentId: string;
  readonly targetId: string;
  readonly position: 'before' | 'after';
}
