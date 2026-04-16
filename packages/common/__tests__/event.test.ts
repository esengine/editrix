import { describe, expect, it, vi } from 'vitest';
import { Emitter } from '../src/event.js';

describe('Emitter', () => {
  it('should notify listeners when fired', () => {
    const emitter = new Emitter<number>();
    const handler = vi.fn();

    emitter.event(handler);
    emitter.fire(42);

    expect(handler).toHaveBeenCalledWith(42);
  });

  it('should support multiple listeners', () => {
    const emitter = new Emitter<string>();
    const h1 = vi.fn();
    const h2 = vi.fn();

    emitter.event(h1);
    emitter.event(h2);
    emitter.fire('hello');

    expect(h1).toHaveBeenCalledWith('hello');
    expect(h2).toHaveBeenCalledWith('hello');
  });

  it('should stop notifying after listener is disposed', () => {
    const emitter = new Emitter<number>();
    const handler = vi.fn();

    const sub = emitter.event(handler);
    emitter.fire(1);
    sub.dispose();
    emitter.fire(2);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(1);
  });

  it('should not fire after emitter is disposed', () => {
    const emitter = new Emitter<number>();
    const handler = vi.fn();

    emitter.event(handler);
    emitter.dispose();
    emitter.fire(42);

    expect(handler).not.toHaveBeenCalled();
  });

  it('should return a no-op disposable when subscribing to a disposed emitter', () => {
    const emitter = new Emitter<number>();
    emitter.dispose();

    const handler = vi.fn();
    const sub = emitter.event(handler);

    // Should not throw
    sub.dispose();

    emitter.fire(42);
    expect(handler).not.toHaveBeenCalled();
  });

  it('should handle dispose during fire gracefully', () => {
    const emitter = new Emitter<number>();
    const h2 = vi.fn();

    // First handler disposes the second subscription
    let sub2: { dispose: () => void };
    emitter.event(() => {
      sub2.dispose();
    });
    sub2 = emitter.event(h2);

    // Should not throw
    emitter.fire(1);
  });

  it('should fire synchronously in order', () => {
    const emitter = new Emitter<number>();
    const order: number[] = [];

    emitter.event(() => order.push(1));
    emitter.event(() => order.push(2));
    emitter.event(() => order.push(3));

    emitter.fire(0);
    expect(order).toEqual([1, 2, 3]);
  });
});
