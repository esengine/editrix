import { describe, expect, it, vi } from 'vitest';
import type { ProgressEvent } from '../src/progress.js';
import { ProgressService } from '../src/progress.js';

function collect(service: ProgressService): { events: ProgressEvent[]; stop: () => void } {
  const events: ProgressEvent[] = [];
  const sub = service.onDidChange((e) => events.push(e));
  return { events, stop: () => sub.dispose() };
}

describe('ProgressService.withProgress', () => {
  it('fires start → update(s) → end and resolves with the task value', async () => {
    const s = new ProgressService();
    const { events } = collect(s);

    const result = await s.withProgress({ title: 'Import' }, async (reporter) => {
      reporter.report({ message: 'Scanning', increment: 30 });
      reporter.report({ message: 'Writing', increment: 70 });
      return 42;
    });

    expect(result).toBe(42);
    expect(events.map((e) => e.kind)).toEqual(['start', 'update', 'update', 'end']);
    expect(events[0]?.title).toBe('Import');
    expect(events[2]?.percent).toBe(100);
  });

  it('clamps increments so percent never exceeds 100', async () => {
    const s = new ProgressService();
    const { events } = collect(s);

    await s.withProgress({ title: 't' }, async (reporter) => {
      reporter.report({ increment: 80 });
      reporter.report({ increment: 40 }); // would overflow
    });

    const updates = events.filter((e) => e.kind === 'update');
    expect(updates.at(-1)?.percent).toBe(100);
  });

  it('carries the previous message when an update omits message', async () => {
    const s = new ProgressService();
    const { events } = collect(s);

    await s.withProgress({ title: 't' }, async (reporter) => {
      reporter.report({ message: 'Step 1', increment: 50 });
      reporter.report({ increment: 50 });
    });

    const updates = events.filter((e) => e.kind === 'update');
    expect(updates[0]?.message).toBe('Step 1');
    expect(updates[1]?.message).toBe('Step 1'); // carried forward
  });

  it('fires end even when the task throws, and propagates the error', async () => {
    const s = new ProgressService();
    const { events } = collect(s);

    await expect(
      s.withProgress({ title: 't' }, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(events.at(-1)?.kind).toBe('end');
  });

  it('removes the task from getActive after it completes', async () => {
    const s = new ProgressService();
    let midActive: readonly ProgressEvent[] = [];

    await s.withProgress({ title: 'x' }, async (reporter) => {
      reporter.report({ increment: 10 });
      midActive = s.getActive();
    });

    expect(midActive).toHaveLength(1);
    expect(s.getActive()).toHaveLength(0);
  });
});

describe('ProgressService cancellation', () => {
  it('supplies an AbortSignal that fires when cancel() is called', async () => {
    const s = new ProgressService();
    let capturedSignal: AbortSignal | undefined;

    const task = s.withProgress({ title: 'slow', cancellable: true }, async (_reporter, signal) => {
      capturedSignal = signal;
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve());
      });
      return 'cancelled';
    });

    // Active task id is always the first issued id.
    expect(s.getActive()).toHaveLength(1);
    const id = s.getActive()[0]!.id;
    const ok = s.cancel(id);
    expect(ok).toBe(true);

    await expect(task).resolves.toBe('cancelled');
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('returns false when cancelling a task that opted out', async () => {
    const s = new ProgressService();

    let resolveTask!: () => void;
    const task = s.withProgress({ title: 'non-cancellable' }, async () => {
      await new Promise<void>((r) => {
        resolveTask = r;
      });
    });

    const id = s.getActive()[0]!.id;
    expect(s.cancel(id)).toBe(false);

    resolveTask();
    await task;
  });

  it('returns false for an unknown id', () => {
    const s = new ProgressService();
    expect(s.cancel(9999)).toBe(false);
  });

  it('aborts in-flight cancellable tasks on dispose', async () => {
    const s = new ProgressService();

    let aborted = false;
    const task = s.withProgress(
      { title: 'leak-me', cancellable: true },
      async (_reporter, signal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => {
            aborted = true;
            resolve();
          });
        }),
    );

    s.dispose();
    await task;
    expect(aborted).toBe(true);
  });
});

describe('ProgressService concurrency', () => {
  it('tracks multiple parallel tasks with unique ids', async () => {
    const s = new ProgressService();
    const observed = new Set<number>();
    s.onDidChange((e) => {
      if (e.kind === 'start') observed.add(e.id);
    });

    const a = s.withProgress({ title: 'a' }, async (reporter) => {
      reporter.report({ increment: 50 });
    });
    const b = s.withProgress({ title: 'b' }, async (reporter) => {
      reporter.report({ increment: 50 });
    });

    await Promise.all([a, b]);
    expect(observed.size).toBe(2);
  });

  it('ignores reports after the task has ended', async () => {
    const s = new ProgressService();
    const { events } = collect(s);

    let escaped: { report: (update: { message?: string; increment?: number }) => void } | undefined;
    await s.withProgress({ title: 't' }, async (reporter) => {
      escaped = reporter;
    });

    const tailCount = events.length;
    escaped?.report({ message: 'too late', increment: 10 });
    expect(events).toHaveLength(tailCount); // no new update fired
  });
});

describe('ProgressService type safety', () => {
  it('exposes a test-only sanity check that onDidChange returns a disposable', () => {
    const s = new ProgressService();
    const sub = s.onDidChange(vi.fn());
    expect(typeof sub.dispose).toBe('function');
    sub.dispose();
  });
});
