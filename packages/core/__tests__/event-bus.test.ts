import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../src/event-bus.js';

describe('EventBus', () => {
  it('should deliver events to exact-match listeners', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on('test.event', handler);
    bus.emit('test.event', { value: 1 });

    expect(handler).toHaveBeenCalledWith({ value: 1 });
  });

  it('should not deliver events to non-matching listeners', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on('other.event', handler);
    bus.emit('test.event', 'hello');

    expect(handler).not.toHaveBeenCalled();
  });

  it('should support multiple listeners on the same event', () => {
    const bus = new EventBus();
    const h1 = vi.fn();
    const h2 = vi.fn();

    bus.on('e', h1);
    bus.on('e', h2);
    bus.emit('e', 'data');

    expect(h1).toHaveBeenCalledWith('data');
    expect(h2).toHaveBeenCalledWith('data');
  });

  it('should remove listener when subscription is disposed', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    const sub = bus.on('e', handler);
    bus.emit('e', 1);
    sub.dispose();
    bus.emit('e', 2);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should support once() — fire and auto-remove', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.once('e', handler);
    bus.emit('e', 'first');
    bus.emit('e', 'second');

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith('first');
  });

  it('should support wildcard subscriptions', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.onWild('document.*', handler);

    bus.emit('document.changed', { type: 'insert' });
    bus.emit('document.saved', { path: '/foo' });
    bus.emit('plugin.activated', 'test');

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenCalledWith('document.changed', { type: 'insert' });
    expect(handler).toHaveBeenCalledWith('document.saved', { path: '/foo' });
  });

  it('should not match wildcard when pattern has no trailing .*', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.onWild('document', handler);
    bus.emit('document.changed', 'data');

    expect(handler).not.toHaveBeenCalled();
  });

  it('should clean up listeners on dispose', () => {
    const bus = new EventBus();
    const h1 = vi.fn();
    const h2 = vi.fn();

    bus.on('e', h1);
    bus.onWild('e.*', h2);
    bus.dispose();

    bus.emit('e', 'data');
    bus.emit('e.sub', 'data');

    expect(h1).not.toHaveBeenCalled();
    expect(h2).not.toHaveBeenCalled();
  });

  describe('listener error isolation', () => {
    it('should keep delivering to other exact listeners when one throws', () => {
      const bus = new EventBus();
      const before = vi.fn();
      const after = vi.fn();
      const errors: unknown[] = [];

      bus.onError(({ error }) => errors.push(error));
      bus.on('e', before);
      bus.on('e', () => {
        throw new Error('boom');
      });
      bus.on('e', after);

      bus.emit('e', 1);

      expect(before).toHaveBeenCalledOnce();
      expect(after).toHaveBeenCalledOnce();
      expect(errors).toHaveLength(1);
      expect((errors[0] as Error).message).toBe('boom');
    });

    it('should keep delivering to wildcard listeners when one throws', () => {
      const bus = new EventBus();
      const sane = vi.fn();
      const errors: unknown[] = [];

      bus.onError(({ eventId, error }) => errors.push({ eventId, error }));
      bus.onWild('e.*', () => {
        throw new Error('bad wild');
      });
      bus.onWild('e.*', sane);

      bus.emit('e.sub', { ok: true });

      expect(sane).toHaveBeenCalledOnce();
      expect(errors).toHaveLength(1);
      expect((errors[0] as { eventId: string }).eventId).toBe('e.sub');
    });

  });

  describe('batching', () => {
    it('drops queued emits when a batch throws', () => {
      const bus = new EventBus();
      const handler = vi.fn();
      bus.on('e', handler);

      expect(() =>
        bus.batch(() => {
          bus.emit('e', 1);
          bus.emit('e', 2);
          throw new Error('aborted');
        }),
      ).toThrow('aborted');

      expect(handler).not.toHaveBeenCalled();
    });


    it('defers emits until the batch completes and preserves order', () => {
      const bus = new EventBus();
      const seen: [string, unknown][] = [];
      bus.on('a', (d) => seen.push(['a', d]));
      bus.on('b', (d) => seen.push(['b', d]));

      const observedDuringBatch: typeof seen = [];
      bus.batch(() => {
        bus.emit('a', 1);
        bus.emit('b', 'x');
        bus.emit('a', 2);
        observedDuringBatch.push(...seen);
      });

      expect(observedDuringBatch).toEqual([]); // nothing fired mid-batch
      expect(seen).toEqual([
        ['a', 1],
        ['b', 'x'],
        ['a', 2],
      ]);
    });

    it('does not coalesce repeated emits — all are delivered', () => {
      const bus = new EventBus();
      const h = vi.fn();
      bus.on('e', h);

      bus.batch(() => {
        bus.emit('e', 1);
        bus.emit('e', 2);
        bus.emit('e', 3);
      });

      expect(h).toHaveBeenCalledTimes(3);
    });

    it('supports nested batches — only the outermost flushes', () => {
      const bus = new EventBus();
      const h = vi.fn();
      bus.on('e', h);

      bus.batch(() => {
        bus.emit('e', 1);
        bus.batch(() => {
          bus.emit('e', 2);
          expect(h).not.toHaveBeenCalled(); // inner end doesn't flush
        });
        expect(h).not.toHaveBeenCalled(); // still inside outer
        bus.emit('e', 3);
      });

      expect(h).toHaveBeenCalledTimes(3);
    });

    it('forwards the callback return value', () => {
      const bus = new EventBus();
      const result = bus.batch(() => {
        bus.emit('e', null);
        return 42;
      });
      expect(result).toBe(42);
    });

    it('delivers to wildcard subscribers too', () => {
      const bus = new EventBus();
      const h = vi.fn();
      bus.onWild('e.*', h);

      bus.batch(() => {
        bus.emit('e.sub', 'a');
        bus.emit('e.other', 'b');
      });

      expect(h).toHaveBeenCalledTimes(2);
      expect(h).toHaveBeenNthCalledWith(1, 'e.sub', 'a');
      expect(h).toHaveBeenNthCalledWith(2, 'e.other', 'b');
    });

    it('emits made by listeners during flush dispatch immediately', () => {
      const bus = new EventBus();
      const order: string[] = [];

      bus.on('outer', () => {
        order.push('outer');
        bus.emit('inner', null);
      });
      bus.on('inner', () => order.push('inner'));

      bus.batch(() => {
        bus.emit('outer', null);
      });

      // Outer first (from the flush), then inner (re-entrant, not batched).
      expect(order).toEqual(['outer', 'inner']);
    });
  });

  describe('listener set mutation during emit', () => {
    it('should tolerate listeners that mutate the listener set during emit', () => {
      const bus = new EventBus();
      const captured: string[] = [];

      const sub = bus.on('e', () => {
        captured.push('first');
        sub.dispose();
      });
      bus.on('e', () => captured.push('second'));

      bus.emit('e', null);

      // Both listeners run for this emit; first should be gone next time.
      expect(captured).toEqual(['first', 'second']);
      bus.emit('e', null);
      expect(captured).toEqual(['first', 'second', 'second']);
    });
  });
});
