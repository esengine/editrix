/**
 * Modal dialog service — abstracts confirm / prompt / message boxes.
 *
 * The framework owns the contract; a platform package (`@editrix/view-dom`)
 * provides the renderer. Plugins resolve {@link IDialogService} from the
 * service registry and never touch the DOM directly.
 *
 * @example
 * ```ts
 * const dialogs = services.get(IDialogService);
 * const ok = await dialogs.confirm({
 *   message: 'Discard unsaved changes?',
 *   destructive: true,
 * });
 * ```
 */

import { createServiceId } from '@editrix/common';

/** Visual variant for a dialog button. */
export type DialogButtonVariant = 'default' | 'primary' | 'destructive';

/**
 * A single button in a {@link MessageDialogOptions}.
 *
 * At most one button should be marked `isDefault` (Enter) and at most one
 * `isCancel` (Escape / overlay click). If no `isCancel` is set, ESC
 * resolves to the default button.
 */
export interface DialogButton {
  /** Value returned from {@link IDialogService.showMessage}. */
  readonly id: string;
  /** Button label. */
  readonly label: string;
  /** Visual variant — `primary` is the accent colour, `destructive` is red. */
  readonly variant?: DialogButtonVariant;
  /** Triggered on Enter when the dialog has focus. */
  readonly isDefault?: boolean;
  /** Triggered on Escape / overlay click. */
  readonly isCancel?: boolean;
}

/**
 * Options for a generic multi-button message dialog.
 */
export interface MessageDialogOptions {
  /** Optional bold title above the message. */
  readonly title?: string;
  /** The primary message body. Line breaks are preserved. */
  readonly message: string;
  /** Optional smaller detail text below the message. */
  readonly detail?: string;
  /** Buttons shown right-aligned at the bottom. Must be non-empty. */
  readonly buttons: readonly DialogButton[];
}

/** Options for a yes/no confirmation dialog. */
export interface ConfirmDialogOptions {
  /** Optional bold title above the message. */
  readonly title?: string;
  /** The primary message body. */
  readonly message: string;
  /** Optional smaller detail text. */
  readonly detail?: string;
  /** Confirm-button label. Defaults to `OK`. */
  readonly okLabel?: string;
  /** Cancel-button label. Defaults to `Cancel`. */
  readonly cancelLabel?: string;
  /** Render the confirm button in the red destructive variant. */
  readonly destructive?: boolean;
}

/** Options for a single-line text-input prompt. */
export interface InputDialogOptions {
  /** Bold title. Required — prompts are always identified. */
  readonly title: string;
  /** Optional explanatory message above the input. */
  readonly message?: string;
  /** Value the input is pre-filled with. */
  readonly initialValue?: string;
  /** Greyed placeholder shown when input is empty. */
  readonly placeholder?: string;
  /** Submit-button label. Defaults to `OK`. */
  readonly okLabel?: string;
  /**
   * Optional per-keystroke validator. Return a string to display an inline
   * error and keep the dialog open; return `undefined` to allow submission.
   */
  readonly validate?: (value: string) => string | undefined;
}

/**
 * Dialog service.
 *
 * All methods resolve with the user's choice. On cancel (Escape, overlay
 * click, or explicit cancel button), {@link showMessage} resolves with the
 * `isCancel` button's id (or the last button's id as a fallback),
 * {@link confirm} with `false`, and {@link prompt} with `null`.
 */
export interface IDialogService {
  /**
   * General-purpose multi-button dialog. Returns the `id` of the chosen
   * button. Throws if `buttons` is empty.
   */
  showMessage(options: MessageDialogOptions): Promise<string>;

  /**
   * Yes/no shorthand. Returns `true` if the user confirmed, `false` on
   * cancel.
   */
  confirm(options: ConfirmDialogOptions): Promise<boolean>;

  /**
   * Text-input prompt. Returns the entered string (may be empty if the
   * user submitted an empty input and no `validate` blocked it), or
   * `null` on cancel.
   */
  prompt(options: InputDialogOptions): Promise<string | null>;
}

export const IDialogService = createServiceId<IDialogService>('IDialogService');
