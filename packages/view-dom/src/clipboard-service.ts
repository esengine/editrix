import type { IClipboardService } from '@editrix/core';

/**
 * DOM-based {@link IClipboardService} backed by the async Clipboard API
 * (`navigator.clipboard`).
 *
 * Works in any secure browser context and in Electron's renderer (where
 * clipboard access is granted without user-gesture prompts). If the
 * environment lacks the API, reads return the empty string and writes
 * reject.
 */
export class NavigatorClipboardService implements IClipboardService {
  async readText(): Promise<string> {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return '';
    }
  }

  async writeText(text: string): Promise<void> {
    await navigator.clipboard.writeText(text);
  }
}
