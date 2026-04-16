import { describe, expect, it, vi } from 'vitest';
import { DisposableStore, isDisposable, toDisposable } from '../src/disposable.js';

describe('toDisposable', () => {
  it('should call the cleanup function on dispose', () => {
    const fn = vi.fn();
    const d = toDisposable(fn);
    expect(fn).not.toHaveBeenCalled();

    d.dispose();
    expect(fn).toHaveBeenCalledOnce();
  });

  it('should only call the cleanup function once', () => {
    const fn = vi.fn();
    const d = toDisposable(fn);

    d.dispose();
    d.dispose();
    d.dispose();
    expect(fn).toHaveBeenCalledOnce();
  });
});

describe('isDisposable', () => {
  it('should return true for objects with a dispose method', () => {
    expect(isDisposable({ dispose: () => {} })).toBe(true);
    expect(isDisposable(toDisposable(() => {}))).toBe(true);
    expect(isDisposable(new DisposableStore())).toBe(true);
  });

  it('should return false for non-disposable values', () => {
    expect(isDisposable(null)).toBe(false);
    expect(isDisposable(undefined)).toBe(false);
    expect(isDisposable(42)).toBe(false);
    expect(isDisposable('string')).toBe(false);
    expect(isDisposable({})).toBe(false);
    expect(isDisposable({ dispose: 'not a function' })).toBe(false);
  });
});

describe('DisposableStore', () => {
  it('should dispose all added disposables', () => {
    const store = new DisposableStore();
    const fn1 = vi.fn();
    const fn2 = vi.fn();

    store.add(toDisposable(fn1));
    store.add(toDisposable(fn2));

    store.dispose();

    expect(fn1).toHaveBeenCalledOnce();
    expect(fn2).toHaveBeenCalledOnce();
  });

  it('should return the added disposable for chaining', () => {
    const store = new DisposableStore();
    const d = toDisposable(() => {});

    const result = store.add(d);
    expect(result).toBe(d);
  });

  it('should immediately dispose items added after store is disposed', () => {
    const store = new DisposableStore();
    store.dispose();

    const fn = vi.fn();
    store.add(toDisposable(fn));

    expect(fn).toHaveBeenCalledOnce();
  });

  it('should not dispose an item that was removed', () => {
    const store = new DisposableStore();
    const fn = vi.fn();
    const d = toDisposable(fn);

    store.add(d);
    store.remove(d);
    store.dispose();

    expect(fn).not.toHaveBeenCalled();
  });

  it('should be idempotent when disposed multiple times', () => {
    const store = new DisposableStore();
    const fn = vi.fn();
    store.add(toDisposable(fn));

    store.dispose();
    store.dispose();

    expect(fn).toHaveBeenCalledOnce();
  });

  it('should report isDisposed correctly', () => {
    const store = new DisposableStore();
    expect(store.isDisposed).toBe(false);

    store.dispose();
    expect(store.isDisposed).toBe(true);
  });
});
