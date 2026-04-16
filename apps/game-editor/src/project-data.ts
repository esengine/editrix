/**
 * Mock project filesystem data and utilities shared by
 * ProjectFilesWidget and AssetBrowserWidget.
 */

/** A node in the virtual project filesystem. */
export interface ProjectFileNode {
  readonly id: string;
  readonly name: string;
  readonly type: 'folder' | 'file';
  /** Hint for icon selection: 'gltf', 'png', 'toml', 'rs', etc. */
  readonly fileType?: string;
  readonly children?: readonly ProjectFileNode[];
}

/** Breadcrumb segment for the Asset Browser path bar. */
export interface BreadcrumbSegment {
  readonly id: string;
  readonly label: string;
}

/** Demo project file tree matching the Bevy editor reference. */
export const PROJECT_FILES: readonly ProjectFileNode[] = [
  {
    id: 'dot-cargo', name: '.cargo', type: 'folder',
    children: [],
  },
  {
    id: 'assets', name: 'assets', type: 'folder',
    children: [
      { id: 'assets-animation', name: 'animation', type: 'folder', children: [] },
      { id: 'assets-audio', name: 'audio', type: 'folder', children: [] },
      { id: 'assets-materials', name: 'materials', type: 'folder', children: [] },
      {
        id: 'assets-models', name: 'models', type: 'folder',
        children: [
          { id: 'stanford-dragon', name: 'stanford-dragon.gltf', type: 'file', fileType: 'gltf' },
          { id: 'teapot', name: 'teapot.gltf', type: 'file', fileType: 'gltf' },
        ],
      },
      { id: 'assets-scenes', name: 'scenes', type: 'folder', children: [] },
      { id: 'sky-texture', name: 'sky-texture.png', type: 'file', fileType: 'png' },
    ],
  },
  {
    id: 'src', name: 'src', type: 'folder',
    children: [
      { id: 'main-rs', name: 'main.rs', type: 'file', fileType: 'rs' },
    ],
  },
  { id: 'cargo-lock', name: 'Cargo.lock', type: 'file', fileType: 'toml' },
  { id: 'cargo-toml', name: 'Cargo.toml', type: 'file', fileType: 'toml' },
];

/** Find a node by ID in the tree. */
export function findFileNode(
  nodes: readonly ProjectFileNode[],
  id: string,
): ProjectFileNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findFileNode(node.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

/** Build breadcrumb path from root to a given node ID. */
export function buildBreadcrumbs(
  nodes: readonly ProjectFileNode[],
  targetId: string,
): BreadcrumbSegment[] {
  const path: BreadcrumbSegment[] = [];

  function walk(list: readonly ProjectFileNode[]): boolean {
    for (const node of list) {
      if (node.id === targetId) {
        path.push({ id: node.id, label: node.name });
        return true;
      }
      if (node.children && walk(node.children)) {
        path.unshift({ id: node.id, label: node.name });
        return true;
      }
    }
    return false;
  }

  walk(nodes);
  return path;
}

/** Get the children of a folder node. Pass 'root' for top-level. */
export function getFolderContents(
  nodes: readonly ProjectFileNode[],
  folderId: string,
): readonly ProjectFileNode[] {
  if (folderId === 'root') return nodes;
  const node = findFileNode(nodes, folderId);
  return node?.children ?? [];
}

/** Map a file node to an icon name from the registry. */
export function fileTypeToIcon(node: ProjectFileNode): string {
  if (node.type === 'folder') return 'folder';
  switch (node.fileType) {
    case 'gltf': return 'box';
    case 'png': return 'grid';
    default: return 'file';
  }
}
