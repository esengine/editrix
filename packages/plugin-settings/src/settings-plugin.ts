import { ICommandRegistry } from '@editrix/commands';
import type { IPlugin, IPluginContext } from '@editrix/core';
import { ISettingsService } from '@editrix/core';
import { IViewAdapter } from '@editrix/view';
import type { DomViewAdapter } from '@editrix/view-dom';
import { SettingsWidget } from './settings-widget.js';

/**
 * Settings panel plugin. Adds a "Settings" view to the sidebar
 * that auto-generates controls from all registered setting groups.
 */
export const SettingsPlugin: IPlugin = {
  descriptor: {
    id: 'editrix.settings',
    version: '0.1.0',
    dependencies: ['editrix.commands', 'editrix.view', 'editrix.view-dom'],
  },

  activate(ctx: IPluginContext) {
    const commands = ctx.services.get(ICommandRegistry);
    const settings = ctx.services.get(ISettingsService);
    const viewAdapter = ctx.services.get(IViewAdapter) as DomViewAdapter;

    ctx.subscriptions.add(
      viewAdapter.sidebar.registerView(
        'settings',
        (id) => new SettingsWidget(id, settings),
      ),
    );

    ctx.subscriptions.add(
      viewAdapter.activityBar.addView({
        id: 'settings',
        title: 'Settings',
        icon: 'settings',
        priority: 900,
      }),
    );

    ctx.subscriptions.add(
      commands.register({
        id: 'settings.show',
        title: 'Open Settings',
        category: 'Preferences',
        execute() {
          viewAdapter.activityBar.setActiveView('settings');
        },
      }),
    );
  },
};
