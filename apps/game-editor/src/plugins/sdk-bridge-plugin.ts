/**
 * SDK component bridge plugin.
 *
 * The estella SDK registers a pool of TypeScript-only components via
 * `defineComponent(...)` — SpriteAnimator, ScrollView, UIRect, Image,
 * Text, Focusable, and friends. Without this plugin the editor is blind
 * to all of them: Add-Component never lists them, scene save/load drops
 * them, the Inspector never shows their fields.
 *
 * This plugin fills in the gap by:
 *
 *   1. Waiting for the SDK bundle to finish loading (`loadSDK()` resolves
 *      after every top-level `defineComponent` has run).
 *   2. Walking the SDK's component registry and mirroring each non-builtin
 *      entry into {@link IComponentCatalog} (the "replay").
 *   3. Installing an `EditorBridge` on the SDK's `AppContext` so future
 *      `defineComponent` calls (e.g. from user plugins loaded via the
 *      plugin scanner) land in the catalog too.
 *
 * Activates with a low-level dependency on `editrix.estella` only —
 * ECSSceneService doesn't exist yet at this point but doesn't need to.
 * The catalog we register is consumed lazily by later plugins.
 */

import {
  ComponentCatalog,
  IComponentCatalog,
  IEstellaService,
  type SdkComponentDef,
} from '@editrix/estella';
import { IConsoleService } from '@editrix/plugin-console';
import type { IPlugin, IPluginContext } from '@editrix/shell';

interface SdkContext {
  editorBridge: EditorBridgeShape | null;
}

interface EditorBridgeShape {
  registerComponent(name: string, defaults: Record<string, unknown>, isTag: boolean): void;
}

type GetDefaultContext = () => SdkContext;
type GetAllRegisteredComponents = () => Map<string, SdkComponentDef>;
type GetComponent = (name: string) => SdkComponentDef | undefined;
type IsBuiltinComponent = (def: SdkComponentDef) => boolean;

/**
 * Narrow the loosely-typed SDK module record into the handful of
 * symbols we need. Returns undefined if the SDK build is missing any;
 * the plugin degrades gracefully (no catalog entries) rather than
 * throwing.
 */
function readBridgeEntryPoints(sdk: Record<string, unknown>):
  | {
      getDefaultContext: GetDefaultContext;
      getAllRegistered: GetAllRegisteredComponents;
      getComponent: GetComponent;
      isBuiltin: IsBuiltinComponent;
    }
  | undefined {
  const getDefaultContext = sdk['getDefaultContext'];
  const getAllRegistered = sdk['getAllRegisteredComponents'];
  const getComponent = sdk['getComponent'];
  const isBuiltin = sdk['isBuiltinComponent'];
  if (
    typeof getDefaultContext !== 'function' ||
    typeof getAllRegistered !== 'function' ||
    typeof getComponent !== 'function' ||
    typeof isBuiltin !== 'function'
  )
    return undefined;
  return {
    getDefaultContext: getDefaultContext as GetDefaultContext,
    getAllRegistered: getAllRegistered as GetAllRegisteredComponents,
    getComponent: getComponent as GetComponent,
    isBuiltin: isBuiltin as IsBuiltinComponent,
  };
}

export const SdkBridgePlugin: IPlugin = {
  descriptor: {
    id: 'app.sdk-bridge',
    version: '1.0.0',
    dependencies: ['editrix.estella'],
  },
  activate(ctx: IPluginContext) {
    const estella = ctx.services.get(IEstellaService);

    const catalog = new ComponentCatalog();
    ctx.subscriptions.add(catalog);
    ctx.subscriptions.add(ctx.services.register(IComponentCatalog, catalog));

    const warn = (msg: string, err?: unknown): void => {
      const text = err !== undefined ? `${msg}: ${stringifyErr(err)}` : msg;
      try {
        ctx.services.get(IConsoleService).log('warn', text, 'sdk-bridge');
      } catch {
        // IConsoleService isn't registered until ProjectPanelsPlugin —
        // bridge runs earlier in the dep graph, so fall through.
        // eslint-disable-next-line no-console -- fallback only
        console.warn(`[sdk-bridge] ${text}`);
      }
    };

    const installBridge = (sdk: Record<string, unknown>): void => {
      const entry = readBridgeEntryPoints(sdk);
      if (!entry) {
        warn('SDK is missing bridge entry points; SDK-only components will be invisible');
        return;
      }

      const context = entry.getDefaultContext();

      // Replay: every SDK module that's already loaded has run its
      // top-level defineComponent calls. Walk the live registry so the
      // catalog starts already populated.
      for (const [name, def] of entry.getAllRegistered()) {
        if (entry.isBuiltin(def)) continue;
        catalog.register({
          name,
          def,
          defaults: snapshotDefaults(def),
          isTag: Object.keys(def._default).length === 0,
        });
      }

      // Live: future defineComponent calls (user plugins, lazy SDK
      // imports) flow through this bridge. The SDK calls
      // `editorBridge.registerComponent(name, defaults, isTag)` AFTER
      // it's already put the def in the global registry, so
      // `getComponent(name)` here returns the full def.
      context.editorBridge = {
        registerComponent: (
          name: string,
          _defaults: Record<string, unknown>,
          isTag: boolean,
        ): void => {
          const def = entry.getComponent(name);
          if (!def || entry.isBuiltin(def)) return;
          catalog.register({
            name,
            def,
            defaults: snapshotDefaults(def),
            isTag,
          });
        },
      };

      ctx.subscriptions.add({
        dispose(): void {
          if (context.editorBridge) context.editorBridge = null;
          catalog.clear();
        },
      });
    };

    if (estella.sdk) {
      installBridge(estella.sdk as unknown as Record<string, unknown>);
    } else {
      // loadSDK is also kicked by PlayModePlugin + renderer.ts. It's
      // idempotent — multiple callers share the same underlying promise.
      estella
        .loadSDK()
        .then((sdk) => {
          installBridge(sdk as unknown as Record<string, unknown>);
        })
        .catch((err: unknown) => {
          warn('loadSDK failed — SDK components unavailable', err);
        });
    }
  },
};

function snapshotDefaults(def: SdkComponentDef): Readonly<Record<string, unknown>> {
  // Shallow clone so later mutations of def._default (unlikely but
  // possible in user code) don't retroactively change the catalog view.
  return Object.freeze({ ...def._default });
}

function stringifyErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return 'unknown error';
  }
}
