/**
 * @file    transaction-adapter.ts
 * @brief   Bridge estella Transaction into editrix IUndoRedoService
 *
 * The two systems live at different layers: estella Transaction is an
 * engine-data atomic (forward/reverse pair, no UI concepts); editrix
 * IUndoRedoService is the editor-level stack that drives Ctrl+Z, the
 * Edit menu, per-document history. Editor code should always push its
 * gestures onto the editrix service so the user sees consistent undo
 * behaviour across engine and editor actions — this adapter is the
 * canonical way to wrap a data-layer Transaction into one `push()`.
 */

import type { IUndoRedoService } from '@editrix/core';
import { Transaction, type TransactionOp } from 'esengine';

export interface RunTransactionOptions {
  /** Stack key — pass the scene URI / document key for per-document undo. */
  readonly resourceKey?: string;
}

/**
 * Opens a Transaction, hands it to `builder` to add ops (each `add` applies
 * forward immediately), then pushes a single UndoRedoOperation onto the
 * editrix undo stack. Empty transactions are silently dropped so a polling
 * loop that discovers no actual change doesn't clutter history.
 *
 * @example
 *   runTransaction(undoRedo, 'Paint Tiles', (tx) => {
 *     for (const tile of stroke) {
 *       const prev = getTile(layer, tile.x, tile.y);
 *       tx.add({
 *         forward: () => setTile(layer, tile.x, tile.y, newId),
 *         reverse: () => setTile(layer, tile.x, tile.y, prev.id),
 *       });
 *     }
 *   }, { resourceKey: sceneUri });
 */
export function runTransaction(
  undoRedo: IUndoRedoService,
  label: string,
  builder: (tx: Transaction) => void,
  options?: RunTransactionOptions,
): Transaction {
  const tx = new Transaction(label);
  builder(tx);
  if (tx.opCount > 0) {
    undoRedo.push({
      label,
      undo: () => {
        tx.undo();
      },
      redo: () => {
        tx.redo();
      },
      ...(options?.resourceKey !== undefined && { resourceKey: options.resourceKey }),
    });
  }
  return tx;
}

/**
 * Wraps an already-built Transaction (e.g. one assembled elsewhere, such
 * as a streaming tilemap stroke) and pushes it onto the undo stack.
 * Prefer `runTransaction` when the caller still has the ops to add — this
 * overload exists for cases where op assembly and commit happen in
 * different scopes.
 */
export function pushTransaction(
  undoRedo: IUndoRedoService,
  tx: Transaction,
  options?: RunTransactionOptions,
): void {
  if (tx.opCount === 0) return;
  undoRedo.push({
    label: tx.label,
    undo: () => {
      tx.undo();
    },
    redo: () => {
      tx.redo();
    },
    ...(options?.resourceKey !== undefined && { resourceKey: options.resourceKey }),
  });
}

// Re-export the Transaction types so editor code doesn't need a direct
// dependency on esengine just to build a Transaction.
export { Transaction };
export type { TransactionOp };
