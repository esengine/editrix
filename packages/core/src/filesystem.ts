/**
 * Cross-platform filesystem abstraction for the editor.
 *
 * The framework defines the interface; platform packages (Electron, web)
 * provide the actual implementation. All paths use forward slashes internally
 * and are normalized on the platform boundary.
 *
 * @example
 * ```ts
 * const fs = services.get(IFileSystemService);
 * const entries = await fs.readDir('/project/assets');
 * const content = await fs.readFile('/project/scenes/main.editrix-scene');
 * ```
 */

import type { Event, IDisposable } from '@editrix/common';
import { createServiceId } from '@editrix/common';

/**
 * Type of filesystem entry.
 */
export type FileEntryType = 'file' | 'directory';

/**
 * A single entry in a directory listing.
 */
export interface FileEntry {
  /** File or directory name (not full path). */
  readonly name: string;
  /** Absolute path (forward slashes). */
  readonly path: string;
  /** Whether this is a file or directory. */
  readonly type: FileEntryType;
  /** File size in bytes (0 for directories). */
  readonly size: number;
  /** Last modified time as ISO string. */
  readonly lastModified: string;
  /** File extension including dot (e.g. ".png"), empty for directories. */
  readonly extension: string;
}

/**
 * Stat result for a single file/directory.
 */
export interface FileStat {
  /** Whether this is a file or directory. */
  readonly type: FileEntryType;
  /** File size in bytes. */
  readonly size: number;
  /** Last modified time as ISO string. */
  readonly lastModified: string;
  /** Creation time as ISO string. */
  readonly createdAt: string;
}

/**
 * File change event from the watcher.
 */
export interface FileChangeEvent {
  /** Type of change. */
  readonly kind: 'created' | 'modified' | 'deleted';
  /** Absolute path of the changed file/directory (forward slashes). */
  readonly path: string;
}

/**
 * Editor filesystem service.
 *
 * Provides cross-platform file operations. All paths are normalized
 * to forward slashes internally. Implementations handle the platform
 * path conversion.
 */
export interface IFileSystemService extends IDisposable {
  /**
   * List entries in a directory.
   * Returns files and subdirectories sorted: directories first, then files, alphabetical.
   */
  readDir(dirPath: string): Promise<readonly FileEntry[]>;

  /**
   * Read a file as UTF-8 text.
   */
  readFile(filePath: string): Promise<string>;

  /**
   * Read a file as binary (ArrayBuffer).
   */
  readFileBuffer(filePath: string): Promise<ArrayBuffer>;

  /**
   * Write UTF-8 text to a file. Creates parent directories if needed.
   */
  writeFile(filePath: string, content: string): Promise<void>;

  /**
   * Get stat information for a file or directory.
   * Returns undefined if the path does not exist.
   */
  stat(filePath: string): Promise<FileStat | undefined>;

  /**
   * Check if a path exists.
   */
  exists(filePath: string): Promise<boolean>;

  /**
   * Create a directory (and parent directories if needed).
   */
  mkdir(dirPath: string): Promise<void>;

  /**
   * Delete a file or directory (recursively).
   */
  delete(targetPath: string): Promise<void>;

  /**
   * Rename / move a file or directory.
   */
  rename(oldPath: string, newPath: string): Promise<void>;

  /**
   * Copy a file or directory.
   */
  copy(srcPath: string, destPath: string): Promise<void>;

  /**
   * Start watching a directory for changes.
   * Returns a disposable to stop watching.
   */
  watch(dirPath: string): IDisposable;

  /**
   * Event fired when a watched file/directory changes.
   */
  readonly onDidChangeFile: Event<FileChangeEvent>;
}

/** Service identifier for DI. */
export const IFileSystemService = createServiceId<IFileSystemService>('IFileSystemService');

/**
 * Normalize a path to forward slashes (cross-platform).
 */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Get the file extension including the dot, or empty string.
 */
export function getExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx > 0 ? filename.slice(idx).toLowerCase() : '';
}

/**
 * Get the file name without extension.
 */
export function getBaseName(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx > 0 ? filename.slice(0, idx) : filename;
}

/**
 * Join path segments with forward slashes.
 */
export function joinPath(...parts: string[]): string {
  return parts
    .map((p) => p.replace(/\\/g, '/'))
    .join('/')
    .replace(/\/+/g, '/');
}

/**
 * Get the parent directory path.
 */
export function getParentPath(p: string): string {
  const normalized = normalizePath(p);
  const idx = normalized.lastIndexOf('/');
  return idx > 0 ? normalized.slice(0, idx) : normalized;
}
