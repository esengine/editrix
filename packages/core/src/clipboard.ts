/**
 * Clipboard service — thin abstraction over the platform clipboard.
 *
 * The framework defines the interface; a platform package provides the
 * implementation. Current scope is plain text — cut/copy/paste workflows
 * that need structured payloads should go through a dedicated MIME-typed
 * protocol (not yet defined).
 *
 * @example
 * ```ts
 * const clipboard = services.get(IClipboardService);
 * await clipboard.writeText(entity.name);
 * const last = await clipboard.readText();
 * ```
 */

import { createServiceId } from '@editrix/common';

export interface IClipboardService {
  /**
   * Read the clipboard as UTF-8 text.
   *
   * Returns the empty string if the clipboard is empty, contains
   * non-text data, or permission was denied.
   */
  readText(): Promise<string>;

  /**
   * Replace the clipboard contents with UTF-8 text.
   *
   * Rejects if the platform denies clipboard access.
   */
  writeText(text: string): Promise<void>;
}

export const IClipboardService = createServiceId<IClipboardService>('IClipboardService');
