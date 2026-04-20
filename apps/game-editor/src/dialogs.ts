/**
 * Lightweight modal dialogs used across the editor's UI plugins.
 *
 * These are intentionally vanilla DOM rather than view-dom widgets — modals
 * are short-lived, top-level, and don't need to participate in the layout
 * system. Sharing them here keeps app plugins (Hierarchy, Inspector, etc.)
 * from each rolling their own `prompt()` replacement.
 */

interface DialogOptions {
  /** Initial value populated in the input. */
  readonly initialValue?: string;
  /** Placeholder shown when input is empty. */
  readonly placeholder?: string;
  /** Submit-button label. Defaults to "OK". */
  readonly okLabel?: string;
}

const OVERLAY_STYLE = `
  position:fixed;inset:0;background:rgba(0,0,0,0.5);
  display:flex;align-items:center;justify-content:center;z-index:99999;
`;

const DIALOG_STYLE = `
  background:#2c2c32;border:1px solid #444;border-radius:8px;
  padding:20px;min-width:360px;color:#ccc;font-family:inherit;
`;

const INPUT_STYLE = `
  width:100%;box-sizing:border-box;background:#414141;border:none;
  color:#ccc;padding:8px 12px;border-radius:6px;font-size:13px;
  font-family:inherit;outline:none;margin-bottom:16px;
`;

const BTN_BASE = `
  border-radius:6px;cursor:pointer;font-family:inherit;font-size:13px;
  padding:6px 16px;
`;

const BTN_CANCEL = `${BTN_BASE} background:#333;border:1px solid #555;color:#ccc;`;
const BTN_OK = `${BTN_BASE} background:#4a8fff;border:none;color:#fff;`;
const BTN_DESTRUCTIVE = `${BTN_BASE} background:#e55561;border:none;color:#fff;`;

/**
 * Prompt the user for a string. Resolves with the entered value, or null on
 * cancel / Escape / overlay click.
 */
export function showInputDialog(
  title: string,
  options: DialogOptions = {},
): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = OVERLAY_STYLE;

    const dialog = document.createElement('div');
    dialog.style.cssText = DIALOG_STYLE;

    const label = document.createElement('div');
    label.textContent = title;
    label.style.cssText = 'font-size:14px;font-weight:600;margin-bottom:12px;';
    dialog.appendChild(label);

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = options.placeholder ?? '';
    input.value = options.initialValue ?? '';
    input.style.cssText = INPUT_STYLE;
    dialog.appendChild(input);

    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = BTN_CANCEL;
    cancelBtn.addEventListener('click', () => {
      overlay.remove();
      resolve(null);
    });
    buttons.appendChild(cancelBtn);

    const okBtn = document.createElement('button');
    okBtn.textContent = options.okLabel ?? 'OK';
    okBtn.style.cssText = BTN_OK;
    okBtn.addEventListener('click', () => {
      overlay.remove();
      resolve(input.value || null);
    });
    buttons.appendChild(okBtn);

    dialog.appendChild(buttons);
    overlay.appendChild(dialog);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(null);
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        overlay.remove();
        resolve(input.value || null);
      }
      if (e.key === 'Escape') {
        overlay.remove();
        resolve(null);
      }
    });

    document.body.appendChild(overlay);
    input.focus();
    input.select();
  });
}

interface ConfirmOptions {
  /** Confirm-button label. Defaults to "OK". */
  readonly okLabel?: string;
  /** When true, the confirm button uses the destructive (red) style. */
  readonly destructive?: boolean;
}

export type ThreeChoice = 'save' | 'discard' | 'cancel';

export function showThreeChoiceDialog(
  message: string,
  options: { saveLabel?: string; discardLabel?: string; cancelLabel?: string } = {},
): Promise<ThreeChoice> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = OVERLAY_STYLE;

    const dialog = document.createElement('div');
    dialog.style.cssText = DIALOG_STYLE;

    const text = document.createElement('div');
    text.textContent = message;
    text.style.cssText = 'font-size:13px;line-height:1.5;margin-bottom:16px;white-space:pre-line;';
    dialog.appendChild(text);

    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;';

    const discardBtn = document.createElement('button');
    discardBtn.textContent = options.discardLabel ?? "Don't Save";
    discardBtn.style.cssText = BTN_DESTRUCTIVE;
    discardBtn.addEventListener('click', () => {
      cleanup();
      resolve('discard');
    });
    buttons.appendChild(discardBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = options.cancelLabel ?? 'Cancel';
    cancelBtn.style.cssText = BTN_CANCEL;
    cancelBtn.addEventListener('click', () => {
      cleanup();
      resolve('cancel');
    });
    buttons.appendChild(cancelBtn);

    const saveBtn = document.createElement('button');
    saveBtn.textContent = options.saveLabel ?? 'Save';
    saveBtn.style.cssText = BTN_OK;
    saveBtn.addEventListener('click', () => {
      cleanup();
      resolve('save');
    });
    buttons.appendChild(saveBtn);

    dialog.appendChild(buttons);
    overlay.appendChild(dialog);

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        cleanup();
        resolve('cancel');
      }
    };
    document.addEventListener('keydown', onKey);

    function cleanup(): void {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }

    document.body.appendChild(overlay);
    saveBtn.focus();
  });
}

/**
 * Confirm a yes/no decision. Resolves true on confirm, false on cancel.
 */
export function showConfirmDialog(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = OVERLAY_STYLE;

    const dialog = document.createElement('div');
    dialog.style.cssText = DIALOG_STYLE;

    const text = document.createElement('div');
    text.textContent = message;
    text.style.cssText = 'font-size:13px;line-height:1.5;margin-bottom:16px;';
    dialog.appendChild(text);

    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = BTN_CANCEL;
    cancelBtn.addEventListener('click', () => {
      overlay.remove();
      resolve(false);
    });
    buttons.appendChild(cancelBtn);

    const okBtn = document.createElement('button');
    okBtn.textContent = options.okLabel ?? 'OK';
    okBtn.style.cssText = options.destructive ? BTN_DESTRUCTIVE : BTN_OK;
    okBtn.addEventListener('click', () => {
      overlay.remove();
      resolve(true);
    });
    buttons.appendChild(okBtn);

    dialog.appendChild(buttons);
    overlay.appendChild(dialog);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(false);
      }
    });

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Enter') {
        overlay.remove();
        resolve(true);
        document.removeEventListener('keydown', onKey);
      }
      if (e.key === 'Escape') {
        overlay.remove();
        resolve(false);
        document.removeEventListener('keydown', onKey);
      }
    };
    document.addEventListener('keydown', onKey);

    document.body.appendChild(overlay);
    okBtn.focus();
  });
}
