import type { IPluginManager } from '@editrix/core';
import { PluginState } from '@editrix/core';
import { BaseWidget, createElement } from '@editrix/view-dom';

const STATE_LABELS: Record<string, string> = {
  [PluginState.Active]: 'Active',
  [PluginState.Resolved]: 'Ready',
  [PluginState.Unloaded]: 'Inactive',
};

/**
 * Detail view for a single plugin, shown as a tab in the main editor area.
 */
export class PluginDetailWidget extends BaseWidget {
  private readonly _manager: IPluginManager;
  private readonly _pluginId: string;
  private _contentEl: HTMLElement | undefined;

  constructor(id: string, pluginId: string, manager: IPluginManager) {
    super(id, 'plugin-detail');
    this._pluginId = pluginId;
    this._manager = manager;
  }

  protected buildContent(root: HTMLElement): void {
    this._injectStyles();

    this._contentEl = this.appendElement(root, 'div', 'editrix-pd-container');
    this._contentEl.style.overflowY = 'auto';
    this._contentEl.style.flex = '1';

    this.subscriptions.add(
      this._manager.onDidChangePlugin(() => { this._render(); }),
    );

    this._render();
  }

  private _render(): void {
    if (!this._contentEl) return;
    this._contentEl.innerHTML = '';

    const info = this._manager.getInfo(this._pluginId);
    if (!info) {
      this._contentEl.textContent = 'Plugin not found.';
      return;
    }

    // Header
    const header = createElement('div', 'editrix-pd-header');

    const titleRow = createElement('div', 'editrix-pd-title-row');
    const name = createElement('h2', 'editrix-pd-name');
    name.textContent = info.manifest.name;
    titleRow.appendChild(name);

    const version = createElement('span', 'editrix-pd-version');
    version.textContent = `v${info.manifest.version}`;
    titleRow.appendChild(version);
    header.appendChild(titleRow);

    const id = createElement('div', 'editrix-pd-id');
    id.textContent = info.manifest.id;
    header.appendChild(id);

    if (info.manifest.description) {
      const desc = createElement('p', 'editrix-pd-desc');
      desc.textContent = info.manifest.description;
      header.appendChild(desc);
    }

    // Action bar
    const actionBar = createElement('div', 'editrix-pd-actions');
    if (!info.builtin) {
      if (info.disabled) {
        actionBar.appendChild(this._actionBtn('Enable', 'editrix-pd-btn--primary', () => {
          void this._manager.enablePlugin(this._pluginId);
        }));
      } else {
        actionBar.appendChild(this._actionBtn('Disable', '', () => {
          void this._manager.disablePlugin(this._pluginId);
        }));
      }
      actionBar.appendChild(this._actionBtn('Uninstall', 'editrix-pd-btn--danger', () => {
        void this._manager.uninstallPlugin(this._pluginId);
      }));
    }

    // Status badge
    const statusBadge = createElement('span', 'editrix-pd-status');
    const stateText = info.disabled ? 'Disabled' : (STATE_LABELS[info.state] ?? info.state);
    statusBadge.textContent = stateText;
    statusBadge.classList.add(info.disabled ? 'editrix-pd-status--disabled' : 'editrix-pd-status--active');
    actionBar.appendChild(statusBadge);

    if (info.builtin) {
      const builtinBadge = createElement('span', 'editrix-pd-status');
      builtinBadge.textContent = 'Built-in';
      actionBar.appendChild(builtinBadge);
    }

    header.appendChild(actionBar);
    this._contentEl.appendChild(header);

    // Details section
    const details = createElement('div', 'editrix-pd-details');

    this._addDetailRow(details, 'Identifier', info.manifest.id);
    this._addDetailRow(details, 'Version', info.manifest.version);
    if (info.manifest.author) {
      this._addDetailRow(details, 'Author', info.manifest.author);
    }

    const deps = info.manifest.dependencies;
    if (deps && deps.length > 0) {
      this._addDetailRow(details, 'Dependencies', deps.join(', '));
    }

    const events = info.manifest.activationEvents;
    if (events && events.length > 0) {
      this._addDetailRow(details, 'Activation', events.join(', '));
    } else {
      this._addDetailRow(details, 'Activation', 'On startup');
    }

    this._contentEl.appendChild(details);
  }

  private _addDetailRow(parent: HTMLElement, label: string, value: string): void {
    const row = createElement('div', 'editrix-pd-detail-row');
    const lbl = createElement('span', 'editrix-pd-detail-label');
    lbl.textContent = label;
    const val = createElement('span', 'editrix-pd-detail-value');
    val.textContent = value;
    row.appendChild(lbl);
    row.appendChild(val);
    parent.appendChild(row);
  }

  private _actionBtn(label: string, cls: string, onClick: () => void): HTMLButtonElement {
    const btn = createElement('button', `editrix-pd-btn ${cls}`);
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  private _injectStyles(): void {
    if (document.getElementById('editrix-pd-styles')) return;
    const style = document.createElement('style');
    style.id = 'editrix-pd-styles';
    style.textContent = `
      .editrix-pd-container {
        padding: 24px 32px;
        max-width: 700px;
      }
      .editrix-pd-header {
        margin-bottom: 24px;
        padding-bottom: 20px;
        border-bottom: 1px solid var(--editrix-border);
      }
      .editrix-pd-title-row {
        display: flex;
        align-items: baseline;
        gap: 10px;
        margin-bottom: 4px;
      }
      .editrix-pd-name {
        font-size: 20px;
        font-weight: 600;
      }
      .editrix-pd-version {
        font-size: 13px;
        color: var(--editrix-text-dim);
      }
      .editrix-pd-id {
        font-size: 12px;
        color: var(--editrix-text-dim);
        font-family: var(--editrix-mono-font, Consolas, monospace);
        margin-bottom: 8px;
      }
      .editrix-pd-desc {
        font-size: 13px;
        color: var(--editrix-text);
        line-height: 1.5;
        margin-bottom: 16px;
      }
      .editrix-pd-actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .editrix-pd-btn {
        background: transparent;
        border: 1px solid var(--editrix-border);
        border-radius: 4px;
        padding: 5px 14px;
        font-size: 12px;
        font-family: inherit;
        color: var(--editrix-text);
        cursor: pointer;
        transition: all 0.12s;
      }
      .editrix-pd-btn:hover {
        background: rgba(255,255,255,0.06);
        border-color: var(--editrix-text-dim);
      }
      .editrix-pd-btn--primary {
        background: var(--editrix-accent);
        border-color: var(--editrix-accent);
        color: var(--editrix-accent-text);
      }
      .editrix-pd-btn--primary:hover {
        opacity: 0.9;
      }
      .editrix-pd-btn--danger {
        color: #f14c4c;
        border-color: #f14c4c;
      }
      .editrix-pd-btn--danger:hover {
        background: rgba(241,76,76,0.1);
      }
      .editrix-pd-status {
        font-size: 11px;
        padding: 2px 10px;
        border-radius: 10px;
        background: rgba(255,255,255,0.06);
        color: var(--editrix-text-dim);
        margin-left: auto;
      }
      .editrix-pd-status--active { color: #4ec9b0; }
      .editrix-pd-status--disabled { color: #f14c4c; }
      .editrix-pd-details {
        display: flex;
        flex-direction: column;
        gap: 0;
      }
      .editrix-pd-detail-row {
        display: flex;
        padding: 8px 0;
        border-bottom: 1px solid var(--editrix-border);
        font-size: 13px;
      }
      .editrix-pd-detail-label {
        width: 120px;
        flex-shrink: 0;
        color: var(--editrix-text-dim);
      }
      .editrix-pd-detail-value {
        color: var(--editrix-text);
        font-family: var(--editrix-mono-font, Consolas, monospace);
        font-size: 12px;
      }
    `;
    document.head.appendChild(style);
  }
}
