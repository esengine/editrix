import type { Event, IDisposable } from '@editrix/common';
import { Emitter, toDisposable } from '@editrix/common';
import type { FileChangeEvent, FileEntry, FileStat, IFileSystemService } from '@editrix/core';

/**
 * Shape of the Electron preload bridge under window.electronAPI.fs.
 * Mirrors what preload.cjs exposes — kept narrow so a missing method surfaces
 * as a TypeScript error instead of a runtime undefined.
 */
interface ElectronFsBridge {
  readDir(dirPath: string): Promise<readonly FileEntry[]>;
  readFile(filePath: string): Promise<string>;
  readFileBuffer(filePath: string): Promise<Uint8Array | ArrayBuffer | { buffer: ArrayBuffer }>;
  writeFile(filePath: string, content: string): Promise<void>;
  stat(filePath: string): Promise<FileStat | null>;
  exists(filePath: string): Promise<boolean>;
  mkdir(dirPath: string): Promise<void>;
  delete(targetPath: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  copy(srcPath: string, destPath: string): Promise<void>;
  watch(dirPath: string): Promise<string | null>;
  unwatch(watchId: string): Promise<void>;
  onChange(callback: (event: FileChangeEvent) => void): void;
}

function getBridge(): ElectronFsBridge | undefined {
  return (window as unknown as { electronAPI?: { fs?: ElectronFsBridge } }).electronAPI?.fs;
}

/**
 * IFileSystemService implementation backed by the Electron preload bridge.
 *
 * Forwards every operation to the matching ipcRenderer.invoke channel. The
 * watch path is a bit more involved: the preload exposes a one-shot
 * onChange callback registration, so this service installs ONE listener at
 * construction time and fans out to subscribers via {@link onDidChangeFile}.
 * Each watch() call tracks an active watchId so the returned IDisposable can
 * call unwatch() at the right time.
 */
export class ElectronFileSystemService implements IFileSystemService {
  private readonly _bridge: ElectronFsBridge;
  private readonly _onDidChangeFile = new Emitter<FileChangeEvent>();
  private readonly _activeWatches = new Set<string>();
  private _disposed = false;

  readonly onDidChangeFile: Event<FileChangeEvent> = this._onDidChangeFile.event;

  constructor() {
    const bridge = getBridge();
    if (!bridge) {
      throw new Error(
        'ElectronFileSystemService requires window.electronAPI.fs — preload bridge not available.',
      );
    }
    this._bridge = bridge;
    // The preload exposes onChange as a registration function; we install ONE
    // forwarder that drives our multi-subscriber Emitter.
    bridge.onChange((event) => {
      if (this._disposed) return;
      this._onDidChangeFile.fire(event);
    });
  }

  readDir(dirPath: string): Promise<readonly FileEntry[]> {
    return this._bridge.readDir(dirPath);
  }

  readFile(filePath: string): Promise<string> {
    return this._bridge.readFile(filePath);
  }

  async readFileBuffer(filePath: string): Promise<ArrayBuffer> {
    const raw = await this._bridge.readFileBuffer(filePath);
    // Node's Buffer arrives over IPC as Uint8Array (or shaped like it).
    // Normalise to ArrayBuffer for consumers (typed-array constructors
    // accept either, but the interface promises ArrayBuffer).
    if (raw instanceof ArrayBuffer) return raw;
    if (raw instanceof Uint8Array) {
      // .buffer is typed ArrayBufferLike in newer TS lib defs (covers Shared too).
      // We only ever serve plain ArrayBuffers through IPC, so narrow explicitly.
      return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
    }
    if ('buffer' in raw && raw.buffer instanceof ArrayBuffer) return raw.buffer;
    throw new Error(`readFileBuffer: unexpected payload shape for "${filePath}".`);
  }

  writeFile(filePath: string, content: string): Promise<void> {
    return this._bridge.writeFile(filePath, content);
  }

  async stat(filePath: string): Promise<FileStat | undefined> {
    const result = await this._bridge.stat(filePath);
    return result ?? undefined;
  }

  exists(filePath: string): Promise<boolean> {
    return this._bridge.exists(filePath);
  }

  mkdir(dirPath: string): Promise<void> {
    return this._bridge.mkdir(dirPath);
  }

  delete(targetPath: string): Promise<void> {
    return this._bridge.delete(targetPath);
  }

  rename(oldPath: string, newPath: string): Promise<void> {
    return this._bridge.rename(oldPath, newPath);
  }

  copy(srcPath: string, destPath: string): Promise<void> {
    return this._bridge.copy(srcPath, destPath);
  }

  watch(dirPath: string): IDisposable {
    let watchId: string | undefined;
    let cancelled = false;
    void this._bridge.watch(dirPath).then((id) => {
      if (cancelled || !id) return;
      watchId = id;
      this._activeWatches.add(id);
    });
    return toDisposable(() => {
      cancelled = true;
      if (watchId) {
        this._activeWatches.delete(watchId);
        void this._bridge.unwatch(watchId);
      }
    });
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    for (const id of this._activeWatches) {
      void this._bridge.unwatch(id);
    }
    this._activeWatches.clear();
    this._onDidChangeFile.dispose();
  }
}
