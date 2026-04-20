/**
 * GizmoController — owns transform-tool state for the Scene View.
 *
 * This first cut is a pure extraction of the move/rotate/scale logic that
 * used to live inline inside SceneViewWidget: drag state, the per-tool
 * drawing that renders on top of the selected entity, and the update math
 * that writes the new Transform values on each mouse move. Behaviour is
 * preserved exactly — later slices will layer axis-locked hit-testing,
 * multi-select pivots, and snap visualisation on top without touching
 * SceneViewWidget again.
 */

import type { IECSSceneService } from '@editrix/estella';

export type ToolId = 'select' | 'move' | 'rotate' | 'scale';

/** Which direction a drag should move in. 'xy' is free 2D, 'x' / 'y' lock to one axis. */
export type GizmoAxis = 'x' | 'y' | 'xy';

export interface TransformSnapshot {
  px: number;
  py: number;
  rotation: number;
  sx: number;
  sy: number;
}

export interface DragResult {
  entityId: number;
  tool: Exclude<ToolId, 'select'>;
  before: TransformSnapshot;
  after: TransformSnapshot;
}

// Tool-specific visual sizes, expressed in screen-space pixels so they stay
// constant under editor zoom.
const MOVE_ARROW_LEN_PX = 30;
const ROTATE_RING_PADDING_PX = 10;
const CORNER_HANDLE_PX = 5;

// Hit-test padding around each move-arrow shaft. Generous enough that
// grabbing the arrow works without pixel-hunting, narrow enough that the
// X and Y zones don't overlap anywhere except at the centre square.
const AXIS_HIT_PAD_PX = 6;
const CENTER_HANDLE_HALF_PX = 6;

const COLOR_X = '#e55561';
const COLOR_Y = '#6bc46d';
const COLOR_RING = '#4a8fff';
const COLOR_CORNER = '#4a8fff';
// Brighter tints used when an axis is hovered or actively being dragged.
const COLOR_X_ACTIVE = '#ffd24a';
const COLOR_Y_ACTIVE = '#ffd24a';

export class GizmoController {
  private _tool: ToolId = 'select';
  private _drag: {
    active: boolean;
    entityId: number;
    axis: GizmoAxis;
    startWorldX: number;
    startWorldY: number;
    startValues: TransformSnapshot;
  } = {
    active: false,
    entityId: 0,
    axis: 'xy',
    startWorldX: 0,
    startWorldY: 0,
    startValues: { px: 0, py: 0, rotation: 0, sx: 1, sy: 1 },
  };

  get tool(): ToolId {
    return this._tool;
  }

  setTool(tool: ToolId): void {
    this._tool = tool;
  }

  get isDragging(): boolean {
    return this._drag.active;
  }

  get dragEntityId(): number {
    return this._drag.entityId;
  }

  get dragAxis(): GizmoAxis {
    return this._drag.axis;
  }

  /**
   * Hit-test the move gizmo handles. Returns which axis the user is
   * grabbing ('x', 'y', 'xy' for the centre square), or null if the click
   * missed all handles. Call this first on mousedown when the active tool
   * has handles; fall back to entity-pick / free drag when the result is
   * null. Only the move tool exposes handles in this cut — rotate/scale
   * still free-drag from anywhere on the canvas.
   *
   * Coordinates are canvas-relative CSS pixels (use `e.clientX - rect.left`
   * style math), matching what worldToScreen returns.
   */
  hitTestHandle(
    screenX: number,
    screenY: number,
    centerX: number,
    centerY: number,
  ): GizmoAxis | null {
    if (this._tool !== 'move') return null;

    const dx = screenX - centerX;
    const dy = screenY - centerY;

    // Centre square has priority — users targeting the middle to free-drag
    // would otherwise graze the X-arrow shaft.
    if (Math.abs(dx) <= CENTER_HANDLE_HALF_PX && Math.abs(dy) <= CENTER_HANDLE_HALF_PX) {
      return 'xy';
    }

    // X arrow extends to the right of centre.
    if (dx >= 0 && dx <= MOVE_ARROW_LEN_PX + AXIS_HIT_PAD_PX && Math.abs(dy) <= AXIS_HIT_PAD_PX) {
      return 'x';
    }

    // Y arrow extends upward (canvas Y is inverted, so dy <= 0).
    if (
      dy <= 0 &&
      dy >= -(MOVE_ARROW_LEN_PX + AXIS_HIT_PAD_PX) &&
      Math.abs(dx) <= AXIS_HIT_PAD_PX
    ) {
      return 'y';
    }

    return null;
  }

  /**
   * Capture the entity's current Transform and flip into drag mode. Called
   * from SceneViewWidget's mousedown handler after it has resolved which
   * entity is being manipulated (from selection or hit-test). The axis
   * defaults to 'xy' (free 2D) for rotate/scale and for move-tool drags
   * that didn't hit a handle; pass 'x' or 'y' to lock a move-tool drag to
   * one axis.
   */
  beginDrag(
    ecs: IECSSceneService,
    entityId: number,
    worldX: number,
    worldY: number,
    axis: GizmoAxis = 'xy',
  ): void {
    this._drag = {
      active: true,
      entityId,
      axis,
      startWorldX: worldX,
      startWorldY: worldY,
      startValues: readTransform(ecs, entityId),
    };
  }

  /**
   * Apply the current tool's math from start-of-drag to the supplied world
   * point and push the result to the Transform. Snap is already interpreted
   * as a world-unit step (0 = no snap) — only the move tool honours it in
   * this cut, matching the existing behaviour.
   */
  applyDrag(ecs: IECSSceneService, worldX: number, worldY: number, snap: number): void {
    if (!this._drag.active) return;
    const { entityId, startWorldX, startWorldY, startValues: s } = this._drag;

    if (this._tool === 'move') {
      const axis = this._drag.axis;
      // Axis lock: if axis is 'y' the X delta is dropped; if 'x' the Y
      // delta is dropped. 'xy' applies both (free 2D, legacy behaviour).
      let newX = axis === 'y' ? s.px : s.px + (worldX - startWorldX);
      let newY = axis === 'x' ? s.py : s.py + (worldY - startWorldY);
      if (snap > 0) {
        if (axis !== 'y') newX = Math.round(newX / snap) * snap;
        if (axis !== 'x') newY = Math.round(newY / snap) * snap;
      }
      ecs.setProperty(entityId, 'Transform', 'position.x', newX);
      ecs.setProperty(entityId, 'Transform', 'position.y', newY);
    } else if (this._tool === 'rotate') {
      const px = ecs.getProperty(entityId, 'Transform', 'position.x') as number;
      const py = ecs.getProperty(entityId, 'Transform', 'position.y') as number;
      const startAngle = Math.atan2(startWorldY - py, startWorldX - px);
      const currAngle = Math.atan2(worldY - py, worldX - px);
      const deltaAngleDeg = ((currAngle - startAngle) * 180) / Math.PI;
      ecs.setProperty(entityId, 'Transform', 'rotation.z', s.rotation + deltaAngleDeg);
    } else if (this._tool === 'scale') {
      const px = ecs.getProperty(entityId, 'Transform', 'position.x') as number;
      const py = ecs.getProperty(entityId, 'Transform', 'position.y') as number;
      const startDist = Math.max(0.01, Math.hypot(startWorldX - px, startWorldY - py));
      const currDist = Math.hypot(worldX - px, worldY - py);
      const ratio = currDist / startDist;
      ecs.setProperty(entityId, 'Transform', 'scale.x', s.sx * ratio);
      ecs.setProperty(entityId, 'Transform', 'scale.y', s.sy * ratio);
    }
  }

  /**
   * Exit drag mode and report whether the Transform actually moved, so the
   * caller can decide whether to push an undo entry. Returns null when
   * there was nothing to commit (e.g. the mouse was released without any
   * mousemove, or the tool was select).
   */
  endDrag(ecs: IECSSceneService): DragResult | null {
    if (!this._drag.active) return null;
    const tool = this._tool;
    if (tool === 'select') {
      this._drag.active = false;
      return null;
    }
    const { entityId, startValues } = this._drag;
    this._drag.active = false;

    const after = readTransform(ecs, entityId);
    if (transformsEqual(startValues, after)) return null;

    return { entityId, tool, before: startValues, after };
  }

  /**
   * Draw the tool-specific gizmo for one selected entity. Screen-space
   * coordinates pass in: (cx, cy) is the entity's centre in canvas pixels,
   * (hw, hh) are the half-width / half-height of its bounds in world
   * units (for sizing the rotate ring), and rotRad is the entity's
   * rotation in radians (for the rotation indicator dot).
   *
   * Expects ctx to already be in a `save()` scope so the caller can
   * `restore()` once after iterating all selected entities.
   */
  drawForEntity(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    screenRingRadius: number,
    rotRad: number,
    screenCorners: readonly (readonly [number, number])[],
  ): void {
    if (this._tool === 'move') {
      this._drawMoveGizmo(ctx, cx, cy);
    } else if (this._tool === 'rotate') {
      this._drawRotateGizmo(ctx, cx, cy, screenRingRadius, rotRad);
    } else {
      this._drawCornerHandles(ctx, screenCorners);
    }
  }

  /**
   * Draw the full-canvas dashed line that shows the locked axis during an
   * active move drag. Caller supplies the entity's current screen-space
   * centre so the line passes through it even as the entity moves along
   * the locked axis (the perpendicular component is clamped to the origin).
   * No-op when the drag is free (`axis === 'xy'`) or the tool isn't move.
   */
  drawAxisLockLine(
    ctx: CanvasRenderingContext2D,
    canvasWidth: number,
    canvasHeight: number,
    centerX: number,
    centerY: number,
  ): void {
    if (!this._drag.active || this._tool !== 'move') return;
    const axis = this._drag.axis;
    if (axis === 'xy') return;
    ctx.save();
    ctx.strokeStyle = axis === 'x' ? COLOR_X : COLOR_Y;
    ctx.globalAlpha = 0.35;
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (axis === 'x') {
      ctx.moveTo(0, centerY);
      ctx.lineTo(canvasWidth, centerY);
    } else {
      ctx.moveTo(centerX, 0);
      ctx.lineTo(centerX, canvasHeight);
    }
    ctx.stroke();
    ctx.restore();
  }

  private _activeMoveAxis(): GizmoAxis | null {
    if (!this._drag.active || this._tool !== 'move') return null;
    return this._drag.axis;
  }

  private _drawMoveGizmo(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    const len = MOVE_ARROW_LEN_PX;
    const active = this._activeMoveAxis();
    const xColor = active === 'x' ? COLOR_X_ACTIVE : COLOR_X;
    const yColor = active === 'y' ? COLOR_Y_ACTIVE : COLOR_Y;

    ctx.strokeStyle = xColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + len, cy);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + len - 6, cy - 4);
    ctx.lineTo(cx + len, cy);
    ctx.lineTo(cx + len - 6, cy + 4);
    ctx.stroke();

    ctx.strokeStyle = yColor;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, cy - len);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 4, cy - len + 6);
    ctx.lineTo(cx, cy - len);
    ctx.lineTo(cx + 4, cy - len + 6);
    ctx.stroke();

    // Centre square — visual affordance for the free-XY grab.
    const hs = CENTER_HANDLE_HALF_PX;
    ctx.strokeStyle = active === 'xy' ? COLOR_X_ACTIVE : '#ccd4df';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - hs, cy - hs, hs * 2, hs * 2);
  }

  private _drawRotateGizmo(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    screenRingRadius: number,
    rotRad: number,
  ): void {
    const radius = screenRingRadius + ROTATE_RING_PADDING_PX;
    ctx.strokeStyle = COLOR_RING;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
    const indX = cx + radius * Math.cos(-rotRad);
    const indY = cy + radius * Math.sin(-rotRad);
    ctx.fillStyle = COLOR_RING;
    ctx.beginPath();
    ctx.arc(indX, indY, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  private _drawCornerHandles(
    ctx: CanvasRenderingContext2D,
    screenCorners: readonly (readonly [number, number])[],
  ): void {
    const hs = CORNER_HANDLE_PX;
    ctx.fillStyle = COLOR_CORNER;
    for (const [scx, scy] of screenCorners) {
      ctx.fillRect(scx - hs / 2, scy - hs / 2, hs, hs);
    }
  }
}

function readTransform(ecs: IECSSceneService, entityId: number): TransformSnapshot {
  return {
    px: ecs.getProperty(entityId, 'Transform', 'position.x') as number,
    py: ecs.getProperty(entityId, 'Transform', 'position.y') as number,
    rotation: ecs.getProperty(entityId, 'Transform', 'rotation.z') as number,
    sx: ecs.getProperty(entityId, 'Transform', 'scale.x') as number,
    sy: ecs.getProperty(entityId, 'Transform', 'scale.y') as number,
  };
}

function transformsEqual(a: TransformSnapshot, b: TransformSnapshot): boolean {
  return (
    a.px === b.px && a.py === b.py && a.rotation === b.rotation && a.sx === b.sx && a.sy === b.sy
  );
}
