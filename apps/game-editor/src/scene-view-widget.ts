import type { Event } from '@editrix/common';
import { Emitter } from '@editrix/common';
import type { ESEngineModule, CppRegistry, IECSSceneService } from '@editrix/estella';
import type { ISelectionService, IUndoRedoService } from '@editrix/shell';
import { BaseWidget, createIconElement, registerIcon } from '@editrix/view-dom';
import { ASSET_PATH_MIME } from './content-browser-widget.js';
import { EditorCamera } from './editor-camera.js';
import { GizmoController, type ToolId as GizmoToolId, type GizmoAxis } from './gizmo-controller.js';
import type { SharedRenderContext, RenderView } from './render-context.js';
import { entityRef, parseSelectionRef } from './services.js';

function cursorForAxis(axis: GizmoAxis, tool: GizmoToolId): string {
  if (axis === 'x') return 'ew-resize';
  if (axis === 'y') return 'ns-resize';
  if (axis === 'ring') return 'grabbing';
  // axis === 'xy'
  if (tool === 'move') return 'move';
  return 'crosshair';
}

export interface SceneAssetDropEvent {
  readonly absolutePath: string;
  readonly worldX: number;
  readonly worldY: number;
  /** Entity under the cursor, if any — receiver may choose to replace its sprite. */
  readonly hitEntityId: number | undefined;
}

// ─── Register tool icons ────────────────────────────────

registerIcon(
  'tool-select',
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2l4 12 2-5 5-2L3 2z"/></svg>',
);

registerIcon(
  'tool-move',
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v12M2 8h12M8 2l-2 2M8 2l2 2M8 14l-2-2M8 14l2-2M2 8l2-2M2 8l2 2M14 8l-2-2M14 8l-2 2"/></svg>',
);

registerIcon(
  'tool-rotate',
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 8a5 5 0 01-9.17 2.77M3 8a5 5 0 019.17-2.77"/><path d="M13 3v3.5h-3.5M3 13V9.5h3.5"/></svg>',
);

registerIcon(
  'tool-scale',
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 13V8M3 13h5M3 13l10-10M13 3v5M13 3H8"/></svg>',
);

registerIcon(
  'snap-grid',
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><circle cx="4" cy="4" r="1.2" fill="currentColor" stroke="none"/><circle cx="8" cy="4" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="4" r="1.2" fill="currentColor" stroke="none"/><circle cx="4" cy="8" r="1.2" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="8" r="1.2" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="8" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg>',
);

type ToolId = GizmoToolId;

/**
 * Scene View — editor camera viewport.
 *
 * Uses a 2D canvas that receives rendered frames from SharedRenderContext
 * via drawImage. The editor camera (pan/zoom) is independent of any game entity.
 */
export class SceneViewWidget extends BaseWidget {
  private readonly _toolButtons = new Map<ToolId, HTMLElement>();
  private _snapInput: HTMLInputElement | undefined;
  private _zoomIndicatorEl: HTMLButtonElement | undefined;
  private _canvas: HTMLCanvasElement | undefined;
  private readonly _renderContext: SharedRenderContext;
  private readonly _editorCamera = new EditorCamera();
  private readonly _selection: ISelectionService;
  private readonly _undoRedo: IUndoRedoService;
  private readonly _gizmo = new GizmoController();
  private _ecsScene: IECSSceneService | undefined;
  private _view: RenderView | undefined;

  // Mouse pan state
  private _isPanning = false;
  private _lastMouseX = 0;
  private _lastMouseY = 0;

  private readonly _onDidDropAsset = new Emitter<SceneAssetDropEvent>();
  readonly onDidDropAsset: Event<SceneAssetDropEvent> = this._onDidDropAsset.event;

  constructor(
    id: string,
    renderContext: SharedRenderContext,
    selection: ISelectionService,
    undoRedo: IUndoRedoService,
  ) {
    super(id, 'scene-view');
    this._renderContext = renderContext;
    this._selection = selection;
    this._undoRedo = undoRedo;
  }

  /** Set the ECS scene service (available after WASM init). */
  setECSScene(ecsScene: IECSSceneService): void {
    this._ecsScene = ecsScene;
  }

  /** Initialize the editor camera after WASM is ready. */
  initCamera(module: ESEngineModule): void {
    this._editorCamera.init(module);
    this._renderContext.requestRender();
  }

  protected buildContent(root: HTMLElement): void {
    this._injectStyles();

    // Viewport
    const viewport = this.appendElement(root, 'div', 'editrix-sv-viewport');

    // 2D canvas for drawImage rendering. `tabIndex=0` lets the viewport
    // participate in keyboard focus so camera shortcuts (F to frame the
    // current selection) work without swallowing keys meant for text
    // inputs elsewhere in the editor.
    this._canvas = document.createElement('canvas');
    this._canvas.className = 'editrix-sv-canvas';
    this._canvas.tabIndex = 0;
    this._canvas.style.outline = 'none';
    viewport.appendChild(this._canvas);
    const ctx2d = this._canvas.getContext('2d');
    if (!ctx2d) {
      throw new Error('SceneViewWidget: 2D canvas context unavailable.');
    }

    // Register as a render view
    const canvasRef = this._canvas;
    const cam = this._editorCamera;
    this._view = {
      render: (module: ESEngineModule, registry: CppRegistry, w: number, h: number): void => {
        const ptr = cam.computeMatrix(w, h);
        if (ptr !== 0) module.renderFrameWithMatrix(registry, w, h, ptr);
        // Cheap: repaint the zoom label on each render. Camera mutates
        // (zoomAt / focusOn / wheel) always trigger a render anyway.
        this._updateZoomIndicator();
      },
      postDraw: (ctx: CanvasRenderingContext2D, w: number, h: number): void => {
        this._drawGrid(ctx, w, h);
        this._drawSelectionHighlight(ctx, w, h);
      },
      target: ctx2d,
      get width() {
        return canvasRef.clientWidth;
      },
      get height() {
        return canvasRef.clientHeight;
      },
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
    this.subscriptions.add({
      dispose: () => {
        ro.disconnect();
      },
    });

    this._setupMouseHandlers(this._canvas);
    this._setupDropHandlers(viewport, this._canvas);

    // Floating toolbar
    const toolbar = this.appendElement(viewport, 'div', 'editrix-sv-toolbar');

    // Left: tool buttons
    const toolGroup = this.appendElement(toolbar, 'div', 'editrix-sv-tool-group');
    const tools: { id: ToolId; icon: string; title: string }[] = [
      { id: 'select', icon: 'tool-select', title: 'Select (Q)' },
      { id: 'move', icon: 'tool-move', title: 'Move (W)' },
      { id: 'rotate', icon: 'tool-rotate', title: 'Rotate (E)' },
      { id: 'scale', icon: 'tool-scale', title: 'Scale (R)' },
    ];
    for (const tool of tools) {
      const btn = document.createElement('div');
      btn.className = 'editrix-sv-tool-btn';
      if (tool.id === this._gizmo.tool) btn.classList.add('editrix-sv-tool-btn--active');
      btn.title = tool.title;
      btn.appendChild(createIconElement(tool.icon, 16));
      btn.addEventListener('click', () => {
        this._setActiveTool(tool.id);
      });
      toolGroup.appendChild(btn);
      this._toolButtons.set(tool.id, btn);
    }

    // Separator
    this.appendElement(toolbar, 'div', 'editrix-sv-separator');

    // Center: snap controls
    const snapGroup = this.appendElement(toolbar, 'div', 'editrix-sv-snap-group');
    const snapIcon = this.appendElement(snapGroup, 'div', 'editrix-sv-snap-icon');
    snapIcon.appendChild(createIconElement('snap-grid', 16));
    const snapLabel = this.appendElement(snapGroup, 'span', 'editrix-sv-snap-label');
    snapLabel.textContent = 'Snap distance';
    this._snapInput = this.appendElement(snapGroup, 'input', 'editrix-sv-snap-input');
    this._snapInput.type = 'text';
    this._snapInput.value = '5.00';
    this._snapInput.style.width = '48px';

    // Trailing spacer keeps the snap controls left-aligned. The "more options"
    // overflow menu is intentionally not rendered until there's a real submenu
    // to attach — a no-op affordance is worse than no affordance.
    const spacer = this.appendElement(toolbar, 'div');
    spacer.style.flex = '1';

    // Right: zoom indicator. Click resets to 100%. The value is driven by
    // the editor camera's zoom property — we register a short poll via
    // requestAnimationFrame-on-render since the camera itself has no
    // event. Scene View renders on camera change, so painting the label
    // from within the render view (above) keeps the label in sync
    // without plumbing a new event through.
    this._zoomIndicatorEl = this.appendElement(toolbar, 'button', 'editrix-sv-zoom-indicator');
    this._zoomIndicatorEl.type = 'button';
    this._zoomIndicatorEl.title = 'Reset zoom to 100%';
    this._zoomIndicatorEl.textContent = '100%';
    this._zoomIndicatorEl.addEventListener('click', () => {
      this._editorCamera.zoom = 1.0;
      this._updateZoomIndicator();
      this._renderContext.requestRender();
    });

    // Gizmo
    const gizmo = this.appendElement(viewport, 'div', 'editrix-sv-gizmo');
    this._buildGizmo(gizmo);
  }

  private _updateZoomIndicator(): void {
    if (!this._zoomIndicatorEl) return;
    this._zoomIndicatorEl.textContent = `${String(Math.round(this._editorCamera.zoom * 100))}%`;
  }

  private _setActiveTool(id: ToolId): void {
    this._gizmo.setTool(id);
    for (const [toolId, btn] of this._toolButtons) {
      btn.classList.toggle('editrix-sv-tool-btn--active', toolId === id);
    }
    this._renderContext.requestRender();
  }

  private _buildGizmo(container: HTMLElement): void {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 80 80');
    svg.setAttribute('width', '80');
    svg.setAttribute('height', '80');
    svg.innerHTML = `
      <circle cx="40" cy="40" r="3" fill="rgba(255,255,255,0.3)"/>
      <line x1="40" y1="40" x2="40" y2="10" stroke="#6bc46d" stroke-width="2.5"/>
      <line x1="40" y1="40" x2="70" y2="40" stroke="#e55561" stroke-width="2.5"/>
      <circle cx="70" cy="40" r="6" fill="#e55561"/>
      <circle cx="40" cy="10" r="6" fill="#6bc46d"/>
      <text x="70" y="43" fill="#fff" font-size="11" font-weight="bold" text-anchor="middle" dominant-baseline="middle">X</text>
      <text x="40" y="13" fill="#fff" font-size="11" font-weight="bold" text-anchor="middle" dominant-baseline="middle">Y</text>
    `;
    container.appendChild(svg);
  }

  /** Draw 2D grid overlay on the Scene View canvas. */
  private _drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const cam = this._editorCamera;
    const [left, right, bottom, top] = cam.getWorldBounds(w, h);

    // Adaptive grid spacing: find a power-of-10 step that gives ~5-20 lines on screen
    const worldWidth = right - left;
    const rawStep = worldWidth / 15;
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
    let step: number;
    if (rawStep / magnitude < 2) step = magnitude;
    else if (rawStep / magnitude < 5) step = magnitude * 2;
    else step = magnitude * 5;

    const majorEvery = 5; // every 5th line is major

    // Grid lines
    const startX = Math.floor(left / step) * step;
    const startY = Math.floor(bottom / step) * step;

    ctx.save();

    // Minor grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let wx = startX; wx <= right; wx += step) {
      if (Math.round(wx / step) % majorEvery === 0) continue;
      const [sx] = cam.worldToScreen(wx, 0, w, h);
      ctx.moveTo(Math.round(sx) + 0.5, 0);
      ctx.lineTo(Math.round(sx) + 0.5, h);
    }
    for (let wy = startY; wy <= top; wy += step) {
      if (Math.round(wy / step) % majorEvery === 0) continue;
      const [, sy] = cam.worldToScreen(0, wy, w, h);
      ctx.moveTo(0, Math.round(sy) + 0.5);
      ctx.lineTo(w, Math.round(sy) + 0.5);
    }
    ctx.stroke();

    // Major grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const majorStep = step * majorEvery;
    const majorStartX = Math.floor(left / majorStep) * majorStep;
    const majorStartY = Math.floor(bottom / majorStep) * majorStep;
    for (let wx = majorStartX; wx <= right; wx += majorStep) {
      if (Math.abs(wx) < step * 0.01) continue; // skip origin, drawn separately
      const [sx] = cam.worldToScreen(wx, 0, w, h);
      ctx.moveTo(Math.round(sx) + 0.5, 0);
      ctx.lineTo(Math.round(sx) + 0.5, h);
    }
    for (let wy = majorStartY; wy <= top; wy += majorStep) {
      if (Math.abs(wy) < step * 0.01) continue;
      const [, sy] = cam.worldToScreen(0, wy, w, h);
      ctx.moveTo(0, Math.round(sy) + 0.5);
      ctx.lineTo(w, Math.round(sy) + 0.5);
    }
    ctx.stroke();

    // Origin axis lines
    const [ox, oy] = cam.worldToScreen(0, 0, w, h);

    // X axis (red, horizontal through y=0)
    ctx.strokeStyle = 'rgba(229,85,97,0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(oy) + 0.5);
    ctx.lineTo(w, Math.round(oy) + 0.5);
    ctx.stroke();

    // Y axis (green, vertical through x=0)
    ctx.strokeStyle = 'rgba(107,196,109,0.5)';
    ctx.beginPath();
    ctx.moveTo(Math.round(ox) + 0.5, 0);
    ctx.lineTo(Math.round(ox) + 0.5, h);
    ctx.stroke();

    ctx.restore();
  }

  /**
   * Ring radius for a whole selection — walks the entities, takes the
   * world-space max of their bounds, then projects that through the
   * camera so the rotate gizmo encloses the full group. Shares the
   * per-entity projection logic with _computeScreenRingRadius below.
   */
  private _computeSelectionScreenRingRadius(
    entityIds: readonly number[],
    pivotWX: number,
    pivotWY: number,
    pivotScreenY: number,
    canvasWidth: number,
    canvasHeight: number,
  ): number {
    let maxWorldRingRadius = 0;
    for (const id of entityIds) {
      const r = this._computeWorldRingRadius(id);
      if (r > maxWorldRingRadius) maxWorldRingRadius = r;
    }
    const [, rsy] = this._editorCamera.worldToScreen(
      pivotWX,
      pivotWY + maxWorldRingRadius,
      canvasWidth,
      canvasHeight,
    );
    return Math.abs(pivotScreenY - rsy);
  }

  /** World-space ring radius based on entity bounds × scale. */
  private _computeWorldRingRadius(entityId: number): number {
    const ecs = this._ecsScene;
    if (!ecs) return 0;
    const scaleX = ecs.getProperty(entityId, 'Transform', 'scale.x') as number;
    const scaleY = ecs.getProperty(entityId, 'Transform', 'scale.y') as number;
    let sizeX = 20;
    let sizeY = 20;
    if (ecs.hasComponent(entityId, 'ShapeRenderer')) {
      sizeX = ecs.getProperty(entityId, 'ShapeRenderer', 'size.x') as number;
      sizeY = ecs.getProperty(entityId, 'ShapeRenderer', 'size.y') as number;
    } else if (ecs.hasComponent(entityId, 'Sprite')) {
      sizeX = ecs.getProperty(entityId, 'Sprite', 'size.x') as number;
      sizeY = ecs.getProperty(entityId, 'Sprite', 'size.y') as number;
    }
    return Math.max((sizeX * scaleX) / 2, (sizeY * scaleY) / 2);
  }

  /** Pick the topmost entity at the given world position. */
  private _pickEntity(wx: number, wy: number): number | undefined {
    const ecs = this._ecsScene;
    if (!ecs) return undefined;

    // Collect all pickable entities (flat list, children after parents)
    const entities: number[] = [];
    const visit = (ids: readonly number[]): void => {
      for (const id of ids) {
        entities.push(id);
        visit(ecs.getChildren(id));
      }
    };
    visit(ecs.getRootEntities());

    // Reverse iterate — higher index = rendered later = on top
    for (let i = entities.length - 1; i >= 0; i--) {
      const id = entities[i];
      if (id === undefined) continue;
      if (!ecs.hasComponent(id, 'Transform')) continue;

      const px = ecs.getProperty(id, 'Transform', 'position.x') as number;
      const py = ecs.getProperty(id, 'Transform', 'position.y') as number;

      // Get size from ShapeRenderer or Sprite, or use a default icon area
      let sizeX = 20;
      let sizeY = 20;
      if (ecs.hasComponent(id, 'ShapeRenderer')) {
        sizeX = ecs.getProperty(id, 'ShapeRenderer', 'size.x') as number;
        sizeY = ecs.getProperty(id, 'ShapeRenderer', 'size.y') as number;
      } else if (ecs.hasComponent(id, 'Sprite')) {
        sizeX = ecs.getProperty(id, 'Sprite', 'size.x') as number;
        sizeY = ecs.getProperty(id, 'Sprite', 'size.y') as number;
      }

      // AABB test (centered on position)
      const halfW = sizeX / 2;
      const halfH = sizeY / 2;
      if (wx >= px - halfW && wx <= px + halfW && wy >= py - halfH && wy <= py + halfH) {
        return id;
      }
    }
    return undefined;
  }

  /** Draw selection highlight around selected entities. */
  private _drawSelectionHighlight(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const ecs = this._ecsScene;
    if (!ecs) return;

    const selectedIds = this._selection.getSelection();
    if (selectedIds.length === 0) return;

    const cam = this._editorCamera;
    ctx.save();

    // Collect per-entity draw info in one pass. We use this twice: once to
    // draw the selection border around each entity, then once to compute
    // the shared pivot and ring radius for the single gizmo drawn over the
    // whole selection.
    interface EntityDrawInfo {
      id: number;
      px: number;
      py: number;
      screenCorners: [number, number][];
      worldRingRadius: number;
      rotRad: number;
    }
    const infos: EntityDrawInfo[] = [];

    for (const idStr of selectedIds) {
      const ref = parseSelectionRef(idStr);
      if (ref?.kind !== 'entity') continue;
      const id = ref.id;
      if (!ecs.hasComponent(id, 'Transform')) continue;

      const px = ecs.getProperty(id, 'Transform', 'position.x') as number;
      const py = ecs.getProperty(id, 'Transform', 'position.y') as number;
      const scaleX = ecs.getProperty(id, 'Transform', 'scale.x') as number;
      const scaleY = ecs.getProperty(id, 'Transform', 'scale.y') as number;
      const rotZ = ecs.getProperty(id, 'Transform', 'rotation.z') as number;
      const rotRad = (rotZ * Math.PI) / 180;

      let sizeX = 20;
      let sizeY = 20;
      if (ecs.hasComponent(id, 'ShapeRenderer')) {
        sizeX = ecs.getProperty(id, 'ShapeRenderer', 'size.x') as number;
        sizeY = ecs.getProperty(id, 'ShapeRenderer', 'size.y') as number;
      } else if (ecs.hasComponent(id, 'Sprite')) {
        sizeX = ecs.getProperty(id, 'Sprite', 'size.x') as number;
        sizeY = ecs.getProperty(id, 'Sprite', 'size.y') as number;
      }

      const hw = (sizeX * scaleX) / 2;
      const hh = (sizeY * scaleY) / 2;
      const cos = Math.cos(rotRad);
      const sin = Math.sin(rotRad);
      const corners: [number, number][] = [
        [-hw, hh],
        [hw, hh],
        [hw, -hh],
        [-hw, -hh],
      ];
      const screenCorners: [number, number][] = corners.map(([lx, ly]) => {
        const wx = px + lx * cos - ly * sin;
        const wy = py + lx * sin + ly * cos;
        return cam.worldToScreen(wx, wy, w, h);
      });

      ctx.strokeStyle = '#4a8fff';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.beginPath();
      const first = screenCorners[0];
      if (first) {
        ctx.moveTo(first[0], first[1]);
        for (let ci = 1; ci < 4; ci++) {
          const corner = screenCorners[ci];
          if (!corner) continue;
          ctx.lineTo(corner[0], corner[1]);
        }
        ctx.closePath();
        ctx.stroke();
      }

      infos.push({
        id,
        px,
        py,
        screenCorners,
        worldRingRadius: Math.max(hw, hh),
        rotRad,
      });
    }

    if (infos.length > 0) {
      // Pivot / ring radius come from the active drag when one is in
      // flight so the gizmo tracks the drag's captured pivot (stable
      // across the gesture) rather than the entities' current positions
      // (which are being mutated each mousemove). When idle, fall back to
      // the centroid of the live selection.
      let pivotWX: number;
      let pivotWY: number;
      if (this._gizmo.isDragging) {
        const p = this._gizmo.dragPivot;
        pivotWX = p.x;
        pivotWY = p.y;
      } else {
        pivotWX = 0;
        pivotWY = 0;
        for (const info of infos) {
          pivotWX += info.px;
          pivotWY += info.py;
        }
        pivotWX /= infos.length;
        pivotWY /= infos.length;
      }
      const [pivotSX, pivotSY] = cam.worldToScreen(pivotWX, pivotWY, w, h);

      // Ring radius: max of the selection's worldRingRadius values, so a
      // group rotate gizmo encloses the whole group rather than just one
      // member.
      let maxWorldRingRadius = 0;
      for (const info of infos) {
        if (info.worldRingRadius > maxWorldRingRadius) maxWorldRingRadius = info.worldRingRadius;
      }
      const [, rsy] = cam.worldToScreen(pivotWX, pivotWY + maxWorldRingRadius, w, h);
      const screenRingRadius = Math.abs(pivotSY - rsy);

      // Rotation indicator only carries meaning for a single selection —
      // multi-select entities can each have different rotations, so the
      // indicator dot tracks the first entity's heading in that case as
      // a "lead" reference.
      const rotRadForIndicator = infos[0]?.rotRad ?? 0;
      // Corner handles are per-entity; for the scale gizmo the overlay
      // shows the first entity's corners as the bounding hint.
      const cornersForScale = infos[0]?.screenCorners ?? [];

      this._gizmo.drawForEntity(
        ctx,
        pivotSX,
        pivotSY,
        screenRingRadius,
        rotRadForIndicator,
        cornersForScale,
      );

      if (this._gizmo.isDragging) {
        this._gizmo.drawAxisLockLine(ctx, w, h, pivotSX, pivotSY);
      }
    }

    ctx.restore();
  }

  private _setupDropHandlers(viewport: HTMLElement, canvas: HTMLCanvasElement): void {
    const overlay = document.createElement('div');
    overlay.className = 'editrix-sv-drop-overlay';
    viewport.appendChild(overlay);

    const hasAssetPayload = (e: DragEvent): boolean =>
      Boolean(e.dataTransfer?.types.includes(ASSET_PATH_MIME));

    viewport.addEventListener('dragenter', (e: DragEvent) => {
      if (!hasAssetPayload(e)) return;
      e.preventDefault();
      overlay.classList.add('editrix-sv-drop-overlay--active');
    });
    viewport.addEventListener('dragover', (e: DragEvent) => {
      if (!hasAssetPayload(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    viewport.addEventListener('dragleave', (e: DragEvent) => {
      // Internal transitions fire dragleave on the child — keep the overlay
      // up until the pointer truly leaves the viewport.
      if (e.relatedTarget && viewport.contains(e.relatedTarget as Node)) return;
      overlay.classList.remove('editrix-sv-drop-overlay--active');
    });
    viewport.addEventListener('drop', (e: DragEvent) => {
      overlay.classList.remove('editrix-sv-drop-overlay--active');
      if (!hasAssetPayload(e)) return;
      e.preventDefault();
      const absolutePath = e.dataTransfer?.getData(ASSET_PATH_MIME);
      if (!absolutePath) return;

      const rect = canvas.getBoundingClientRect();
      const [worldX, worldY] = this._editorCamera.screenToWorld(
        e.clientX - rect.left,
        e.clientY - rect.top,
        canvas.clientWidth,
        canvas.clientHeight,
      );
      this._onDidDropAsset.fire({
        absolutePath,
        worldX,
        worldY,
        hitEntityId: this._pickEntity(worldX, worldY),
      });
    });
  }

  private _setupMouseHandlers(canvas: HTMLCanvasElement): void {
    const getWorldPos = (e: MouseEvent): [number, number] => {
      const rect = canvas.getBoundingClientRect();
      return this._editorCamera.screenToWorld(
        e.clientX - rect.left,
        e.clientY - rect.top,
        canvas.clientWidth,
        canvas.clientHeight,
      );
    };

    // F: frame selection. Only active when the Scene View canvas has
    // keyboard focus so a user editing a text input somewhere else in
    // the app can still type an "f" without jumping the camera.
    canvas.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key !== 'f' && e.key !== 'F') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return; // leave cmd-F etc. alone
      const ecs = this._ecsScene;
      if (!ecs) return;
      const selectedRaw = this._selection.getSelection()[0];
      const parsed = selectedRaw !== undefined ? parseSelectionRef(selectedRaw) : undefined;
      if (parsed?.kind !== 'entity') return;
      e.preventDefault();
      const px = Number(ecs.getProperty(parsed.id, 'Transform', 'position.x') ?? 0);
      const py = Number(ecs.getProperty(parsed.id, 'Transform', 'position.y') ?? 0);
      this._editorCamera.focusOn(px, py, 1.0);
      this._renderContext.requestRender();
    });
    // Focus the canvas when the user clicks it — so F works immediately
    // after a click without needing a separate focus step.
    canvas.addEventListener('mousedown', () => {
      canvas.focus();
    });

    // Left-click: select or start transform drag
    canvas.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button !== 0) return;
      const [wx, wy] = getWorldPos(e);

      if (this._gizmo.tool === 'select') {
        const hit = this._pickEntity(wx, wy);
        if (hit !== undefined) this._selection.select([entityRef(hit)]);
        else this._selection.clearSelection();
        this._renderContext.requestRender();
        return;
      }

      // Move/Rotate/Scale path.
      const ecs = this._ecsScene;
      if (!ecs) return;

      // Collect every selected entity with a Transform, preserving the
      // selection order (first one drives hit-test references).
      const draggable: number[] = [];
      for (const raw of this._selection.getSelection()) {
        const ref = parseSelectionRef(raw);
        if (ref?.kind !== 'entity') continue;
        if (!ecs.hasComponent(ref.id, 'Transform')) continue;
        draggable.push(ref.id);
      }

      // If there's already a selection with a Transform, hit-test the
      // gizmo handles before anything else — grabbing an X arrow, Y arrow,
      // or rotate ring should take priority over picking a different
      // entity underneath the cursor.
      let axis: GizmoAxis = 'xy';
      if (draggable.length > 0) {
        // Pivot screen pos = centroid of all selected entities' positions
        // (matches what draw + applyDrag use).
        let pivotWX = 0;
        let pivotWY = 0;
        for (const id of draggable) {
          pivotWX += ecs.getProperty(id, 'Transform', 'position.x') as number;
          pivotWY += ecs.getProperty(id, 'Transform', 'position.y') as number;
        }
        pivotWX /= draggable.length;
        pivotWY /= draggable.length;
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        const [pivotSX, pivotSY] = this._editorCamera.worldToScreen(pivotWX, pivotWY, w, h);
        const screenRingRadius =
          this._gizmo.tool === 'rotate'
            ? this._computeSelectionScreenRingRadius(draggable, pivotWX, pivotWY, pivotSY, w, h)
            : 0;
        const hit = this._gizmo.hitTestHandle(sx, sy, pivotSX, pivotSY, screenRingRadius);
        if (hit !== null) axis = hit;
      }

      // No handle hit and no existing selection — fall back to picking the
      // entity under the cursor, matching the legacy free-drag flow.
      if (axis === 'xy' && draggable.length === 0) {
        const hit = this._pickEntity(wx, wy);
        if (hit !== undefined && ecs.hasComponent(hit, 'Transform')) {
          this._selection.select([entityRef(hit)]);
          draggable.push(hit);
        } else return;
      }

      if (draggable.length === 0) return;

      this._gizmo.beginDrag(ecs, draggable, wx, wy, axis);
      canvas.style.cursor = cursorForAxis(axis, this._gizmo.tool);
    });

    // Middle-click drag to pan
    canvas.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        this._isPanning = true;
        this._lastMouseX = e.clientX;
        this._lastMouseY = e.clientY;
        canvas.style.cursor = 'grabbing';
      }
    });

    const onMouseMove = (e: MouseEvent): void => {
      // Camera pan (middle button)
      if (this._isPanning) {
        const dx = e.clientX - this._lastMouseX;
        const dy = e.clientY - this._lastMouseY;
        this._lastMouseX = e.clientX;
        this._lastMouseY = e.clientY;
        this._editorCamera.pan(dx, dy, canvas.clientWidth, canvas.clientHeight);
        this._renderContext.requestRender();
        return;
      }

      // Transform drag (left button)
      if (!this._gizmo.isDragging || !this._ecsScene) return;
      const [wx, wy] = getWorldPos(e);
      const snap = parseFloat(this._snapInput?.value ?? '0') || 0;
      this._gizmo.applyDrag(this._ecsScene, wx, wy, snap);
    };

    const onMouseUp = (e: MouseEvent): void => {
      // End camera pan
      if (e.button === 1 && this._isPanning) {
        this._isPanning = false;
        canvas.style.cursor = '';
        return;
      }

      // End transform drag + undo
      if (e.button === 0 && this._gizmo.isDragging && this._ecsScene) {
        canvas.style.cursor = '';
        const result = this._gizmo.endDrag(this._ecsScene);
        if (result) {
          const ecs = this._ecsScene;
          const { tool, entities } = result;
          const toolLabel = tool.charAt(0).toUpperCase() + tool.slice(1);
          const label =
            entities.length === 1
              ? `${toolLabel} Entity`
              : `${toolLabel} ${entities.length} Entities`;
          this._undoRedo.push({
            label,
            undo: () => {
              for (const ent of entities) {
                ecs.setProperty(ent.entityId, 'Transform', 'position.x', ent.before.px);
                ecs.setProperty(ent.entityId, 'Transform', 'position.y', ent.before.py);
                ecs.setProperty(ent.entityId, 'Transform', 'rotation.z', ent.before.rotation);
                ecs.setProperty(ent.entityId, 'Transform', 'scale.x', ent.before.sx);
                ecs.setProperty(ent.entityId, 'Transform', 'scale.y', ent.before.sy);
              }
            },
            redo: () => {
              for (const ent of entities) {
                ecs.setProperty(ent.entityId, 'Transform', 'position.x', ent.after.px);
                ecs.setProperty(ent.entityId, 'Transform', 'position.y', ent.after.py);
                ecs.setProperty(ent.entityId, 'Transform', 'rotation.z', ent.after.rotation);
                ecs.setProperty(ent.entityId, 'Transform', 'scale.x', ent.after.sx);
                ecs.setProperty(ent.entityId, 'Transform', 'scale.y', ent.after.sy);
              }
            },
          });
        }
      }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    this.subscriptions.add({
      dispose: () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      },
    });

    // Scroll wheel to zoom (centered on cursor)
    canvas.addEventListener(
      'wheel',
      (e: WheelEvent) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        this._editorCamera.zoomAt(
          -e.deltaY,
          e.clientX - rect.left,
          e.clientY - rect.top,
          canvas.clientWidth,
          canvas.clientHeight,
        );
        this._renderContext.requestRender();
      },
      { passive: false },
    );
  }

  override dispose(): void {
    if (this._view) this._renderContext.unregisterView(this._view);
    this._editorCamera.dispose();
    super.dispose();
  }

  private _injectStyles(): void {
    const styleId = 'editrix-scene-view-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
.editrix-widget-scene-view { background: #2b2b2f; }

.editrix-sv-canvas {
  position: absolute; top: 0; left: 0; width: 100%; height: 100%;
}

.editrix-sv-viewport {
  position: relative; width: 100%; height: 100%;
  overflow: hidden;
}

.editrix-sv-drop-overlay {
  position: absolute; inset: 0;
  pointer-events: none;
  border: 2px dashed transparent;
  border-radius: 4px;
  background: transparent;
  transition: border-color 0.08s, background 0.08s;
  z-index: 50;
}
.editrix-sv-drop-overlay--active {
  border-color: var(--editrix-accent);
  background: rgba(74,158,255,0.06);
}

.editrix-sv-toolbar {
  position: absolute; top: 6px; left: 6px; right: 6px;
  display: flex; align-items: center; gap: 4px;
  padding: 3px 6px;
  background: rgba(30, 30, 34, 0.88);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px; backdrop-filter: blur(8px); z-index: 10;
}

.editrix-sv-tool-group { display: flex; align-items: center; gap: 2px; }

.editrix-sv-tool-btn {
  display: flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; border-radius: 4px;
  cursor: pointer; color: var(--editrix-text-dim);
}
.editrix-sv-tool-btn:hover { color: var(--editrix-text); background: rgba(255,255,255,0.08); }
.editrix-sv-tool-btn--active { color: var(--editrix-text); background: rgba(255,255,255,0.12); }

.editrix-sv-separator {
  width: 1px; height: 18px; background: rgba(255,255,255,0.1);
  margin: 0 4px; flex-shrink: 0;
}

.editrix-sv-snap-group { display: flex; align-items: center; gap: 6px; }
.editrix-sv-snap-icon { display: flex; align-items: center; color: var(--editrix-text-dim); }
.editrix-sv-snap-label { font-size: 12px; color: var(--editrix-text-dim); white-space: nowrap; }
.editrix-sv-snap-input {
  background: #414141; border: none; color: var(--editrix-text);
  padding: 3px 6px; border-radius: 4px;
  font-family: var(--editrix-mono-font, Consolas, monospace);
  font-size: 12px; text-align: center; outline: none;
}
.editrix-sv-snap-input:focus { box-shadow: 0 0 0 1px var(--editrix-accent); }

.editrix-sv-zoom-indicator {
  margin-left: 4px; padding: 3px 9px; border-radius: 4px;
  background: transparent; color: var(--editrix-text-dim);
  border: 1px solid transparent;
  font-family: var(--editrix-mono-font, Consolas, monospace);
  font-size: 12px; cursor: pointer; min-width: 48px; text-align: center;
}
.editrix-sv-zoom-indicator:hover {
  background: rgba(255,255,255,0.06); color: var(--editrix-text);
  border-color: rgba(255,255,255,0.12);
}

.editrix-sv-gizmo { position: absolute; top: 50px; right: 12px; opacity: 0.85; pointer-events: none; }
`;
    document.head.appendChild(style);
  }
}
