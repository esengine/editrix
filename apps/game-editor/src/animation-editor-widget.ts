import type { IWorkspaceService } from '@editrix/shell';
import { BaseWidget, createIconElement } from '@editrix/view-dom';
import { ASSET_PATH_MIME } from './content-browser-widget.js';
import type {
  AnimClipData,
  AnimFrameData,
  IAnimationService,
  IAssetCatalogService,
} from './services.js';

function assetUrl(relativePath: string): string {
  return `project-asset:///${relativePath.split('/').map(encodeURIComponent).join('/')}`;
}

function toProjectRelative(abs: string, projectPath: string): string | undefined {
  if (!projectPath) return undefined;
  const root = projectPath.endsWith('/') ? projectPath : projectPath + '/';
  if (!abs.startsWith(root)) return undefined;
  return abs.slice(root.length);
}

/**
 * Sprite animation clip editor. Owns no state itself — reads current clip
 * data from {@link IAnimationService} and writes back via `updateClip`.
 * Mounted as an overlay inside {@link ViewportWidget} whenever a `.esanim`
 * document is active.
 *
 * UI layout:
 *   [Header: "Editing Clip: name" + Exit]
 *   [Props bar: FPS | Loop | Duration | Play/Pause]
 *   [Preview canvas — current frame, scaled to fit]
 *   [Frame strip (bottom) — thumbnails, drag-to-add, click to select]
 */
export class AnimationEditorWidget extends BaseWidget {
  private readonly _anim: IAnimationService;
  private readonly _catalog: IAssetCatalogService;
  private readonly _project: IWorkspaceService;

  private _filePath: string | undefined;
  private _data: AnimClipData | undefined;
  private _selectedFrame = 0;
  private _playing = false;
  private _rafId: number | undefined;
  private _lastTick = 0;
  private _frameTimer = 0;

  private _onExitHandler: (() => void) | undefined;

  // DOM refs
  private _titleEl: HTMLElement | undefined;
  private _fpsInput: HTMLInputElement | undefined;
  private _loopInput: HTMLInputElement | undefined;
  private _durationEl: HTMLElement | undefined;
  private _playBtn: HTMLButtonElement | undefined;
  private _previewImg: HTMLImageElement | undefined;
  private _emptyEl: HTMLElement | undefined;
  private _stripEl: HTMLElement | undefined;
  private _frameIndicatorEl: HTMLElement | undefined;

  constructor(
    id: string,
    anim: IAnimationService,
    catalog: IAssetCatalogService,
    project: IWorkspaceService,
  ) {
    super(id, 'animation-editor');
    this._anim = anim;
    this._catalog = catalog;
    this._project = project;

    this.subscriptions.add(
      this._anim.onDidChangeClip(({ filePath, data }) => {
        if (filePath !== this._filePath) return;
        this._data = data;
        this._render();
      }),
    );
  }

  /** Bind the widget to a `.esanim` document. Call with `undefined` to detach. */
  setDocument(filePath: string | undefined): void {
    this._stop();
    this._filePath = filePath;
    this._selectedFrame = 0;
    if (filePath === undefined) {
      this._data = undefined;
    } else {
      this._data = this._anim.getClip(filePath);
    }
    this._render();
  }

  /** Exit-button handler (e.g. closes the tab). */
  setOnExit(handler: (() => void) | undefined): void {
    this._onExitHandler = handler;
  }

  protected override buildContent(root: HTMLElement): void {
    this._injectStyles();

    const header = this.appendElement(root, 'div', 'editrix-anim-header');
    const icon = this.appendElement(header, 'span', 'editrix-anim-header__icon');
    icon.appendChild(createIconElement('anim-clip', 14));
    this._titleEl = this.appendElement(header, 'span', 'editrix-anim-header__title');
    this._titleEl.textContent = '';
    const exitBtn = this.appendElement(header, 'button', 'editrix-anim-header__exit');
    exitBtn.textContent = 'Close';
    exitBtn.addEventListener('click', () => {
      this._onExitHandler?.();
    });

    const propsBar = this.appendElement(root, 'div', 'editrix-anim-props');

    const fpsLabel = this.appendElement(propsBar, 'label', 'editrix-anim-prop');
    fpsLabel.appendChild(document.createTextNode('FPS '));
    const fps = this.appendElement(fpsLabel, 'input', 'editrix-anim-prop__input');
    fps.type = 'number';
    fps.min = '1';
    fps.max = '120';
    fps.step = '1';
    fps.addEventListener('change', () => {
      this._commitFps();
    });
    this._fpsInput = fps;

    const loopLabel = this.appendElement(propsBar, 'label', 'editrix-anim-prop');
    const loop = this.appendElement(loopLabel, 'input', 'editrix-anim-prop__check');
    loop.type = 'checkbox';
    loop.addEventListener('change', () => {
      this._commitLoop();
    });
    this._loopInput = loop;
    loopLabel.appendChild(document.createTextNode(' Loop'));

    this._durationEl = this.appendElement(
      propsBar,
      'span',
      'editrix-anim-prop editrix-anim-prop--readout',
    );

    const spacer = this.appendElement(propsBar, 'span', 'editrix-anim-props__spacer');
    spacer.style.flex = '1';

    this._playBtn = this.appendElement(propsBar, 'button', 'editrix-anim-play');
    this._playBtn.addEventListener('click', () => {
      this._togglePlay();
    });

    this._frameIndicatorEl = this.appendElement(
      propsBar,
      'span',
      'editrix-anim-prop editrix-anim-prop--readout',
    );

    const body = this.appendElement(root, 'div', 'editrix-anim-body');

    const preview = this.appendElement(body, 'div', 'editrix-anim-preview');
    this._previewImg = this.appendElement(preview, 'img', 'editrix-anim-preview__img');
    this._previewImg.draggable = false;
    this._emptyEl = this.appendElement(preview, 'div', 'editrix-anim-empty');
    this._emptyEl.textContent = 'Drop textures from the Content Browser to add frames.';

    this._stripEl = this.appendElement(root, 'div', 'editrix-anim-strip');
    this._stripEl.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes(ASSET_PATH_MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      this._stripEl?.classList.add('editrix-anim-strip--drop-target');
    });
    this._stripEl.addEventListener('dragleave', (e) => {
      if (e.target === this._stripEl)
        this._stripEl.classList.remove('editrix-anim-strip--drop-target');
    });
    this._stripEl.addEventListener('drop', (e) => {
      this._stripEl?.classList.remove('editrix-anim-strip--drop-target');
      const payload = e.dataTransfer?.getData(ASSET_PATH_MIME);
      if (!payload) return;
      e.preventDefault();
      this._handleAssetDrop(payload);
    });

    this._render();
  }

  override dispose(): void {
    this._stop();
    super.dispose();
  }

  // ─── State transitions ─────────────────────────────────

  private _commitFps(): void {
    if (!this._data || !this._fpsInput) return;
    const raw = Number(this._fpsInput.value);
    const fps = Number.isFinite(raw) && raw > 0 ? raw : this._data.fps;
    if (fps === this._data.fps) return;
    this._commit({ ...this._data, fps });
  }

  private _commitLoop(): void {
    if (!this._data || !this._loopInput) return;
    const loop = this._loopInput.checked;
    if (loop === this._data.loop) return;
    this._commit({ ...this._data, loop });
  }

  private _commit(next: AnimClipData): void {
    if (this._filePath === undefined) return;
    this._data = next;
    this._anim.updateClip(this._filePath, next);
    // updateClip re-fires onDidChangeClip synchronously; that handler
    // already calls _render. Nothing else to do.
  }

  private _handleAssetDrop(absolutePath: string): void {
    if (!this._data || this._filePath === undefined) return;
    const rel = toProjectRelative(absolutePath, this._project.path);
    if (rel === undefined) return;
    const entry = this._catalog.getByPath(rel);
    if (entry?.type !== 'image') return;

    const frames = [...this._data.frames, { texture: rel } as AnimFrameData];
    const next: AnimClipData = { ...this._data, frames };
    this._selectedFrame = frames.length - 1;
    this._commit(next);
  }

  private _removeFrame(index: number): void {
    if (!this._data) return;
    const frames = this._data.frames.filter((_, i) => i !== index);
    const selected = Math.min(this._selectedFrame, Math.max(0, frames.length - 1));
    this._selectedFrame = selected;
    this._commit({ ...this._data, frames });
  }

  private _selectFrame(index: number): void {
    if (!this._data) return;
    if (index < 0 || index >= this._data.frames.length) return;
    this._stop();
    this._selectedFrame = index;
    this._render();
  }

  // ─── Play loop ─────────────────────────────────────────

  private _togglePlay(): void {
    if (this._playing) {
      this._stop();
    } else {
      this._play();
    }
    this._render();
  }

  private _play(): void {
    if (!this._data || this._data.frames.length === 0) return;
    this._playing = true;
    this._lastTick = performance.now();
    this._frameTimer = 0;
    const step = (t: number): void => {
      if (!this._playing || !this._data) return;
      const dt = (t - this._lastTick) / 1000;
      this._lastTick = t;
      const frame = this._data.frames[this._selectedFrame];
      const frameDur = frame?.duration ?? 1 / this._data.fps;
      this._frameTimer += dt;
      if (this._frameTimer >= frameDur) {
        this._frameTimer -= frameDur;
        let next = this._selectedFrame + 1;
        if (next >= this._data.frames.length) {
          if (this._data.loop) {
            next = 0;
          } else {
            this._stop();
            this._render();
            return;
          }
        }
        this._selectedFrame = next;
        this._render();
      }
      this._rafId = requestAnimationFrame(step);
    };
    this._rafId = requestAnimationFrame(step);
  }

  private _stop(): void {
    this._playing = false;
    if (this._rafId !== undefined) {
      cancelAnimationFrame(this._rafId);
      this._rafId = undefined;
    }
  }

  // ─── Render ────────────────────────────────────────────

  private _render(): void {
    if (!this.root) return;

    if (this._titleEl) {
      const name = this._filePath?.split('/').pop() ?? '';
      this._titleEl.textContent = name ? `Editing Clip: ${name}` : 'No clip open';
    }

    const data = this._data;
    const disabled = data === undefined;

    if (this._fpsInput) {
      this._fpsInput.disabled = disabled;
      this._fpsInput.value = data !== undefined ? String(data.fps) : '12';
    }
    if (this._loopInput) {
      this._loopInput.disabled = disabled;
      this._loopInput.checked = data?.loop ?? true;
    }
    if (this._durationEl) {
      if (data === undefined || data.frames.length === 0) {
        this._durationEl.textContent = '0 frames';
      } else {
        const perFrame = 1 / data.fps;
        const totalSec = data.frames.reduce((acc, f) => acc + (f.duration ?? perFrame), 0);
        this._durationEl.textContent = `${String(data.frames.length)} frames · ${totalSec.toFixed(2)}s`;
      }
    }
    if (this._playBtn) {
      this._playBtn.disabled = data === undefined || data.frames.length === 0;
      this._playBtn.replaceChildren();
      this._playBtn.appendChild(createIconElement(this._playing ? 'pause' : 'play', 12));
      const lbl = document.createElement('span');
      lbl.textContent = this._playing ? 'Pause' : 'Play';
      this._playBtn.appendChild(lbl);
    }
    if (this._frameIndicatorEl) {
      if (data !== undefined && data.frames.length > 0) {
        this._frameIndicatorEl.textContent = `Frame ${String(this._selectedFrame + 1)} / ${String(data.frames.length)}`;
      } else {
        this._frameIndicatorEl.textContent = '';
      }
    }

    const preview = this._previewImg;
    const empty = this._emptyEl;
    if (preview && empty) {
      const currentFrame = data?.frames[this._selectedFrame];
      if (currentFrame) {
        preview.src = assetUrl(currentFrame.texture);
        preview.style.display = '';
        empty.style.display = 'none';
      } else {
        preview.removeAttribute('src');
        preview.style.display = 'none';
        empty.style.display = '';
      }
    }

    this._renderStrip();
  }

  private _renderStrip(): void {
    const strip = this._stripEl;
    if (!strip) return;
    strip.replaceChildren();
    if (!this._data) return;
    if (this._data.frames.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'editrix-anim-strip__hint';
      hint.textContent = 'No frames. Drop textures here to add them.';
      strip.appendChild(hint);
      return;
    }

    this._data.frames.forEach((frame, idx) => {
      const card = document.createElement('div');
      card.className = 'editrix-anim-frame';
      if (idx === this._selectedFrame) card.classList.add('editrix-anim-frame--selected');

      const thumb = document.createElement('div');
      thumb.className = 'editrix-anim-frame__thumb';
      const img = document.createElement('img');
      img.src = assetUrl(frame.texture);
      img.draggable = false;
      thumb.appendChild(img);
      card.appendChild(thumb);

      const label = document.createElement('div');
      label.className = 'editrix-anim-frame__label';
      const leaf = frame.texture.split('/').pop() ?? frame.texture;
      label.textContent = `${String(idx + 1)}. ${leaf}`;
      card.appendChild(label);

      const del = document.createElement('button');
      del.className = 'editrix-anim-frame__del';
      del.textContent = '\u00D7';
      del.title = 'Remove frame';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        this._removeFrame(idx);
      });
      card.appendChild(del);

      card.addEventListener('click', () => {
        this._selectFrame(idx);
      });

      strip.appendChild(card);
    });
  }

  // ─── Styles ────────────────────────────────────────────

  private _injectStyles(): void {
    const styleId = 'editrix-animation-editor-styles';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
.editrix-widget-animation-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--editrix-bg-deep, #1c1c20);
  color: var(--editrix-text, #d4d4d8);
  font-size: 12px;
}
.editrix-anim-header {
  display: flex; align-items: center; gap: 10px;
  padding: 6px 12px;
  background: linear-gradient(90deg, #2a1f5f 0%, #3a2a72 100%);
  border-bottom: 1px solid rgba(160,130,255,0.5);
  color: #e6dfff;
  flex-shrink: 0;
}
.editrix-anim-header__icon { display: inline-flex; color: #b9a8ff; }
.editrix-anim-header__title { flex: 1; font-weight: 600; }
.editrix-anim-header__exit {
  background: rgba(255,255,255,0.1); color: #fff;
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 4px; padding: 3px 10px;
  font-family: inherit; font-size: 11px; cursor: pointer;
}
.editrix-anim-header__exit:hover { background: rgba(255,255,255,0.18); }
.editrix-anim-props {
  display: flex; align-items: center; gap: 14px;
  padding: 6px 12px;
  background: var(--editrix-bg-panel, #25252a);
  border-bottom: 1px solid var(--editrix-border, #303034);
  flex-shrink: 0;
}
.editrix-anim-prop { display: inline-flex; align-items: center; gap: 4px; }
.editrix-anim-prop__input {
  width: 56px; background: #1c1c20; color: #d4d4d8;
  border: 1px solid #3a3a42; border-radius: 3px;
  padding: 2px 6px; font-family: inherit; font-size: 12px;
}
.editrix-anim-prop__check { margin: 0; }
.editrix-anim-prop--readout { color: var(--editrix-text-dim, #8a8a90); }
.editrix-anim-play {
  display: inline-flex; align-items: center; gap: 5px;
  background: var(--editrix-accent, #4a8fff); color: #fff;
  border: none; border-radius: 4px;
  padding: 3px 10px; font-family: inherit; font-size: 12px;
  cursor: pointer;
}
.editrix-anim-play:disabled { opacity: 0.4; cursor: not-allowed; }
.editrix-anim-play:hover:not(:disabled) { background: #5aa4ff; }
.editrix-anim-body {
  flex: 1; position: relative; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  padding: 20px;
  background:
    linear-gradient(45deg, #202024 25%, transparent 25%),
    linear-gradient(-45deg, #202024 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #202024 75%),
    linear-gradient(-45deg, transparent 75%, #202024 75%);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  background-color: #1a1a1e;
}
.editrix-anim-preview {
  position: relative; width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
}
.editrix-anim-preview__img {
  max-width: 100%; max-height: 100%;
  object-fit: contain;
  image-rendering: pixelated;
}
.editrix-anim-empty {
  color: var(--editrix-text-dim, #8a8a90);
  font-style: italic;
  text-align: center;
}
.editrix-anim-strip {
  height: 104px;
  flex-shrink: 0;
  background: var(--editrix-bg-panel, #25252a);
  border-top: 1px solid var(--editrix-border, #303034);
  padding: 10px;
  display: flex; align-items: flex-start; gap: 8px;
  overflow-x: auto; overflow-y: hidden;
}
.editrix-anim-strip--drop-target {
  background: rgba(160,130,255,0.1);
  outline: 1px dashed #a082ff;
  outline-offset: -4px;
}
.editrix-anim-strip__hint {
  color: var(--editrix-text-dim, #8a8a90); font-style: italic;
  align-self: center; padding-left: 8px;
}
.editrix-anim-frame {
  flex: 0 0 auto; width: 72px; height: 84px;
  background: #1c1c20; border: 1px solid #3a3a42;
  border-radius: 4px; padding: 4px;
  display: flex; flex-direction: column;
  cursor: pointer; position: relative;
}
.editrix-anim-frame:hover { border-color: #5aa4ff; }
.editrix-anim-frame--selected { border-color: #a082ff; box-shadow: 0 0 0 1px rgba(160,130,255,0.4); }
.editrix-anim-frame__thumb {
  flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center;
  background:
    linear-gradient(45deg, #2a2a30 25%, transparent 25%),
    linear-gradient(-45deg, #2a2a30 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #2a2a30 75%),
    linear-gradient(-45deg, transparent 75%, #2a2a30 75%);
  background-size: 8px 8px;
  background-position: 0 0, 0 4px, 4px -4px, -4px 0;
  background-color: #1a1a1e;
  border-radius: 2px;
}
.editrix-anim-frame__thumb img {
  max-width: 100%; max-height: 100%; object-fit: contain;
  image-rendering: pixelated;
}
.editrix-anim-frame__label {
  font-size: 10px; color: var(--editrix-text-dim, #8a8a90);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  margin-top: 3px;
}
.editrix-anim-frame__del {
  position: absolute; top: 2px; right: 2px;
  width: 16px; height: 16px; border-radius: 8px;
  background: rgba(0,0,0,0.6); color: #fff; border: none;
  font-size: 10px; line-height: 16px; cursor: pointer;
  padding: 0; opacity: 0;
  transition: opacity 0.1s;
}
.editrix-anim-frame:hover .editrix-anim-frame__del { opacity: 1; }
.editrix-anim-frame__del:hover { background: #d04a4a; }
`;
    document.head.appendChild(style);
  }
}
