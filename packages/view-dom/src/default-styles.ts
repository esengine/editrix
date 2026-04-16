/**
 * Inject default editor styles into the document.
 */
export function injectDefaultStyles(): void {
  if (document.getElementById('editrix-default-styles')) return;

  const style = document.createElement('style');
  style.id = 'editrix-default-styles';
  style.textContent = DEFAULT_CSS;
  document.head.appendChild(style);
}

const DEFAULT_CSS = /* css */ `
/* ─── Reset + Scrollbar ─────────────────────────── */
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.16); }
::-webkit-scrollbar-corner { background: transparent; }

/* ─── Root ──────────────────────────────────────── */
.editrix-root {
  display: flex; flex-direction: column;
  width: 100%; height: 100%;
  background: var(--editrix-background);
  color: var(--editrix-text);
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  font-size: 13px;
  user-select: none;
}

/* ─── Menu bar ──────────────────────────────────── */
.editrix-menubar {
  display: flex; align-items: stretch;
  height: 34px; padding: 0;
  background: var(--editrix-menu-bar);
  border-bottom: 1px solid var(--editrix-border);
  flex-shrink: 0;
  -webkit-app-region: drag;
}
.editrix-menubar-menus {
  display: flex; align-items: center;
  padding: 0 4px; flex-shrink: 0;
}

.editrix-menubar-item {
  position: relative;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
  border-radius: 3px;
  -webkit-app-region: no-drag;
}
.editrix-menubar-item:hover,
.editrix-menubar-item--active { background: rgba(255,255,255,0.08); }

.editrix-menubar-dropdown {
  position: absolute; top: 100%; left: 0;
  min-width: 200px;
  background: var(--editrix-surface);
  border: 1px solid var(--editrix-border);
  border-radius: 4px;
  padding: 4px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.5);
  z-index: 9000;
}
.editrix-menubar-dropdown-item {
  display: flex; justify-content: space-between; align-items: center;
  padding: 5px 10px; border-radius: 3px;
  font-size: 12px; cursor: pointer;
}
.editrix-menubar-dropdown-item:hover { background: var(--editrix-accent); color: var(--editrix-accent-text); }
.editrix-menubar-shortcut { font-size: 11px; color: var(--editrix-text-dim); margin-left: 24px; }
.editrix-menubar-dropdown-item:hover .editrix-menubar-shortcut { color: var(--editrix-accent-text); opacity: 0.7; }
.editrix-menubar-separator { height: 1px; background: var(--editrix-border); margin: 3px 6px; }

/* ─── Menu bar integrated tabs ─────────────────── */
.editrix-menubar-tabs {
  display: flex; align-items: stretch;
  height: 100%; flex: 1;
  margin-left: 2px; overflow-x: auto; overflow-y: hidden;
}
.editrix-menubar-tab {
  display: flex; align-items: center; gap: 6px;
  padding: 0 10px; height: 100%;
  -webkit-app-region: no-drag;
  color: var(--editrix-text-dim);
  font-size: 12px; cursor: pointer;
  white-space: nowrap;
  border-top: 2px solid transparent;
  margin-bottom: -1px;
  transition: color 0.1s, background 0.1s;
  position: relative;
}
.editrix-menubar-tab:hover { color: var(--editrix-text); background: rgba(255,255,255,0.04); }
.editrix-menubar-tab--draggable { cursor: grab; }
.editrix-menubar-tab--draggable:active { cursor: grabbing; }
.editrix-menubar-tab--active {
  color: var(--editrix-text);
  background: var(--editrix-toolbar);
  border-top-color: var(--editrix-accent);
  border-bottom: 1px solid var(--editrix-toolbar);
}

/* Colored left indicator bar — shorter than icon */
.editrix-menubar-tab-indicator {
  width: 2px; height: 40%;
  border-radius: 1px;
  background: var(--editrix-text-dim);
  flex-shrink: 0;
  opacity: 0.5;
}
.editrix-menubar-tab--active .editrix-menubar-tab-indicator { opacity: 0.9; }

/* SVG icon */
.editrix-menubar-tab-icon {
  opacity: 0.7;
}
.editrix-menubar-tab--active .editrix-menubar-tab-icon { opacity: 1; }

.editrix-menubar-tab-label { }

/* Close button — always visible */
.editrix-menubar-tab-close {
  font-size: 14px; opacity: 0.4; line-height: 1;
  padding: 1px 3px; border-radius: 3px;
  cursor: pointer;
  transition: all 0.1s;
}
.editrix-menubar-tab:hover .editrix-menubar-tab-close { opacity: 0.6; }
.editrix-menubar-tab-close:hover { opacity: 1 !important; background: rgba(255,255,255,0.1); }

/* Modified dot indicator */
.editrix-menubar-tab-modified {
  font-size: 8px; color: var(--editrix-text-dim);
  line-height: 1;
}

/* Add tab button */
.editrix-menubar-tab-add {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 100%;
  color: var(--editrix-text-dim); font-size: 16px;
  cursor: pointer; transition: color 0.1s;
  -webkit-app-region: no-drag;
}
.editrix-menubar-tab-add:hover { color: var(--editrix-text); background: rgba(255,255,255,0.04); }

/* ─── Menu bar app icon ────────────────────────── */
.editrix-menubar-app-icon {
  display: flex; align-items: center; justify-content: center;
  width: 36px; height: 100%; flex-shrink: 0;
  color: var(--editrix-accent);
  -webkit-app-region: no-drag;
}

/* ─── Menu bar right section ───────────────────── */
.editrix-menubar-right {
  display: flex; align-items: center;
  padding: 0; flex-shrink: 0; gap: 2px;
  -webkit-app-region: no-drag;
}

/* Play / Pause buttons */
.editrix-menubar-play-btn {
  display: flex; align-items: center; justify-content: center;
  width: 30px; height: 26px;
  background: rgba(255,255,255,0.08);
  border: none; border-radius: 3px;
  color: var(--editrix-text); font-size: 14px;
  cursor: pointer;
}
.editrix-menubar-play-btn:hover { background: rgba(255,255,255,0.15); }

/* Window control buttons */
.editrix-menubar-win-btn {
  display: flex; align-items: center; justify-content: center;
  width: 46px; height: 100%;
  background: none; border: none;
  color: var(--editrix-text-dim); font-size: 13px;
  cursor: pointer;
}
.editrix-menubar-win-btn:hover { background: rgba(255,255,255,0.08); color: var(--editrix-text); }
.editrix-menubar-win-close:hover { background: #e81123; color: #fff; }

/* ─── Editor toolbar ────────────────────────────── */
.editrix-editor-toolbar {
  display: flex; align-items: center; justify-content: space-between;
  height: 34px; padding: 0 8px;
  background: var(--editrix-toolbar);
  border-bottom: 1px solid var(--editrix-border);
  flex-shrink: 0;
}
.editrix-editor-toolbar-section { display: flex; gap: 2px; align-items: center; }
.editrix-editor-toolbar-center { flex: 1; justify-content: center; }
.editrix-editor-toolbar-btn {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px;
  background: none; border: none; border-radius: 4px;
  color: var(--editrix-text-dim); cursor: pointer;
  transition: all 0.1s;
}
.editrix-editor-toolbar-btn:hover { background: rgba(255,255,255,0.08); color: var(--editrix-text); }
.editrix-editor-toolbar-btn--toggled { background: var(--editrix-accent); color: var(--editrix-accent-text); }

/* ─── Tab bar ───────────────────────────────────── */
.editrix-top-tab-bar {
  display: flex; align-items: stretch;
  height: 32px; padding: 0;
  background: var(--editrix-surface);
  border-bottom: 1px solid var(--editrix-border);
  flex-shrink: 0;
  overflow-x: auto; overflow-y: hidden;
}

/* ─── Work area ─────────────────────────────────── */
.editrix-work-area { flex: 1; display: flex; overflow: hidden; }

/* ─── Activity bar ──────────────────────────────── */
.editrix-activity-bar {
  width: 36px;
  background: var(--editrix-background);
  border-right: 1px solid var(--editrix-border);
  display: flex; flex-direction: column; align-items: center;
  padding-top: 4px; flex-shrink: 0;
}
.editrix-activity-bar-btn {
  width: 30px; height: 30px;
  display: flex; align-items: center; justify-content: center;
  background: none; border: none;
  border-left: 2px solid transparent;
  color: var(--editrix-text-dim); cursor: pointer;
  margin: 1px 0; transition: all 0.1s;
}
.editrix-activity-bar-btn:hover { color: var(--editrix-text); background: rgba(255,255,255,0.04); }
.editrix-activity-bar-btn--active { color: var(--editrix-text); border-left-color: var(--editrix-accent); background: rgba(255,255,255,0.06); }

/* ─── Sidebar ───────────────────────────────────── */
.editrix-sidebar {
  width: var(--editrix-sidebar-width, 240px);
  background: var(--editrix-surface);
  border-right: 1px solid var(--editrix-border);
  display: flex; flex-direction: column;
  flex-shrink: 0; overflow: hidden;
  transition: width 0.15s ease;
}
.editrix-sidebar-header {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 12px; height: 30px;
  font-size: 11px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.6px;
  color: var(--editrix-text-dim);
  border-bottom: 1px solid var(--editrix-border);
  flex-shrink: 0;
}
.editrix-sidebar-content { flex: 1; overflow: hidden; display: flex; }

/* ─── Main editor area ──────────────────────────── */
.editrix-main-area { flex: 1; overflow: hidden; background: var(--editrix-background); padding: 2px; }

/* Root drop zones */
.editrix-root-drop {
  flex-shrink: 0; overflow: hidden;
  background: transparent; transition: all 0.15s ease;
}
.editrix-root-drop--top, .editrix-root-drop--bottom { height: 0; }
.editrix-root-drop--left, .editrix-root-drop--right { width: 0; }
.editrix-root--dragging .editrix-root-drop--top,
.editrix-root--dragging .editrix-root-drop--bottom { height: 20px; border: 2px dashed var(--editrix-border); }
.editrix-root--dragging .editrix-root-drop--left,
.editrix-root--dragging .editrix-root-drop--right { width: 20px; border: 2px dashed var(--editrix-border); }
.editrix-root-drop--active { background: rgba(74,158,255,0.15) !important; border-color: var(--editrix-accent) !important; }

/* ─── Split layout ──────────────────────────────── */
.editrix-split { display: flex; width: 100%; height: 100%; gap: 3px; background: var(--editrix-background); }
.editrix-split[data-direction="vertical"] { flex-direction: column; }
.editrix-split-child { overflow: hidden; min-width: 0; min-height: 0; }

.editrix-resize-handle {
  flex-shrink: 0; position: relative; z-index: 10;
  background: transparent; transition: background 0.1s;
}
.editrix-resize-handle[data-direction="horizontal"] { width: 3px; cursor: col-resize; }
.editrix-resize-handle[data-direction="vertical"] { height: 3px; cursor: row-resize; }
.editrix-resize-handle::after { content: ''; position: absolute; }
.editrix-resize-handle[data-direction="horizontal"]::after { top: 0; bottom: 0; left: -3px; right: -3px; }
.editrix-resize-handle[data-direction="vertical"]::after { left: 0; right: 0; top: -3px; bottom: -3px; }
.editrix-resize-handle:hover, .editrix-resize-handle--dragging { background: var(--editrix-accent); }

/* ─── Tab group ─────────────────────────────────── */
.editrix-tab-group {
  display: flex; flex-direction: column;
  width: 100%; height: 100%;
  background: var(--editrix-surface);
  border-radius: 6px;
  overflow: hidden;
}
.editrix-tab-group--empty { align-items: center; justify-content: center; }
.editrix-empty-placeholder { color: var(--editrix-text-dim); font-size: 12px; }

/* ─── Panel tab bar ─────────────────────────────── */
.editrix-tab-bar {
  display: flex;
  background: var(--editrix-surface);
  border-bottom: 1px solid rgba(255,255,255,0.04);
  overflow-x: auto; overflow-y: hidden;
  flex-shrink: 0; height: 28px;
  align-items: stretch; padding: 0;
}
.editrix-tab {
  display: flex; align-items: center; gap: 6px;
  padding: 0 12px; height: 100%;
  background: transparent;
  color: var(--editrix-text-dim);
  border: none;
  border-top: 2px solid transparent;
  margin-bottom: -1px;
  font-family: inherit; font-size: 12px;
  cursor: pointer; white-space: nowrap;
  transition: color 0.1s, background 0.1s;
}
.editrix-tab:hover { color: var(--editrix-text); background: rgba(255,255,255,0.04); }
.editrix-tab--active {
  color: var(--editrix-text);
  background: var(--editrix-surface);
  border-top-color: var(--editrix-accent);
  border-bottom: 1px solid var(--editrix-surface);
}
.editrix-tab-close {
  font-size: 13px; opacity: 0;
  padding: 2px; line-height: 1; border-radius: 3px;
  transition: all 0.1s;
}
.editrix-tab:hover .editrix-tab-close { opacity: 0.4; }
.editrix-tab-close:hover { opacity: 1 !important; background: rgba(255,255,255,0.1); }
.editrix-tab-add {
  display: flex; align-items: center; justify-content: center;
  width: 24px; flex-shrink: 0;
  color: var(--editrix-text-dim); font-size: 14px;
  cursor: pointer; transition: color 0.1s;
}
.editrix-tab-add:hover { color: var(--editrix-text); background: rgba(255,255,255,0.04); }

/* Tab bar grip handle (left) */
.editrix-tab-grip {
  display: flex; align-items: center; justify-content: center;
  width: 18px; flex-shrink: 0;
  color: var(--editrix-text-dim); opacity: 0.4;
  cursor: grab; padding: 0 2px;
}
.editrix-tab-grip:hover { opacity: 0.7; }
.editrix-tab-grip:active { cursor: grabbing; }

/* Tab bar spacer (pushes + and ⋮ to right) */
.editrix-tab-spacer { flex: 1; }

/* Tab bar more menu button (right) */
.editrix-tab-more {
  display: flex; align-items: center; justify-content: center;
  width: 24px; flex-shrink: 0;
  color: var(--editrix-text-dim); opacity: 0.4;
  cursor: pointer;
}
.editrix-tab-more:hover { opacity: 0.7; color: var(--editrix-text); }

/* Pane context menu */
.editrix-pane-context-menu {
  position: fixed; z-index: 9500;
  min-width: 180px;
  background: var(--editrix-surface);
  border: 1px solid var(--editrix-border);
  border-radius: 6px; padding: 4px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.5);
}
.editrix-pane-context-item {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px; border-radius: 4px;
  font-size: 12px; cursor: pointer;
  color: var(--editrix-text);
}
.editrix-pane-context-item:hover { background: var(--editrix-accent); color: var(--editrix-accent-text); }
.editrix-pane-context-sep { height: 1px; background: var(--editrix-border); margin: 3px 6px; }

/* Single-panel tab group: hide tab bar */
.editrix-tab-bar--hidden { display: none; }

/* Tab drag */
.editrix-tab--dragging { opacity: 0.4; }
.editrix-tab-bar--dragover { background: rgba(74,158,255,0.06); }

/* ─── Panel content ─────────────────────────────── */
.editrix-panel-content {
  flex: 1; min-height: 0; overflow: hidden;
  display: flex; flex-direction: column;
  background: var(--editrix-surface);
  position: relative;
}
.editrix-widget-placeholder {
  display: flex; align-items: center; justify-content: center;
  width: 100%; height: 100%;
  color: var(--editrix-text-dim); font-size: 14px;
}

/* Drop zone overlay */
.editrix-drop-overlay {
  position: absolute; inset: 0;
  display: none; z-index: 50; pointer-events: none;
}
.editrix-drop-overlay--visible {
  display: grid; pointer-events: auto;
  grid-template: ". top ." 1fr "left center right" 1fr ". bottom ." 1fr / 1fr 1fr 1fr;
  gap: 2px; padding: 4px;
}
.editrix-drop-zone { border-radius: 4px; border: 2px dashed transparent; }
.editrix-drop-zone--left { grid-area: left; }
.editrix-drop-zone--right { grid-area: right; }
.editrix-drop-zone--top { grid-area: top; }
.editrix-drop-zone--bottom { grid-area: bottom; }
.editrix-drop-zone--center { grid-area: center; }
.editrix-drop-zone--active { border-color: var(--editrix-accent); background: rgba(74,158,255,0.1); }

/* ─── Status bar ────────────────────────────────── */
.editrix-statusbar-area { flex-shrink: 0; display: none; }
.editrix-statusbar {
  display: flex; align-items: center; justify-content: space-between;
  height: 22px; padding: 0 10px;
  background: var(--editrix-status-bar);
  color: var(--editrix-status-bar-text);
  font-size: 11px;
  border-top: 1px solid var(--editrix-border);
}
.editrix-statusbar-section { display: flex; gap: 16px; align-items: center; }
.editrix-statusbar-item--clickable { cursor: pointer; }
.editrix-statusbar-item--clickable:hover { color: var(--editrix-text); }

/* ─── Command palette ───────────────────────────── */
.editrix-palette-overlay {
  position: fixed; inset: 0;
  background: var(--editrix-overlay);
  display: flex; justify-content: center;
  padding-top: 10%; z-index: 9999;
}
.editrix-palette-dialog {
  width: 520px; max-height: 380px;
  background: var(--editrix-surface);
  border: 1px solid var(--editrix-border);
  border-radius: 4px; overflow: hidden;
  display: flex; flex-direction: column;
  box-shadow: 0 12px 40px rgba(0,0,0,0.6);
}
.editrix-palette-input {
  padding: 12px 16px;
  background: var(--editrix-background);
  border: none; border-bottom: 1px solid var(--editrix-border);
  color: var(--editrix-text);
  font-family: inherit; font-size: 14px; outline: none;
  border-radius: 4px 4px 0 0;
}
.editrix-palette-input::placeholder { color: var(--editrix-text-dim); }
.editrix-palette-list { overflow-y: auto; flex: 1; padding: 4px; }
.editrix-palette-item {
  padding: 6px 12px; cursor: pointer;
  border-radius: 4px; margin: 1px 0;
  transition: background 0.06s;
}
.editrix-palette-item:hover { background: rgba(255,255,255,0.04); }
.editrix-palette-item--selected { background: var(--editrix-accent); color: var(--editrix-accent-text); }
.editrix-palette-item--selected .editrix-palette-category { color: var(--editrix-accent-text); opacity: 0.7; }
.editrix-palette-category { color: var(--editrix-text-dim); }
.editrix-palette-empty { padding: 16px; text-align: center; color: var(--editrix-text-dim); }

/* ─── List widget ───────────────────────────────── */
.editrix-list-filter {
  padding: 6px 8px; border-bottom: 1px solid var(--editrix-border); flex-shrink: 0;
}
.editrix-list-filter-input {
  width: 100%; background: var(--editrix-background);
  border: 1px solid var(--editrix-border); color: var(--editrix-text);
  padding: 5px 8px; border-radius: 4px;
  font-family: inherit; font-size: 12px; outline: none;
  transition: border-color 0.1s;
}
.editrix-list-filter-input:focus { border-color: var(--editrix-accent); }
.editrix-list-item {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 10px; font-size: 12px; cursor: pointer;
  border-left: 2px solid transparent;
  transition: background 0.06s;
}
.editrix-list-item:hover { background: rgba(255,255,255,0.03); }
.editrix-list-item--selected { background: rgba(74,158,255,0.15); border-left-color: var(--editrix-accent); }
.editrix-list-item--selected:hover { background: rgba(74,158,255,0.2); }
.editrix-list-item-icon { flex-shrink: 0; width: 16px; text-align: center; font-weight: 700; font-size: 10px; }
.editrix-list-item-text { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.editrix-list-item-detail { color: var(--editrix-text-dim); font-size: 11px; flex-shrink: 0; }
.editrix-list-empty { padding: 20px; text-align: center; color: var(--editrix-text-dim); }
`;
