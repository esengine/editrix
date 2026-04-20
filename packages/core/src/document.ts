/**
 * Document management service.
 *
 * Tracks open files (documents), their dirty state, and the active document.
 * Plugins register document handlers that know how to load/save specific
 * file types (e.g. scene files, animation files).
 *
 * @example
 * ```ts
 * const docs = services.get(IDocumentService);
 * await docs.open('/project/scenes/main.scene.json');
 * docs.setDirty(docs.activeDocument!, true);
 * await docs.save(docs.activeDocument!);
 * ```
 */

import type { Event, IDisposable } from '@editrix/common';
import { createServiceId, Emitter, toDisposable } from '@editrix/common';

/**
 * Information about an open document.
 */
export interface DocumentInfo {
  /** Absolute file path (forward slashes). */
  readonly filePath: string;
  /** Display name (filename without path). */
  readonly name: string;
  /** File extension including dot. */
  readonly extension: string;
  /** Whether the document has unsaved changes. */
  readonly dirty: boolean;
}

/**
 * A handler that knows how to load and save a specific file type.
 */
export interface DocumentHandler {
  /** File extensions this handler supports (e.g. ['.scene.json']). */
  readonly extensions: readonly string[];
  /** Load file content and apply it to the appropriate service. */
  load(filePath: string, content: string): Promise<void>;
  /** Serialize current state back to a string for saving. */
  serialize(filePath: string): Promise<string>;
}

/**
 * Document management service — tracks open files and their state.
 */
export interface IDocumentService extends IDisposable {
  /** Register a handler for specific file types. */
  registerHandler(handler: DocumentHandler): IDisposable;

  /** Open a file. Reads from disk, dispatches to the appropriate handler. */
  open(filePath: string): Promise<void>;

  /** Save a document. Serializes via handler and writes to disk. */
  save(filePath: string): Promise<void>;

  /**
   * Save the current in-memory state of an open document to a different
   * path. The existing document entry is rekeyed to the new path (no
   * reload), dirty is cleared, and active state follows. Throws if the
   * source isn't open, the destination is already open elsewhere, or no
   * handler matches either path.
   */
  saveAs(fromPath: string, toPath: string): Promise<void>;

  /**
   * Discard in-memory state and reload from disk via the handler. Used
   * for both user-initiated revert ("discard my changes") and
   * system-triggered reload (external file watcher). Caller is
   * responsible for confirming with the user when unsaved changes exist.
   */
  revert(filePath: string): Promise<void>;

  /** Close a document. */
  close(filePath: string): void;

  /** Set the active document. */
  setActive(filePath: string | null): void;

  /** Mark a document as dirty (has unsaved changes). */
  setDirty(filePath: string, dirty: boolean): void;

  /** Get info for all open documents. */
  getOpenDocuments(): readonly DocumentInfo[];

  /** Get the currently active document path, or null. */
  readonly activeDocument: string | null;

  /** Fired when the list of open documents changes (open/close). */
  readonly onDidChangeDocuments: Event<void>;

  /** Fired when the active document changes. */
  readonly onDidChangeActive: Event<string | null>;

  /** Fired when a document's dirty state changes. */
  readonly onDidChangeDirty: Event<{ filePath: string; dirty: boolean }>;
}

/** Service identifier for DI. */
export const IDocumentService = createServiceId<IDocumentService>('IDocumentService');

/**
 * Default implementation of {@link IDocumentService}.
 */
export class DocumentService implements IDocumentService {
  private readonly _documents = new Map<string, DocumentInfo>();
  private readonly _handlers: DocumentHandler[] = [];
  private _activeDocument: string | null = null;

  /** Function to read a file — injected to avoid direct fs dependency. */
  private readonly _readFile: (path: string) => Promise<string>;
  /** Function to write a file — injected to avoid direct fs dependency. */
  private readonly _writeFile: (path: string, content: string) => Promise<void>;

  private readonly _onDidChangeDocuments = new Emitter<void>();
  private readonly _onDidChangeActive = new Emitter<string | null>();
  private readonly _onDidChangeDirty = new Emitter<{ filePath: string; dirty: boolean }>();

  readonly onDidChangeDocuments: Event<void> = this._onDidChangeDocuments.event;
  readonly onDidChangeActive: Event<string | null> = this._onDidChangeActive.event;
  readonly onDidChangeDirty: Event<{ filePath: string; dirty: boolean }> =
    this._onDidChangeDirty.event;

  constructor(
    readFile: (path: string) => Promise<string>,
    writeFile: (path: string, content: string) => Promise<void>,
  ) {
    this._readFile = readFile;
    this._writeFile = writeFile;
  }

  get activeDocument(): string | null {
    return this._activeDocument;
  }

  registerHandler(handler: DocumentHandler): IDisposable {
    this._handlers.push(handler);
    return toDisposable(() => {
      const idx = this._handlers.indexOf(handler);
      if (idx >= 0) this._handlers.splice(idx, 1);
    });
  }

  async open(filePath: string): Promise<void> {
    const normalized = filePath.replace(/\\/g, '/');

    // Already open — just activate
    if (this._documents.has(normalized)) {
      this.setActive(normalized);
      return;
    }

    const handler = this._findHandler(normalized);
    if (!handler) {
      throw new Error(`No document handler registered for "${normalized}".`);
    }

    let content: string;
    try {
      content = await this._readFile(normalized);
    } catch (cause) {
      throw new Error(`Failed to read document "${normalized}".`, { cause });
    }

    try {
      await handler.load(normalized, content);
    } catch (cause) {
      throw new Error(`Failed to load document "${normalized}".`, { cause });
    }

    const name = normalized.split('/').pop() ?? normalized;
    const ext = this._getExtension(name);

    this._documents.set(normalized, { filePath: normalized, name, extension: ext, dirty: false });
    this._onDidChangeDocuments.fire();
    this.setActive(normalized);
  }

  async save(filePath: string): Promise<void> {
    const normalized = filePath.replace(/\\/g, '/');
    const doc = this._documents.get(normalized);
    if (!doc) return;

    const handler = this._findHandler(normalized);
    if (!handler) return;

    let content: string;
    try {
      content = await handler.serialize(normalized);
    } catch (cause) {
      throw new Error(`Failed to serialize document "${normalized}".`, { cause });
    }

    try {
      await this._writeFile(normalized, content);
    } catch (cause) {
      throw new Error(`Failed to write document "${normalized}".`, { cause });
    }

    this.setDirty(normalized, false);
  }

  async saveAs(fromPath: string, toPath: string): Promise<void> {
    const normalizedFrom = fromPath.replace(/\\/g, '/');
    const normalizedTo = toPath.replace(/\\/g, '/');

    const doc = this._documents.get(normalizedFrom);
    if (!doc) throw new Error(`Document "${normalizedFrom}" is not open.`);

    if (normalizedTo !== normalizedFrom && this._documents.has(normalizedTo)) {
      throw new Error(
        `Cannot save as "${normalizedTo}": a document is already open at that path.`,
      );
    }

    const sourceHandler = this._findHandler(normalizedFrom);
    if (!sourceHandler) {
      throw new Error(`No document handler registered for "${normalizedFrom}".`);
    }

    // Destination path must also resolve to a handler — prevents silently
    // writing a .scene.json as .txt and losing type info on the next open.
    if (!this._findHandler(normalizedTo)) {
      throw new Error(`No document handler registered for "${normalizedTo}".`);
    }

    let content: string;
    try {
      content = await sourceHandler.serialize(normalizedFrom);
    } catch (cause) {
      throw new Error(`Failed to serialize document "${normalizedFrom}".`, { cause });
    }

    try {
      await this._writeFile(normalizedTo, content);
    } catch (cause) {
      throw new Error(`Failed to write document "${normalizedTo}".`, { cause });
    }

    if (normalizedTo === normalizedFrom) {
      this.setDirty(normalizedFrom, false);
      return;
    }

    this._documents.delete(normalizedFrom);
    const name = normalizedTo.split('/').pop() ?? normalizedTo;
    const ext = this._getExtension(name);
    this._documents.set(normalizedTo, {
      filePath: normalizedTo,
      name,
      extension: ext,
      dirty: false,
    });
    this._onDidChangeDocuments.fire();

    if (this._activeDocument === normalizedFrom) {
      this._activeDocument = normalizedTo;
      this._onDidChangeActive.fire(normalizedTo);
    }
  }

  async revert(filePath: string): Promise<void> {
    const normalized = filePath.replace(/\\/g, '/');
    const doc = this._documents.get(normalized);
    if (!doc) throw new Error(`Document "${normalized}" is not open.`);

    const handler = this._findHandler(normalized);
    if (!handler) {
      throw new Error(`No document handler registered for "${normalized}".`);
    }

    let content: string;
    try {
      content = await this._readFile(normalized);
    } catch (cause) {
      throw new Error(`Failed to read document "${normalized}".`, { cause });
    }

    try {
      await handler.load(normalized, content);
    } catch (cause) {
      throw new Error(`Failed to reload document "${normalized}".`, { cause });
    }

    this.setDirty(normalized, false);
  }

  close(filePath: string): void {
    const normalized = filePath.replace(/\\/g, '/');
    if (!this._documents.has(normalized)) return;

    this._documents.delete(normalized);
    this._onDidChangeDocuments.fire();

    if (this._activeDocument === normalized) {
      // Activate the first remaining document, or null
      const remaining = [...this._documents.keys()];
      this.setActive(remaining[0] ?? null);
    }
  }

  setActive(filePath: string | null): void {
    const normalized = filePath?.replace(/\\/g, '/') ?? null;
    if (this._activeDocument === normalized) return;
    this._activeDocument = normalized;
    this._onDidChangeActive.fire(normalized);
  }

  setDirty(filePath: string, dirty: boolean): void {
    const normalized = filePath.replace(/\\/g, '/');
    const doc = this._documents.get(normalized);
    if (!doc || doc.dirty === dirty) return;

    this._documents.set(normalized, { ...doc, dirty });
    this._onDidChangeDirty.fire({ filePath: normalized, dirty });
  }

  getOpenDocuments(): readonly DocumentInfo[] {
    return [...this._documents.values()];
  }

  dispose(): void {
    this._documents.clear();
    this._handlers.length = 0;
    this._onDidChangeDocuments.dispose();
    this._onDidChangeActive.dispose();
    this._onDidChangeDirty.dispose();
  }

  private _findHandler(filePath: string): DocumentHandler | undefined {
    return this._handlers.find((h) => h.extensions.some((ext) => filePath.endsWith(ext)));
  }

  private _getExtension(filename: string): string {
    const idx = filename.lastIndexOf('.');
    return idx > 0 ? filename.slice(idx).toLowerCase() : '';
  }
}
