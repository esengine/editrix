import type { Event, IDisposable } from '@editrix/common';
import { createServiceId, Emitter } from '@editrix/common';

/**
 * Manages the currently selected objects in the editor.
 *
 * When the user clicks an object in the scene, hierarchy, or any panel,
 * the selection service is updated. The Inspector reads the selection
 * to display the selected object's properties.
 *
 * @example
 * ```ts
 * const selection = new SelectionService();
 * selection.select(['node-1']);
 * selection.getSelection(); // ['node-1']
 * selection.select(['node-2', 'node-3']); // multi-select
 * ```
 */
export interface ISelectionService extends IDisposable {
  /** Set the current selection (replaces previous). */
  select(objectIds: readonly string[]): void;

  /** Add objects to the current selection. */
  addToSelection(objectIds: readonly string[]): void;

  /** Remove objects from the current selection. */
  removeFromSelection(objectIds: readonly string[]): void;

  /** Clear the selection. */
  clearSelection(): void;

  /** Get the current selection. */
  getSelection(): readonly string[];

  /** Whether a specific object is selected. */
  isSelected(objectId: string): boolean;

  /** Event fired when the selection changes. */
  readonly onDidChangeSelection: Event<readonly string[]>;
}

/** Service identifier for DI. */
export const ISelectionService = createServiceId<ISelectionService>('ISelectionService');

/**
 * Default implementation of {@link ISelectionService}.
 *
 * @example
 * ```ts
 * const service = new SelectionService();
 * service.select(['player']);
 * service.addToSelection(['enemy']);
 * service.getSelection(); // ['player', 'enemy']
 * ```
 */
export class SelectionService implements ISelectionService {
  private _selection: string[] = [];
  private readonly _onDidChange = new Emitter<readonly string[]>();

  readonly onDidChangeSelection: Event<readonly string[]> = this._onDidChange.event;

  select(objectIds: readonly string[]): void {
    this._selection = [...objectIds];
    this._onDidChange.fire(this._selection);
  }

  addToSelection(objectIds: readonly string[]): void {
    const toAdd = objectIds.filter((id) => !this._selection.includes(id));
    if (toAdd.length === 0) return;
    this._selection = [...this._selection, ...toAdd];
    this._onDidChange.fire(this._selection);
  }

  removeFromSelection(objectIds: readonly string[]): void {
    const toRemove = new Set(objectIds);
    const before = this._selection.length;
    this._selection = this._selection.filter((id) => !toRemove.has(id));
    if (this._selection.length !== before) {
      this._onDidChange.fire(this._selection);
    }
  }

  clearSelection(): void {
    if (this._selection.length === 0) return;
    this._selection = [];
    this._onDidChange.fire(this._selection);
  }

  getSelection(): readonly string[] {
    return this._selection;
  }

  isSelected(objectId: string): boolean {
    return this._selection.includes(objectId);
  }

  dispose(): void {
    this._selection = [];
    this._onDidChange.dispose();
  }
}
