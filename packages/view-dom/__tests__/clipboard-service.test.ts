import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NavigatorClipboardService } from '../src/clipboard-service.js';

const originalClipboard = navigator.clipboard;

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { readText: vi.fn(), writeText: vi.fn() },
  });
});
afterEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: originalClipboard,
  });
});

describe('NavigatorClipboardService', () => {
  it('readText forwards to navigator.clipboard.readText', async () => {
    const svc = new NavigatorClipboardService();
    (navigator.clipboard.readText as ReturnType<typeof vi.fn>).mockResolvedValue('hello');
    await expect(svc.readText()).resolves.toBe('hello');
  });

  it('readText returns empty string when navigator rejects', async () => {
    const svc = new NavigatorClipboardService();
    (navigator.clipboard.readText as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('denied'),
    );
    await expect(svc.readText()).resolves.toBe('');
  });

  it('writeText forwards to navigator.clipboard.writeText', async () => {
    const svc = new NavigatorClipboardService();
    (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    await svc.writeText('x');
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('x');
  });

  it('writeText rejects when the platform denies', async () => {
    const svc = new NavigatorClipboardService();
    (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('no-focus'),
    );
    await expect(svc.writeText('x')).rejects.toThrow('no-focus');
  });
});
