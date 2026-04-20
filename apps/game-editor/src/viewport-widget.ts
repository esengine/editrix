import type { Event } from '@editrix/common';
import type { ESEngineModule, IECSSceneService } from '@editrix/estella';
import type { ISelectionService, IUndoRedoService } from '@editrix/shell';
import { BaseWidget, createIconElement } from '@editrix/view-dom';
import type { AnimationEditorWidget } from './animation-editor-widget.js';
import { GameViewWidget } from './game-view-widget.js';
import type { SharedRenderContext } from './render-context.js';
import type { SceneAssetDropEvent } from './scene-view-widget.js';
import { SceneViewWidget } from './scene-view-widget.js';

type ViewportMode = 'scene' | 'game' | 'both';

/**
 * Single viewport panel that hosts both the Scene View (interactive editor)
 * and Game View (runtime preview) and switches between them with a segmented
 * control header.
 *
 * Why one panel instead of two:
 * - Scene and Game are *perspectives of the same scene*, not independent
 *   documents. A tab strip would suggest they're separable; a segmented
 *   control communicates "modes of one thing".
 * - Single panel means the layout never has to balance two center
 *   tab-groups, and the Viewport can render full-width by default.
 *
 * Both child widgets are constructed once and remain mounted (display
 * toggles which is visible). Their canvases keep their state across
 * mode switches, and the shared render context drives both when they're
 * visible.
 */
export class ViewportWidget extends BaseWidget {
  private readonly _renderContext: SharedRenderContext;
  private readonly _selection: ISelectionService;
  private readonly _undoRedo: IUndoRedoService;

  private _mode: ViewportMode = 'scene';
  private readonly _modeButtons = new Map<ViewportMode, HTMLElement>();
  private _sceneContainer: HTMLElement | undefined;
  private _gameContainer: HTMLElement | undefined;
  private _animContainer: HTMLElement | undefined;
  private _animWidget: AnimationEditorWidget | undefined;
  private _animActive = false;
  private _headerEl: HTMLElement | undefined;
  private _prefabBannerEl: HTMLElement | undefined;
  private _prefabBannerTitleEl: HTMLElement | undefined;
  private _prefabBannerExitHandler: (() => void) | undefined;

  private readonly _sceneWidget: SceneViewWidget;
  private readonly _gameWidget: GameViewWidget;

  constructor(
    id: string,
    renderContext: SharedRenderContext,
    selection: ISelectionService,
    undoRedo: IUndoRedoService,
  ) {
    super(id, 'viewport');
    this._renderContext = renderContext;
    this._selection = selection;
    this._undoRedo = undoRedo;
    // Constructed up front so subscribers (e.g. ViewportPlugin wiring
    // onDidDropAsset) can attach before mount runs.
    this._sceneWidget = new SceneViewWidget(
      `${this.id}-scene`,
      this._renderContext,
      this._selection,
      this._undoRedo,
    );
    this._gameWidget = new GameViewWidget(`${this.id}-game`, this._renderContext);
    this.subscriptions.add(this._sceneWidget);
    this.subscriptions.add(this._gameWidget);
  }

  setECSScene(ecs: IECSSceneService): void {
    this._sceneWidget.setECSScene(ecs);
  }

  get onDidDropAsset(): Event<SceneAssetDropEvent> {
    return this._sceneWidget.onDidDropAsset;
  }

  initCamera(module: ESEngineModule): void {
    this._sceneWidget.initCamera(module);
  }

  /**
   * Mount an Animation Editor overlay that covers the scene/game panes
   * when the active document is a `.esanim`. Pass `undefined` to unmount
   * and restore the regular scene/game view. The widget is owned by the
   * caller — this method just hosts it inside the viewport body.
   */
  setAnimationEditor(widget: AnimationEditorWidget | undefined): void {
    if (widget === undefined) {
      if (!this._animActive) return;
      this._animActive = false;
      if (this._animContainer) this._animContainer.style.display = 'none';
      this._animWidget = undefined;
      if (this._headerEl) this._headerEl.style.display = '';
      this._applyMode();
      return;
    }
    if (!this._animContainer) return;
    if (this._animWidget === widget && this._animActive) return;
    this._animContainer.replaceChildren();
    widget.mount(this._animContainer);
    this._animWidget = widget;
    this._animActive = true;
    this._animContainer.style.display = '';
    // Hide the Scene/Game segmented header; the animation editor has its
    // own header strip with the Close button.
    if (this._headerEl) this._headerEl.style.display = 'none';
    if (this._sceneContainer) this._sceneContainer.style.display = 'none';
    if (this._gameContainer) this._gameContainer.style.display = 'none';
  }

  /**
   * Show a "Editing Prefab: X" banner above the viewport, with an Exit
   * button that fires {@link onExit}. Pass `undefined` to hide the banner.
   * Called by the viewport plugin when the active document switches
   * between a scene and a `.esprefab`.
   */
  setPrefabBanner(info: { title: string; onExit: () => void } | undefined): void {
    this._prefabBannerExitHandler = info?.onExit;
    if (!this._prefabBannerEl || !this._prefabBannerTitleEl) return;
    if (!info) {
      this._prefabBannerEl.style.display = 'none';
      return;
    }
    this._prefabBannerEl.style.display = '';
    this._prefabBannerTitleEl.textContent = info.title;
  }

  /** Programmatically switch which view is active. */
  setMode(mode: ViewportMode): void {
    if (this._mode === mode) return;
    this._mode = mode;
    this._applyMode();
  }

  protected override buildContent(root: HTMLElement): void {
    this._injectStyles();

    // Prefab Mode banner — sits above the header, hidden by default.
    // Shown by ViewportPlugin whenever the active doc is `.esprefab`, so
    // the user always knows whether they're editing a live instance or
    // the canonical source.
    this._prefabBannerEl = this.appendElement(root, 'div', 'editrix-prefab-mode-banner');
    this._prefabBannerEl.style.display = 'none';
    const bannerIcon = this.appendElement(
      this._prefabBannerEl,
      'span',
      'editrix-prefab-mode-banner__icon',
    );
    bannerIcon.textContent = '\u25C6'; // ◆
    this._prefabBannerTitleEl = this.appendElement(
      this._prefabBannerEl,
      'span',
      'editrix-prefab-mode-banner__title',
    );
    this._prefabBannerTitleEl.textContent = '';
    const bannerExitBtn = this.appendElement(
      this._prefabBannerEl,
      'button',
      'editrix-prefab-mode-banner__exit',
    );
    bannerExitBtn.textContent = 'Exit Prefab Mode';
    bannerExitBtn.addEventListener('click', () => {
      this._prefabBannerExitHandler?.();
    });

    // Header: segmented control. Future: tool buttons can sit on the right.
    const header = this.appendElement(root, 'div', 'editrix-viewport-header');
    this._headerEl = header;
    const segment = this.appendElement(header, 'div', 'editrix-viewport-segment');

    const buildButton = (mode: ViewportMode, label: string, icon: string): HTMLElement => {
      const btn = this.appendElement(segment, 'button', 'editrix-viewport-segment-btn');
      btn.appendChild(createIconElement(icon, 14));
      const span = document.createElement('span');
      span.textContent = label;
      btn.appendChild(span);
      btn.addEventListener('click', () => {
        this.setMode(mode);
      });
      this._modeButtons.set(mode, btn);
      return btn;
    };
    buildButton('scene', 'Scene', 'layout');
    buildButton('game', 'Game', 'play');
    buildButton('both', 'Both', 'columns');

    // Body holds both child widgets, only one visible at a time.
    const body = this.appendElement(root, 'div', 'editrix-viewport-body');
    this._sceneContainer = this.appendElement(body, 'div', 'editrix-viewport-pane');
    this._gameContainer = this.appendElement(body, 'div', 'editrix-viewport-pane');
    // Animation editor overlay — covers the body when active. Hidden by
    // default; the ViewportPlugin toggles it on `.esanim` docs.
    this._animContainer = this.appendElement(body, 'div', 'editrix-viewport-anim-overlay');
    this._animContainer.style.display = 'none';

    this._sceneWidget.mount(this._sceneContainer);
    this._gameWidget.mount(this._gameContainer);

    this._applyMode();
  }

  private _applyMode(): void {
    // When the animation overlay is up, the mode toggles are hidden and
    // neither scene nor game pane should render.
    if (this._animActive) return;

    const showScene = this._mode === 'scene' || this._mode === 'both';
    const showGame = this._mode === 'game' || this._mode === 'both';

    if (this._sceneContainer) {
      this._sceneContainer.style.display = showScene ? '' : 'none';
    }
    if (this._gameContainer) {
      this._gameContainer.style.display = showGame ? '' : 'none';
    }

    // In single-mode the visible pane fills the body. In Both mode the body
    // becomes a horizontal flex split; the data attribute drives the CSS.
    const body = this._sceneContainer?.parentElement;
    if (body) {
      body.dataset['mode'] = this._mode;
    }

    for (const [m, btn] of this._modeButtons) {
      btn.classList.toggle('editrix-viewport-segment-btn--active', m === this._mode);
    }
    // Resize the now-visible widget(s); ResizeObservers may have skipped
    // panes that were display:none on the previous frame.
    this._renderContext.requestRender();
  }

  private _injectStyles(): void {
    const styleId = 'editrix-viewport-styles';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
.editrix-widget-viewport {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--editrix-bg-deep, #1c1c20);
}
.editrix-viewport-header {
  display: flex;
  align-items: center;
  height: 30px;
  padding: 0 8px;
  background: var(--editrix-bg-panel, #25252a);
  border-bottom: 1px solid var(--editrix-border, #303034);
  flex-shrink: 0;
}
.editrix-prefab-mode-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  background: linear-gradient(90deg, #1a3a5f 0%, #1f4872 100%);
  border-bottom: 1px solid rgba(90,164,255,0.5);
  color: #dde9fb;
  font-size: 12px;
  flex-shrink: 0;
}
.editrix-prefab-mode-banner__icon { color: #9cc2ff; font-size: 12px; }
.editrix-prefab-mode-banner__title { flex: 1; font-weight: 600; }
.editrix-prefab-mode-banner__exit {
  background: rgba(255,255,255,0.1); color: #fff;
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 4px; padding: 3px 10px;
  font-family: inherit; font-size: 11px; cursor: pointer;
}
.editrix-prefab-mode-banner__exit:hover { background: rgba(255,255,255,0.18); }
.editrix-viewport-segment {
  display: inline-flex;
  background: var(--editrix-bg-deep, #1c1c20);
  border-radius: 5px;
  padding: 2px;
  gap: 1px;
}
.editrix-viewport-segment-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border: none;
  background: transparent;
  color: var(--editrix-text-dim, #8a8a90);
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
  border-radius: 4px;
  transition: background 0.1s, color 0.1s;
}
.editrix-viewport-segment-btn:hover {
  color: var(--editrix-text, #d4d4d8);
}
.editrix-viewport-segment-btn--active {
  background: var(--editrix-accent, #4a8fff);
  color: #fff;
}
.editrix-viewport-segment-btn--active:hover {
  color: #fff;
}
.editrix-viewport-body {
  flex: 1;
  position: relative;
  overflow: hidden;
}
/* Single mode: the visible pane fills the body. */
.editrix-viewport-body[data-mode="scene"] .editrix-viewport-pane,
.editrix-viewport-body[data-mode="game"] .editrix-viewport-pane {
  position: absolute;
  inset: 0;
}
/* Both mode: switch to a horizontal flex split with a thin divider. */
.editrix-viewport-body[data-mode="both"] {
  display: flex;
  flex-direction: row;
}
.editrix-viewport-body[data-mode="both"] .editrix-viewport-pane {
  position: relative;
  flex: 1 1 50%;
  min-width: 0;
}
.editrix-viewport-body[data-mode="both"] .editrix-viewport-pane + .editrix-viewport-pane {
  border-left: 1px solid var(--editrix-border, #303034);
}
.editrix-viewport-anim-overlay {
  position: absolute; inset: 0;
  background: var(--editrix-bg-deep, #1c1c20);
}
`;
    document.head.appendChild(style);
  }
}
