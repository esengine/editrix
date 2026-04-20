import type { IPlugin, IPluginContext } from '@editrix/core';
import { IEstellaService, EstellaService } from './estella-service.js';

/**
 * Editrix plugin that registers IEstellaService.
 * Provides WASM module loading and lifecycle management.
 */
export const EstellaPlugin: IPlugin = {
  descriptor: {
    id: 'editrix.estella',
    version: '0.1.0',
  },
  activate(ctx: IPluginContext) {
    const service = new EstellaService();
    ctx.services.register(IEstellaService, service);
    ctx.subscriptions.add(service);
  },
};
