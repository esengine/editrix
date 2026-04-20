import { Emitter } from '@editrix/common';
import type { IECSSceneService } from '@editrix/estella';
import { IEstellaService } from '@editrix/estella';
import { IConsoleService } from '@editrix/plugin-console';
import type { SceneData } from '@editrix/scene';
import type { IPlugin, IPluginContext } from '@editrix/shell';
import { ISelectionService } from '@editrix/shell';
import {
  IECSScenePresence,
  IPlayModeService,
  IRuntimeAppPresence,
  ISharedRenderContext,
  type IRuntimeApp,
  type IRuntimeAppPresence as IRuntimeAppPresenceShape,
  type PlayMode,
  type PlayModeChangeEvent,
} from '../services.js';

interface EstellaApp {
  connectCpp: (registry: unknown, module: unknown) => unknown;
  disconnectCpp?: () => void;
  tick: (delta: number) => Promise<void>;
  setPaused?: (paused: boolean) => void;
  addPlugin?: (plugin: unknown) => unknown;
  addSystemToSchedule?: (
    schedule: number,
    system: unknown,
    options?: { runIf?: () => boolean; runBefore?: string[]; runAfter?: string[] },
  ) => unknown;
}

// Per-entity metadata flag the demo system honours. Authored on the seeded
// Test Shape so the default project visibly animates on Play; survives scene
// round-trip via SerializedEntity.metadata.
const DEMO_ORBIT_METADATA_KEY = 'debug:autoSpin';

export const PlayModePlugin: IPlugin = {
  descriptor: {
    id: 'app.play-mode',
    version: '1.0.0',
    dependencies: ['app.ecs-scene', 'app.render-context'],
  },
  activate(ctx: IPluginContext) {
    const presence = ctx.services.get(IECSScenePresence);
    const renderContextSvc = ctx.services.get(ISharedRenderContext);
    const selection = ctx.services.get(ISelectionService);
    const estella = ctx.services.get(IEstellaService);

    const onDidChangeMode = new Emitter<PlayModeChangeEvent>();
    ctx.subscriptions.add(onDidChangeMode);
    const onDidBindApp = new Emitter<IRuntimeApp>();
    const onDidUnbindApp = new Emitter<void>();
    ctx.subscriptions.add(onDidBindApp);
    ctx.subscriptions.add(onDidUnbindApp);

    let mode: PlayMode = 'edit';
    let snapshot: SceneData | undefined;
    let rafHandle: number | undefined;
    let app: EstellaApp | undefined;
    let runtimeApp: IRuntimeApp | undefined;
    let lastTickMs: number | undefined;
    let frameCount = 0;
    let avgDtMs = 0;
    let setEnginePlayMode: ((active: boolean) => void) | undefined;
    let resetDemoOrbitState: (() => void) | undefined;

    const runtimePresence: IRuntimeAppPresenceShape = {
      get current() {
        return runtimeApp;
      },
      onDidBind: onDidBindApp.event,
      onDidUnbind: onDidUnbindApp.event,
    };
    ctx.subscriptions.add(ctx.services.register(IRuntimeAppPresence, runtimePresence));

    const stringifyErr = (err: unknown): string => {
      if (err instanceof Error) return err.message;
      if (typeof err === 'string') return err;
      try {
        return JSON.stringify(err);
      } catch {
        return 'unknown error';
      }
    };
    const warn = (msg: string, err?: unknown): void => {
      const text = err !== undefined ? `${msg}: ${stringifyErr(err)}` : msg;
      try {
        ctx.services.get(IConsoleService).log('warn', text, 'play-mode');
      } catch {
        // IConsoleService is registered by ProjectPanelsPlugin and may not be
        // available during early activation paths. Fall through to console.
        // eslint-disable-next-line no-console -- fallback only
        console.warn(`[play-mode] ${text}`);
      }
    };

    const transition = (next: PlayMode): void => {
      if (mode === next) return;
      const previous = mode;
      mode = next;
      onDidChangeMode.fire({ previous, current: next });
    };

    // Set when a tick throws — `play()` / `resume()` force a `stop()`
    // first so the next session restores from snapshot instead of
    // ticking a broken app that's guaranteed to fail again.
    let tickFailed = false;

    const startLoop = (): void => {
      if (rafHandle !== undefined) return;
      lastTickMs = undefined;
      const frame = (nowMs: number): void => {
        if (mode !== 'playing') {
          rafHandle = undefined;
          return;
        }
        const dt = lastTickMs === undefined ? 1 / 60 : Math.min(0.1, (nowMs - lastTickMs) / 1000);
        lastTickMs = nowMs;
        frameCount++;
        avgDtMs = avgDtMs === 0 ? dt * 1000 : avgDtMs * 0.9 + dt * 100;

        const tickPromise = app ? app.tick(dt) : Promise.resolve();
        tickPromise
          .catch((err: unknown) => {
            warn('app.tick threw — pausing play', err);
            tickFailed = true;
            stopLoop();
            transition('paused');
          })
          .finally(() => {
            renderContextSvc.context.requestRender();
          });

        rafHandle = requestAnimationFrame(frame);
      };
      rafHandle = requestAnimationFrame(frame);
    };

    const stopLoop = (): void => {
      if (rafHandle !== undefined) {
        cancelAnimationFrame(rafHandle);
        rafHandle = undefined;
      }
    };

    const service: IPlayModeService = {
      get mode(): PlayMode {
        return mode;
      },
      get isInPlay(): boolean {
        return mode !== 'edit';
      },
      get frameStats(): { frame: number; avgDtMs: number } {
        return { frame: frameCount, avgDtMs };
      },
      onDidChangeMode: onDidChangeMode.event,

      play(): void {
        const ecs = presence.current;
        if (!ecs) return;
        if (mode === 'playing') return;
        // If the previous session threw inside tick, the app is in an
        // unknown state — force a full stop (snapshot restore) before
        // the new session starts so we're not resuming a broken app.
        if (tickFailed) {
          this.stop();
          tickFailed = false;
        }
        if (mode === 'edit') {
          snapshot = ecs.serialize();
          if (app?.setPaused) app.setPaused(false);
          if (!app)
            warn('Play started before runtime App was ready — will be render-only this session.');
          // Fresh entity ids after the snapshot is taken — drop any stale
          // demo-orbit baselines so the next session captures from current.
          resetDemoOrbitState?.();
        }
        setEnginePlayMode?.(true);
        transition('playing');
        startLoop();
      },

      pause(): void {
        if (mode !== 'playing') return;
        stopLoop();
        try {
          app?.setPaused?.(true);
        } catch {
          /* empty */
        }
        setEnginePlayMode?.(false);
        transition('paused');
      },

      resume(): void {
        if (mode !== 'paused') return;
        // Same guard as play(): a tick-throw during playing leaves the
        // app state indeterminate; snapshot-restore is the only safe
        // path back.
        if (tickFailed) {
          this.stop();
          tickFailed = false;
          return;
        }
        try {
          app?.setPaused?.(false);
        } catch {
          /* empty */
        }
        setEnginePlayMode?.(true);
        transition('playing');
        startLoop();
      },

      step(): void {
        if (mode !== 'paused') return;
        renderContextSvc.context.requestRender();
      },

      stop(): void {
        if (mode === 'edit') return;
        stopLoop();
        // Keep the App alive across play/stop — the resolver and bound texture
        // handles stay valid for edit mode. Just pause ticking.
        try {
          app?.setPaused?.(true);
        } catch (err) {
          warn('setPaused threw', err);
        }
        setEnginePlayMode?.(false);
        const ecs = presence.current;
        if (ecs && snapshot) {
          // Entity ids change on deserialize; stale selection would point
          // at the wrong entity.
          selection.clearSelection();
          ecs.deserialize(snapshot);
        }
        // Drop demo-orbit baselines keyed by the now-destroyed entity ids.
        resetDemoOrbitState?.();
        snapshot = undefined;
        frameCount = 0;
        avgDtMs = 0;
        lastTickMs = undefined;
        transition('edit');
        renderContextSvc.context.requestRender();
      },
    };

    ctx.subscriptions.add(ctx.services.register(IPlayModeService, service));

    // App construction runs eagerly (on SDK + ECS ready) so the Assets
    // pipeline is live in edit mode, not just during Play.
    const tryCreateApp = (): void => {
      if (app) return;
      const ecs = presence.current;
      const sdk = estella.sdk;
      const wasmModule = estella.module;
      if (!ecs || !sdk || !wasmModule) return;
      try {
        const handle = ecs.getCppHandle();
        const sdkRec = sdk as unknown as Record<string, unknown>;
        const factory = sdkRec['createWebApp'];
        const created =
          typeof factory === 'function'
            ? (factory as (m: unknown) => EstellaApp)(wasmModule)
            : new (sdkRec['App'] as new () => EstellaApp)();
        created.connectCpp(handle.registry, handle.module);
        created.setPaused?.(true);
        app = created;
        runtimeApp = { instance: created, sdk: sdkRec };

        // Engine-mode flags: editorMode permanently true; playMode toggles
        // with our PlayMode transitions. AnimationPlugin + similar systems
        // gate on `playModeOnly` so without these toggles nothing animates.
        const setEditorModeFn = sdkRec['setEditorMode'];
        if (typeof setEditorModeFn === 'function') {
          (setEditorModeFn as (b: boolean) => void)(true);
        }
        const setPlayModeFn = sdkRec['setPlayMode'];
        if (typeof setPlayModeFn === 'function') {
          setEnginePlayMode = setPlayModeFn as (b: boolean) => void;
          setEnginePlayMode(false);
        }

        installDemoOrbitSystem(created, sdkRec, ecs, warn, (reset) => {
          resetDemoOrbitState = reset;
        });

        onDidBindApp.fire(runtimeApp);
      } catch (err) {
        warn('Failed to construct runtime App — textures will not load', err);
      }
    };

    ctx.subscriptions.add(
      presence.onDidBind(() => {
        tryCreateApp();
      }),
    );

    // loadSDK rejects if loadCore hasn't run — renderer.ts fires it after
    // createEditor, so at activate we must defer.
    const kickLoadSDK = (): void => {
      estella
        .loadSDK()
        .then(() => {
          tryCreateApp();
        })
        .catch((err: unknown) => {
          warn('loadSDK failed', err);
        });
    };
    if (estella.isReady) {
      kickLoadSDK();
    } else {
      ctx.subscriptions.add(
        estella.onReady(() => {
          tryCreateApp();
          kickLoadSDK();
        }),
      );
    }
    tryCreateApp();

    ctx.subscriptions.add({
      dispose(): void {
        stopLoop();
        setEnginePlayMode?.(false);
        if (app) {
          if (runtimeApp) {
            onDidUnbindApp.fire();
            runtimeApp = undefined;
          }
          try {
            app.disconnectCpp?.();
          } catch {
            /* empty */
          }
          app = undefined;
        }
        if (mode !== 'edit') {
          const ecs = presence.current;
          if (ecs && snapshot) {
            try {
              ecs.deserialize(snapshot);
            } catch {
              /* empty */
            }
          }
          snapshot = undefined;
        }
      },
    });
  },
};

// Tiny JS system that orbits any entity flagged with editor metadata
// `debug:autoSpin`. The seeded Test Shape is flagged so the default scene
// visibly animates on Play; user-created entities are untouched. Position
// baseline is captured the first frame the entity is seen, then the position
// is driven relative to that baseline so user-set positions are preserved.
interface DemoOrbitDeps {
  defineSystem: (
    params: unknown[],
    fn: (...args: unknown[]) => void,
    opts?: { name?: string },
  ) => unknown;
  Schedule: { Update: number };
  playModeOnly: () => boolean;
  Res: (resource: unknown) => unknown;
  GetWorld: () => unknown;
  Time: unknown;
  Transform: unknown;
}

function readDemoOrbitDeps(sdkRec: Record<string, unknown>): DemoOrbitDeps | undefined {
  const defineSystem = sdkRec['defineSystem'];
  const Schedule = sdkRec['Schedule'];
  const playModeOnly = sdkRec['playModeOnly'];
  const Res = sdkRec['Res'];
  const GetWorld = sdkRec['GetWorld'];
  const Time = sdkRec['Time'];
  const Transform = sdkRec['Transform'];
  if (
    typeof defineSystem !== 'function' ||
    typeof Schedule !== 'object' ||
    Schedule === null ||
    typeof playModeOnly !== 'function' ||
    typeof Res !== 'function' ||
    typeof GetWorld !== 'function' ||
    Time === undefined ||
    Transform === undefined
  )
    return undefined;
  const sched = Schedule as { Update?: number };
  if (typeof sched.Update !== 'number') return undefined;
  return {
    defineSystem: defineSystem as DemoOrbitDeps['defineSystem'],
    Schedule: { Update: sched.Update },
    playModeOnly: playModeOnly as () => boolean,
    Res: Res as (r: unknown) => unknown,
    GetWorld: GetWorld as () => unknown,
    Time,
    Transform,
  };
}

function installDemoOrbitSystem(
  app: EstellaApp,
  sdkRec: Record<string, unknown>,
  ecs: IECSSceneService,
  warn: (msg: string, err?: unknown) => void,
  registerReset: (reset: () => void) => void,
): void {
  if (typeof app.addSystemToSchedule !== 'function') return;
  const deps = readDemoOrbitDeps(sdkRec);
  if (!deps) {
    warn('Demo orbit system skipped — SDK missing expected exports.');
    return;
  }

  const baselines = new Map<number, { x: number; y: number; z: number }>();
  registerReset(() => {
    baselines.clear();
  });

  interface WorldLike {
    getEntitiesWithComponents: (defs: unknown[]) => number[];
    get: (entity: number, def: unknown) => unknown;
    insert: (entity: number, def: unknown, data: unknown) => void;
  }
  interface TransformLike {
    position: { x: number; y: number; z: number };
  }
  interface TimeLike {
    elapsed: number;
    delta: number;
  }

  const sysDef = deps.defineSystem(
    [deps.Res(deps.Time), deps.GetWorld()],
    (...args: unknown[]) => {
      const time = args[0] as TimeLike;
      const world = args[1] as WorldLike;
      const entities = world.getEntitiesWithComponents([deps.Transform]);
      if (entities.length === 0) return;
      const RADIUS = 80;
      const SPEED = 1.6;
      for (const entity of entities) {
        if (ecs.getEntityMetadata(entity, DEMO_ORBIT_METADATA_KEY) !== true) continue;
        const transform = world.get(entity, deps.Transform) as TransformLike | undefined;
        if (!transform) continue;
        let baseline = baselines.get(entity);
        if (!baseline) {
          baseline = {
            x: transform.position.x,
            y: transform.position.y,
            z: transform.position.z,
          };
          baselines.set(entity, baseline);
        }
        const angle = time.elapsed * SPEED;
        transform.position.x = baseline.x + Math.cos(angle) * RADIUS;
        transform.position.y = baseline.y + Math.sin(angle) * RADIUS;
        world.insert(entity, deps.Transform, transform);
      }
    },
    { name: 'EditorDemoOrbitSystem' },
  );

  try {
    app.addSystemToSchedule(deps.Schedule.Update, sysDef, { runIf: deps.playModeOnly });
  } catch (err) {
    warn('Failed to install demo orbit system', err);
  }
}
