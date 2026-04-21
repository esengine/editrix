import { CommandsPluginId, ICommandRegistry, IKeybindingService } from '@editrix/commands';
import type { IPlugin, IPluginContext } from '@editrix/core';
import {
  IClipboardService,
  IDialogService,
  INotificationService,
  IProgressService,
} from '@editrix/core';
import { ILayoutService, LayoutPluginId } from '@editrix/layout';
import { IViewAdapter, IViewService, ViewPluginId } from '@editrix/view';
import { NavigatorClipboardService } from './clipboard-service.js';
import { injectDefaultStyles } from './default-styles.js';
import { DomDialogService } from './dialog-service.js';
import type { DomViewAdapterOptions } from './dom-view-adapter.js';
import { DomViewAdapter } from './dom-view-adapter.js';
import { DomNotificationService } from './notification-service.js';
import { DomProgressRenderer } from './progress-renderer.js';

/** Stable plugin id — dependents should import this rather than hard-coding the string. */
export const ViewDomPluginId = 'editrix.view-dom' as const;

/**
 * Create the DOM view plugin with optional configuration.
 *
 * This plugin depends on {@link CommandsPluginId}, {@link LayoutPluginId}, and
 * {@link ViewPluginId}. It creates a {@link DomViewAdapter} and registers it
 * as the {@link IViewAdapter}.
 *
 * @example
 * ```ts
 * kernel.registerPlugin(createDomViewPlugin());
 * // or with custom theme:
 * kernel.registerPlugin(createDomViewPlugin({ theme: myTheme }));
 * ```
 */
export function createDomViewPlugin(options?: DomViewAdapterOptions): IPlugin {
  return {
    descriptor: {
      id: ViewDomPluginId,
      version: '0.1.0',
      dependencies: [CommandsPluginId, LayoutPluginId, ViewPluginId],
    },
    activate(ctx: IPluginContext) {
      injectDefaultStyles();

      const layoutService = ctx.services.get(ILayoutService);
      const viewService = ctx.services.get(IViewService);
      const commandRegistry = ctx.services.get(ICommandRegistry);
      const keybindingService = ctx.services.get(IKeybindingService);

      const adapter = new DomViewAdapter(
        layoutService,
        viewService,
        commandRegistry,
        keybindingService,
        options,
      );
      ctx.subscriptions.add(adapter);
      ctx.subscriptions.add(ctx.services.register(IViewAdapter, adapter));

      const dialogs = new DomDialogService();
      ctx.subscriptions.add(ctx.services.register(IDialogService, dialogs));

      const notifications = new DomNotificationService();
      ctx.subscriptions.add(notifications);
      ctx.subscriptions.add(ctx.services.register(INotificationService, notifications));

      const clipboard = new NavigatorClipboardService();
      ctx.subscriptions.add(ctx.services.register(IClipboardService, clipboard));

      const progress = ctx.services.get(IProgressService);
      ctx.subscriptions.add(new DomProgressRenderer(progress));
    },
  };
}
