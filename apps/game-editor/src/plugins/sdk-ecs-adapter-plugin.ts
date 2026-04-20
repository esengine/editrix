/**
 * Adapter plugin: bridges SDK-only components into the editor's ECS
 * service.
 *
 * {@link SdkBridgePlugin} populates {@link IComponentCatalog} with every
 * `defineComponent(...)` registered in the SDK. But the catalog is only
 * metadata — `addComponent` / `getProperty` / `setProperty` etc. need
 * somewhere to actually *store* data for those components. That place is
 * the runtime App's `world`: its ScriptStorage lives as long as the App
 * does (eagerly constructed at edit time per PlayModePlugin), and the
 * WASM entity ids in it are the same ids the editor hands out.
 *
 * This plugin wires the two halves together:
 *
 *   1. On {@link IRuntimeAppPresence.onDidBind}: build an
 *      {@link IEcsSdkAdapter} that reads/writes the App's world, derive
 *      per-component {@link ComponentFieldSchema} from each SDK def, and
 *      install the adapter on {@link IECSSceneService}.
 *   2. On unbind (or disposal): detach.
 *
 * The editor's Inspector / serializer / Add-Component list all go
 * through `IECSSceneService`, which routes SDK-named components through
 * this adapter transparently.
 */

import type { IDisposable } from '@editrix/common';
import type { IEcsSdkAdapter, SdkComponentDef, SdkComponentInfo } from '@editrix/estella';
import { IComponentCatalog, IECSSceneService } from '@editrix/estella';
import type { AssetFieldSubtype, ComponentFieldSchema } from '@editrix/scene';
import { deriveComponentSchema } from '@editrix/scene';
import type { IPlugin, IPluginContext } from '@editrix/shell';
import { IRuntimeAppPresence, type IRuntimeApp } from '../services.js';

// Structural type for the SDK's World — only the methods we use.
interface SdkWorld {
  has(entity: number, def: unknown): boolean;
  get(entity: number, def: unknown): Record<string, unknown>;
  insert(entity: number, def: unknown, data?: Record<string, unknown>): Record<string, unknown>;
  remove(entity: number, def: unknown): boolean;
  getEntitiesWithComponents(defs: readonly unknown[]): readonly number[];
}

interface SdkApp {
  world: SdkWorld;
}

export const SdkEcsAdapterPlugin: IPlugin = {
  descriptor: {
    id: 'app.sdk-ecs-adapter',
    version: '1.0.0',
    dependencies: ['editrix.estella', 'app.sdk-bridge', 'app.ecs-scene', 'app.play-mode'],
  },
  activate(ctx: IPluginContext) {
    const catalog = ctx.services.get(IComponentCatalog);
    const runtimePresence = ctx.services.get(IRuntimeAppPresence);
    const ecs = ctx.services.get(IECSSceneService);

    let current:
      | {
          adapter: IEcsSdkAdapter;
          schemaCache: Map<string, ComponentFieldSchema[]>;
          schemaSub: IDisposable;
        }
      | undefined;

    const attach = (runtime: IRuntimeApp): void => {
      const app = runtime.instance as SdkApp | undefined;
      const world = app?.world;
      if (!world) return;

      const schemaCache = new Map<string, ComponentFieldSchema[]>();
      const rebuildSchemaCache = (): void => {
        schemaCache.clear();
        for (const info of catalog.list()) {
          schemaCache.set(info.name, deriveSdkSchema(info));
        }
      };
      rebuildSchemaCache();
      const schemaSub = catalog.onDidChange(rebuildSchemaCache);

      const adapter: IEcsSdkAdapter = {
        list: () => catalog.list().map((i) => i.name),
        has: (name) => catalog.has(name),
        getSchema: (name) => schemaCache.get(name) ?? [],
        getDefaults: (name) => {
          const info = catalog.get(name);
          return info ? { ...info.defaults } : undefined;
        },

        entityHas: (entityId, name) => {
          const info = catalog.get(name);
          if (!info) return false;
          return world.has(entityId, info.def);
        },

        entityComponents: (entityId) => {
          const out: string[] = [];
          for (const info of catalog.list()) {
            if (world.has(entityId, info.def)) out.push(info.name);
          }
          return out;
        },

        insert: (entityId, name, data) => {
          const info = catalog.get(name);
          if (!info) return false;
          world.insert(entityId, info.def, data);
          return true;
        },

        remove: (entityId, name) => {
          const info = catalog.get(name);
          if (!info) return false;
          if (!world.has(entityId, info.def)) return false;
          world.remove(entityId, info.def);
          return true;
        },

        getData: (entityId, name) => {
          const info = catalog.get(name);
          if (!info) return undefined;
          if (!world.has(entityId, info.def)) return undefined;
          // Return a deep-ish clone so callers can't accidentally poke at
          // the live ScriptStorage ref (which any SDK system might be
          // reading concurrently).
          return cloneShallow(world.get(entityId, info.def));
        },

        setField: (entityId, name, fieldPath, value) => {
          const info = catalog.get(name);
          if (!info) return false;
          if (!world.has(entityId, info.def)) return false;
          const live = world.get(entityId, info.def);
          return writeNestedField(live, fieldPath, value);
        },

        cleanupEntity: (entityId) => {
          // Iterate our known SDK components rather than calling
          // world.despawn — despawn also blows away the WASM entity,
          // which the caller (ECSSceneService.destroyEntity) handles
          // separately. We only own the SDK storage.
          for (const info of catalog.list()) {
            if (world.has(entityId, info.def)) {
              world.remove(entityId, info.def);
            }
          }
        },
      };

      ecs.attachSdkAdapter(adapter);
      current = { adapter, schemaCache, schemaSub };
    };

    const detach = (): void => {
      if (!current) return;
      ecs.attachSdkAdapter(undefined);
      current.schemaSub.dispose();
      current = undefined;
    };

    if (runtimePresence.current) attach(runtimePresence.current);
    ctx.subscriptions.add(runtimePresence.onDidBind(attach));
    ctx.subscriptions.add(runtimePresence.onDidUnbind(detach));
    ctx.subscriptions.add({ dispose: detach });
  },
};

/**
 * Turn an {@link SdkComponentInfo} into a {@link ComponentFieldSchema}
 * array that matches what the Inspector renders from WASM schemas. We
 * reuse the package's existing `deriveComponentSchema` helper, wrapping
 * the SDK def's `assetFields` + `entityFields` into the `ComponentMeta`
 * shape it expects.
 */
function deriveSdkSchema(info: SdkComponentInfo): ComponentFieldSchema[] {
  const def = info.def;
  // deriveComponentSchema's assetFields option takes `readonly string[]`.
  // We also have the asset subtype per field on def.assetFields; patch it
  // onto each schema entry afterwards so the Inspector picker can filter.
  const assetSubtypes = new Map<string, string>();
  for (const { field, type } of def.assetFields) {
    assetSubtypes.set(field, type);
  }

  const schema = deriveComponentSchema(info.name, {
    defaults: info.defaults,
    assetFields: def.assetFields.map((a) => a.field),
    entityFields: def.entityFields,
    colorKeys: def.colorKeys,
    animatableFields: def.animatableFields,
  });

  return schema.map((f) => {
    const subtype = assetSubtypes.get(f.key);
    return subtype ? { ...f, assetType: subtype as AssetFieldSubtype } : f;
  });
}

/** Shallow clone with one level of nested object cloning (for vec/color leaves). */
function cloneShallow(src: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = { ...(v as Record<string, unknown>) };
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Write a value at a dot-path inside a component data record. Returns
 * true if the write took place; false if the path traversed a non-object
 * or the final key's type is obviously incompatible. We don't coerce —
 * callers pass the value the Inspector produced, which already matches
 * the schema's leaf type.
 */
function writeNestedField(
  data: Record<string, unknown>,
  fieldPath: string,
  value: unknown,
): boolean {
  if (!fieldPath) return false;
  if (!fieldPath.includes('.')) {
    data[fieldPath] = value;
    return true;
  }
  const parts = fieldPath.split('.');
  let cursor: Record<string, unknown> = data;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (part === undefined) return false;
    const next = cursor[part];
    if (next === null || typeof next !== 'object' || Array.isArray(next)) return false;
    cursor = next as Record<string, unknown>;
  }
  const leaf = parts[parts.length - 1];
  if (leaf === undefined) return false;
  cursor[leaf] = value;
  return true;
}

export type { SdkComponentDef };
