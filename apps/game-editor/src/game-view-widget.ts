import type { ESEngineModule, CppRegistry } from '@editrix/estella';
import { BaseWidget } from '@editrix/view-dom';
import type { SharedRenderContext, RenderView } from './render-context.js';

/**
 * Game View — renders through the game's Camera entity.
 *
 * Uses a 2D canvas that receives rendered frames from SharedRenderContext
 * via drawImage. Edit mode: preview only (no input handling).
 */
export class GameViewWidget extends BaseWidget {
  private _canvas: HTMLCanvasElement | undefined;
  private _ctx2d: CanvasRenderingContext2D | null = null;
  private readonly _renderContext: SharedRenderContext;
  private _view: RenderView | undefined;

  constructor(id: string, renderContext: SharedRenderContext) {
    super(id, 'game-view');
    this._renderContext = renderContext;
  }

  protected buildContent(root: HTMLElement): void {
    this._injectStyles();

    const viewport = this.appendElement(root, 'div', 'editrix-gv-viewport');

    this._canvas = document.createElement('canvas');
    this._canvas.className = 'editrix-gv-canvas';
    viewport.appendChild(this._canvas);
    const ctx2d = this._canvas.getContext('2d');
    if (!ctx2d) {
      throw new Error('GameViewWidget: 2D canvas context unavailable.');
    }
    this._ctx2d = ctx2d;

    // Register as a render view
    const canvasRef = this._canvas;
    this._view = {
      render: (module: ESEngineModule, _registry: CppRegistry, w: number, h: number): void => {
        module.renderFrame(_registry, w, h);
      },
      target: ctx2d,
      get width() { return canvasRef.clientWidth; },
      get height() { return canvasRef.clientHeight; },
    };
    this._renderContext.registerView(this._view);

    // ResizeObserver — sync 2D canvas buffer size + trigger render
    const ro = new ResizeObserver(() => {
      if (this._canvas) {
        const w = this._canvas.clientWidth;
        const h = this._canvas.clientHeight;
        if (w > 0 && h > 0 && (this._canvas.width !== w || this._canvas.height !== h)) {
          this._canvas.width = w;
          this._canvas.height = h;
        }
      }
      this._renderContext.requestRender();
    });
    ro.observe(this._canvas);
    this.subscriptions.add({ dispose: () => { ro.disconnect(); } });
  }

  override dispose(): void {
    if (this._view) this._renderContext.unregisterView(this._view);
    super.dispose();
  }

  private _injectStyles(): void {
    const styleId = 'editrix-game-view-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
.editrix-widget-game-view { background: #1a1a1e; }

.editrix-gv-viewport {
  position: relative; width: 100%; height: 100%; overflow: hidden;
}

.editrix-gv-canvas {
  position: absolute; top: 0; left: 0; width: 100%; height: 100%;
}
`;
    document.head.appendChild(style);
  }
}
