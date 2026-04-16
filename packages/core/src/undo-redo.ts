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
   * Optional resource key. Operations on the same resource are grouped
   * in the stack for context-aware undo (e.g. per-document undo).
   * If omitted, the operation belongs to the global stack.
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
 * @example
 * ```ts
 * const undoRedo = kernel.services.get(IUndoRedoService);
 *
 * // Simple push
 * undoRedo.push({ label: 'Set Color', undo: () => {...}, redo: () => {...} });
 *
 * // Grouped transaction
 * undoRedo.beginGroup('Batch Edit');
 * undoRedo.push(op1);
 * undoRedo.push(op2);
 * undoRedo.endGroup();
 * // Ctrl+Z undoes op2 and op1 together
 *
 * undoRedo.undo();
 * undoRedo.redo();
 * ```
 */
export interface IUndoRedoService extends IDisposable {
  /** Push an operation onto the undo stack. Clears the redo stack. */
  push(operation: UndoRedoOperation): void;

  /** Undo the most recent operation (or group). */
  undo(): void;

  /** Redo the most recently undone operation (or group). */
  redo(): void;

  /** Whether there are operations to undo. */
  canUndo(): boolean;

  /** Whether there are operations to redo. */
  canRedo(): boolean;

  /** Label of the next operation to undo, or undefined. */
  getUndoLabel(): string | undefined;

  /** Label of the next operation to redo, or undefined. */
  getRedoLabel(): string | undefined;

  /** Start a group. All operations pushed until `endGroup` are one undo step. */
  beginGroup(label: string): void;

  /** End the current group and push it as a single entry. */
  endGroup(): void;

  /** Clear all undo and redo history. */
  clear(): void;

  /** Event fired when the undo/redo state changes. */
  readonly onDidChangeState: Event<UndoRedoStateEvent>;
}

/** Service identifier for DI. */
export const IUndoRedoService = createServiceId<IUndoRedoService>('IUndoRedoService');

/**
 * An entry in the undo/redo stack. Either a single operation or a group.
 */
interface StackEntry {
  readonly label: string;
  readonly operations: readonly UndoRedoOperation[];
}

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
  private readonly _undoStack: StackEntry[] = [];
  private readonly _redoStack: StackEntry[] = [];
  private readonly _onDidChangeState = new Emitter<UndoRedoStateEvent>();

  private _groupBuffer: UndoRedoOperation[] | undefined;
  private _groupLabel: string | undefined;
  private _maxStackSize = 100;

  readonly onDidChangeState: Event<UndoRedoStateEvent> = this._onDidChangeState.event;

  /** Set maximum undo stack depth. Oldest entries are dropped when exceeded. */
  setMaxStackSize(size: number): void {
    this._maxStackSize = size;
    this._trimStack();
  }

  push(operation: UndoRedoOperation): void {
    if (this._groupBuffer) {
      this._groupBuffer.push(operation);
      return;
    }

    this._undoStack.push({ label: operation.label, operations: [operation] });
    this._redoStack.length = 0;
    this._trimStack();
    this._fireState();
  }

  undo(): void {
    const entry = this._undoStack.pop();
    if (!entry) return;

    // Undo in reverse order
    for (let i = entry.operations.length - 1; i >= 0; i--) {
      entry.operations[i]?.undo();
    }

    this._redoStack.push(entry);
    this._fireState();
  }

  redo(): void {
    const entry = this._redoStack.pop();
    if (!entry) return;

    // Redo in forward order
    for (const op of entry.operations) {
      op.redo();
    }

    this._undoStack.push(entry);
    this._fireState();
  }

  canUndo(): boolean {
    return this._undoStack.length > 0;
  }

  canRedo(): boolean {
    return this._redoStack.length > 0;
  }

  getUndoLabel(): string | undefined {
    return this._undoStack[this._undoStack.length - 1]?.label;
  }

  getRedoLabel(): string | undefined {
    return this._redoStack[this._redoStack.length - 1]?.label;
  }

  beginGroup(label: string): void {
    if (this._groupBuffer) {
      throw new Error('Cannot nest beginGroup calls. Call endGroup first.');
    }
    this._groupBuffer = [];
    this._groupLabel = label;
  }

  endGroup(): void {
    if (!this._groupBuffer) {
      throw new Error('No active group. Call beginGroup first.');
    }

    const operations = this._groupBuffer;
    const label = this._groupLabel ?? 'Group';
    this._groupBuffer = undefined;
    this._groupLabel = undefined;

    if (operations.length === 0) return;

    this._undoStack.push({ label, operations });
    this._redoStack.length = 0;
    this._trimStack();
    this._fireState();
  }

  clear(): void {
    this._undoStack.length = 0;
    this._redoStack.length = 0;
    this._groupBuffer = undefined;
    this._groupLabel = undefined;
    this._fireState();
  }

  dispose(): void {
    this.clear();
    this._onDidChangeState.dispose();
  }

  private _trimStack(): void {
    while (this._undoStack.length > this._maxStackSize) {
      this._undoStack.shift();
    }
  }

  private _fireState(): void {
    this._onDidChangeState.fire({
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      undoLabel: this.getUndoLabel(),
      redoLabel: this.getRedoLabel(),
    });
  }
}
