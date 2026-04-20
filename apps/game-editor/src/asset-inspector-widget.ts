import { BaseWidget } from '@editrix/view-dom';
import type { AssetEntry, ImporterSettings } from './services.js';

export interface AssetInspectorCallbacks {
  readonly getImporterSettings: (uuid: string) => ImporterSettings;
  readonly setImporterSettings: (uuid: string, patch: ImporterSettings) => Promise<void>;
}

export class AssetInspectorWidget extends BaseWidget {
  private _content: HTMLElement | undefined;
  private _current: AssetEntry | undefined;
  private readonly _callbacks: AssetInspectorCallbacks;

  constructor(id: string, callbacks: AssetInspectorCallbacks) {
    super(id, 'asset-inspector');
    this._callbacks = callbacks;
  }

  setAsset(entry: AssetEntry | undefined): void {
    this._current = entry;
    this._render();
  }

  protected buildContent(root: HTMLElement): void {
    this._injectStyles();
    this._content = this.appendElement(root, 'div', 'editrix-ai-root');
    this._render();
  }

  private _render(): void {
    const el = this._content;
    if (!el) return;
    el.replaceChildren();

    const entry = this._current;
    if (!entry) {
      const empty = document.createElement('div');
      empty.className = 'editrix-ai-empty';
      empty.textContent = 'No asset selected.';
      el.appendChild(empty);
      return;
    }

    // ── Thumbnail ──
    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'editrix-ai-thumb';
    el.appendChild(thumbWrap);

    const dimsEl = document.createElement('div');
    dimsEl.className = 'editrix-ai-dims';
    dimsEl.textContent = '';

    if (entry.type === 'image') {
      const img = document.createElement('img');
      img.src = assetUrl(entry.relativePath);
      img.alt = entry.relativePath;
      img.draggable = false;
      img.addEventListener('load', () => {
        dimsEl.textContent = `${String(img.naturalWidth)} × ${String(img.naturalHeight)} px`;
      });
      img.addEventListener('error', () => {
        dimsEl.textContent = '(image failed to load)';
        dimsEl.classList.add('editrix-ai-dims--error');
      });
      thumbWrap.appendChild(img);
    } else {
      const glyph = document.createElement('div');
      glyph.className = 'editrix-ai-thumb-glyph';
      glyph.textContent = glyphFor(entry.type);
      thumbWrap.appendChild(glyph);
    }

    // ── Heading: filename + path ──
    const heading = document.createElement('div');
    heading.className = 'editrix-ai-heading';
    const name = document.createElement('div');
    name.className = 'editrix-ai-name';
    name.textContent = filenameOf(entry.relativePath);
    heading.appendChild(name);
    const subpath = document.createElement('div');
    subpath.className = 'editrix-ai-path';
    subpath.textContent = entry.relativePath;
    heading.appendChild(subpath);
    el.appendChild(heading);

    // ── Type badge + dims under thumb ──
    const metaRow = document.createElement('div');
    metaRow.className = 'editrix-ai-meta-row';
    const badge = document.createElement('span');
    badge.className = `editrix-ai-badge editrix-ai-badge--${entry.type}`;
    badge.textContent = entry.type;
    metaRow.appendChild(badge);
    metaRow.appendChild(dimsEl);
    el.appendChild(metaRow);

    // ── Properties table ──
    const table = document.createElement('div');
    table.className = 'editrix-ai-props';
    appendRow(table, 'Size', humanBytes(entry.size));
    appendRow(table, 'Modified', formatTime(entry.mtime));
    appendRow(table, 'UUID', entry.uuid, { mono: true });
    el.appendChild(table);

    // ── Import Settings ──
    const importWrap = document.createElement('div');
    importWrap.className = 'editrix-ai-section';
    const importTitle = document.createElement('div');
    importTitle.className = 'editrix-ai-section-title';
    importTitle.textContent = 'Import Settings';
    importWrap.appendChild(importTitle);
    const importBody = document.createElement('div');
    importBody.className = 'editrix-ai-section-body';
    if (entry.type === 'image') {
      this._buildTextureImportControls(importBody, entry);
    } else {
      importBody.classList.add('editrix-ai-section-body--placeholder');
      importBody.textContent = importPlaceholderFor(entry.type);
    }
    importWrap.appendChild(importBody);
    el.appendChild(importWrap);
  }

  private _buildTextureImportControls(body: HTMLElement, entry: AssetEntry): void {
    const settings = this._callbacks.getImporterSettings(entry.uuid);
    const tex = settings.texture ?? {};
    const currentFilter = tex.filter ?? 'linear';
    const currentWrap = tex.wrap ?? 'repeat';
    const currentMipmaps = tex.mipmaps ?? true;

    const filterRow = buildSelectRow(body, 'Filter', currentFilter, [
      { value: 'linear', label: 'Linear (smooth)' },
      { value: 'nearest', label: 'Nearest (pixel)' },
    ]);
    const wrapRow = buildSelectRow(body, 'Wrap', currentWrap, [
      { value: 'repeat', label: 'Repeat' },
      { value: 'clamp', label: 'Clamp to edge' },
      { value: 'mirror', label: 'Mirrored' },
    ]);
    const mipmapsRow = buildCheckboxRow(body, 'Generate Mipmaps', currentMipmaps);

    const commit = (): void => {
      const patch: ImporterSettings = {
        texture: {
          filter: filterRow.value as 'linear' | 'nearest',
          wrap: wrapRow.value as 'repeat' | 'clamp' | 'mirror',
          mipmaps: mipmapsRow.checked,
        },
      };
      void this._callbacks.setImporterSettings(entry.uuid, patch);
    };
    filterRow.select.addEventListener('change', commit);
    wrapRow.select.addEventListener('change', commit);
    mipmapsRow.checkbox.addEventListener('change', commit);
  }

  private _injectStyles(): void {
    const id = 'editrix-asset-inspector-styles';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
.editrix-widget-asset-inspector { background: var(--editrix-background); }
.editrix-ai-root {
  padding: 12px;
  overflow: auto;
  font-size: 12px;
  color: var(--editrix-text);
  display: flex; flex-direction: column; gap: 10px;
}
.editrix-ai-empty { color: var(--editrix-text-dim); padding: 16px; text-align: center; }
.editrix-ai-thumb {
  width: 100%;
  aspect-ratio: 1 / 1;
  max-height: 240px;
  background:
    repeating-conic-gradient(rgba(255,255,255,0.06) 0 25%, transparent 0 50%) 0 0 / 16px 16px,
    #1a1b1f;
  border-radius: 4px;
  border: 1px solid var(--editrix-border);
  overflow: hidden;
  display: flex; align-items: center; justify-content: center;
}
.editrix-ai-thumb img {
  max-width: 100%; max-height: 100%;
  object-fit: contain;
  image-rendering: pixelated;
}
.editrix-ai-thumb-glyph { font-size: 64px; color: var(--editrix-text-dim); }
.editrix-ai-heading { display: flex; flex-direction: column; gap: 2px; }
.editrix-ai-name { font-size: 14px; font-weight: 600; word-break: break-all; }
.editrix-ai-path { color: var(--editrix-text-dim); font-size: 11px; word-break: break-all; }
.editrix-ai-meta-row {
  display: flex; align-items: center; gap: 8px;
  flex-wrap: wrap;
}
.editrix-ai-badge {
  display: inline-block;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  background: rgba(255,255,255,0.08);
  color: var(--editrix-text-dim);
}
.editrix-ai-badge--image { background: rgba(74,158,255,0.18); color: #4a9eff; }
.editrix-ai-badge--scene { background: rgba(155,89,182,0.18); color: #c678dd; }
.editrix-ai-badge--audio { background: rgba(46,204,113,0.18); color: #4ec97d; }
.editrix-ai-badge--font  { background: rgba(241,196,15,0.22); color: #e8b92a; }
.editrix-ai-dims { color: var(--editrix-text-dim); font-size: 11px; }
.editrix-ai-dims--error { color: var(--editrix-error); }
.editrix-ai-props {
  display: grid;
  grid-template-columns: 80px 1fr;
  gap: 4px 10px;
  padding-top: 4px;
  border-top: 1px solid var(--editrix-border);
}
.editrix-ai-prop-label { color: var(--editrix-text-dim); font-size: 11px; }
.editrix-ai-prop-value { word-break: break-all; font-size: 11px; }
.editrix-ai-prop-value--mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10.5px;
}
.editrix-ai-section {
  padding-top: 6px; border-top: 1px solid var(--editrix-border);
  display: flex; flex-direction: column; gap: 4px;
}
.editrix-ai-section-title {
  font-size: 11px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.4px; color: var(--editrix-text-dim);
}
.editrix-ai-section-body--placeholder {
  color: var(--editrix-text-dim); font-style: italic; font-size: 11px;
  padding: 8px; background: rgba(255,255,255,0.03); border-radius: 3px;
}
.editrix-ai-import-row {
  display: grid;
  grid-template-columns: 110px 1fr;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
}
.editrix-ai-import-label {
  color: var(--editrix-text-dim);
  font-size: 11px;
}
.editrix-ai-import-select {
  background: #2b2c31;
  color: var(--editrix-text);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 3px;
  padding: 3px 6px;
  font-size: 11px;
  outline: none;
}
.editrix-ai-import-select:focus {
  border-color: var(--editrix-accent);
}
.editrix-ai-import-checkbox {
  justify-self: start;
  accent-color: var(--editrix-accent);
}
`;
    document.head.appendChild(style);
  }
}

// ─── Helpers ────────────────────────────────────────────

function assetUrl(relativePath: string): string {
  return `project-asset://editor/${relativePath.split('/').map(encodeURIComponent).join('/')}`;
}

function filenameOf(relativePath: string): string {
  const slash = relativePath.lastIndexOf('/');
  return slash >= 0 ? relativePath.slice(slash + 1) : relativePath;
}

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function glyphFor(type: AssetEntry['type']): string {
  switch (type) {
    case 'scene':
      return '\u2606';
    case 'audio':
      return '\u266B';
    case 'font':
      return '\u0041';
    case 'image':
      return '\u25A0';
    case 'prefab':
      return '\u25C6';
    case 'anim-clip':
      return '\u25B6';
    case 'unknown':
      return '?';
  }
}

function importPlaceholderFor(type: AssetEntry['type']): string {
  switch (type) {
    case 'image':
      return 'Filter / wrap / compression settings coming soon.';
    case 'audio':
      return 'Compression / loop settings coming soon.';
    case 'font':
      return 'Atlas size / glyph range settings coming soon.';
    case 'scene':
      return 'No import settings for scenes.';
    case 'prefab':
      return 'No import settings for prefabs.';
    case 'anim-clip':
      return 'No import settings for animation clips.';
    case 'unknown':
      return 'No import settings available.';
  }
}

function appendRow(
  table: HTMLElement,
  label: string,
  value: string,
  opts?: { mono?: boolean },
): void {
  const l = document.createElement('div');
  l.className = 'editrix-ai-prop-label';
  l.textContent = label;
  const v = document.createElement('div');
  v.className = opts?.mono
    ? 'editrix-ai-prop-value editrix-ai-prop-value--mono'
    : 'editrix-ai-prop-value';
  v.textContent = value;
  table.appendChild(l);
  table.appendChild(v);
}

interface SelectOption {
  value: string;
  label: string;
}

function buildSelectRow(
  parent: HTMLElement,
  label: string,
  current: string,
  options: readonly SelectOption[],
): { select: HTMLSelectElement; get value(): string } {
  const row = document.createElement('div');
  row.className = 'editrix-ai-import-row';
  const lbl = document.createElement('div');
  lbl.className = 'editrix-ai-import-label';
  lbl.textContent = label;
  row.appendChild(lbl);
  const select = document.createElement('select');
  select.className = 'editrix-ai-import-select';
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    if (opt.value === current) o.selected = true;
    select.appendChild(o);
  }
  row.appendChild(select);
  parent.appendChild(row);
  return {
    select,
    get value(): string {
      return select.value;
    },
  };
}

function buildCheckboxRow(
  parent: HTMLElement,
  label: string,
  current: boolean,
): { checkbox: HTMLInputElement; get checked(): boolean } {
  const row = document.createElement('div');
  row.className = 'editrix-ai-import-row';
  const lbl = document.createElement('div');
  lbl.className = 'editrix-ai-import-label';
  lbl.textContent = label;
  row.appendChild(lbl);
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'editrix-ai-import-checkbox';
  checkbox.checked = current;
  row.appendChild(checkbox);
  parent.appendChild(row);
  return {
    checkbox,
    get checked(): boolean {
      return checkbox.checked;
    },
  };
}
