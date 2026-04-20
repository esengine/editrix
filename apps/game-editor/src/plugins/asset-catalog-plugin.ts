import { Emitter } from '@editrix/common';
import type { IDisposable } from '@editrix/common';
import { IFileSystemService } from '@editrix/core';
import type { FileChangeEvent } from '@editrix/core';
import type { IPlugin, IPluginContext } from '@editrix/shell';
import { IWorkspaceService } from '@editrix/shell';
import type {
  AssetChange,
  AssetEntry,
  AssetType,
  IAssetCatalogService,
  ImporterSettings,
} from '../services.js';
import { IAssetCatalogService as IAssetCatalogServiceId } from '../services.js';

const META_SUFFIX = '.meta';
const ASSETS_DIR = 'assets';

export const AssetCatalogPlugin: IPlugin = {
  descriptor: {
    id: 'app.asset-catalog',
    version: '1.0.0',
    dependencies: ['app.filesystem'],
  },
  activate(ctx: IPluginContext) {
    const fs = ctx.services.get(IFileSystemService);
    const project = ctx.services.get(IWorkspaceService);

    if (!project.isOpen) {
      // Nothing to catalog without a project. Register a stub so consumers
      // don't crash; getAll returns empty.
      ctx.subscriptions.add(ctx.services.register(IAssetCatalogServiceId, new EmptyCatalog()));
      return;
    }

    const catalog = new AssetCatalog(fs, project.resolve(ASSETS_DIR));
    ctx.subscriptions.add(catalog);
    ctx.subscriptions.add(ctx.services.register(IAssetCatalogServiceId, catalog));
    void catalog.init();
  },
};

class EmptyCatalog implements IAssetCatalogService {
  readonly ready = Promise.resolve();
  private readonly _onDidChange = new Emitter<AssetChange>();
  private readonly _onDidChangeImporter = new Emitter<{
    uuid: string;
    settings: ImporterSettings;
  }>();
  readonly onDidChange = this._onDidChange.event;
  readonly onDidChangeImporter = this._onDidChangeImporter.event;
  getAll(): readonly AssetEntry[] {
    return [];
  }
  getByUuid(): undefined {
    return undefined;
  }
  getByPath(): undefined {
    return undefined;
  }
  getImporterSettings(): ImporterSettings {
    return {};
  }
  setImporterSettings(): Promise<void> {
    return Promise.resolve();
  }
}

class AssetCatalog implements IAssetCatalogService, IDisposable {
  private readonly _byUuid = new Map<string, AssetEntry>();
  private readonly _byPath = new Map<string, AssetEntry>();
  private readonly _importerByUuid = new Map<string, ImporterSettings>();
  private readonly _onDidChange = new Emitter<AssetChange>();
  private readonly _onDidChangeImporter = new Emitter<{
    uuid: string;
    settings: ImporterSettings;
  }>();
  private _readyResolve!: () => void;
  private _watchHandle: IDisposable | undefined;
  private _changeSub: IDisposable | undefined;
  // Debounced because single edits emit bursts (write + stat + rename).
  private _rescanTimer: ReturnType<typeof setTimeout> | undefined;

  readonly ready: Promise<void>;
  readonly onDidChange = this._onDidChange.event;
  readonly onDidChangeImporter = this._onDidChangeImporter.event;

  constructor(
    private readonly _fs: IFileSystemService,
    private readonly _assetsDir: string,
  ) {
    this.ready = new Promise((resolve) => {
      this._readyResolve = resolve;
    });
  }

  async init(): Promise<void> {
    try {
      if (!(await this._fs.exists(this._assetsDir))) {
        await this._fs.mkdir(this._assetsDir);
      }
      await this._scan();
      this._watchHandle = this._fs.watch(this._assetsDir);
      this._changeSub = this._fs.onDidChangeFile((e) => {
        this._handleFsEvent(e);
      });
    } finally {
      this._readyResolve();
    }
  }

  getAll(): readonly AssetEntry[] {
    return [...this._byUuid.values()];
  }

  getByUuid(uuid: string): AssetEntry | undefined {
    return this._byUuid.get(uuid);
  }

  getByPath(relativePath: string): AssetEntry | undefined {
    return this._byPath.get(relativePath);
  }

  getImporterSettings(uuid: string): ImporterSettings {
    return this._importerByUuid.get(uuid) ?? {};
  }

  async setImporterSettings(uuid: string, patch: ImporterSettings): Promise<void> {
    const asset = this._byUuid.get(uuid);
    if (!asset) return;
    const existing = this._importerByUuid.get(uuid) ?? {};
    const merged: ImporterSettings = { ...existing, ...patch };
    this._importerByUuid.set(uuid, merged);
    const metaPath = asset.absolutePath + META_SUFFIX;
    const body = { uuid, mtime: asset.mtime, importer: merged };
    await this._fs.writeFile(metaPath, JSON.stringify(body, null, 2));
    this._onDidChangeImporter.fire({ uuid, settings: merged });
  }

  dispose(): void {
    if (this._rescanTimer !== undefined) {
      clearTimeout(this._rescanTimer);
      this._rescanTimer = undefined;
    }
    this._changeSub?.dispose();
    this._changeSub = undefined;
    this._watchHandle?.dispose();
    this._watchHandle = undefined;
    this._onDidChange.dispose();
    this._onDidChangeImporter.dispose();
    this._byUuid.clear();
    this._byPath.clear();
    this._importerByUuid.clear();
  }

  private _handleFsEvent(e: FileChangeEvent): void {
    if (!e.path.startsWith(this._assetsDir)) return;
    if (e.path.endsWith(META_SUFFIX)) return;
    this._scheduleRescan();
  }

  private _scheduleRescan(): void {
    if (this._rescanTimer !== undefined) return;
    this._rescanTimer = setTimeout(() => {
      this._rescanTimer = undefined;
      void this._scan();
    }, 150);
  }

  private async _scan(): Promise<void> {
    const found = await this._walkAssets(this._assetsDir);
    const seenUuids = new Set<string>();

    for (const entry of found) {
      const existing = this._byPath.get(entry.relativePath);
      if (!existing) {
        this._byUuid.set(entry.uuid, entry);
        this._byPath.set(entry.relativePath, entry);
        seenUuids.add(entry.uuid);
        this._onDidChange.fire({ kind: 'added', asset: entry });
      } else if (existing.mtime !== entry.mtime || existing.size !== entry.size) {
        // UUID is sticky via the sidecar — only the mutable fields changed.
        const updated: AssetEntry = { ...existing, mtime: entry.mtime, size: entry.size };
        this._byUuid.set(existing.uuid, updated);
        this._byPath.set(existing.relativePath, updated);
        seenUuids.add(existing.uuid);
        this._onDidChange.fire({ kind: 'modified', asset: updated });
      } else {
        seenUuids.add(existing.uuid);
      }
    }

    for (const [uuid, asset] of this._byUuid) {
      if (!seenUuids.has(uuid)) {
        this._byUuid.delete(uuid);
        this._byPath.delete(asset.relativePath);
        this._onDidChange.fire({ kind: 'removed', uuid, relativePath: asset.relativePath });
      }
    }
  }

  private async _walkAssets(dir: string): Promise<AssetEntry[]> {
    const results: AssetEntry[] = [];
    const stack = [dir];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) break;
      let entries;
      try {
        entries = await this._fs.readDir(current);
      } catch {
        continue;
      }
      for (const e of entries) {
        if (e.type === 'directory') {
          stack.push(e.path);
          continue;
        }
        if (e.name.endsWith(META_SUFFIX)) continue;
        const resolved = await this._resolveOrCreateUuid(e.path, e.lastModified);
        results.push({
          uuid: resolved,
          relativePath: this._toRelative(e.path),
          absolutePath: e.path,
          type: classify(e.extension),
          mtime: e.lastModified,
          size: e.size,
        });
      }
    }
    return results;
  }

  private async _resolveOrCreateUuid(absPath: string, mtime: string): Promise<string> {
    const metaPath = absPath + META_SUFFIX;
    try {
      const raw = await this._fs.readFile(metaPath);
      const parsed = JSON.parse(raw) as { uuid?: unknown; importer?: unknown };
      if (typeof parsed.uuid === 'string' && parsed.uuid.length > 0) {
        if (parsed.importer && typeof parsed.importer === 'object') {
          this._importerByUuid.set(parsed.uuid, parsed.importer as ImporterSettings);
        }
        return parsed.uuid;
      }
    } catch {
      /* missing or malformed — fall through and re-create */
    }
    const uuid = uuidv4();
    await this._fs.writeFile(metaPath, JSON.stringify({ uuid, mtime }, null, 2));
    return uuid;
  }

  private _toRelative(absPath: string): string {
    // _assetsDir is already project-qualified; strip the part before the
    // project root — but since we don't carry the project root in here,
    // just strip everything up to and including the first `/assets/`
    // segment. Catalog clients use relativePath for UI and save refs.
    const idx = absPath.indexOf(`/${ASSETS_DIR}/`);
    if (idx === -1) return absPath;
    return absPath.slice(idx + 1);
  }
}

function classify(extension: string): AssetType {
  const ext = extension.toLowerCase();
  if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.webp' || ext === '.gif')
    return 'image';
  if (ext === '.esprefab') return 'prefab';
  if (ext === '.esanim') return 'anim-clip';
  if (ext === '.scene.json' || ext === '.json') return 'scene';
  if (ext === '.mp3' || ext === '.wav' || ext === '.ogg') return 'audio';
  if (ext === '.ttf' || ext === '.otf' || ext === '.woff' || ext === '.woff2') return 'font';
  return 'unknown';
}

function uuidv4(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  // RFC 4122 v4 fallback for hosts without crypto.randomUUID.
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
