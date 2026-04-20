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
// constant under editor zoom. Duplicated here from the previous inline
// values to keep the refactor byte-identical.
const MOVE_ARROW_LEN_PX = 30;
const ROTATE_RING_PADDING_PX = 10;
const CORNER_HANDLE_PX = 5;

const COLOR_X = '#e55561';
const COLOR_Y = '#6bc46d';
const COLOR_RING = '#4a8fff';
const COLOR_CORNER = '#4a8fff';

export class GizmoController {
  private _tool: ToolId = 'select';
  private _drag: {
    active: boolean;
    entityId: number;
    startWorldX: number;
    startWorldY: number;
    startValues: TransformSnapshot;
  } = {
    active: false,
    entityId: 0,
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

  /**
   * Capture the entity's current Transform and flip into drag mode. Called
   * from SceneViewWidget's mousedown handler after it has resolved which
   * entity is being manipulated (from selection or hit-test).
   */
  beginDrag(ecs: IECSSceneService, entityId: number, worldX: number, worldY: number): void {
    this._drag = {
      active: true,
      entityId,
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
      let newX = s.px + (worldX - startWorldX);
      let newY = s.py + (worldY - startWorldY);
      if (snap > 0) {
        newX = Math.round(newX / snap) * snap;
        newY = Math.round(newY / snap) * snap;
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

  private _drawMoveGizmo(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    const len = MOVE_ARROW_LEN_PX;
    ctx.strokeStyle = COLOR_X;
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
    ctx.strokeStyle = COLOR_Y;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, cy - len);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 4, cy - len + 6);
    ctx.lineTo(cx, cy - len);
    ctx.lineTo(cx + 4, cy - len + 6);
    ctx.stroke();
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
