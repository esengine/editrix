import type { ISettingsService, SettingDescriptor } from '@editrix/core';
import { BaseWidget, createElement } from '@editrix/view-dom';

/**
 * Settings panel widget. Auto-generates editor controls from
 * registered setting groups and descriptors.
 */
export class SettingsWidget extends BaseWidget {
  private readonly _settings: ISettingsService;
  private _contentEl: HTMLElement | undefined;
  private _filterText = '';

  constructor(id: string, settings: ISettingsService) {
    super(id, 'settings');
    this._settings = settings;
  }

  protected buildContent(root: HTMLElement): void {
    this._injectStyles();

    // Search bar
    const searchBar = this.appendElement(root, 'div', 'editrix-settings-search');
    const input = createElement('input', 'editrix-settings-search-input');
    input.type = 'text';
    input.placeholder = 'Search settings...';
    input.addEventListener('input', () => {
      this._filterText = input.value.toLowerCase();
      this._render();
    });
    searchBar.appendChild(input);

    // Content
    this._contentEl = this.appendElement(root, 'div', 'editrix-settings-content');

    // Re-render when settings change
    this.subscriptions.add(
      this._settings.onDidChangeAny(() => { this._render(); }),
    );

    this._render();
  }

  private _render(): void {
    if (!this._contentEl) return;
    this._contentEl.innerHTML = '';

    const groups = this._settings.getGroups();

    for (const group of groups) {
      const matchingSettings = this._filterText
        ? group.settings.filter((s) =>
            s.label.toLowerCase().includes(this._filterText) ||
            s.key.toLowerCase().includes(this._filterText) ||
            (s.description?.toLowerCase().includes(this._filterText) ?? false)
          )
        : group.settings;

      if (matchingSettings.length === 0) continue;

      const section = createElement('div', 'editrix-settings-group');

      const header = createElement('div', 'editrix-settings-group-header');
      header.textContent = group.label;
      section.appendChild(header);

      for (const setting of matchingSettings) {
        section.appendChild(this._renderSetting(setting));
      }

      this._contentEl.appendChild(section);
    }

    if (this._contentEl.childElementCount === 0) {
      const empty = createElement('div', 'editrix-settings-empty');
      empty.textContent = this._filterText ? 'No matching settings' : 'No settings registered';
      this._contentEl.appendChild(empty);
    }
  }

  private _renderSetting(desc: SettingDescriptor): HTMLElement {
    const row = createElement('div', 'editrix-settings-row');

    // Left: label + description + key
    const infoCol = createElement('div', 'editrix-settings-info');

    const label = createElement('div', 'editrix-settings-label');
    label.textContent = desc.label;
    infoCol.appendChild(label);

    if (desc.description) {
      const help = createElement('div', 'editrix-settings-desc');
      help.textContent = desc.description;
      infoCol.appendChild(help);
    }

    const keyEl = createElement('div', 'editrix-settings-key');
    keyEl.textContent = desc.key;
    infoCol.appendChild(keyEl);

    row.appendChild(infoCol);

    // Right: control
    const control = this._createControl(desc);
    row.appendChild(control);

    // Modified indicator
    if (this._settings.isModified(desc.key)) {
      row.classList.add('editrix-settings-row--modified');

      const resetBtn = createElement('button', 'editrix-settings-reset');
      resetBtn.textContent = '\u21BA';
      resetBtn.title = 'Reset to default';
      resetBtn.addEventListener('click', () => {
        this._settings.reset(desc.key);
      });
      row.appendChild(resetBtn);
    }

    return row;
  }

  private _createControl(desc: SettingDescriptor): HTMLElement {
    const wrapper = createElement('div', 'editrix-settings-control');
    const value = this._settings.get(desc.key);

    switch (desc.type) {
      case 'boolean': {
        const cb = createElement('input');
        cb.type = 'checkbox';
        cb.checked = value as boolean;
        cb.className = 'editrix-settings-checkbox';
        cb.addEventListener('change', () => { this._settings.set(desc.key, cb.checked); });
        wrapper.appendChild(cb);
        break;
      }

      case 'number': {
        const input = createElement('input', 'editrix-settings-input');
        input.type = 'number';
        input.value = String(value);
        input.addEventListener('change', () => { this._settings.set(desc.key, parseFloat(input.value)); });
        wrapper.appendChild(input);
        break;
      }

      case 'string': {
        const input = createElement('input', 'editrix-settings-input');
        input.type = 'text';
        input.value = value as string;
        input.addEventListener('change', () => { this._settings.set(desc.key, input.value); });
        wrapper.appendChild(input);
        break;
      }

      case 'enum': {
        const select = createElement('select', 'editrix-settings-select');
        for (const v of desc.enumValues ?? []) {
          const opt = createElement('option');
          opt.value = v;
          opt.textContent = v;
          if (v === value) opt.selected = true;
          select.appendChild(opt);
        }
        select.addEventListener('change', () => { this._settings.set(desc.key, select.value); });
        wrapper.appendChild(select);
        break;
      }

      case 'range': {
        const rangeRow = createElement('div', 'editrix-settings-range-row');
        const slider = createElement('input');
        slider.type = 'range';
        slider.min = String(desc.min ?? 0);
        slider.max = String(desc.max ?? 100);
        slider.step = String(desc.step ?? 1);
        slider.value = String(value);
        slider.className = 'editrix-settings-range';

        const display = createElement('span', 'editrix-settings-range-value');
        display.textContent = String(value);

        slider.addEventListener('input', () => {
          display.textContent = slider.value;
          this._settings.set(desc.key, parseFloat(slider.value));
        });

        rangeRow.appendChild(slider);
        rangeRow.appendChild(display);
        wrapper.appendChild(rangeRow);
        break;
      }

      case 'color': {
        const input = createElement('input');
        input.type = 'color';
        input.value = value as string;
        input.className = 'editrix-settings-color';
        input.addEventListener('input', () => { this._settings.set(desc.key, input.value); });
        wrapper.appendChild(input);
        break;
      }
    }

    return wrapper;
  }

  private _injectStyles(): void {
    if (document.getElementById('editrix-settings-styles')) return;
    const style = document.createElement('style');
    style.id = 'editrix-settings-styles';
    style.textContent = `
      .editrix-settings-search {
        padding: 8px;
        border-bottom: 1px solid var(--editrix-border);
        flex-shrink: 0;
      }
      .editrix-settings-search-input {
        width: 100%;
        background: var(--editrix-background);
        border: 1px solid var(--editrix-border);
        color: var(--editrix-text);
        padding: 6px 10px;
        border-radius: 4px;
        font-family: inherit;
        font-size: 12px;
        outline: none;
        transition: border-color 0.15s;
      }
      .editrix-settings-search-input:focus {
        border-color: var(--editrix-accent);
      }
      .editrix-settings-content {
        flex: 1;
        overflow-y: auto;
        padding: 0 16px 16px;
      }
      .editrix-settings-empty {
        padding: 24px;
        text-align: center;
        color: var(--editrix-text-dim);
      }
      .editrix-settings-group {
        margin-top: 16px;
      }
      .editrix-settings-group-header {
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.8px;
        color: var(--editrix-accent);
        padding-bottom: 6px;
        margin-bottom: 4px;
        border-bottom: 1px solid var(--editrix-border);
      }
      .editrix-settings-row {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 10px 0;
        border-bottom: 1px solid var(--editrix-border);
        position: relative;
      }
      .editrix-settings-row--modified {
        background: rgba(0,120,212,0.04);
        margin: 0 -8px;
        padding: 10px 8px;
        border-radius: 4px;
      }
      .editrix-settings-info {
        flex: 1;
        min-width: 0;
      }
      .editrix-settings-label {
        font-size: 13px;
        font-weight: 500;
        margin-bottom: 2px;
      }
      .editrix-settings-desc {
        font-size: 11px;
        color: var(--editrix-text-dim);
        line-height: 1.4;
        margin-bottom: 2px;
      }
      .editrix-settings-key {
        font-size: 10px;
        color: var(--editrix-text-dim);
        font-family: var(--editrix-mono-font, Consolas, monospace);
        opacity: 0.6;
      }
      .editrix-settings-control {
        flex-shrink: 0;
        display: flex;
        align-items: center;
      }
      .editrix-settings-input,
      .editrix-settings-select {
        background: var(--editrix-surface);
        border: 1px solid var(--editrix-border);
        color: var(--editrix-text);
        padding: 4px 8px;
        border-radius: 4px;
        font-family: inherit;
        font-size: 12px;
        outline: none;
        width: 120px;
      }
      .editrix-settings-input:focus,
      .editrix-settings-select:focus {
        border-color: var(--editrix-accent);
      }
      .editrix-settings-checkbox {
        width: 16px;
        height: 16px;
        accent-color: var(--editrix-accent);
      }
      .editrix-settings-range-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .editrix-settings-range {
        width: 100px;
        accent-color: var(--editrix-accent);
      }
      .editrix-settings-range-value {
        font-size: 12px;
        color: var(--editrix-text-dim);
        min-width: 24px;
        text-align: right;
      }
      .editrix-settings-color {
        width: 32px;
        height: 24px;
        border: 1px solid var(--editrix-border);
        border-radius: 4px;
        cursor: pointer;
      }
      .editrix-settings-reset {
        background: none;
        border: none;
        color: var(--editrix-accent);
        font-size: 16px;
        cursor: pointer;
        padding: 0 4px;
        flex-shrink: 0;
      }
      .editrix-settings-reset:hover {
        color: var(--editrix-text);
      }
    `;
    document.head.appendChild(style);
  }
}
