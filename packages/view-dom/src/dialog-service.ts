import type {
  ConfirmDialogOptions,
  DialogButton,
  IDialogService,
  InputDialogOptions,
  MessageDialogOptions,
} from '@editrix/core';

const STYLE_ID = 'editrix-dialog-styles';

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = DIALOG_CSS;
  document.head.appendChild(style);
}

/**
 * DOM-based implementation of {@link IDialogService}. Dialogs are rendered
 * as top-level overlays appended to `document.body` — they do not
 * participate in the layout system.
 */
export class DomDialogService implements IDialogService {
  async showMessage(options: MessageDialogOptions): Promise<string> {
    if (options.buttons.length === 0) {
      throw new Error('DomDialogService.showMessage: buttons must be non-empty');
    }
    injectStyles();
    return new Promise((resolve) => {
      const { overlay, dialog } = this._buildShell();

      if (options.title !== undefined) dialog.appendChild(this._buildTitle(options.title));
      dialog.appendChild(this._buildMessage(options.message));
      if (options.detail !== undefined) dialog.appendChild(this._buildDetail(options.detail));

      const { row, defaultButton, cancelId } = this._buildButtonRow(options.buttons, (id) => {
        close();
        resolve(id);
      });
      dialog.appendChild(row);

      const onKey = (e: KeyboardEvent): void => {
        if (e.key === 'Enter' && defaultButton) {
          e.preventDefault();
          close();
          resolve(defaultButton.id);
        } else if (e.key === 'Escape' && cancelId !== undefined) {
          e.preventDefault();
          close();
          resolve(cancelId);
        }
      };
      const onOverlayClick = (e: MouseEvent): void => {
        if (e.target === overlay && cancelId !== undefined) {
          close();
          resolve(cancelId);
        }
      };
      document.addEventListener('keydown', onKey);
      overlay.addEventListener('click', onOverlayClick);

      const releaseTrap = this._installFocusTrap(dialog);

      function close(): void {
        document.removeEventListener('keydown', onKey);
        releaseTrap();
        overlay.remove();
      }

      document.body.appendChild(overlay);
      (defaultButton?.el ?? row.firstElementChild)?.dispatchEvent(new Event('focus'));
      (defaultButton?.el ?? (row.firstElementChild as HTMLElement | null))?.focus();
    });
  }

  async confirm(options: ConfirmDialogOptions): Promise<boolean> {
    const buttons: DialogButton[] = [
      { id: 'cancel', label: options.cancelLabel ?? 'Cancel', isCancel: true },
      {
        id: 'ok',
        label: options.okLabel ?? 'OK',
        variant: options.destructive === true ? 'destructive' : 'primary',
        isDefault: true,
      },
    ];
    const messageOpts: MessageDialogOptions = {
      message: options.message,
      buttons,
      ...(options.title !== undefined && { title: options.title }),
      ...(options.detail !== undefined && { detail: options.detail }),
    };
    const chosen = await this.showMessage(messageOpts);
    return chosen === 'ok';
  }

  async prompt(options: InputDialogOptions): Promise<string | null> {
    injectStyles();
    return new Promise((resolve) => {
      const { overlay, dialog } = this._buildShell();

      dialog.appendChild(this._buildTitle(options.title));
      if (options.message !== undefined) dialog.appendChild(this._buildMessage(options.message));

      const input = document.createElement('input');
      input.className = 'editrix-dialog-input';
      input.type = 'text';
      if (options.placeholder !== undefined) input.placeholder = options.placeholder;
      input.value = options.initialValue ?? '';
      dialog.appendChild(input);

      const errorEl = document.createElement('div');
      errorEl.className = 'editrix-dialog-error';
      errorEl.hidden = true;
      dialog.appendChild(errorEl);

      const cancelBtn = this._buildButton({ id: 'cancel', label: 'Cancel', isCancel: true }, () => {
        close();
        resolve(null);
      });
      const okBtn = this._buildButton(
        {
          id: 'ok',
          label: options.okLabel ?? 'OK',
          variant: 'primary',
          isDefault: true,
        },
        () => {
          submit();
        },
      );

      const row = document.createElement('div');
      row.className = 'editrix-dialog-buttons';
      row.append(cancelBtn, okBtn);
      dialog.appendChild(row);

      const onKey = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') {
          e.preventDefault();
          close();
          resolve(null);
        }
      };
      const onOverlayClick = (e: MouseEvent): void => {
        if (e.target === overlay) {
          close();
          resolve(null);
        }
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submit();
        }
      });
      document.addEventListener('keydown', onKey);
      overlay.addEventListener('click', onOverlayClick);

      const releaseTrap = this._installFocusTrap(dialog);

      function submit(): void {
        const value = input.value;
        if (options.validate !== undefined) {
          const err = options.validate(value);
          if (err !== undefined) {
            errorEl.textContent = err;
            errorEl.hidden = false;
            input.focus();
            input.select();
            return;
          }
        }
        close();
        resolve(value);
      }

      function close(): void {
        document.removeEventListener('keydown', onKey);
        releaseTrap();
        overlay.remove();
      }

      document.body.appendChild(overlay);
      input.focus();
      input.select();
    });
  }

  /**
   * Wrap dialog open with two a11y requirements: (1) keyboard focus
   * cannot Tab out of the dialog; (2) when the dialog closes, focus
   * returns to whatever element had it before we opened — otherwise
   * keyboard users end up back at document.body and lose their place.
   *
   * The listener runs in the capture phase so Tab is intercepted before
   * any caller-owned handler can see it.
   */
  private _installFocusTrap(dialog: HTMLElement): () => void {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const getFocusable = (): HTMLElement[] => {
      const selector =
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), ' +
        'select:not([disabled]), [tabindex]:not([tabindex="-1"])';
      return Array.from(dialog.querySelectorAll<HTMLElement>(selector)).filter((el) => !el.hidden);
    };

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return;
      const focusable = getFocusable();
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      const active = document.activeElement as HTMLElement | null;
      if (!active || !dialog.contains(active)) {
        e.preventDefault();
        first.focus();
        return;
      }

      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);

    return (): void => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (previouslyFocused && document.contains(previouslyFocused)) {
        try {
          previouslyFocused.focus();
        } catch {
          /* element may no longer be focusable */
        }
      }
    };
  }

  private _buildShell(): { overlay: HTMLDivElement; dialog: HTMLDivElement } {
    const overlay = document.createElement('div');
    overlay.className = 'editrix-dialog-overlay';
    const dialog = document.createElement('div');
    dialog.className = 'editrix-dialog';
    overlay.appendChild(dialog);
    return { overlay, dialog };
  }

  private _buildTitle(text: string): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'editrix-dialog-title';
    el.textContent = text;
    return el;
  }

  private _buildMessage(text: string): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'editrix-dialog-message';
    el.textContent = text;
    return el;
  }

  private _buildDetail(text: string): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'editrix-dialog-detail';
    el.textContent = text;
    return el;
  }

  private _buildButton(spec: DialogButton, onActivate: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = spec.label;
    btn.className = 'editrix-dialog-btn';
    const variant = spec.variant ?? (spec.isDefault === true ? 'primary' : 'default');
    btn.dataset['variant'] = variant;
    btn.addEventListener('click', onActivate);
    return btn;
  }

  private _buildButtonRow(
    buttons: readonly DialogButton[],
    onChosen: (id: string) => void,
  ): {
    row: HTMLDivElement;
    defaultButton: { id: string; el: HTMLButtonElement } | undefined;
    cancelId: string | undefined;
  } {
    const row = document.createElement('div');
    row.className = 'editrix-dialog-buttons';

    let defaultButton: { id: string; el: HTMLButtonElement } | undefined;
    let cancelId: string | undefined;

    for (const spec of buttons) {
      const el = this._buildButton(spec, () => {
        onChosen(spec.id);
      });
      row.appendChild(el);
      if (spec.isDefault === true && !defaultButton) {
        defaultButton = { id: spec.id, el };
      }
      if (spec.isCancel === true && cancelId === undefined) {
        cancelId = spec.id;
      }
    }
    return { row, defaultButton, cancelId };
  }
}

const DIALOG_CSS = /* css */ `
.editrix-dialog-overlay {
  position: fixed; inset: 0; z-index: 99999;
  display: flex; align-items: center; justify-content: center;
  background: var(--editrix-overlay, rgba(0, 0, 0, 0.5));
  animation: editrix-dialog-fade 120ms ease-out;
}
.editrix-dialog {
  min-width: 360px; max-width: min(560px, 90vw);
  background: var(--editrix-surface, #2c2c32);
  color: var(--editrix-text, #ccc);
  border: 1px solid var(--editrix-border, #444);
  border-radius: 8px;
  padding: 20px;
  font-family: inherit; font-size: 13px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
  animation: editrix-dialog-pop 140ms ease-out;
}
.editrix-dialog-title {
  font-size: 14px; font-weight: 600; margin-bottom: 12px;
}
.editrix-dialog-message {
  font-size: 13px; line-height: 1.5; margin-bottom: 8px;
  white-space: pre-line;
}
.editrix-dialog-detail {
  font-size: 12px; line-height: 1.45;
  color: var(--editrix-text-dim, #8a8a92);
  margin-bottom: 8px; white-space: pre-line;
}
.editrix-dialog-input {
  width: 100%; box-sizing: border-box;
  background: var(--editrix-background, #414141);
  color: var(--editrix-text, #ccc);
  border: 1px solid var(--editrix-border, #444);
  border-radius: 6px;
  padding: 8px 12px; font-size: 13px; font-family: inherit;
  outline: none; margin-top: 8px;
}
.editrix-dialog-input:focus {
  border-color: var(--editrix-accent, #4a8fff);
}
.editrix-dialog-error {
  margin-top: 6px; font-size: 12px;
  color: var(--editrix-error, #e06c75);
}
.editrix-dialog-buttons {
  display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;
}
.editrix-dialog-btn {
  border-radius: 6px; cursor: pointer;
  font-family: inherit; font-size: 13px;
  padding: 6px 16px; border: 1px solid transparent;
}
.editrix-dialog-btn[data-variant='default'] {
  background: var(--editrix-background, #333);
  color: var(--editrix-text, #ccc);
  border-color: var(--editrix-border, #555);
}
.editrix-dialog-btn[data-variant='default']:hover {
  background: var(--editrix-tab-active, #3a3a40);
}
.editrix-dialog-btn[data-variant='primary'] {
  background: var(--editrix-accent, #4a8fff);
  color: var(--editrix-accent-text, #fff);
}
.editrix-dialog-btn[data-variant='primary']:hover { filter: brightness(1.1); }
.editrix-dialog-btn[data-variant='destructive'] {
  background: var(--editrix-error, #e55561);
  color: #fff;
}
.editrix-dialog-btn[data-variant='destructive']:hover { filter: brightness(1.1); }
.editrix-dialog-btn:focus-visible {
  outline: 2px solid var(--editrix-accent, #4a8fff);
  outline-offset: 2px;
}
@keyframes editrix-dialog-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes editrix-dialog-pop {
  from { opacity: 0; transform: translateY(-4px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0)    scale(1);    }
}
`;
