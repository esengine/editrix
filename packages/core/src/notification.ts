/**
 * Notification (toast) service — non-modal status messages for the user.
 *
 * Use for feedback that doesn't require a decision: "Project saved",
 * "Failed to load asset", "Connected to server". For questions the user
 * must answer, use {@link IDialogService} instead.
 *
 * @example
 * ```ts
 * const notifications = services.get(INotificationService);
 * notifications.error('Could not save scene.', {
 *   detail: err.message,
 *   actions: [{ label: 'Retry', run: () => save() }],
 * });
 * ```
 */

import type { Event, IDisposable } from '@editrix/common';
import { createServiceId } from '@editrix/common';

/** Severity level — drives colour + default timeout. */
export type NotificationSeverity = 'info' | 'warn' | 'error';

/** A clickable action rendered on a toast. */
export interface NotificationAction {
  /** Button label. */
  readonly label: string;
  /** Invoked when the user clicks the action. The toast auto-dismisses after. */
  readonly run: () => void | Promise<void>;
}

/** Options controlling how a notification renders and dismisses. */
export interface NotificationOptions {
  /** Severity level — defaults to `info`. */
  readonly severity?: NotificationSeverity;
  /** Optional smaller body text under the message. */
  readonly detail?: string;
  /** Buttons rendered on the toast. */
  readonly actions?: readonly NotificationAction[];
  /**
   * Auto-dismiss timeout in ms. Pass `0` or a negative number to keep the
   * toast sticky until dismissed manually. When omitted, defaults are:
   * - `info`:  4000 ms
   * - `warn`:  6000 ms
   * - `error`: sticky
   */
  readonly timeout?: number;
}

/** A live notification handle — dispose to dismiss. */
export interface Notification extends IDisposable {
  /** Unique id assigned by the service. */
  readonly id: string;
  /** Severity at show time. */
  readonly severity: NotificationSeverity;
  /** The message passed to `show()`. */
  readonly message: string;
}

/**
 * Notification service.
 *
 * Notifications are shown in a stack at a platform-specific location
 * (bottom-right by default in the DOM implementation). They do not
 * interrupt the user and can be dismissed individually.
 */
export interface INotificationService {
  /** Show a notification with explicit severity. */
  show(message: string, options?: NotificationOptions): Notification;

  /** Convenience: `severity: 'info'`. */
  info(message: string, options?: Omit<NotificationOptions, 'severity'>): Notification;

  /** Convenience: `severity: 'warn'`. */
  warn(message: string, options?: Omit<NotificationOptions, 'severity'>): Notification;

  /** Convenience: `severity: 'error'`. */
  error(message: string, options?: Omit<NotificationOptions, 'severity'>): Notification;

  /** Dismiss a notification by id. No-op if already dismissed. */
  dismiss(id: string): void;

  /** Dismiss every visible notification. */
  dismissAll(): void;

  /** Fired after a notification becomes visible. */
  readonly onDidShow: Event<Notification>;

  /** Fired after a notification is dismissed. Carries the notification id. */
  readonly onDidDismiss: Event<string>;
}

export const INotificationService = createServiceId<INotificationService>('INotificationService');
