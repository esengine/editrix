/**
 * Shared drag-session state for internal editor asset drags.
 *
 * HTML5 `DataTransfer` payloads are only readable inside the `drop`
 * event — they're locked during `dragover` by the spec. Drop targets
 * that want to react while the drag is still in motion (e.g. render a
 * ghost preview at the cursor world position inside the Scene View)
 * need a different channel. This module is that channel:
 *
 *   • Content Browser cards call {@link beginAssetDrag} on dragstart.
 *   • Drop targets read {@link currentAssetDrag} during dragover.
 *   • The source clears via {@link endAssetDrag} on dragend.
 *
 * Only one native DnD gesture can be live at a time per window, so a
 * module-level mutable singleton is sufficient and avoids plumbing a
 * new service through the plugin graph.
 */

export interface AssetDragInfo {
  readonly absolutePath: string;
  /** Forward-slash path relative to the current project root, used to
   *  construct `project-asset://editor/<relativePath>` URLs for thumbnail
   *  previews. Empty if the asset sits outside the project tree. */
  readonly relativePath: string;
  readonly fileName: string;
  /** Lower-case, includes the leading dot (e.g. `.png`). Empty if none. */
  readonly extension: string;
}

let current: AssetDragInfo | null = null;

export function beginAssetDrag(info: AssetDragInfo): void {
  current = info;
}

export function endAssetDrag(): void {
  current = null;
}

export function currentAssetDrag(): AssetDragInfo | null {
  return current;
}
