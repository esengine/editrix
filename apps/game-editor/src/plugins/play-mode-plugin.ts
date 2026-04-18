import { Emitter } from '@editrix/common';
import type { SceneData } from '@editrix/estella';
import type { IPlugin, IPluginContext } from '@editrix/shell';
import { ISelectionService } from '@editrix/shell';
import {
  IECSScenePresence,
  IPlayModeService,
  ISharedRenderContext,
  type PlayMode,
  type PlayModeChangeEvent,
} from '../services.js';

/**
 * Owns the editor's play-mode lifecycle.
 *
 * State machine:
 *
 *   edit ──play()──▶ playing ──pause()──▶ paused
 *                       ▲                    │
 *                       └────resume()────────┘
 *
 *   any state ──stop()──▶ edit  (restores snapshot)
 *
 * Snapshot semantics: on the edit→playing transition we serialize the ECS
 * scene; on stop() we destroy the live scene and re-deserialize from the
 * snapshot so the authored data is unchanged. Selection is dropped because
 * entity numeric ids are reassigned during deserialize.
 *
 * Render loop: while playing, requestAnimationFrame fires renderContext.
 * requestRender every frame. Pausing cancels the loop; stepping renders one
 * frame on demand.
 */
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

    const onDidChangeMode = new Emitter<PlayModeChangeEvent>();
    ctx.subscriptions.add(onDidChangeMode);

    let mode: PlayMode = 'edit';
    let snapshot: SceneData | undefined;
    let rafHandle: number | undefined;

    const transition = (next: PlayMode): void => {
      if (mode === next) return;
      const previous = mode;
      mode = next;
      onDidChangeMode.fire({ previous, current: next });
    };

    const startLoop = (): void => {
      if (rafHandle !== undefined) return;
      const tick = (): void => {
        if (mode !== 'playing') {
          rafHandle = undefined;
          return;
        }
        renderContextSvc.context.requestRender();
        rafHandle = requestAnimationFrame(tick);
      };
      rafHandle = requestAnimationFrame(tick);
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
          // First time entering play this session — capture the authored state.
          snapshot = ecs.serialize();
        }
        transition('playing');
        startLoop();
      },

      pause(): void {
        if (mode !== 'playing') return;
        stopLoop();
        transition('paused');
      },

      resume(): void {
        if (mode !== 'paused') return;
        transition('playing');
        startLoop();
      },

      step(): void {
        if (mode !== 'paused') return;
        // One synthetic frame so the user can advance manually. Real
        // simulation tick will hook in here once a runtime App is wired.
        renderContextSvc.context.requestRender();
      },

      stop(): void {
        if (mode === 'edit') return;
        stopLoop();
        const ecs = presence.current;
        if (ecs && snapshot) {
          // Selection stores entity ids by number — those ids change on
          // deserialize, so any stale selection would point at the wrong
          // entity (or none). Clearing is the only safe move.
          selection.clearSelection();
          ecs.deserialize(snapshot);
        }
        snapshot = undefined;
        transition('edit');
        // Force one render so the restored scene paints before the next user
        // interaction (RAF loop is no longer running).
        renderContextSvc.context.requestRender();
      },
    };

    ctx.subscriptions.add(ctx.services.register(IPlayModeService, service));

    // If the plugin is disposed while playing (editor shutting down), make
    // sure we don't leave a dangling RAF handle and that the snapshot is
    // restored so the next session starts with the authored state.
    ctx.subscriptions.add({
      dispose(): void {
        if (mode !== 'edit') {
          stopLoop();
          const ecs = presence.current;
          if (ecs && snapshot) {
            try { ecs.deserialize(snapshot); } catch { /* shutting down */ }
          }
          snapshot = undefined;
        }
      },
    });
  },
};
