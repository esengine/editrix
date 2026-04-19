import type { IDisposable } from '@editrix/common';
import type { IECSSceneService } from '@editrix/estella';
import { IConsoleService } from '@editrix/plugin-console';
import type { IPlugin, IPluginContext } from '@editrix/shell';
import {
  IAssetCatalogService,
  IECSScenePresence,
  IRuntimeAppPresence,
  type IRuntimeApp,
} from '../services.js';

interface RuntimeTextureResult {
  handle: number;
  width: number;
  height: number;
}

interface RuntimeTextureImportSettings {
  readonly filter?: 'linear' | 'nearest';
  readonly wrap?: 'repeat' | 'clamp' | 'mirror';
  readonly mipmaps?: boolean;
}

type RuntimeAssetRefResolver = (ref: string) => string | null;
type RuntimeTextureSettingsResolver = (ref: string) => RuntimeTextureImportSettings | undefined;

interface RuntimeAssets {
  baseUrl: string | undefined;
  setAssetRefResolver(resolver: RuntimeAssetRefResolver): void;
  setTextureImportSettingsResolver?(resolver: RuntimeTextureSettingsResolver | null): void;
  invalidate(ref: string): boolean;
  loadTexture(ref: string): Promise<RuntimeTextureResult>;
}

const INVALID_TEXTURE_HANDLE = 0;
const ASSET_METADATA_PREFIX = 'asset:';
const UUID_PREFIX = '@uuid:';

interface RuntimeApp {
  getResource(def: unknown): RuntimeAssets;
  hasResource(def: unknown): boolean;
}

export const ImageImporterPlugin: IPlugin = {
  descriptor: {
    id: 'app.image-importer',
    version: '1.0.0',
    dependencies: ['app.asset-catalog', 'app.ecs-scene', 'app.play-mode'],
  },
  activate(ctx: IPluginContext) {
    const catalog = ctx.services.get(IAssetCatalogService);
    const runtimePresence = ctx.services.get(IRuntimeAppPresence);
    const ecsPresence = ctx.services.get(IECSScenePresence);

    const warn = (msg: string, err?: unknown): void => {
      const text = err !== undefined ? `${msg}: ${stringifyErr(err)}` : msg;
      try {
        ctx.services.get(IConsoleService).log('warn', text, 'image-importer');
      } catch {
        // eslint-disable-next-line no-console -- fallback only
        console.warn(`[image-importer] ${text}`);
      }
    };

    let bound: { assets: RuntimeAssets; sub: IDisposable; metaSub: IDisposable | undefined; importerSub: IDisposable } | undefined;

    const loadAndBind = (ecs: IECSSceneService, assets: RuntimeAssets, entityId: number, comp: string, field: string, uuid: string): void => {
      const ref = `${UUID_PREFIX}${uuid}`;
      assets.loadTexture(ref).then((result) => {
        if (!ecs.hasComponent(entityId, comp)) return;
        ecs.setProperty(entityId, comp, field, result.handle);
        if (comp === 'Sprite' && field === 'texture') {
          const sx = Number(ecs.getProperty(entityId, 'Sprite', 'size.x'));
          const sy = Number(ecs.getProperty(entityId, 'Sprite', 'size.y'));
          if (Number.isFinite(sx) && Number.isFinite(sy) && sx === 1 && sy === 1 && result.width > 0 && result.height > 0) {
            ecs.setProperty(entityId, 'Sprite', 'size.x', result.width);
            ecs.setProperty(entityId, 'Sprite', 'size.y', result.height);
          }
        }
        ecs.requestRender();
      }).catch((err: unknown) => {
        warn(`loadTexture ${ref}`, err);
      });
    };

    const bindAllTextures = (ecs: IECSSceneService, assets: RuntimeAssets, filterUuid?: string): void => {
      const visit = (entityId: number): void => {
        for (const comp of ecs.getComponents(entityId)) {
          for (const f of ecs.getComponentSchema(comp)) {
            if (f.type !== 'asset') continue;
            const ref = ecs.getEntityMetadata(entityId, `${ASSET_METADATA_PREFIX}${comp}.${f.key}`);
            if (typeof ref !== 'string' || ref === '') continue;
            if (filterUuid !== undefined && ref !== filterUuid) continue;
            loadAndBind(ecs, assets, entityId, comp, f.key, ref);
          }
        }
        for (const child of ecs.getChildren(entityId)) visit(child);
      };
      for (const root of ecs.getRootEntities()) visit(root);
    };

    const clearTexturesForUuid = (ecs: IECSSceneService, uuid: string): void => {
      const visit = (entityId: number): void => {
        for (const comp of ecs.getComponents(entityId)) {
          for (const f of ecs.getComponentSchema(comp)) {
            if (f.type !== 'asset') continue;
            const ref = ecs.getEntityMetadata(entityId, `${ASSET_METADATA_PREFIX}${comp}.${f.key}`);
            if (ref === uuid) ecs.setProperty(entityId, comp, f.key, INVALID_TEXTURE_HANDLE);
          }
        }
        for (const child of ecs.getChildren(entityId)) visit(child);
      };
      for (const root of ecs.getRootEntities()) visit(root);
    };

    const bind = (runtime: IRuntimeApp): void => {
      const AssetsDef = runtime.sdk['Assets'];
      const app = runtime.instance as RuntimeApp;
      if (!AssetsDef || !app.hasResource(AssetsDef)) return;

      const assets = app.getResource(AssetsDef);
      assets.setAssetRefResolver((ref) => {
        if (!ref.startsWith(UUID_PREFIX)) return ref;
        const uuid = ref.slice(UUID_PREFIX.length);
        const entry = catalog.getByUuid(uuid);
        return entry ? entry.relativePath : null;
      });
      // Explicit authority survives HttpBackend's trailing-slash strip; without
      // it `project-asset:///` collapses and fetches a malformed URL.
      assets.baseUrl = 'project-asset://editor';

      assets.setTextureImportSettingsResolver?.((ref) => {
        if (!ref.startsWith(UUID_PREFIX)) return undefined;
        const uuid = ref.slice(UUID_PREFIX.length);
        return catalog.getImporterSettings(uuid).texture;
      });

      if (ecsPresence.current) bindAllTextures(ecsPresence.current, assets);

      const metaSub = ecsPresence.current?.onMetadataChanged(({ entityId, key, value }) => {
        if (!key.startsWith(ASSET_METADATA_PREFIX)) return;
        const ecs = ecsPresence.current;
        if (!ecs) return;
        const fieldPath = key.slice(ASSET_METADATA_PREFIX.length);
        const dot = fieldPath.indexOf('.');
        if (dot <= 0) return;
        const comp = fieldPath.slice(0, dot);
        const field = fieldPath.slice(dot + 1);
        if (typeof value !== 'string' || value === '') {
          if (ecs.hasComponent(entityId, comp)) {
            ecs.setProperty(entityId, comp, field, INVALID_TEXTURE_HANDLE);
          }
          return;
        }
        loadAndBind(ecs, assets, entityId, comp, field, value);
      });

      const importerSub = catalog.onDidChangeImporter(({ uuid }) => {
        const ecs = ecsPresence.current;
        assets.invalidate(`${UUID_PREFIX}${uuid}`);
        if (ecs) bindAllTextures(ecs, assets, uuid);
      });

      const sub = catalog.onDidChange((change) => {
        const ecs = ecsPresence.current;
        switch (change.kind) {
          case 'added':
            if (ecs) bindAllTextures(ecs, assets, change.asset.uuid);
            break;
          case 'removed':
            assets.invalidate(`${UUID_PREFIX}${change.uuid}`);
            if (ecs) clearTexturesForUuid(ecs, change.uuid);
            break;
          case 'modified':
            assets.invalidate(`${UUID_PREFIX}${change.asset.uuid}`);
            if (ecs) bindAllTextures(ecs, assets, change.asset.uuid);
            break;
        }
      });

      bound = { assets, sub, metaSub, importerSub };
    };

    const unbind = (): void => {
      if (!bound) return;
      bound.sub.dispose();
      bound.metaSub?.dispose();
      bound.importerSub.dispose();
      bound = undefined;
    };

    if (runtimePresence.current) bind(runtimePresence.current);
    ctx.subscriptions.add(runtimePresence.onDidBind(bind));
    ctx.subscriptions.add(runtimePresence.onDidUnbind(unbind));
    ctx.subscriptions.add({ dispose: unbind });
  },
};

function stringifyErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try { return JSON.stringify(err); } catch { return 'unknown error'; }
}
