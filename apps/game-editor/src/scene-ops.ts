/**
 * Shared entity manipulation helpers used by both the Hierarchy panel
 * and the Scene View canvas — snapshot / restore for undo, plus small
 * wrappers that read a SelectionService snapshot and build an undo entry
 * for the "obvious" multi-select gestures (nudge, duplicate, delete).
 *
 * Widgets and plugins should prefer these over re-implementing the
 * capture/restore walk; the ECS has no built-in clone and the correct
 * snapshot shape is non-trivial (parent id, all components, nested
 * children), so multiple copies would drift.
 */

import type { IECSSceneService } from '@editrix/estella';
import type { ISelectionService, IUndoRedoService } from '@editrix/shell';
import { entityRef, parseSelectionRef } from './services.js';

export interface EntitySnapshot {
  readonly name: string;
  readonly parentId: number | null;
  readonly components: readonly string[];
  readonly componentData: Record<string, Record<string, unknown>>;
  readonly children: readonly EntitySnapshot[];
}

export function captureEntitySnapshot(ecs: IECSSceneService, entityId: number): EntitySnapshot {
  const components = ecs.getComponents(entityId);
  const componentData: Record<string, Record<string, unknown>> = {};
  for (const comp of components) {
    componentData[comp] = ecs.getComponentData(entityId, comp);
  }
  const childIds = ecs.getChildren(entityId);
  return {
    name: ecs.getName(entityId) || `Entity ${String(entityId)}`,
    parentId: ecs.getParent(entityId),
    components: [...components],
    componentData,
    children: childIds.map((id) => captureEntitySnapshot(ecs, id)),
  };
}

export function restoreEntitySnapshot(
  ecs: IECSSceneService,
  snapshot: EntitySnapshot,
  parentId?: number,
): number {
  const newId = ecs.createEntity(snapshot.name, parentId);
  for (const comp of snapshot.components) {
    if (comp === 'Transform') continue;
    ecs.addComponent(newId, comp);
  }
  for (const [comp, data] of Object.entries(snapshot.componentData)) {
    for (const [field, value] of Object.entries(data)) {
      ecs.setProperty(newId, comp, field, value);
    }
  }
  for (const childSnapshot of snapshot.children) {
    restoreEntitySnapshot(ecs, childSnapshot, newId);
  }
  return newId;
}

/** Extract entity ids from the current selection, preserving order. */
function selectedEntityIds(selection: ISelectionService): number[] {
  const ids: number[] = [];
  for (const raw of selection.getSelection()) {
    const ref = parseSelectionRef(raw);
    if (ref?.kind === 'entity') ids.push(ref.id);
  }
  return ids;
}

/**
 * Filter a list to "roots" relative to the list itself — an entity
 * whose parent is also in the list is dropped, since duplicating /
 * deleting its ancestor will pull it along via the recursive snapshot.
 */
function rootsOnly(ecs: IECSSceneService, ids: readonly number[]): number[] {
  const set = new Set(ids);
  return ids.filter((id) => {
    const parent = ecs.getParent(id);
    return parent === null || !set.has(parent);
  });
}

/**
 * Translate every selected entity that has a Transform by `(dx, dy)`
 * world units and push a single undo entry. Returns true if anything
 * moved (caller can decide whether to request a render).
 */
export function nudgeSelectedEntities(
  ecs: IECSSceneService,
  selection: ISelectionService,
  dx: number,
  dy: number,
  undoRedo: IUndoRedoService,
): boolean {
  if (dx === 0 && dy === 0) return false;
  const ids = selectedEntityIds(selection).filter((id) => ecs.hasComponent(id, 'Transform'));
  if (ids.length === 0) return false;

  const before: { id: number; px: number; py: number }[] = [];
  for (const id of ids) {
    const px = ecs.getProperty(id, 'Transform', 'position.x') as number;
    const py = ecs.getProperty(id, 'Transform', 'position.y') as number;
    before.push({ id, px, py });
    ecs.setProperty(id, 'Transform', 'position.x', px + dx);
    ecs.setProperty(id, 'Transform', 'position.y', py + dy);
  }

  const label = ids.length === 1 ? 'Nudge Entity' : `Nudge ${String(ids.length)} Entities`;
  undoRedo.push({
    label,
    undo: () => {
      for (const b of before) {
        ecs.setProperty(b.id, 'Transform', 'position.x', b.px);
        ecs.setProperty(b.id, 'Transform', 'position.y', b.py);
      }
    },
    redo: () => {
      for (const b of before) {
        ecs.setProperty(b.id, 'Transform', 'position.x', b.px + dx);
        ecs.setProperty(b.id, 'Transform', 'position.y', b.py + dy);
      }
    },
  });
  return true;
}

/**
 * Duplicate every selected entity (filtered to its own roots), select
 * the new copies, and push a single undo entry. No-op when the
 * selection contains no entities.
 */
export function duplicateSelectedEntities(
  ecs: IECSSceneService,
  selection: ISelectionService,
  undoRedo: IUndoRedoService,
): void {
  const ids = selectedEntityIds(selection);
  if (ids.length === 0) return;
  const roots = rootsOnly(ecs, ids);
  if (roots.length === 0) return;

  const previousSelection = [...selection.getSelection()];
  const snapshots = roots.map((id) => captureEntitySnapshot(ecs, id));
  const newIds: number[] = [];
  for (const snapshot of snapshots) {
    newIds.push(restoreEntitySnapshot(ecs, snapshot, snapshot.parentId ?? undefined));
  }
  selection.select(newIds.map(entityRef));

  undoRedo.push({
    label: roots.length === 1 ? 'Duplicate Entity' : `Duplicate ${String(roots.length)} Entities`,
    undo: () => {
      for (const id of newIds) ecs.destroyEntity(id);
      selection.select(previousSelection);
    },
    redo: () => {
      const replay: number[] = [];
      for (const snapshot of snapshots) {
        replay.push(restoreEntitySnapshot(ecs, snapshot, snapshot.parentId ?? undefined));
      }
      selection.select(replay.map(entityRef));
    },
  });
}

/**
 * Delete every selected entity (filtered to its own roots). Selection
 * is cleared afterwards and an undo entry is pushed.
 *
 * The caller may pass a `guard` that further narrows the delete list
 * (e.g. the hierarchy panel filters out the sole prefab root with a
 * warning). Returning an empty array from the guard cancels the
 * operation entirely.
 */
export function deleteSelectedEntities(
  ecs: IECSSceneService,
  selection: ISelectionService,
  undoRedo: IUndoRedoService,
  guard?: (candidates: readonly number[]) => readonly number[],
): void {
  const ids = selectedEntityIds(selection);
  if (ids.length === 0) return;
  let toDelete = rootsOnly(ecs, ids);
  if (guard) toDelete = [...guard(toDelete)];
  if (toDelete.length === 0) return;

  const previousSelection = [...selection.getSelection()];
  const snapshots = toDelete.map((id) => captureEntitySnapshot(ecs, id));
  for (const id of toDelete) ecs.destroyEntity(id);
  selection.clearSelection();

  undoRedo.push({
    label: toDelete.length === 1 ? 'Delete Entity' : `Delete ${String(toDelete.length)} Entities`,
    undo: () => {
      const newRefs: string[] = [];
      for (const snapshot of snapshots) {
        const newId = restoreEntitySnapshot(ecs, snapshot, snapshot.parentId ?? undefined);
        newRefs.push(entityRef(newId));
      }
      selection.select(newRefs.length > 0 ? newRefs : previousSelection);
    },
    redo: () => {
      const currentRoots = ecs.getRootEntities();
      const tail = currentRoots.slice(-snapshots.length);
      for (const tailId of tail) ecs.destroyEntity(tailId);
      selection.clearSelection();
    },
  });
}
