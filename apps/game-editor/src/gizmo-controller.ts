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

export type ToolId = 'select' | 'move' | 'rotate' | 'scale' | 'paint';

/**
 * Which direction a drag affects.
 * - `x` / `y` — move or scale locked to one world axis.
 * - `xy` — move freely in 2D, or uniform scale in both dimensions.
 * - `ring` — rotate drag grabbed on the rotate ring. The math is identical
 *   to free rotate, but the controller remembers the grab so drawing code
 *   can highlight the ring and the caller can tell a ring-initiated drag
 *   from a free-canvas one if it ever needs to.
 */
export type GizmoAxis = 'x' | 'y' | 'xy' | 'ring';

export interface TransformSnapshot {
  px: number;
  py: number;
  rotation: number;
  sx: number;
  sy: number;
}

export interface DragResultEntity {
  entityId: number;
  before: TransformSnapshot;
  after: TransformSnapshot;
}

export interface DragResult {
  tool: Exclude<ToolId, 'select'>;
  entities: DragResultEntity[];
}

/**
 * Snap-while-dragging hint payload — returned by {@link GizmoController.getSnapPreview}
 * while a transform drag is in progress and the snap input is non-zero.
 * The Scene View uses it to overlay a bright "this is where it will land"
 * marker on top of the live drag, so the user sees the snapped target
 * separately from the raw cursor position.
 *
 * The controller stays the single source of snap math; the widget only
 * projects the returned world values through its camera and draws glyphs.
 */
export type SnapPreview =
  | { tool: 'move'; snap: number; snappedPivotX: number; snappedPivotY: number }
  | {
      tool: 'rotate';
      snap: number;
      /** Mouse angle (world radians) captured at drag start. Ticks are laid
       *  out at this angle + k·stepDeg so the start grab is always a tick. */
      startAngleRad: number;
      /** Angular delta from drag start, snapped to stepDeg. */
      snappedDeltaDeg: number;
      /** Snap step in degrees (15°). */
      stepDeg: number;
    }
  | { tool: 'scale'; snap: number; axis: GizmoAxis; snappedRatio: number };

interface DraggedEntity {
  entityId: number;
  startValues: TransformSnapshot;
}

// Tool-specific visual sizes, expressed in screen-space pixels so they stay
// constant under editor zoom.
const MOVE_ARROW_LEN_PX = 30;
const SCALE_ARROW_LEN_PX = 30;
const SCALE_END_BOX_HALF_PX = 5;
// Exported so the Scene View can draw snap ticks along the same ring the
// gizmo paints (painting just inside the hit annulus keeps them readable
// without covering the ring itself).
export const ROTATE_RING_PADDING_PX = 10;
const CORNER_HANDLE_PX = 5;

// Hit-test padding around each move / scale arrow shaft. Generous enough
// that grabbing the arrow works without pixel-hunting, narrow enough that
// the X and Y zones don't overlap anywhere except at the centre square.
const AXIS_HIT_PAD_PX = 6;
const CENTER_HANDLE_HALF_PX = 6;

// Half-thickness (in pixels) of the rotate ring's hit annulus. A click
// within this band of the ring radius counts as grabbing the ring.
const RING_HIT_HALF_PX = 8;

// When the "snap" toolbar value is non-zero, rotate steps in this many
// degrees and scale steps in this many units. The snap value itself is
// only meaningful as a world distance to the move tool — rotate/scale
// just treat it as a boolean "snap on".
const ROTATE_SNAP_DEG = 15;
const SCALE_SNAP_STEP = 0.1;

const COLOR_X = '#e55561';
const COLOR_Y = '#6bc46d';
const COLOR_RING = '#4a8fff';
const COLOR_CORNER = '#4a8fff';
// Brighter tints used when an axis / ring is actively being dragged.
const COLOR_X_ACTIVE = '#ffd24a';
const COLOR_Y_ACTIVE = '#ffd24a';
const COLOR_RING_ACTIVE = '#ffd24a';
// Softer "about to grab" tints for hover — warm enough to read as a
// change from the idle red/green/blue, cool enough that it doesn't look
// like a drag is already in progress.
const COLOR_X_HOVER = '#ff9b66';
const COLOR_Y_HOVER = '#a8e86f';
const COLOR_RING_HOVER = '#8cb7ff';

export class GizmoController {
  private _tool: ToolId = 'select';
  // Which handle the cursor is currently over. Used to tint the idle
  // gizmo so the user sees which part is grabbable before pressing the
  // mouse. Ignored while a drag is in progress — the active tint wins.
  private _hoverAxis: GizmoAxis | null = null;
  private _drag: {
    active: boolean;
    entries: DraggedEntity[];
    // World-space pivot captured at drag start. For single-select this is
    // the entity's own position; for multi-select it's the centroid of
    // all selected positions. Rotate and scale dilate around this point.
    pivotX: number;
    pivotY: number;
    axis: GizmoAxis;
    startWorldX: number;
    startWorldY: number;
    // Last world-space cursor / snap value fed to applyDrag. Tracked so
    // getSnapPreview() can recompute the snapped target without the
    // caller having to thread the live mouse position through separately.
    currWorldX: number;
    currWorldY: number;
    currSnap: number;
  } = {
    active: false,
    entries: [],
    pivotX: 0,
    pivotY: 0,
    axis: 'xy',
    startWorldX: 0,
    startWorldY: 0,
    currWorldX: 0,
    currWorldY: 0,
    currSnap: 0,
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

  get dragAxis(): GizmoAxis {
    return this._drag.axis;
  }

  /**
   * Set or clear the hovered handle. Callers should pass the result of
   * {@link hitTestHandle} on every mousemove while no drag is active.
   * Returns true if the hover state actually changed — the caller can
   * use that to skip an unnecessary re-render.
   */
  setHoverAxis(axis: GizmoAxis | null): boolean {
    if (this._hoverAxis === axis) return false;
    this._hoverAxis = axis;
    return true;
  }

  get hoverAxis(): GizmoAxis | null {
    return this._hoverAxis;
  }

  /** Entity IDs currently being dragged. Stable across one drag gesture. */
  get dragEntityIds(): readonly number[] {
    return this._drag.entries.map((e) => e.entityId);
  }

  /** World-space pivot of the current drag (centroid for multi-select). */
  get dragPivot(): { readonly x: number; readonly y: number } {
    return { x: this._drag.pivotX, y: this._drag.pivotY };
  }

  /**
   * Hit-test the active tool's gizmo handles. Returns the axis the user is
   * grabbing, or null if the click missed. Callers (SceneViewWidget) should
   * fall back to entity-pick / free drag when this returns null, matching
   * the legacy "click anywhere while selection has Transform" behaviour.
   *
   * Coordinates are canvas-relative CSS pixels (`e.clientX - rect.left`),
   * matching what worldToScreen returns.
   *
   * @param screenRingRadius screen-space ring radius (centre-to-ring,
   *   before the 10px padding the rotate gizmo adds). Required only for
   *   rotate; ignored for other tools.
   */
  hitTestHandle(
    screenX: number,
    screenY: number,
    centerX: number,
    centerY: number,
    screenRingRadius = 0,
  ): GizmoAxis | null {
    if (this._tool === 'move')
      return this._hitTestAxisHandles(screenX, screenY, centerX, centerY, MOVE_ARROW_LEN_PX);
    if (this._tool === 'scale')
      return this._hitTestAxisHandles(screenX, screenY, centerX, centerY, SCALE_ARROW_LEN_PX);
    if (this._tool === 'rotate')
      return this._hitTestRing(screenX, screenY, centerX, centerY, screenRingRadius);
    return null;
  }

  private _hitTestAxisHandles(
    screenX: number,
    screenY: number,
    centerX: number,
    centerY: number,
    arrowLen: number,
  ): GizmoAxis | null {
    const dx = screenX - centerX;
    const dy = screenY - centerY;

    // Centre square has priority — users targeting the middle to free-drag
    // would otherwise graze the X-arrow shaft.
    if (Math.abs(dx) <= CENTER_HANDLE_HALF_PX && Math.abs(dy) <= CENTER_HANDLE_HALF_PX) {
      return 'xy';
    }

    // X arrow / shaft extends to the right of centre.
    if (dx >= 0 && dx <= arrowLen + AXIS_HIT_PAD_PX && Math.abs(dy) <= AXIS_HIT_PAD_PX) {
      return 'x';
    }

    // Y arrow / shaft extends upward (canvas Y is inverted, so dy <= 0).
    if (dy <= 0 && dy >= -(arrowLen + AXIS_HIT_PAD_PX) && Math.abs(dx) <= AXIS_HIT_PAD_PX) {
      return 'y';
    }

    return null;
  }

  private _hitTestRing(
    screenX: number,
    screenY: number,
    centerX: number,
    centerY: number,
    screenRingRadius: number,
  ): GizmoAxis | null {
    const ringRadius = screenRingRadius + ROTATE_RING_PADDING_PX;
    if (ringRadius <= 0) return null;
    const dist = Math.hypot(screenX - centerX, screenY - centerY);
    return Math.abs(dist - ringRadius) <= RING_HIT_HALF_PX ? 'ring' : null;
  }

  /**
   * Snapshot every entity's starting Transform and flip into drag mode.
   * Called from SceneViewWidget's mousedown handler after it has resolved
   * the target set (from selection or hit-test) and axis (from a handle
   * hit-test or default 'xy' for free drag). The pivot is computed as the
   * centroid of the entities' starting positions — rotate and scale
   * dilate around it, so a group of sprites rotates about their collective
   * centre rather than around any one member.
   *
   * Entities without a Transform should be filtered out by the caller;
   * this method assumes every id in the list has one.
   */
  beginDrag(
    ecs: IECSSceneService,
    entityIds: readonly number[],
    worldX: number,
    worldY: number,
    axis: GizmoAxis = 'xy',
  ): void {
    const entries: DraggedEntity[] = [];
    let pivotX = 0;
    let pivotY = 0;
    for (const id of entityIds) {
      const startValues = readTransform(ecs, id);
      entries.push({ entityId: id, startValues });
      pivotX += startValues.px;
      pivotY += startValues.py;
    }
    if (entries.length > 0) {
      pivotX /= entries.length;
      pivotY /= entries.length;
    }
    this._drag = {
      active: true,
      entries,
      pivotX,
      pivotY,
      axis,
      startWorldX: worldX,
      startWorldY: worldY,
      currWorldX: worldX,
      currWorldY: worldY,
      currSnap: 0,
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
    this._drag.currWorldX = worldX;
    this._drag.currWorldY = worldY;
    this._drag.currSnap = snap;
    const { entries, pivotX, pivotY, startWorldX, startWorldY, axis } = this._drag;
    if (entries.length === 0) return;

    if (this._tool === 'move') {
      let dx = axis === 'y' ? 0 : worldX - startWorldX;
      let dy = axis === 'x' ? 0 : worldY - startWorldY;
      if (snap > 0) {
        // Snap the pivot itself, then apply the pivot's delta to each
        // entity so relative layout between selected items is preserved.
        if (axis !== 'y') dx = Math.round((pivotX + dx) / snap) * snap - pivotX;
        if (axis !== 'x') dy = Math.round((pivotY + dy) / snap) * snap - pivotY;
      }
      for (const e of entries) {
        ecs.setProperty(e.entityId, 'Transform', 'position.x', e.startValues.px + dx);
        ecs.setProperty(e.entityId, 'Transform', 'position.y', e.startValues.py + dy);
      }
    } else if (this._tool === 'rotate') {
      const startAngle = Math.atan2(startWorldY - pivotY, startWorldX - pivotX);
      const currAngle = Math.atan2(worldY - pivotY, worldX - pivotX);
      let deltaDeg = ((currAngle - startAngle) * 180) / Math.PI;
      // Snap toggles a fixed 15° step for rotate — the `snap` field is a
      // world-unit distance for the move tool but collapsed into a simple
      // "snap on/off" bit for rotate and scale. Keeps the single input in
      // the toolbar from needing a per-tool UI.
      if (snap > 0) {
        deltaDeg = Math.round(deltaDeg / ROTATE_SNAP_DEG) * ROTATE_SNAP_DEG;
      }
      const deltaRad = (deltaDeg * Math.PI) / 180;
      const cos = Math.cos(deltaRad);
      const sin = Math.sin(deltaRad);
      for (const e of entries) {
        const ox = e.startValues.px - pivotX;
        const oy = e.startValues.py - pivotY;
        ecs.setProperty(e.entityId, 'Transform', 'position.x', pivotX + ox * cos - oy * sin);
        ecs.setProperty(e.entityId, 'Transform', 'position.y', pivotY + ox * sin + oy * cos);
        ecs.setProperty(e.entityId, 'Transform', 'rotation.z', e.startValues.rotation + deltaDeg);
      }
    } else if (this._tool === 'scale') {
      const snapRatio = (r: number): number =>
        snap > 0 ? Math.round(r / SCALE_SNAP_STEP) * SCALE_SNAP_STEP : r;

      if (axis === 'x') {
        const startDX = signedDelta(startWorldX - pivotX);
        const currDX = worldX - pivotX;
        const ratio = snapRatio(currDX / startDX);
        for (const e of entries) {
          const ox = e.startValues.px - pivotX;
          ecs.setProperty(e.entityId, 'Transform', 'position.x', pivotX + ox * ratio);
          ecs.setProperty(e.entityId, 'Transform', 'scale.x', e.startValues.sx * ratio);
        }
      } else if (axis === 'y') {
        const startDY = signedDelta(startWorldY - pivotY);
        const currDY = worldY - pivotY;
        const ratio = snapRatio(currDY / startDY);
        for (const e of entries) {
          const oy = e.startValues.py - pivotY;
          ecs.setProperty(e.entityId, 'Transform', 'position.y', pivotY + oy * ratio);
          ecs.setProperty(e.entityId, 'Transform', 'scale.y', e.startValues.sy * ratio);
        }
      } else {
        // Uniform (xy / ring — ring shouldn't reach scale but defaulting
        // to uniform keeps the code robust if future tools alias through).
        const startDist = Math.max(0.01, Math.hypot(startWorldX - pivotX, startWorldY - pivotY));
        const currDist = Math.hypot(worldX - pivotX, worldY - pivotY);
        const ratio = snapRatio(currDist / startDist);
        for (const e of entries) {
          const ox = e.startValues.px - pivotX;
          const oy = e.startValues.py - pivotY;
          ecs.setProperty(e.entityId, 'Transform', 'position.x', pivotX + ox * ratio);
          ecs.setProperty(e.entityId, 'Transform', 'position.y', pivotY + oy * ratio);
          ecs.setProperty(e.entityId, 'Transform', 'scale.x', e.startValues.sx * ratio);
          ecs.setProperty(e.entityId, 'Transform', 'scale.y', e.startValues.sy * ratio);
        }
      }
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
    const { entries } = this._drag;
    this._drag.active = false;

    const results: DragResultEntity[] = [];
    let anyChanged = false;
    for (const e of entries) {
      const after = readTransform(ecs, e.entityId);
      if (!transformsEqual(e.startValues, after)) anyChanged = true;
      results.push({ entityId: e.entityId, before: e.startValues, after });
    }
    if (!anyChanged) return null;
    return { tool, entities: results };
  }

  /**
   * Return a hint describing the snap target the active drag will resolve
   * to, or null when no indicator should render (not dragging, snap off,
   * or the select tool). The math mirrors applyDrag so the overlay always
   * matches the value that would be committed if the user released now.
   */
  getSnapPreview(): SnapPreview | null {
    if (!this._drag.active) return null;
    const tool = this._tool;
    if (tool === 'select') return null;
    const { pivotX, pivotY, startWorldX, startWorldY, currWorldX, currWorldY, currSnap, axis } =
      this._drag;
    if (currSnap <= 0) return null;

    if (tool === 'move') {
      let dx = axis === 'y' ? 0 : currWorldX - startWorldX;
      let dy = axis === 'x' ? 0 : currWorldY - startWorldY;
      if (axis !== 'y') dx = Math.round((pivotX + dx) / currSnap) * currSnap - pivotX;
      if (axis !== 'x') dy = Math.round((pivotY + dy) / currSnap) * currSnap - pivotY;
      return {
        tool: 'move',
        snap: currSnap,
        snappedPivotX: pivotX + dx,
        snappedPivotY: pivotY + dy,
      };
    }

    if (tool === 'rotate') {
      const startAngle = Math.atan2(startWorldY - pivotY, startWorldX - pivotX);
      const currAngle = Math.atan2(currWorldY - pivotY, currWorldX - pivotX);
      const deltaDeg = ((currAngle - startAngle) * 180) / Math.PI;
      const snappedDeltaDeg = Math.round(deltaDeg / ROTATE_SNAP_DEG) * ROTATE_SNAP_DEG;
      return {
        tool: 'rotate',
        snap: currSnap,
        startAngleRad: startAngle,
        snappedDeltaDeg,
        stepDeg: ROTATE_SNAP_DEG,
      };
    }

    // scale
    let ratio: number;
    if (axis === 'x') {
      const startDX = signedDelta(startWorldX - pivotX);
      ratio = (currWorldX - pivotX) / startDX;
    } else if (axis === 'y') {
      const startDY = signedDelta(startWorldY - pivotY);
      ratio = (currWorldY - pivotY) / startDY;
    } else {
      const startDist = Math.max(0.01, Math.hypot(startWorldX - pivotX, startWorldY - pivotY));
      ratio = Math.hypot(currWorldX - pivotX, currWorldY - pivotY) / startDist;
    }
    ratio = Math.round(ratio / SCALE_SNAP_STEP) * SCALE_SNAP_STEP;
    return { tool: 'scale', snap: currSnap, axis, snappedRatio: ratio };
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
    } else if (this._tool === 'scale') {
      this._drawScaleGizmo(ctx, cx, cy);
      // Keep the corner handles as a supplementary bounding-box hint; they
      // aren't themselves hit-tested but they help the user see the
      // entity's current footprint as they scale.
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

  /**
   * Pick the colour for a handle given the idle / hover / active tints.
   * Active always wins over hover, so releasing the mouse after a drag
   * visibly settles into whatever the cursor is currently over.
   */
  private _axisColor(
    axis: Exclude<GizmoAxis, 'ring'>,
    idle: string,
    hover: string,
    active: string,
  ): string {
    const activeAxis = this._drag.active ? this._drag.axis : null;
    if (activeAxis === axis) return active;
    // Hover only matters when no drag is in progress — otherwise the
    // cursor is pinned by the drag math and the handle we're dragging
    // already has the active tint.
    if (!this._drag.active && this._hoverAxis === axis) return hover;
    return idle;
  }

  private _drawMoveGizmo(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    const len = MOVE_ARROW_LEN_PX;
    const xColor = this._axisColor('x', COLOR_X, COLOR_X_HOVER, COLOR_X_ACTIVE);
    const yColor = this._axisColor('y', COLOR_Y, COLOR_Y_HOVER, COLOR_Y_ACTIVE);
    const active = this._activeMoveAxis();

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
    const centerHovered = !this._drag.active && this._hoverAxis === 'xy';
    ctx.strokeStyle = active === 'xy' ? COLOR_X_ACTIVE : centerHovered ? COLOR_X_HOVER : '#ccd4df';
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
    const ringGrabbed = this._drag.active && this._tool === 'rotate';
    const ringHovered = !this._drag.active && this._hoverAxis === 'ring';
    const color = ringGrabbed ? COLOR_RING_ACTIVE : ringHovered ? COLOR_RING_HOVER : COLOR_RING;
    ctx.strokeStyle = color;
    ctx.lineWidth = ringGrabbed ? 2.5 : ringHovered ? 2 : 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
    const indX = cx + radius * Math.cos(-rotRad);
    const indY = cy + radius * Math.sin(-rotRad);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(indX, indY, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  private _drawScaleGizmo(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    const len = SCALE_ARROW_LEN_PX;
    const hs = SCALE_END_BOX_HALF_PX;
    const active = this._activeScaleAxis();
    const xColor = this._axisColor('x', COLOR_X, COLOR_X_HOVER, COLOR_X_ACTIVE);
    const yColor = this._axisColor('y', COLOR_Y, COLOR_Y_HOVER, COLOR_Y_ACTIVE);

    // X axis shaft + end box
    ctx.strokeStyle = xColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + len, cy);
    ctx.stroke();
    ctx.fillStyle = xColor;
    ctx.fillRect(cx + len - hs, cy - hs, hs * 2, hs * 2);

    // Y axis shaft + end box
    ctx.strokeStyle = yColor;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, cy - len);
    ctx.stroke();
    ctx.fillStyle = yColor;
    ctx.fillRect(cx - hs, cy - len - hs, hs * 2, hs * 2);

    // Uniform centre square
    const ch = CENTER_HANDLE_HALF_PX;
    const centerHovered = !this._drag.active && this._hoverAxis === 'xy';
    ctx.strokeStyle = active === 'xy' ? COLOR_X_ACTIVE : centerHovered ? COLOR_X_HOVER : '#ccd4df';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - ch, cy - ch, ch * 2, ch * 2);
  }

  private _activeScaleAxis(): GizmoAxis | null {
    if (!this._drag.active || this._tool !== 'scale') return null;
    return this._drag.axis;
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

// Axis scale uses a signed ratio so the user can drag the handle past the
// pivot to flip the entity. A zero delta at drag-start would blow up into
// infinity, so we floor the magnitude at a small epsilon while preserving
// the original sign (or picking positive if the start was exactly zero).
function signedDelta(v: number): number {
  if (v > 0) return Math.max(v, 0.01);
  if (v < 0) return Math.min(v, -0.01);
  return 0.01;
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
