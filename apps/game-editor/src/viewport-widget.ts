import type { ESEngineModule, IECSSceneService } from '@editrix/estella';
import type { ISelectionService, IUndoRedoService } from '@editrix/shell';
import { BaseWidget, createIconElement } from '@editrix/view-dom';
import { GameViewWidget } from './game-view-widget.js';
import type { SharedRenderContext } from './render-context.js';
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

  private _sceneWidget: SceneViewWidget | undefined;
  private _gameWidget: GameViewWidget | undefined;

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
  }

  setECSScene(ecs: IECSSceneService): void {
    this._sceneWidget?.setECSScene(ecs);
  }

  initCamera(module: ESEngineModule): void {
    this._sceneWidget?.initCamera(module);
  }

  /** Programmatically switch which view is active. */
  setMode(mode: ViewportMode): void {
    if (this._mode === mode) return;
    this._mode = mode;
    this._applyMode();
  }

  protected override buildContent(root: HTMLElement): void {
    this._injectStyles();

    // Header: segmented control. Future: tool buttons can sit on the right.
    const header = this.appendElement(root, 'div', 'editrix-viewport-header');
    const segment = this.appendElement(header, 'div', 'editrix-viewport-segment');

    const buildButton = (mode: ViewportMode, label: string, icon: string): HTMLElement => {
      const btn = this.appendElement(segment, 'button', 'editrix-viewport-segment-btn');
      btn.appendChild(createIconElement(icon, 14));
      const span = document.createElement('span');
      span.textContent = label;
      btn.appendChild(span);
      btn.addEventListener('click', () => { this.setMode(mode); });
      this._modeButtons.set(mode, btn);
      return btn;
    };
    buildButton('scene', 'Scene', 'layout');
    buildButton('game',  'Game',  'play');
    buildButton('both',  'Both',  'columns');

    // Body holds both child widgets, only one visible at a time.
    const body = this.appendElement(root, 'div', 'editrix-viewport-body');
    this._sceneContainer = this.appendElement(body, 'div', 'editrix-viewport-pane');
    this._gameContainer = this.appendElement(body, 'div', 'editrix-viewport-pane');

    this._sceneWidget = new SceneViewWidget(`${this.id}-scene`, this._renderContext, this._selection, this._undoRedo);
    this.subscriptions.add(this._sceneWidget);
    this._sceneWidget.mount(this._sceneContainer);

    this._gameWidget = new GameViewWidget(`${this.id}-game`, this._renderContext);
    this.subscriptions.add(this._gameWidget);
    this._gameWidget.mount(this._gameContainer);

    this._applyMode();
  }

  private _applyMode(): void {
    const showScene = this._mode === 'scene' || this._mode === 'both';
    const showGame  = this._mode === 'game'  || this._mode === 'both';

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
`;
    document.head.appendChild(style);
  }
}
