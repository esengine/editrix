import { createServiceId } from '@editrix/common';
import type { IPlugin, IPluginContext } from '@editrix/core';
import { CommandRegistry, ICommandRegistry } from './command-registry.js';
import type { IContextKeyService } from './context-key-service.js';
import { ContextKeyService } from './context-key-service.js';
import { IKeybindingService, KeybindingService } from './keybinding-service.js';

/** Service identifier for DI. */
export const IContextKeyServiceId = createServiceId<IContextKeyService>('IContextKeyService');

/** Stable plugin id — dependents should import this rather than hard-coding the string. */
export const CommandsPluginId = 'editrix.commands' as const;

/**
 * Built-in plugin that registers the command system services.
 *
 * Provides: {@link ICommandRegistry}, {@link IKeybindingService}, {@link IContextKeyService}.
 *
 * @example
 * ```ts
 * kernel.registerPlugin(CommandsPlugin);
 * await kernel.start();
 * const commands = kernel.services.get(ICommandRegistry);
 * ```
 */
export const CommandsPlugin: IPlugin = {
  descriptor: {
    id: CommandsPluginId,
    version: '0.1.0',
  },
  activate(ctx: IPluginContext) {
    const contextKeys = new ContextKeyService();
    const commandRegistry = new CommandRegistry(ctx.services);
    const keybindingService = new KeybindingService(contextKeys);

    ctx.subscriptions.add(contextKeys);
    ctx.subscriptions.add(commandRegistry);
    ctx.subscriptions.add(keybindingService);

    ctx.subscriptions.add(ctx.services.register(IContextKeyServiceId, contextKeys));
    ctx.subscriptions.add(ctx.services.register(ICommandRegistry, commandRegistry));
    ctx.subscriptions.add(ctx.services.register(IKeybindingService, keybindingService));
  },
};
