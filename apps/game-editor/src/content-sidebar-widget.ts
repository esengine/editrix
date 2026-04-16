import type { Event } from '@editrix/common';
import { Emitter } from '@editrix/common';
import { BaseWidget, createIconElement } from '@editrix/view-dom';

/** Which view the sidebar is pointing to. */
export type ContentView = 'asset-browser' | 'console';

/**
 * Persistent sidebar for the bottom panel area.
 *
 * Always visible — switching between Asset Browser and Console
 * is driven by these icon buttons, not framework tab headers.
 */
export class ContentSidebarWidget extends BaseWidget {
  private _activeView: ContentView = 'asset-browser';
  private _termBtn: HTMLElement | undefined;
  private _folderBtn: HTMLElement | undefined;

  private readonly _onDidChangeView = new Emitter<ContentView>();
  readonly onDidChangeView: Event<ContentView> = this._onDidChangeView.event;

  constructor(id: string) {
    super(id, 'content-sidebar');
  }

  /** Update which icon is highlighted. */
  setActiveView(view: ContentView): void {
    this._activeView = view;
    this._updateActiveState();
  }

  protected override buildContent(root: HTMLElement): void {
    this._injectStyles();

    this._termBtn = this.appendElement(root, 'div', 'editrix-cs-btn');
    this._termBtn.title = 'Console';
    this._termBtn.appendChild(createIconElement('terminal', 16));
    this._termBtn.addEventListener('click', () => {
      this._onDidChangeView.fire('console');
    });

    this._folderBtn = this.appendElement(root, 'div', 'editrix-cs-btn editrix-cs-btn--active');
    this._folderBtn.title = 'Asset Browser';
    this._folderBtn.appendChild(createIconElement('folder', 16));
    this._folderBtn.addEventListener('click', () => {
      this._onDidChangeView.fire('asset-browser');
    });

    const spacer = this.appendElement(root, 'div');
    spacer.style.flex = '1';

    const grip = this.appendElement(root, 'div', 'editrix-cs-grip');
    grip.appendChild(createIconElement('grip', 10));
  }

  private _updateActiveState(): void {
    this._termBtn?.classList.toggle('editrix-cs-btn--active', this._activeView === 'console');
    this._folderBtn?.classList.toggle('editrix-cs-btn--active', this._activeView === 'asset-browser');
  }

  private _injectStyles(): void {
    const styleId = 'editrix-content-sidebar-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
.editrix-widget-content-sidebar {
  background: var(--editrix-surface);
  align-items: center;
  padding: 4px 0;
  gap: 2px;
  border-right: 1px solid var(--editrix-border);
}

.editrix-cs-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 3px;
  cursor: pointer;
  color: var(--editrix-text-dim);
}
.editrix-cs-btn:hover {
  color: var(--editrix-text);
  background: rgba(255, 255, 255, 0.08);
}

/* Active state: bottom accent bar */
.editrix-cs-btn--active {
  color: var(--editrix-text);
}
.editrix-cs-btn--active::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 3px;
  right: 3px;
  height: 2px;
  background: var(--editrix-accent);
  border-radius: 1px;
}

.editrix-cs-grip {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--editrix-text-dim);
  opacity: 0.5;
  padding: 4px 0;
}

/* ── Hide framework tab bars for bottom panels ── */
.editrix-tab-group:has([data-panel-id="content-sidebar"]) > .editrix-tab-bar,
.editrix-tab-group:has([data-panel-id="asset-browser"]) > .editrix-tab-bar,
.editrix-tab-group:has([data-panel-id="console"]) > .editrix-tab-bar {
  display: none;
}

/* ── Remove gap/handle between sidebar and content in bottom split ── */
.editrix-split:has(.editrix-tab-group:has([data-panel-id="content-sidebar"])) {
  gap: 0;
}
.editrix-split:has(.editrix-tab-group:has([data-panel-id="content-sidebar"])) > .editrix-resize-handle {
  display: none;
}
`;
    document.head.appendChild(style);
  }

  override dispose(): void {
    this._onDidChangeView.dispose();
    super.dispose();
  }
}
