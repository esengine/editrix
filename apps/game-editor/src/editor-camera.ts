import type { ESEngineModule } from '@editrix/estella';

/**
 * Editor-controlled orthographic camera for the Scene View.
 *
 * Not an ECS entity — purely TypeScript state.
 * Computes a view-projection matrix written directly to the WASM heap
 * for use with `renderFrameWithMatrix()`.
 */
export class EditorCamera {
  /** World-space position (center of view). */
  x = 0;
  y = 0;

  private _zoom = 1.0;
  private readonly _minZoom = 0.01;
  private readonly _maxZoom = 100.0;
  private readonly _near = -1000;
  private readonly _far = 1000;

  /** Orthographic half-height at zoom=1 (world units). */
  private readonly _baseOrthoSize = 300;

  /** WASM heap pointer for 16-float matrix (allocated once, reused). */
  private _matrixPtr = 0;
  private _module: ESEngineModule | undefined;

  get zoom(): number { return this._zoom; }
  set zoom(v: number) { this._zoom = Math.max(this._minZoom, Math.min(this._maxZoom, v)); }

  /**
   * Center the camera on {@link wx},{@link wy} and optionally reset zoom.
   * "Frame selection" (F key) calls this with the entity's world position
   * and a zoom that makes the target comfortably visible.
   */
  focusOn(wx: number, wy: number, zoom?: number): void {
    this.x = wx;
    this.y = wy;
    if (zoom !== undefined) this.zoom = zoom;
  }

  /** Allocate WASM heap memory for the matrix. Call once after module is ready. */
  init(module: ESEngineModule): void {
    this._module = module;
    this._matrixPtr = module._malloc(64); // 16 floats × 4 bytes
  }

  /**
   * Compute orthographic VP matrix and write to WASM heap.
   * Returns the pointer for `renderFrameWithMatrix()`.
   */
  computeMatrix(viewportWidth: number, viewportHeight: number): number {
    if (!this._module || this._matrixPtr === 0) return 0;

    const aspect = viewportWidth / viewportHeight;
    const halfH = this._baseOrthoSize / this._zoom;
    const halfW = halfH * aspect;

    // Ortho bounds offset by camera position (bakes view transform into projection)
    const left = -halfW + this.x;
    const right = halfW + this.x;
    const bottom = -halfH + this.y;
    const top = halfH + this.y;
    const near = this._near;
    const far = this._far;

    const rl = right - left;
    const tb = top - bottom;
    const fn = far - near;

    // Column-major 4×4 orthographic matrix (matches glm::ortho layout)
    const m = this._module.HEAPF32;
    const o = this._matrixPtr >> 2;

    m[o + 0] = 2 / rl;   m[o + 1] = 0;         m[o + 2] = 0;          m[o + 3] = 0;
    m[o + 4] = 0;         m[o + 5] = 2 / tb;    m[o + 6] = 0;          m[o + 7] = 0;
    m[o + 8] = 0;         m[o + 9] = 0;         m[o + 10] = -2 / fn;   m[o + 11] = 0;
    m[o + 12] = -(right + left) / rl;
    m[o + 13] = -(top + bottom) / tb;
    m[o + 14] = -(far + near) / fn;
    m[o + 15] = 1;

    return this._matrixPtr;
  }

  /** Pan by screen-pixel delta, converted to world units. */
  pan(dx: number, dy: number, viewportWidth: number, viewportHeight: number): void {
    const halfH = this._baseOrthoSize / this._zoom;
    const aspect = viewportWidth / viewportHeight;
    const halfW = halfH * aspect;

    const worldPerPixelX = (2 * halfW) / viewportWidth;
    const worldPerPixelY = (2 * halfH) / viewportHeight;

    this.x -= dx * worldPerPixelX;
    this.y += dy * worldPerPixelY; // screen Y down, world Y up
  }

  /** Zoom centered on a screen position (e.g. mouse cursor). */
  zoomAt(delta: number, screenX: number, screenY: number,
    viewportWidth: number, viewportHeight: number): void {
    const aspect = viewportWidth / viewportHeight;
    const halfH = this._baseOrthoSize / this._zoom;
    const halfW = halfH * aspect;

    // Screen → NDC → world position under cursor
    const ndcX = (screenX / viewportWidth) * 2 - 1;
    const ndcY = 1 - (screenY / viewportHeight) * 2;
    const worldX = this.x + ndcX * halfW;
    const worldY = this.y + ndcY * halfH;

    // Apply zoom
    const factor = delta > 0 ? 1.1 : 1 / 1.1;
    this.zoom = this._zoom * factor;

    // Adjust position so the world point under cursor stays in place
    const newHalfH = this._baseOrthoSize / this._zoom;
    const newHalfW = newHalfH * aspect;
    this.x = worldX - ndcX * newHalfW;
    this.y = worldY - ndcY * newHalfH;
  }

  /** Convert screen pixel coordinates to world coordinates. */
  screenToWorld(sx: number, sy: number, viewportWidth: number, viewportHeight: number): [number, number] {
    const aspect = viewportWidth / viewportHeight;
    const halfH = this._baseOrthoSize / this._zoom;
    const halfW = halfH * aspect;

    const ndcX = (sx / viewportWidth) * 2 - 1;
    const ndcY = 1 - (sy / viewportHeight) * 2;
    return [this.x + ndcX * halfW, this.y + ndcY * halfH];
  }

  /** Convert world coordinates to screen pixel coordinates. */
  worldToScreen(wx: number, wy: number, viewportWidth: number, viewportHeight: number): [number, number] {
    const aspect = viewportWidth / viewportHeight;
    const halfH = this._baseOrthoSize / this._zoom;
    const halfW = halfH * aspect;

    const sx = ((wx - this.x) / halfW * 0.5 + 0.5) * viewportWidth;
    const sy = (0.5 - (wy - this.y) / halfH * 0.5) * viewportHeight;
    return [sx, sy];
  }

  /** Get the visible world-space bounds [left, right, bottom, top]. */
  getWorldBounds(viewportWidth: number, viewportHeight: number): [number, number, number, number] {
    const aspect = viewportWidth / viewportHeight;
    const halfH = this._baseOrthoSize / this._zoom;
    const halfW = halfH * aspect;
    return [this.x - halfW, this.x + halfW, this.y - halfH, this.y + halfH];
  }

  /** Reset to origin and default zoom. */
  reset(): void {
    this.x = 0;
    this.y = 0;
    this._zoom = 1.0;
  }

  dispose(): void {
    if (this._module && this._matrixPtr !== 0) {
      this._module._free(this._matrixPtr);
      this._matrixPtr = 0;
    }
    this._module = undefined;
  }
}
