import type { Event, IDisposable } from '@editrix/common';
import { createServiceId, Emitter } from '@editrix/common';

/**
 * A single undoable/redoable operation.
 *
 * Plugins create operations to describe changes that can be reversed.
 * The undo/redo service manages stacks of these operations.
 *
 * @example
 * ```ts
 * const op: UndoRedoOperation = {
 *   label: 'Move Node',
 *   undo: () => { node.position = oldPos; },
 *   redo: () => { node.position = newPos; },
 * };
 * undoRedo.push(op);
 * ```
 */
export interface UndoRedoOperation {
  /** Human-readable description (shown in Edit menu, tooltips). */
  readonly label: string;
  /** Reverse the operation. */
  undo(): void;
  /** Re-apply the operation. */
  redo(): void;
  /**
   * Optional resource key. Operations with the same key share an independent
   * undo/redo stack — useful for per-document undo. Operations without a key
   * use the global stack.
   */
  readonly resourceKey?: string;
}

/**
 * Payload for undo/redo state change events.
 */
export interface UndoRedoStateEvent {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel: string | undefined;
  readonly redoLabel: string | undefined;
  /** The resource whose stack changed, or undefined for the global stack. */
  readonly resourceKey?: string;
}

/**
 * Payload for the {@link IUndoRedoService.onError} event.
 */
export interface UndoRedoOperationError {
  /** Whether the failure occurred during undo or redo. */
  readonly phase: 'undo' | 'redo';
  /** Label of the entry being processed. */
  readonly label: string;
  /** The error thrown by the operation. */
  readonly error: unknown;
}

/**
 * Manages undo and redo stacks.
 *
 * Plugins push operations after making changes. The service maintains
 * two stacks (undo and redo) and exposes `undo()` / `redo()` to walk
 * through them. Pushing a new operation clears the redo stack.
 *
 * Supports transaction grouping: multiple operations pushed inside
 * `beginGroup` / `endGroup` are undone/redone as a single step.
 *
 * Operations with a `resourceKey` live on a stack independent of the
 * global one; pass the same key to `undo`/`redo`/`canUndo` to act on it.
 *
 * @example
 * ```ts
 * const undoRedo = kernel.services.get(IUndoRedoService);
 *
 * // Simple push
 * undoRedo.push({ label: 'Set Color', undo: () => {...}, redo: () => {...} });
 *
 * // Per-document undo
 * undoRedo.push({ label: 'Move Node', undo, redo, resourceKey: '/scenes/main.scene.json' });
 * undoRedo.undo('/scenes/main.scene.json');
 *
 * // Grouped transaction
 * undoRedo.beginGroup('Batch Edit');
 * undoRedo.push(op1);
 * undoRedo.push(op2);
 * undoRedo.endGroup();
 * ```
 */
export interface IUndoRedoService extends IDisposable {
  /** Push an operation onto the appropriate undo stack. Clears that stack's redo. */
  push(operation: UndoRedoOperation): void;

  /** Undo the most recent operation (or group) on the given resource's stack. */
  undo(resourceKey?: string): void;

  /** Redo the most recently undone operation (or group) on the given resource's stack. */
  redo(resourceKey?: string): void;

  /** Whether there are operations to undo on the given resource's stack. */
  canUndo(resourceKey?: string): boolean;

  /** Whether there are operations to redo on the given resource's stack. */
  canRedo(resourceKey?: string): boolean;

  /** Label of the next operation to undo on the given resource's stack. */
  getUndoLabel(resourceKey?: string): string | undefined;

  /** Label of the next operation to redo on the given resource's stack. */
  getRedoLabel(resourceKey?: string): string | undefined;

  /**
   * Start a group. All operations pushed until `endGroup` are one undo step.
   * If `resourceKey` is given, the group entry lands on that resource's stack
   * (overriding individual ops' resourceKey for the duration of the group).
   */
  beginGroup(label: string, resourceKey?: string): void;

  /** End the current group and push it as a single entry. */
  endGroup(): void;

  /** Clear all undo/redo history (all resources). */
  clear(): void;

  /** Clear history for a specific resource. */
  clearResource(resourceKey: string): void;

  /** Event fired when any stack's state changes. */
  readonly onDidChangeState: Event<UndoRedoStateEvent>;

  /**
   * Event fired when an op's `undo()` or `redo()` throws. The entry is still
   * moved between stacks so the user can retry forward — surfacing the error
   * here keeps a buggy operation from leaving the stack permanently stuck.
   */
  readonly onError: Event<UndoRedoOperationError>;
}

/** Service identifier for DI. */
export const IUndoRedoService = createServiceId<IUndoRedoService>('IUndoRedoService');

/**
 * An entry in the undo/redo stack. Either a single operation or a group.
 */
interface StackEntry {
  readonly label: string;
  readonly operations: readonly UndoRedoOperation[];
  readonly resourceKey: string | undefined;
}

interface ResourceStacks {
  undo: StackEntry[];
  redo: StackEntry[];
}

const GLOBAL_KEY = '\u0000__global__';

/**
 * Default implementation of {@link IUndoRedoService}.
 *
 * @example
 * ```ts
 * const service = new UndoRedoService();
 * service.push({ label: 'Edit', undo() {}, redo() {} });
 * service.undo();
 * ```
 */
export class UndoRedoService implements IUndoRedoService {
  private readonly _stacks = new Map<string, ResourceStacks>();
  private readonly _onDidChangeState = new Emitter<UndoRedoStateEvent>();
  private readonly _onError = new Emitter<UndoRedoOperationError>();

  private _groupBuffer: UndoRedoOperation[] | undefined;
  private _groupLabel: string | undefined;
  private _groupResourceKey: string | undefined;
  private _maxStackSize = 100;

  readonly onDidChangeState: Event<UndoRedoStateEvent> = this._onDidChangeState.event;
  readonly onError: Event<UndoRedoOperationError> = this._onError.event;

  /** Set maximum undo stack depth per resource. Oldest entries dropped. */
  setMaxStackSize(size: number): void {
    this._maxStackSize = size;
    for (const stacks of this._stacks.values()) {
      this._trimStack(stacks);
    }
  }

  push(operation: UndoRedoOperation): void {
    if (this._groupBuffer) {
      this._groupBuffer.push(operation);
      return;
    }

    const key = operation.resourceKey;
    const entry: StackEntry = {
      label: operation.label,
      operations: [operation],
      resourceKey: key,
    };
    this._pushEntry(entry);
  }

  undo(resourceKey?: string): void {
    const stacks = this._stacks.get(this._stackKey(resourceKey));
    if (!stacks) return;
    const entry = stacks.undo.pop();
    if (!entry) return;

    // Always rotate the entry to the redo stack — even if an operation throws,
    // the user can step forward (redo) to retry instead of being stuck. The
    // failure surfaces via onError.
    for (let i = entry.operations.length - 1; i >= 0; i--) {
      const op = entry.operations[i];
      if (!op) continue;
      try {
        op.undo();
      } catch (error) {
        this._onError.fire({ phase: 'undo', label: entry.label, error });
      }
    }

    stacks.redo.push(entry);
    this._fireState(resourceKey);
  }

  redo(resourceKey?: string): void {
    const stacks = this._stacks.get(this._stackKey(resourceKey));
    if (!stacks) return;
    const entry = stacks.redo.pop();
    if (!entry) return;

    for (const op of entry.operations) {
      try {
        op.redo();
      } catch (error) {
        this._onError.fire({ phase: 'redo', label: entry.label, error });
      }
    }

    stacks.undo.push(entry);
    this._fireState(resourceKey);
  }

  canUndo(resourceKey?: string): boolean {
    return (this._stacks.get(this._stackKey(resourceKey))?.undo.length ?? 0) > 0;
  }

  canRedo(resourceKey?: string): boolean {
    return (this._stacks.get(this._stackKey(resourceKey))?.redo.length ?? 0) > 0;
  }

  getUndoLabel(resourceKey?: string): string | undefined {
    const stacks = this._stacks.get(this._stackKey(resourceKey));
    return stacks?.undo[stacks.undo.length - 1]?.label;
  }

  getRedoLabel(resourceKey?: string): string | undefined {
    const stacks = this._stacks.get(this._stackKey(resourceKey));
    return stacks?.redo[stacks.redo.length - 1]?.label;
  }

  beginGroup(label: string, resourceKey?: string): void {
    if (this._groupBuffer) {
      throw new Error('Cannot nest beginGroup calls. Call endGroup first.');
    }
    this._groupBuffer = [];
    this._groupLabel = label;
    this._groupResourceKey = resourceKey;
  }

  endGroup(): void {
    if (!this._groupBuffer) {
      throw new Error('No active group. Call beginGroup first.');
    }

    const operations = this._groupBuffer;
    const label = this._groupLabel ?? 'Group';
    const resourceKey = this._groupResourceKey;
    this._groupBuffer = undefined;
    this._groupLabel = undefined;
    this._groupResourceKey = undefined;

    if (operations.length === 0) return;

    this._pushEntry({ label, operations, resourceKey });
  }

  clear(): void {
    const keys = [...this._stacks.keys()];
    this._stacks.clear();
    this._groupBuffer = undefined;
    this._groupLabel = undefined;
    this._groupResourceKey = undefined;
    // Fire one state event per resource that previously had history so any
    // per-document UI updates correctly.
    for (const key of keys) {
      this._fireState(key === GLOBAL_KEY ? undefined : key);
    }
    if (keys.length === 0) {
      this._fireState(undefined);
    }
  }

  clearResource(resourceKey: string): void {
    const key = this._stackKey(resourceKey);
    if (!this._stacks.delete(key)) return;
    this._fireState(resourceKey);
  }

  dispose(): void {
    this._stacks.clear();
    this._groupBuffer = undefined;
    this._onDidChangeState.dispose();
    this._onError.dispose();
  }

  private _pushEntry(entry: StackEntry): void {
    const stacks = this._getOrCreateStacks(entry.resourceKey);
    stacks.undo.push(entry);
    // A new edit invalidates only this resource's redo history.
    stacks.redo.length = 0;
    this._trimStack(stacks);
    this._fireState(entry.resourceKey);
  }

  private _stackKey(resourceKey: string | undefined): string {
    return resourceKey ?? GLOBAL_KEY;
  }

  private _getOrCreateStacks(resourceKey: string | undefined): ResourceStacks {
    const key = this._stackKey(resourceKey);
    let stacks = this._stacks.get(key);
    if (!stacks) {
      stacks = { undo: [], redo: [] };
      this._stacks.set(key, stacks);
    }
    return stacks;
  }

  private _trimStack(stacks: ResourceStacks): void {
    while (stacks.undo.length > this._maxStackSize) {
      stacks.undo.shift();
    }
  }

  private _fireState(resourceKey: string | undefined): void {
    const event: UndoRedoStateEvent = {
      canUndo: this.canUndo(resourceKey),
      canRedo: this.canRedo(resourceKey),
      undoLabel: this.getUndoLabel(resourceKey),
      redoLabel: this.getRedoLabel(resourceKey),
      ...(resourceKey !== undefined ? { resourceKey } : {}),
    };
    this._onDidChangeState.fire(event);
  }
}
