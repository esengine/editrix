import type { ESEngineModule, CppRegistry } from '@editrix/estella';

/** A registered view that participates in the render loop. */
export interface RenderView {
  /** Render to the offscreen WebGL canvas. Called by SharedRenderContext. */
  render(module: ESEngineModule, registry: CppRegistry, w: number, h: number): void;
  /** Optional post-draw on the 2D canvas (e.g. grid overlay). Called after drawImage. */
  postDraw?(ctx: CanvasRenderingContext2D, w: number, h: number): void;
  /** 2D canvas context to receive the drawImage copy. */
  readonly target: CanvasRenderingContext2D;
  /** Current desired width. */
  readonly width: number;
  /** Current desired height. */
  readonly height: number;
}

/**
 * Shared rendering infrastructure.
 *
 * Owns an offscreen WebGL canvas and the ECS Registry.
 * Multiple views register to receive rendered frames via drawImage.
 */
export class SharedRenderContext {
  private readonly _canvas: HTMLCanvasElement;
  private _glContext: WebGL2RenderingContext | null = null;
  private _glContextHandle = 0;
  private _module: ESEngineModule | undefined;
  private _registry: CppRegistry | undefined;
  private _views: RenderView[] = [];
  private _renderRequested = false;

  constructor() {
    this._canvas = document.createElement('canvas');
    // Offscreen — not attached to any DOM
  }

  get module(): ESEngineModule | undefined { return this._module; }
  get registry(): CppRegistry | undefined { return this._registry; }
  get isInitialized(): boolean { return this._module !== undefined; }

  /** Initialize WebGL context and estella renderer. Call once when WASM is ready. */
  init(module: ESEngineModule): boolean {
    if (this._module) return true;

    this._glContext = this._canvas.getContext('webgl2', {
      alpha: true,
      depth: true,
      stencil: true,
      antialias: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true, // needed for drawImage to read back
    });
    if (!this._glContext) {
      // eslint-disable-next-line no-console -- runs before IConsoleService exists
      console.error('SharedRenderContext: Failed to create WebGL2 context');
      return false;
    }

    this._glContextHandle = module.GL.registerContext(this._glContext, {
      majorVersion: 2,
      minorVersion: 0,
    });

    if (!module.initRendererWithContext(this._glContextHandle)) {
      // eslint-disable-next-line no-console -- runs before IConsoleService exists
      console.error('SharedRenderContext: Failed to initialize estella renderer');
      return false;
    }

    this._module = module;
    this._registry = new module.Registry();
    return true;
  }

  /** Register a view to participate in the render loop. */
  registerView(view: RenderView): void {
    if (!this._views.includes(view)) {
      this._views.push(view);
      this.requestRender();
    }
  }

  /** Unregister a view. */
  unregisterView(view: RenderView): void {
    const idx = this._views.indexOf(view);
    if (idx >= 0) this._views.splice(idx, 1);
  }

  /** Request a render on the next animation frame (coalesced). */
  requestRender(): void {
    if (this._renderRequested) return;
    this._renderRequested = true;
    requestAnimationFrame(() => {
      this._renderRequested = false;
      this._renderAllViews();
    });
  }

  private _renderAllViews(): void {
    if (!this._module || !this._registry || this._views.length === 0) return;

    for (const view of this._views) {
      const w = view.width;
      const h = view.height;
      if (w === 0 || h === 0) continue;

      // Resize offscreen canvas to match this view
      if (this._canvas.width !== w || this._canvas.height !== h) {
        this._canvas.width = w;
        this._canvas.height = h;
      }

      // Let the view render to the offscreen WebGL canvas
      view.render(this._module, this._registry, w, h);

      // Copy result to the view's 2D canvas
      view.target.drawImage(this._canvas, 0, 0);

      // Optional overlay drawing (grid, gizmos, etc.)
      view.postDraw?.(view.target, w, h);
    }
  }

  dispose(): void {
    this._views = [];
    this._registry = undefined;
    this._module = undefined;
  }
}
