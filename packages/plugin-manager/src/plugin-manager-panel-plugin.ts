import { CommandsPluginId, ICommandRegistry } from '@editrix/commands';
import type { IPlugin, IPluginContext } from '@editrix/core';
import { IPluginManager } from '@editrix/core';
import { ILayoutService, LayoutPluginId } from '@editrix/layout';
import { IViewAdapter, IViewService, ViewPluginId } from '@editrix/view';
import type { DomViewAdapter } from '@editrix/view-dom';
import { ViewDomPluginId } from '@editrix/view-dom';
import { PluginDetailWidget } from './plugin-detail-widget.js';
import { PluginManagerWidget } from './plugin-manager-widget.js';

/** Stable plugin id — dependents should import this rather than hard-coding the string. */
export const PluginManagerPanelPluginId = 'editrix.plugin-manager' as const;

/**
 * Plugin management panel plugin.
 *
 * Sidebar: plugin list. Clicking a row opens a detail tab in the main area.
 */
export const PluginManagerPanelPlugin: IPlugin = {
  descriptor: {
    id: PluginManagerPanelPluginId,
    version: '0.1.0',
    dependencies: [CommandsPluginId, LayoutPluginId, ViewPluginId, ViewDomPluginId],
  },

  activate(ctx: IPluginContext) {
    const commands = ctx.services.get(ICommandRegistry);
    const manager = ctx.services.get(IPluginManager);
    const layout = ctx.services.get(ILayoutService);
    const view = ctx.services.get(IViewService);
    const viewAdapter = ctx.services.get(IViewAdapter) as DomViewAdapter;

    // Track which detail panels are registered to avoid duplicates
    const registeredDetails = new Set<string>();

    const openPluginDetail = (pluginId: string): void => {
      const panelId = `plugin-detail:${pluginId}`;

      if (!registeredDetails.has(panelId)) {
        const info = manager.getInfo(pluginId);
        const title = info ? info.manifest.name : pluginId;

        layout.registerPanel({ id: panelId, title, defaultRegion: 'center', closable: true });
        view.registerFactory(panelId, (id) => new PluginDetailWidget(id, pluginId, manager));
        registeredDetails.add(panelId);
      }

      layout.openPanel(panelId);
    };

    // Sidebar view — pass the click callback
    ctx.subscriptions.add(
      viewAdapter.sidebar.registerView(
        'plugins',
        (id) => new PluginManagerWidget(id, manager, openPluginDetail),
      ),
    );

    ctx.subscriptions.add(
      viewAdapter.activityBar.addView({
        id: 'plugins',
        title: 'Plugins',
        icon: 'extensions',
        priority: 200,
      }),
    );

    ctx.subscriptions.add(
      commands.register({
        id: 'plugins.show',
        title: 'Show Plugin Manager',
        category: 'Plugins',
        execute() {
          viewAdapter.activityBar.setActiveView('plugins');
        },
      }),
    );
  },
};
