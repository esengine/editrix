import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DomNotificationService } from '../src/notification-service.js';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

function getToasts(): NodeListOf<HTMLElement> {
  return document.querySelectorAll<HTMLElement>('.editrix-notification');
}

describe('DomNotificationService', () => {
  it('renders an info toast with the given message', () => {
    const svc = new DomNotificationService();
    svc.info('Saved');
    const toasts = getToasts();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.dataset['severity']).toBe('info');
    expect(toasts[0]?.textContent).toContain('Saved');
  });

  it('defaults error toasts to sticky (no auto dismiss)', () => {
    const svc = new DomNotificationService();
    svc.error('Oops');
    vi.advanceTimersByTime(60_000);
    expect(getToasts()).toHaveLength(1);
  });

  it('auto-dismisses info toasts after the default 4s timeout', () => {
    const svc = new DomNotificationService();
    const n = svc.info('Saved');
    vi.advanceTimersByTime(4000);
    // Dismiss schedules a transitionend fallback via setTimeout(..., 250);
    vi.advanceTimersByTime(300);
    expect(getToasts()).toHaveLength(0);
    // Handle is still usable as a reference — dispose on an already-dismissed
    // notification is a no-op.
    expect(() => {
      n.dispose();
    }).not.toThrow();
  });

  it('respects a caller-provided timeout of 0 (sticky)', () => {
    const svc = new DomNotificationService();
    svc.info('Stick', { timeout: 0 });
    vi.advanceTimersByTime(60_000);
    expect(getToasts()).toHaveLength(1);
  });

  it('renders action buttons and dismisses on click', async () => {
    const svc = new DomNotificationService();
    const run = vi.fn();
    svc.warn('Failed', { actions: [{ label: 'Retry', run }] });
    const btn = document.querySelector<HTMLButtonElement>('.editrix-notification-action');
    expect(btn?.textContent).toBe('Retry');
    btn?.click();
    // Action is run asynchronously inside the service's IIFE.
    await vi.runAllTimersAsync();
    expect(run).toHaveBeenCalledOnce();
    expect(getToasts()).toHaveLength(0);
  });

  it('dismiss(id) removes a toast by id', () => {
    const svc = new DomNotificationService();
    const n = svc.info('Saved');
    svc.dismiss(n.id);
    vi.advanceTimersByTime(300);
    expect(getToasts()).toHaveLength(0);
  });

  it('dismissAll clears every toast', () => {
    const svc = new DomNotificationService();
    svc.info('a');
    svc.warn('b');
    svc.error('c');
    expect(getToasts()).toHaveLength(3);
    svc.dismissAll();
    vi.advanceTimersByTime(300);
    expect(getToasts()).toHaveLength(0);
  });

  it('fires onDidShow and onDidDismiss events', () => {
    const svc = new DomNotificationService();
    const shown = vi.fn();
    const dismissed = vi.fn();
    svc.onDidShow(shown);
    svc.onDidDismiss(dismissed);
    const n = svc.info('Hi');
    expect(shown).toHaveBeenCalledWith(n);
    svc.dismiss(n.id);
    expect(dismissed).toHaveBeenCalledWith(n.id);
  });

  it('handle.dispose() dismisses the underlying toast', () => {
    const svc = new DomNotificationService();
    const n = svc.info('Hi');
    n.dispose();
    vi.advanceTimersByTime(300);
    expect(getToasts()).toHaveLength(0);
  });
});
