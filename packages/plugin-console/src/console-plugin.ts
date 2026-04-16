import { ICommandRegistry } from '@editrix/commands';
import { createServiceId } from '@editrix/common';
import type { IPlugin, IPluginContext } from '@editrix/core';
import { ISettingsService } from '@editrix/core';
import { ILayoutService } from '@editrix/layout';
import { IViewService } from '@editrix/view';
import { SettingsBinding } from '@editrix/view-dom';
import type { LogLevel } from './console-widget.js';
import { ConsoleWidget } from './console-widget.js';

/**
 * Service interface for the console — allows other plugins to log messages.
 */
export interface IConsoleService {
  /** Log a message to the console panel. */
  log(level: LogLevel, message: string, source?: string): void;
  /** Clear all console entries. */
  clear(): void;
}

/** Service identifier for DI. */
export const IConsoleService = createServiceId<IConsoleService>('IConsoleService');

/**
 * Console panel plugin.
 *
 * Registers a Console panel with log output, provides {@link IConsoleService}
 * for other plugins to log messages, and listens to the event bus to
 * automatically capture framework events.
 *
 * @example
 * ```ts
 * kernel.registerPlugin(ConsolePlugin);
 * await kernel.start();
 *
 * const console = kernel.services.get(IConsoleService);
 * console.log('info', 'Plugin loaded successfully', 'my-plugin');
 * ```
 */
export const ConsolePlugin: IPlugin = {
  descriptor: {
    id: 'editrix.console',
    version: '0.1.0',
    dependencies: ['editrix.commands', 'editrix.layout', 'editrix.view'],
  },

  activate(ctx: IPluginContext) {
    const layout = ctx.services.get(ILayoutService);
    const view = ctx.services.get(IViewService);
    const commands = ctx.services.get(ICommandRegistry);
    const settings = ctx.services.get(ISettingsService);

    // Register console settings
    ctx.subscriptions.add(
      settings.registerGroup({
        id: 'editrix.console',
        label: 'Console',
        settings: [
          { key: 'editrix.console.maxEntries', label: 'Max Log Entries', type: 'number', defaultValue: 1000, description: 'Maximum number of log entries to keep before oldest are removed' },
          { key: 'editrix.console.showTimestamp', label: 'Show Timestamps', type: 'boolean', defaultValue: true, description: 'Display timestamps next to log entries' },
          { key: 'editrix.console.fontSize', label: 'Font Size', type: 'range', defaultValue: 12, min: 10, max: 20, step: 1, description: 'Font size for console log entries' },
          { key: 'editrix.console.captureKernelEvents', label: 'Capture Kernel Events', type: 'boolean', defaultValue: true, description: 'Automatically log kernel events (plugin activation etc.)' },
        ],
      }),
    );

    let consoleWidget: ConsoleWidget | undefined;

    // Buffer messages that arrive before the widget is mounted
    const buffer: { level: LogLevel; message: string; source: string | undefined }[] = [];

    const binding = new SettingsBinding(settings);
    ctx.subscriptions.add(binding);

    ctx.subscriptions.add(
      view.registerFactory('console', (id) => {
        consoleWidget = new ConsoleWidget(id);
        return consoleWidget;
      }),
    );

    // When the widget is mounted: flush buffer + bind settings reactively
    ctx.subscriptions.add(
      view.onDidChangeWidgets((panelId) => {
        if (panelId === 'console' && consoleWidget) {
          // Flush buffered messages
          for (const entry of buffer) {
            consoleWidget.log(entry.level, entry.message, entry.source);
          }
          buffer.length = 0;

          // Reactive settings binding — changes apply immediately
          const root = consoleWidget.getRootElement();
          if (root) {
            binding.bindStyle(root, 'editrix.console.fontSize', 'fontSize', 'px');
          }
        }
      }),
    );

    ctx.subscriptions.add(
      layout.registerPanel({
        id: 'console',
        title: 'Console',
        defaultRegion: 'bottom',
        closable: true,
      }),
    );

    const consoleService: IConsoleService = {
      log(level: LogLevel, message: string, source?: string) {
        if (consoleWidget) {
          consoleWidget.log(level, message, source);
        } else {
          buffer.push({ level, message, source });
        }
      },
      clear() {
        buffer.length = 0;
        consoleWidget?.clear();
      },
    };
    ctx.subscriptions.add(ctx.services.register(IConsoleService, consoleService));

    ctx.subscriptions.add(
      commands.register({
        id: 'console.clear',
        title: 'Clear Console',
        category: 'Console',
        execute() {
          consoleService.clear();
        },
      }),
    );

    ctx.subscriptions.add(
      commands.register({
        id: 'console.show',
        title: 'Show Console',
        category: 'Console',
        execute() {
          layout.openPanel('console');
        },
      }),
    );

    // Kernel event capture — controlled by settings
    if (settings.get('editrix.console.captureKernelEvents')) {
      ctx.subscriptions.add(
        ctx.events.onWild('plugin.*', (eventId, data) => {
          consoleService.log('debug', `${eventId}: ${String(data)}`, 'kernel');
        }),
      );
    }

    layout.openPanel('console');
    consoleService.log('info', 'Editrix Console ready');
  },
};
