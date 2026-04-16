import type { IPlugin, IPluginContext } from '@editrix/core';
import { IPropertyService, PropertyService } from './property-service.js';
import { ISelectionService, SelectionService } from './selection-service.js';

/**
 * Built-in plugin that registers the property and selection services.
 *
 * @example
 * ```ts
 * kernel.registerPlugin(PropertiesPlugin);
 * await kernel.start();
 * const props = kernel.services.get(IPropertyService);
 * const selection = kernel.services.get(ISelectionService);
 * ```
 */
export const PropertiesPlugin: IPlugin = {
  descriptor: {
    id: 'editrix.properties',
    version: '0.1.0',
  },
  activate(ctx: IPluginContext) {
    const propertyService = new PropertyService();
    const selectionService = new SelectionService();

    ctx.subscriptions.add(propertyService);
    ctx.subscriptions.add(selectionService);

    ctx.subscriptions.add(ctx.services.register(IPropertyService, propertyService));
    ctx.subscriptions.add(ctx.services.register(ISelectionService, selectionService));
  },
};
