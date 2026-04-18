import type { ESEngineModule, CppRegistry, IECSSceneService } from '@editrix/estella';
import type { ISelectionService, IUndoRedoService } from '@editrix/shell';
import { BaseWidget, createIconElement, registerIcon } from '@editrix/view-dom';
import { EditorCamera } from './editor-camera.js';
import type { SharedRenderContext, RenderView } from './render-context.js';
import { entityRef, parseSelectionRef } from './services.js';

// ─── Register tool icons ────────────────────────────────

registerIcon('tool-select', '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2l4 12 2-5 5-2L3 2z"/></svg>');

registerIcon('tool-move', '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v12M2 8h12M8 2l-2 2M8 2l2 2M8 14l-2-2M8 14l2-2M2 8l2-2M2 8l2 2M14 8l-2-2M14 8l-2 2"/></svg>');

registerIcon('tool-rotate', '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 8a5 5 0 01-9.17 2.77M3 8a5 5 0 019.17-2.77"/><path d="M13 3v3.5h-3.5M3 13V9.5h3.5"/></svg>');

registerIcon('tool-scale', '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 13V8M3 13h5M3 13l10-10M13 3v5M13 3H8"/></svg>');

registerIcon('snap-grid', '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><circle cx="4" cy="4" r="1.2" fill="currentColor" stroke="none"/><circle cx="8" cy="4" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="4" r="1.2" fill="currentColor" stroke="none"/><circle cx="4" cy="8" r="1.2" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="8" r="1.2" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="8" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg>');

type ToolId = 'select' | 'move' | 'rotate' | 'scale';

/**
 * Scene View — editor camera viewport.
 *
 * Uses a 2D canvas that receives rendered frames from SharedRenderContext
 * via drawImage. The editor camera (pan/zoom) is independent of any game entity.
 */
export class SceneViewWidget extends BaseWidget {
  private _activeTool: ToolId = 'select';
  private readonly _toolButtons = new Map<ToolId, HTMLElement>();
  private _snapInput: HTMLInputElement | undefined;
  private _canvas: HTMLCanvasElement | undefined;
  private _ctx2d: CanvasRenderingContext2D | null = null;
  private readonly _renderContext: SharedRenderContext;
  private readonly _editorCamera = new EditorCamera();
  private readonly _selection: ISelectionService;
  private readonly _undoRedo: IUndoRedoService;
  private _ecsScene: IECSSceneService | undefined;
  private _view: RenderView | undefined;

  // Mouse pan state
  private _isPanning = false;
  private _lastMouseX = 0;
  private _lastMouseY = 0;

  // Transform drag state
  private _isDragging = false;
  private _dragEntityId = 0;
  private _dragStartWorldX = 0;
  private _dragStartWorldY = 0;
  private _dragStartValues = { px: 0, py: 0, rotation: 0, sx: 1, sy: 1 };

  constructor(id: string, renderContext: SharedRenderContext, selection: ISelectionService, undoRedo: IUndoRedoService) {
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

    // 2D canvas for drawImage rendering
    this._canvas = document.createElement('canvas');
    this._canvas.className = 'editrix-sv-canvas';
    viewport.appendChild(this._canvas);
    const ctx2d = this._canvas.getContext('2d');
    if (!ctx2d) {
      throw new Error('SceneViewWidget: 2D canvas context unavailable.');
    }
    this._ctx2d = ctx2d;

    // Register as a render view
    const canvasRef = this._canvas;
    const cam = this._editorCamera;
    this._view = {
      render: (module: ESEngineModule, registry: CppRegistry, w: number, h: number): void => {
        const ptr = cam.computeMatrix(w, h);
        if (ptr !== 0) module.renderFrameWithMatrix(registry, w, h, ptr);
      },
      postDraw: (ctx: CanvasRenderingContext2D, w: number, h: number): void => {
        this._drawGrid(ctx, w, h);
        this._drawSelectionHighlight(ctx, w, h);
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

    // Mouse handlers for pan/zoom
    this._setupMouseHandlers(this._canvas);

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
      if (tool.id === this._activeTool) btn.classList.add('editrix-sv-tool-btn--active');
      btn.title = tool.title;
      btn.appendChild(createIconElement(tool.icon, 16));
      btn.addEventListener('click', () => { this._setActiveTool(tool.id); });
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

    // Gizmo
    const gizmo = this.appendElement(viewport, 'div', 'editrix-sv-gizmo');
    this._buildGizmo(gizmo);
  }

  private _setActiveTool(id: ToolId): void {
    this._activeTool = id;
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
      const rotRad = rotZ * Math.PI / 180;

      let sizeX = 20;
      let sizeY = 20;
      if (ecs.hasComponent(id, 'ShapeRenderer')) {
        sizeX = ecs.getProperty(id, 'ShapeRenderer', 'size.x') as number;
        sizeY = ecs.getProperty(id, 'ShapeRenderer', 'size.y') as number;
      } else if (ecs.hasComponent(id, 'Sprite')) {
        sizeX = ecs.getProperty(id, 'Sprite', 'size.x') as number;
        sizeY = ecs.getProperty(id, 'Sprite', 'size.y') as number;
      }

      // Apply scale to size
      const hw = sizeX * scaleX / 2;
      const hh = sizeY * scaleY / 2;

      // 4 local corners (centered, then rotated around entity position)
      const cos = Math.cos(rotRad);
      const sin = Math.sin(rotRad);
      const corners: [number, number][] = [
        [-hw, hh], [hw, hh], [hw, -hh], [-hw, -hh], // TL, TR, BR, BL in world (Y-up)
      ];
      const screenCorners = corners.map(([lx, ly]) => {
        const wx = px + lx * cos - ly * sin;
        const wy = py + lx * sin + ly * cos;
        return cam.worldToScreen(wx, wy, w, h);
      });

      // Draw rotated selection border (polygon)
      ctx.strokeStyle = '#4a8fff';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.beginPath();
      const first = screenCorners[0];
      if (!first) continue;
      ctx.moveTo(first[0], first[1]);
      for (let ci = 1; ci < 4; ci++) {
        const corner = screenCorners[ci];
        if (!corner) continue;
        ctx.lineTo(corner[0], corner[1]);
      }
      ctx.closePath();
      ctx.stroke();

      // Center in screen space
      const [cx, cy] = cam.worldToScreen(px, py, w, h);

      if (this._activeTool === 'move') {
        // Move gizmo: center cross arrows (X red, Y green)
        const len = 30;
        ctx.strokeStyle = '#e55561'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + len, cy); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx + len - 6, cy - 4); ctx.lineTo(cx + len, cy); ctx.lineTo(cx + len - 6, cy + 4); ctx.stroke();
        ctx.strokeStyle = '#6bc46d';
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - len); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx - 4, cy - len + 6); ctx.lineTo(cx, cy - len); ctx.lineTo(cx + 4, cy - len + 6); ctx.stroke();
      } else if (this._activeTool === 'rotate') {
        // Rotate gizmo: circle + rotation indicator line
        const radius = Math.max(hw, hh);
        const [, rsy] = cam.worldToScreen(px, py + radius, w, h);
        const screenRadius = Math.abs(cy - rsy) + 10;
        ctx.strokeStyle = '#4a8fff'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(cx, cy, screenRadius, 0, Math.PI * 2); ctx.stroke();
        // Rotation direction indicator
        const indX = cx + screenRadius * Math.cos(-rotRad);
        const indY = cy + screenRadius * Math.sin(-rotRad);
        ctx.fillStyle = '#4a8fff';
        ctx.beginPath(); ctx.arc(indX, indY, 4, 0, Math.PI * 2); ctx.fill();
      } else {
        // Select/Scale: corner handles
        const hs = 5;
        ctx.fillStyle = '#4a8fff';
        for (const [scx, scy] of screenCorners) {
          ctx.fillRect(scx - hs / 2, scy - hs / 2, hs, hs);
        }
      }
    }

    ctx.restore();
  }

  private _setupMouseHandlers(canvas: HTMLCanvasElement): void {
    const getWorldPos = (e: MouseEvent): [number, number] => {
      const rect = canvas.getBoundingClientRect();
      return this._editorCamera.screenToWorld(
        e.clientX - rect.left, e.clientY - rect.top,
        canvas.clientWidth, canvas.clientHeight,
      );
    };

    // Left-click: select or start transform drag
    canvas.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button !== 0) return;
      const [wx, wy] = getWorldPos(e);

      if (this._activeTool === 'select') {
        const hit = this._pickEntity(wx, wy);
        if (hit !== undefined) this._selection.select([entityRef(hit)]);
        else this._selection.clearSelection();
        this._renderContext.requestRender();
        return;
      }

      // Move/Rotate/Scale: start drag if an entity is selected
      const selectedIds = this._selection.getSelection();
      const firstSelected = selectedIds[0];
      const firstRef = firstSelected !== undefined ? parseSelectionRef(firstSelected) : undefined;
      let entityId = firstRef?.kind === 'entity' ? firstRef.id : undefined;

      // If nothing selected (or selection is non-entity), try to pick first.
      if (entityId === undefined) {
        const hit = this._pickEntity(wx, wy);
        if (hit !== undefined) {
          this._selection.select([entityRef(hit)]);
          entityId = hit;
        } else return;
      }

      const ecs = this._ecsScene;
      if (!ecs?.hasComponent(entityId, 'Transform')) return;

      this._isDragging = true;
      this._dragEntityId = entityId;
      this._dragStartWorldX = wx;
      this._dragStartWorldY = wy;
      this._dragStartValues = {
        px: ecs.getProperty(entityId, 'Transform', 'position.x') as number,
        py: ecs.getProperty(entityId, 'Transform', 'position.y') as number,
        rotation: ecs.getProperty(entityId, 'Transform', 'rotation.z') as number,
        sx: ecs.getProperty(entityId, 'Transform', 'scale.x') as number,
        sy: ecs.getProperty(entityId, 'Transform', 'scale.y') as number,
      };
      canvas.style.cursor = this._activeTool === 'move' ? 'move' : 'crosshair';
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
      if (!this._isDragging || !this._ecsScene) return;
      const [wx, wy] = getWorldPos(e);
      const ecs = this._ecsScene;
      const id = this._dragEntityId;
      const start = this._dragStartValues;
      const snap = parseFloat(this._snapInput?.value ?? '0') || 0;

      if (this._activeTool === 'move') {
        let newX = start.px + (wx - this._dragStartWorldX);
        let newY = start.py + (wy - this._dragStartWorldY);
        if (snap > 0) {
          newX = Math.round(newX / snap) * snap;
          newY = Math.round(newY / snap) * snap;
        }
        ecs.setProperty(id, 'Transform', 'position.x', newX);
        ecs.setProperty(id, 'Transform', 'position.y', newY);
      } else if (this._activeTool === 'rotate') {
        const px = ecs.getProperty(id, 'Transform', 'position.x') as number;
        const py = ecs.getProperty(id, 'Transform', 'position.y') as number;
        const startAngle = Math.atan2(this._dragStartWorldY - py, this._dragStartWorldX - px);
        const currAngle = Math.atan2(wy - py, wx - px);
        const deltaAngleDeg = (currAngle - startAngle) * 180 / Math.PI;
        ecs.setProperty(id, 'Transform', 'rotation.z', start.rotation + deltaAngleDeg);
      } else if (this._activeTool === 'scale') {
        const px = ecs.getProperty(id, 'Transform', 'position.x') as number;
        const py = ecs.getProperty(id, 'Transform', 'position.y') as number;
        const startDist = Math.max(0.01, Math.hypot(this._dragStartWorldX - px, this._dragStartWorldY - py));
        const currDist = Math.hypot(wx - px, wy - py);
        const ratio = currDist / startDist;
        ecs.setProperty(id, 'Transform', 'scale.x', start.sx * ratio);
        ecs.setProperty(id, 'Transform', 'scale.y', start.sy * ratio);
      }
    };

    const onMouseUp = (e: MouseEvent): void => {
      // End camera pan
      if (e.button === 1 && this._isPanning) {
        this._isPanning = false;
        canvas.style.cursor = '';
        return;
      }

      // End transform drag + undo
      if (e.button === 0 && this._isDragging && this._ecsScene) {
        this._isDragging = false;
        canvas.style.cursor = '';
        const ecs = this._ecsScene;
        const id = this._dragEntityId;
        const start = { ...this._dragStartValues };
        const finalPx = ecs.getProperty(id, 'Transform', 'position.x') as number;
        const finalPy = ecs.getProperty(id, 'Transform', 'position.y') as number;
        const finalRot = ecs.getProperty(id, 'Transform', 'rotation.z') as number;
        const finalSx = ecs.getProperty(id, 'Transform', 'scale.x') as number;
        const finalSy = ecs.getProperty(id, 'Transform', 'scale.y') as number;

        // Only push undo if something actually changed
        if (finalPx !== start.px || finalPy !== start.py || finalRot !== start.rotation || finalSx !== start.sx || finalSy !== start.sy) {
          const toolLabel = this._activeTool.charAt(0).toUpperCase() + this._activeTool.slice(1);
          this._undoRedo.push({
            label: `${toolLabel} Entity`,
            undo: () => {
              ecs.setProperty(id, 'Transform', 'position.x', start.px);
              ecs.setProperty(id, 'Transform', 'position.y', start.py);
              ecs.setProperty(id, 'Transform', 'rotation.z', start.rotation);
              ecs.setProperty(id, 'Transform', 'scale.x', start.sx);
              ecs.setProperty(id, 'Transform', 'scale.y', start.sy);
            },
            redo: () => {
              ecs.setProperty(id, 'Transform', 'position.x', finalPx);
              ecs.setProperty(id, 'Transform', 'position.y', finalPy);
              ecs.setProperty(id, 'Transform', 'rotation.z', finalRot);
              ecs.setProperty(id, 'Transform', 'scale.x', finalSx);
              ecs.setProperty(id, 'Transform', 'scale.y', finalSy);
            },
          });
        }
      }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    this.subscriptions.add({ dispose: () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }});

    // Scroll wheel to zoom (centered on cursor)
    canvas.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      this._editorCamera.zoomAt(
        -e.deltaY, e.clientX - rect.left, e.clientY - rect.top,
        canvas.clientWidth, canvas.clientHeight,
      );
      this._renderContext.requestRender();
    }, { passive: false });
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

.editrix-sv-gizmo { position: absolute; top: 50px; right: 12px; opacity: 0.85; pointer-events: none; }
`;
    document.head.appendChild(style);
  }
}
