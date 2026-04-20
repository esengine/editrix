import type { Event, IDisposable } from '@editrix/common';
import { createServiceId, Emitter } from '@editrix/common';

// Core's tsconfig uses only the ES2022 lib so framework code stays
// free of DOM globals. AbortController / AbortSignal exist at runtime
// on every supported target (Node ≥ 16, all browsers), but TS needs
// the DOM or Node lib to see their types. Declare just the surface we
// use so consumers can import a stable `AbortSignal` name without the
// core package taking on DOM/Node typings.
export interface AbortSignal {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void): void;
}
interface AbortControllerLike {
  readonly signal: AbortSignal;
  abort(): void;
}
declare const AbortController: { new (): AbortControllerLike };

/**
 * Options passed to {@link IProgressService.withProgress}.
 */
export interface ProgressOptions {
  /** Short label shown next to the spinner — e.g. "Importing assets". */
  readonly title: string;
  /**
   * When `true`, the UI surfaces a Cancel affordance. The task callback
   * receives an AbortSignal that fires when the user clicks cancel.
   * Tasks that don't honour cancellation should leave this undefined.
   */
  readonly cancellable?: boolean;
}

/**
 * Incremental update a task can emit.
 *
 * `increment` is *additive* — each call adds to the running percent
 * total. A task that knows its total upfront should add the per-step
 * fraction; one that doesn't can omit increment and rely on `message`
 * alone.
 */
export interface ProgressUpdate {
  readonly message?: string;
  /** Percent to add to the running total. Clamped to [0, 100 - current]. */
  readonly increment?: number;
}

/** Handle passed to the task callback. */
export interface ProgressReporter {
  /** Push an update to any UI observing this task. */
  report(update: ProgressUpdate): void;
}

/**
 * Lifecycle event emitted by {@link IProgressService}. UI layers bind
 * to {@link IProgressService.onDidChange} to render a progress stack.
 */
export interface ProgressEvent {
  /** Unique id assigned to each withProgress invocation. */
  readonly id: number;
  readonly title: string;
  readonly cancellable: boolean;
  /** Current message as last reported; undefined before any report. */
  readonly message: string | undefined;
  /** Running percent in [0, 100]. */
  readonly percent: number;
  readonly kind: 'start' | 'update' | 'end';
}

/**
 * Framework-level long-task service. Plugins wrap work in
 * {@link withProgress} and get back (1) a place to report progress and
 * (2) a cancellation signal; UI layers subscribe to {@link onDidChange}
 * to render a stack of active tasks.
 *
 * Kept headless so non-DOM platforms can provide their own rendering.
 */
export interface IProgressService extends IDisposable {
  /**
   * Run `task` with progress tracking. Resolves with whatever the task
   * returned; rejects if the task threw or cancellation fired after
   * cancellable was requested.
   */
  withProgress<T>(
    options: ProgressOptions,
    task: (reporter: ProgressReporter, signal: AbortSignal) => Promise<T>,
  ): Promise<T>;

  /** All currently-running tasks. */
  getActive(): readonly ProgressEvent[];

  /**
   * Attempt to cancel a running cancellable task. Returns true when the
   * task exists and was cancellable (so the signal fired); false when
   * the id is unknown or the task opted out of cancellation.
   */
  cancel(id: number): boolean;

  readonly onDidChange: Event<ProgressEvent>;
}

export const IProgressService = createServiceId<IProgressService>('IProgressService');

/**
 * Default headless {@link IProgressService}. UIs observe onDidChange
 * and render however they prefer; tasks that throw bubble out through
 * withProgress with a 'end' event fired on the way.
 */
export class ProgressService implements IProgressService {
  private _nextId = 1;
  private readonly _active = new Map<
    number,
    {
      event: ProgressEvent;
      controller: AbortControllerLike | undefined;
    }
  >();
  private readonly _onDidChange = new Emitter<ProgressEvent>();

  readonly onDidChange: Event<ProgressEvent> = this._onDidChange.event;

  async withProgress<T>(
    options: ProgressOptions,
    task: (reporter: ProgressReporter, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const id = this._nextId++;
    const cancellable = options.cancellable === true;
    const controller = cancellable ? new AbortController() : undefined;

    const entry = {
      event: {
        id,
        title: options.title,
        cancellable,
        message: undefined,
        percent: 0,
        kind: 'start' as const,
      } satisfies { event: ProgressEvent }['event'],
      controller,
    };
    this._active.set(id, entry);
    this._onDidChange.fire(entry.event);

    const reporter: ProgressReporter = {
      report: (update) => {
        const current = this._active.get(id);
        if (!current) return;
        const nextMessage = update.message ?? current.event.message;
        let nextPercent = current.event.percent;
        if (update.increment !== undefined) {
          nextPercent = clampPercent(nextPercent + update.increment);
        }
        current.event = {
          ...current.event,
          message: nextMessage,
          percent: nextPercent,
          kind: 'update',
        };
        this._onDidChange.fire(current.event);
      },
    };

    // Using a dedicated signal (either the controller's or a never-
    // aborting stub) keeps the task signature uniform — callers don't
    // have to branch on cancellable to read `signal.aborted`.
    const signal = controller?.signal ?? NEVER_ABORT;

    try {
      return await task(reporter, signal);
    } finally {
      const current = this._active.get(id);
      this._active.delete(id);
      if (current) {
        this._onDidChange.fire({ ...current.event, kind: 'end' });
      }
    }
  }

  getActive(): readonly ProgressEvent[] {
    return Array.from(this._active.values(), (v) => v.event);
  }

  cancel(id: number): boolean {
    const entry = this._active.get(id);
    if (!entry?.controller) return false;
    entry.controller.abort();
    return true;
  }

  dispose(): void {
    // Abort any still-running cancellable tasks so they drop their work
    // instead of leaking into the next test / editor instance.
    for (const entry of this._active.values()) {
      entry.controller?.abort();
    }
    this._active.clear();
    this._onDidChange.dispose();
  }
}

function clampPercent(v: number): number {
  if (v < 0) return 0;
  if (v > 100) return 100;
  return v;
}

const NEVER_ABORT: AbortSignal = (() => {
  // An AbortSignal that never fires; used as a no-op fallback so tasks
  // can pass `signal` through without a null-check.
  const controller = new AbortController();
  return controller.signal;
})();
