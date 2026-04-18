import { Emitter } from '@editrix/common';
import type { SceneData } from '@editrix/estella';
import { IEstellaService } from '@editrix/estella';
import type { IPlugin, IPluginContext } from '@editrix/shell';
import { ISelectionService } from '@editrix/shell';
import {
  IECSScenePresence,
  IPlayModeService,
  ISharedRenderContext,
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

    let mode: PlayMode = 'edit';
    let snapshot: SceneData | undefined;
    let rafHandle: number | undefined;
    let app: EstellaApp | undefined;
    let lastTickMs: number | undefined;

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

        const tickPromise = app ? app.tick(dt) : Promise.resolve();
        tickPromise
          .catch((err: unknown) => {
            console.warn('[play-mode] app.tick threw — pausing play:', err);
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
      onDidChangeMode: onDidChangeMode.event,

      play(): void {
        const ecs = presence.current;
        if (!ecs) return;
        if (mode === 'playing') return;
        if (mode === 'edit') {
          snapshot = ecs.serialize();

          if (!app) {
            const sdk = estella.sdk;
            const wasmModule = estella.module;
            if (sdk && wasmModule) {
              try {
                const handle = ecs.getCppHandle();
                const created = typeof sdk['createWebApp'] === 'function'
                  ? (sdk['createWebApp'] as (m: unknown) => EstellaApp)(wasmModule)
                  : new (sdk['App'] as { new(): EstellaApp })();
                created.connectCpp(handle.registry, handle.module);
                app = created;
              } catch (err) {
                console.warn('[play-mode] Failed to construct runtime App — play will render-only:', err);
              }
            } else if (!sdk) {
              void estella.loadSDK().catch((err: unknown) => {
                console.warn('[play-mode] loadSDK failed:', err);
              });
              console.warn('[play-mode] Runtime SDK not loaded yet; play will render-only until SDK is ready.');
            }
          } else if (app.setPaused) {
            app.setPaused(false);
          }
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
        if (app) {
          try { app.disconnectCpp?.(); } catch (err) {
            console.warn('[play-mode] disconnectCpp threw:', err);
          }
          app = undefined;
        }
        const ecs = presence.current;
        if (ecs && snapshot) {
          // Entity ids change on deserialize; stale selection would point
          // at the wrong entity.
          selection.clearSelection();
          ecs.deserialize(snapshot);
        }
        snapshot = undefined;
        transition('edit');
        renderContextSvc.context.requestRender();
      },
    };

    ctx.subscriptions.add(ctx.services.register(IPlayModeService, service));

    ctx.subscriptions.add({
      dispose(): void {
        if (mode !== 'edit') {
          stopLoop();
          if (app) {
            try { app.disconnectCpp?.(); } catch { /* empty */ }
            app = undefined;
          }
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
