import { Emitter } from '@editrix/common';
import type { SceneData } from '@editrix/estella';
import { IEstellaService } from '@editrix/estella';
import { IConsoleService } from '@editrix/plugin-console';
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
}

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

    const runtimePresence: IRuntimeAppPresenceShape = {
      get current() { return runtimeApp; },
      onDidBind: onDidBindApp.event,
      onDidUnbind: onDidUnbindApp.event,
    };
    ctx.subscriptions.add(ctx.services.register(IRuntimeAppPresence, runtimePresence));

    const stringifyErr = (err: unknown): string => {
      if (err instanceof Error) return err.message;
      if (typeof err === 'string') return err;
      try { return JSON.stringify(err); } catch { return 'unknown error'; }
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
        if (mode === 'edit') {
          snapshot = ecs.serialize();
          if (app?.setPaused) app.setPaused(false);
          if (!app) warn('Play started before runtime App was ready — will be render-only this session.');
        }
        transition('playing');
        startLoop();
      },

      pause(): void {
        if (mode !== 'playing') return;
        stopLoop();
        try { app?.setPaused?.(true); } catch { /* empty */ }
        transition('paused');
      },

      resume(): void {
        if (mode !== 'paused') return;
        try { app?.setPaused?.(false); } catch { /* empty */ }
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
        try { app?.setPaused?.(true); } catch (err) { warn('setPaused threw', err); }
        const ecs = presence.current;
        if (ecs && snapshot) {
          // Entity ids change on deserialize; stale selection would point
          // at the wrong entity.
          selection.clearSelection();
          ecs.deserialize(snapshot);
        }
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
        const created = typeof factory === 'function'
          ? (factory as (m: unknown) => EstellaApp)(wasmModule)
          : new (sdkRec['App'] as new () => EstellaApp)();
        created.connectCpp(handle.registry, handle.module);
        created.setPaused?.(true);
        app = created;
        runtimeApp = { instance: created, sdk: sdkRec };
        onDidBindApp.fire(runtimeApp);
      } catch (err) {
        warn('Failed to construct runtime App — textures will not load', err);
      }
    };

    ctx.subscriptions.add(presence.onDidBind(() => { tryCreateApp(); }));

    // loadSDK rejects if loadCore hasn't run — renderer.ts fires it after
    // createEditor, so at activate we must defer.
    const kickLoadSDK = (): void => {
      estella.loadSDK()
        .then(() => { tryCreateApp(); })
        .catch((err: unknown) => { warn('loadSDK failed', err); });
    };
    if (estella.isReady) {
      kickLoadSDK();
    } else {
      ctx.subscriptions.add(estella.onReady(() => { tryCreateApp(); kickLoadSDK(); }));
    }
    tryCreateApp();

    ctx.subscriptions.add({
      dispose(): void {
        stopLoop();
        if (app) {
          if (runtimeApp) {
            onDidUnbindApp.fire();
            runtimeApp = undefined;
          }
          try { app.disconnectCpp?.(); } catch { /* empty */ }
          app = undefined;
        }
        if (mode !== 'edit') {
          const ecs = presence.current;
          if (ecs && snapshot) {
            try { ecs.deserialize(snapshot); } catch { /* empty */ }
          }
          snapshot = undefined;
        }
      },
    });
  },
};
