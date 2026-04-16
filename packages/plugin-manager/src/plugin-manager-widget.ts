import type { IPluginManager, PluginInfo } from '@editrix/core';
import { PluginState } from '@editrix/core';
import { BaseWidget, createElement } from '@editrix/view-dom';

const STATE_LABELS: Record<string, string> = {
  [PluginState.Active]: 'Active',
  [PluginState.Resolved]: 'Ready',
  [PluginState.Unloaded]: 'Inactive',
};

const STATE_COLORS: Record<string, string> = {
  [PluginState.Active]: '#4ec9b0',
  [PluginState.Resolved]: '#569cd6',
  [PluginState.Unloaded]: '#858585',
};

/**
 * Plugin Manager sidebar widget.
 *
 * Lists all registered plugins with status indicators,
 * enable/disable controls, and search filtering.
 */
export class PluginManagerWidget extends BaseWidget {
  private readonly _manager: IPluginManager;
  private readonly _onRowClick: ((pluginId: string) => void) | undefined;
  private _listEl: HTMLElement | undefined;
  private _filterText = '';

  constructor(id: string, manager: IPluginManager, onRowClick?: (pluginId: string) => void) {
    super(id, 'plugin-manager');
    this._manager = manager;
    this._onRowClick = onRowClick;
  }

  protected buildContent(root: HTMLElement): void {
    this._injectStyles();

    // Search
    const searchBar = this.appendElement(root, 'div', 'editrix-pm-search');
    const searchInput = createElement('input', 'editrix-pm-search-input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Search...';
    searchInput.addEventListener('input', () => {
      this._filterText = searchInput.value.toLowerCase();
      this._renderList();
    });
    searchBar.appendChild(searchInput);

    // List
    this._listEl = this.appendElement(root, 'div', 'editrix-pm-list');

    this.subscriptions.add(
      this._manager.onDidChangePlugin(() => { this._renderList(); }),
    );
    this.subscriptions.add(
      this._manager.onDidChangePluginList(() => { this._renderList(); }),
    );

    this._renderList();
  }

  private _renderList(): void {
    if (!this._listEl) return;
    this._listEl.innerHTML = '';

    const all = this._manager.getAll();
    const filtered = this._filterText
      ? all.filter((p) =>
          p.manifest.name.toLowerCase().includes(this._filterText) ||
          p.manifest.id.toLowerCase().includes(this._filterText) ||
          (p.manifest.description?.toLowerCase().includes(this._filterText) ?? false)
        )
      : all;

    if (filtered.length === 0) {
      const empty = createElement('div', 'editrix-pm-empty');
      empty.textContent = this._filterText ? 'No matching plugins' : 'No plugins installed';
      this._listEl.appendChild(empty);
      return;
    }

    const userPlugins = filtered.filter((p) => !p.builtin);
    const builtins = filtered.filter((p) => p.builtin);

    if (userPlugins.length > 0) {
      this._renderSection('Installed', userPlugins);
    }
    if (builtins.length > 0) {
      this._renderSection('Built-in', builtins);
    }
  }

  private _renderSection(title: string, plugins: readonly PluginInfo[]): void {
    if (!this._listEl) return;

    const header = createElement('div', 'editrix-pm-section');
    header.textContent = `${title} (${String(plugins.length)})`;
    this._listEl.appendChild(header);

    for (const info of plugins) {
      this._renderRow(info);
    }
  }

  private _renderRow(info: PluginInfo): void {
    if (!this._listEl) return;

    const row = createElement('div', 'editrix-pm-row');
    if (info.disabled) row.classList.add('editrix-pm-row--disabled');
    row.addEventListener('click', () => {
      this._onRowClick?.(info.manifest.id);
    });

    // Status dot
    const dot = createElement('span', 'editrix-pm-dot');
    const stateColor = info.disabled ? '#f14c4c' : (STATE_COLORS[info.state] ?? '#858585');
    dot.style.background = stateColor;
    row.appendChild(dot);

    // Info column
    const infoCol = createElement('div', 'editrix-pm-info');

    const nameEl = createElement('div', 'editrix-pm-name');
    nameEl.textContent = info.manifest.name;
    infoCol.appendChild(nameEl);

    const metaRow = createElement('div', 'editrix-pm-meta');
    const versionEl = createElement('span', 'editrix-pm-version');
    versionEl.textContent = `v${info.manifest.version}`;
    metaRow.appendChild(versionEl);

    const stateLabel = createElement('span', 'editrix-pm-state');
    stateLabel.textContent = info.disabled ? 'Disabled' : (STATE_LABELS[info.state] ?? '');
    stateLabel.style.color = stateColor;
    metaRow.appendChild(stateLabel);
    infoCol.appendChild(metaRow);

    if (info.manifest.description) {
      const desc = createElement('div', 'editrix-pm-desc');
      desc.textContent = info.manifest.description;
      infoCol.appendChild(desc);
    }

    row.appendChild(infoCol);

    // Actions (only for non-builtin)
    if (!info.builtin) {
      const actions = createElement('div', 'editrix-pm-actions');
      if (info.disabled) {
        actions.appendChild(this._actionBtn('Enable', '#4ec9b0', () => {
          void this._manager.enablePlugin(info.manifest.id);
        }));
      } else {
        actions.appendChild(this._actionBtn('Disable', '#858585', () => {
          void this._manager.disablePlugin(info.manifest.id);
        }));
      }
      actions.appendChild(this._actionBtn('Remove', '#f14c4c', () => {
        void this._manager.uninstallPlugin(info.manifest.id);
      }));
      row.appendChild(actions);
    }

    this._listEl.appendChild(row);
  }

  private _actionBtn(label: string, hoverColor: string, onClick: () => void): HTMLButtonElement {
    const btn = createElement('button', 'editrix-pm-btn');
    btn.textContent = label;
    btn.style.setProperty('--hover-color', hoverColor);
    btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return btn;
  }

  private _injectStyles(): void {
    if (document.getElementById('editrix-pm-styles')) return;
    const style = document.createElement('style');
    style.id = 'editrix-pm-styles';
    style.textContent = `
/* ── Search ── */
.editrix-pm-search {
  padding: 8px;
  flex-shrink: 0;
}
.editrix-pm-search-input {
  width: 100%;
  background: #414141;
  border: none;
  color: var(--editrix-text);
  padding: 6px 10px;
  border-radius: 4px;
  font-family: inherit;
  font-size: 12px;
  outline: none;
  box-sizing: border-box;
}
.editrix-pm-search-input::placeholder { color: var(--editrix-text-dim); }
.editrix-pm-search-input:focus { box-shadow: 0 0 0 1px var(--editrix-accent); }

/* ── List ── */
.editrix-pm-list {
  flex: 1;
  overflow-y: auto;
}
.editrix-pm-empty {
  padding: 24px;
  text-align: center;
  color: var(--editrix-text-dim);
  font-size: 12px;
}
.editrix-pm-section {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--editrix-text-dim);
  padding: 14px 12px 6px;
}

/* ── Row ── */
.editrix-pm-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  cursor: pointer;
  border-radius: 4px;
  margin: 2px 6px;
  transition: background 0.08s;
}
.editrix-pm-row:hover {
  background: rgba(255, 255, 255, 0.04);
}
.editrix-pm-row--disabled {
  opacity: 0.55;
}

/* ── Status dot ── */
.editrix-pm-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-top: 5px;
}

/* ── Info column ── */
.editrix-pm-info {
  flex: 1;
  min-width: 0;
}
.editrix-pm-name {
  font-weight: 500;
  font-size: 13px;
  color: var(--editrix-text);
  margin-bottom: 2px;
}
.editrix-pm-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 2px;
}
.editrix-pm-version {
  font-size: 11px;
  color: var(--editrix-text-dim);
}
.editrix-pm-state {
  font-size: 11px;
}
.editrix-pm-desc {
  font-size: 11px;
  color: var(--editrix-text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 2px;
}

/* ── Actions ── */
.editrix-pm-actions {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
}
.editrix-pm-btn {
  background: transparent;
  border: 1px solid var(--editrix-border);
  border-radius: 4px;
  padding: 3px 10px;
  font-size: 11px;
  font-family: inherit;
  color: var(--editrix-text-dim);
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.1s;
}
.editrix-pm-btn:hover {
  color: var(--hover-color, var(--editrix-text));
  border-color: var(--hover-color, var(--editrix-text-dim));
  background: rgba(255, 255, 255, 0.04);
}
`;
    document.head.appendChild(style);
  }
}
