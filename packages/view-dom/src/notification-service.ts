import type { Event, IDisposable } from '@editrix/common';
import { Emitter } from '@editrix/common';
import type {
  INotificationService,
  Notification,
  NotificationOptions,
  NotificationSeverity,
} from '@editrix/core';

const STYLE_ID = 'editrix-notification-styles';
const STACK_ID = 'editrix-notification-stack';

const DEFAULT_TIMEOUTS: Record<NotificationSeverity, number> = {
  info: 4000,
  warn: 6000,
  error: 0,
};

interface LiveToast {
  readonly notification: Notification;
  readonly element: HTMLDivElement;
  timer: ReturnType<typeof setTimeout> | undefined;
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = NOTIFICATION_CSS;
  document.head.appendChild(style);
}

function ensureStack(): HTMLDivElement {
  const existing = document.getElementById(STACK_ID);
  if (existing) return existing as HTMLDivElement;
  const stack = document.createElement('div');
  stack.id = STACK_ID;
  stack.className = 'editrix-notifications';
  document.body.appendChild(stack);
  return stack;
}

/**
 * DOM-based implementation of {@link INotificationService}. Toasts are
 * rendered in a stack at the bottom-right of the viewport.
 */
export class DomNotificationService implements INotificationService, IDisposable {
  private readonly _toasts = new Map<string, LiveToast>();
  private readonly _onDidShow = new Emitter<Notification>();
  private readonly _onDidDismiss = new Emitter<string>();
  private _seq = 0;

  readonly onDidShow: Event<Notification> = this._onDidShow.event;
  readonly onDidDismiss: Event<string> = this._onDidDismiss.event;

  show(message: string, options: NotificationOptions = {}): Notification {
    injectStyles();
    const stack = ensureStack();

    const severity = options.severity ?? 'info';
    const id = `notif-${String(++this._seq)}`;
    const element = this._buildToast(id, message, severity, options);
    stack.appendChild(element);

    const notification: Notification = {
      id,
      severity,
      message,
      dispose: () => {
        this.dismiss(id);
      },
    };
    const toast: LiveToast = { notification, element, timer: undefined };
    this._toasts.set(id, toast);

    const timeout = options.timeout ?? DEFAULT_TIMEOUTS[severity];
    if (timeout > 0) {
      toast.timer = setTimeout(() => {
        this.dismiss(id);
      }, timeout);
    }

    this._onDidShow.fire(notification);
    return notification;
  }

  info(message: string, options?: Omit<NotificationOptions, 'severity'>): Notification {
    return this.show(message, { ...options, severity: 'info' });
  }

  warn(message: string, options?: Omit<NotificationOptions, 'severity'>): Notification {
    return this.show(message, { ...options, severity: 'warn' });
  }

  error(message: string, options?: Omit<NotificationOptions, 'severity'>): Notification {
    return this.show(message, { ...options, severity: 'error' });
  }

  dismiss(id: string): void {
    const toast = this._toasts.get(id);
    if (!toast) return;
    this._toasts.delete(id);
    if (toast.timer !== undefined) clearTimeout(toast.timer);
    toast.element.classList.add('editrix-notification--leaving');
    const remove = (): void => {
      toast.element.remove();
    };
    toast.element.addEventListener('transitionend', remove, { once: true });
    setTimeout(remove, 250);
    this._onDidDismiss.fire(id);
  }

  dismissAll(): void {
    for (const id of [...this._toasts.keys()]) this.dismiss(id);
  }

  dispose(): void {
    this.dismissAll();
    this._onDidShow.dispose();
    this._onDidDismiss.dispose();
  }

  private _buildToast(
    id: string,
    message: string,
    severity: NotificationSeverity,
    options: NotificationOptions,
  ): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'editrix-notification';
    el.dataset['severity'] = severity;
    el.dataset['id'] = id;

    const body = document.createElement('div');
    body.className = 'editrix-notification-body';

    const msg = document.createElement('div');
    msg.className = 'editrix-notification-message';
    msg.textContent = message;
    body.appendChild(msg);

    if (options.detail !== undefined) {
      const detail = document.createElement('div');
      detail.className = 'editrix-notification-detail';
      detail.textContent = options.detail;
      body.appendChild(detail);
    }

    if (options.actions && options.actions.length > 0) {
      const row = document.createElement('div');
      row.className = 'editrix-notification-actions';
      for (const action of options.actions) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = action.label;
        btn.className = 'editrix-notification-action';
        btn.addEventListener('click', () => {
          void (async () => {
            try {
              await action.run();
            } finally {
              this.dismiss(id);
            }
          })();
        });
        row.appendChild(btn);
      }
      body.appendChild(row);
    }

    el.appendChild(body);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'editrix-notification-close';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '\u00D7'; // ×
    close.addEventListener('click', () => {
      this.dismiss(id);
    });
    el.appendChild(close);

    return el;
  }
}

const NOTIFICATION_CSS = /* css */ `
.editrix-notifications {
  position: fixed; bottom: 16px; right: 16px; z-index: 99998;
  display: flex; flex-direction: column-reverse; gap: 8px;
  max-width: min(380px, calc(100vw - 32px));
  pointer-events: none;
}
.editrix-notification {
  pointer-events: auto;
  display: flex; align-items: flex-start; gap: 10px;
  padding: 10px 12px;
  background: var(--editrix-surface, #2c2c32);
  color: var(--editrix-text, #ccc);
  border: 1px solid var(--editrix-border, #444);
  border-left-width: 3px;
  border-radius: 6px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.3);
  font-family: inherit; font-size: 13px;
  transform: translateX(0); opacity: 1;
  transition: transform 200ms ease, opacity 200ms ease;
}
.editrix-notification[data-severity='info']  { border-left-color: var(--editrix-accent, #4a8fff); }
.editrix-notification[data-severity='warn']  { border-left-color: var(--editrix-warning, #e5c07b); }
.editrix-notification[data-severity='error'] { border-left-color: var(--editrix-error, #e06c75); }
.editrix-notification--leaving { transform: translateX(24px); opacity: 0; }
.editrix-notification-body { flex: 1; min-width: 0; }
.editrix-notification-message { line-height: 1.4; word-wrap: break-word; }
.editrix-notification-detail {
  margin-top: 4px; font-size: 12px;
  color: var(--editrix-text-dim, #8a8a92); line-height: 1.4;
}
.editrix-notification-actions {
  margin-top: 8px; display: flex; gap: 6px; flex-wrap: wrap;
}
.editrix-notification-action {
  border: 1px solid var(--editrix-border, #555);
  background: transparent;
  color: var(--editrix-text, #ccc);
  padding: 3px 10px; border-radius: 4px;
  font-family: inherit; font-size: 12px; cursor: pointer;
}
.editrix-notification-action:hover { background: var(--editrix-tab-active, #3a3a40); }
.editrix-notification-close {
  flex: 0 0 auto;
  background: transparent; border: none;
  color: var(--editrix-text-dim, #8a8a92);
  font-size: 18px; line-height: 1; cursor: pointer;
  padding: 0 2px;
}
.editrix-notification-close:hover { color: var(--editrix-text, #ccc); }
`;
