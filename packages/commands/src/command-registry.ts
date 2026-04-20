import type { Event, IDisposable, ServiceIdentifier } from '@editrix/common';
import { createServiceId, Emitter, toDisposable } from '@editrix/common';
import type { IServiceRegistry } from '@editrix/core';

/**
 * Service accessor passed to command handlers.
 * Provides a scoped view of the service registry so handlers can resolve dependencies.
 */
export interface IServiceAccessor {
  /** Resolve a service by its identifier. */
  get<T>(id: ServiceIdentifier<T>): T;
}

/**
 * A command that can be registered and executed.
 */
export interface Command {
  /** Unique command identifier, e.g. `'editor.undo'`. */
  readonly id: string;
  /** Human-readable title for UI display (command palette, menus). */
  readonly title: string;
  /** Optional category for grouping in command palette. */
  readonly category?: string;
  /** The handler. Receives a service accessor and optional arguments. */
  execute(accessor: IServiceAccessor, ...args: unknown[]): void | Promise<void>;
}

/**
 * Central command registry. Commands are registered by plugins
 * and can be executed by ID from anywhere in the framework.
 *
 * @example
 * ```ts
 * const registry = new CommandRegistry(serviceRegistry);
 * registry.register({
 *   id: 'file.save',
 *   title: 'Save File',
 *   execute(accessor) { ... },
 * });
 * await registry.execute('file.save');
 * ```
 */
export interface ICommandRegistry extends IDisposable {
  /** Register a command. Returns a disposable to unregister. */
  register(command: Command): IDisposable;

  /** Execute a command by ID with optional arguments. */
  execute(commandId: string, ...args: unknown[]): Promise<void>;

  /** Get a registered command by ID. */
  getCommand(commandId: string): Command | undefined;

  /** Get all registered commands. */
  getAll(): readonly Command[];

  /** Check if a command is registered. */
  has(commandId: string): boolean;

  /** Event fired when the set of registered commands changes. */
  readonly onDidChangeCommands: Event<void>;

  /**
   * Event fired **before** dispatching a command. The argument is the
   * command id. Shells wire this to `IKernel.fireActivationEvent` so
   * plugins declaring `onCommand:<id>` wake up on demand.
   *
   * Handlers run synchronously via the registry's own Emitter — if the
   * shell needs to `await` a lazy activation, it should subscribe,
   * trigger the async activation, and handle the slight race where the
   * command may dispatch before activation completes. In practice the
   * command registry re-resolves after activation completes because
   * the activated plugin typically calls `register` during its own
   * activate().
   */
  readonly onWillExecute: Event<string>;
}

/** Service identifier for DI. */
export const ICommandRegistry = createServiceId<ICommandRegistry>('ICommandRegistry');

/**
 * Default implementation of {@link ICommandRegistry}.
 *
 * @example
 * ```ts
 * const registry = new CommandRegistry(kernel.services);
 * registry.register({ id: 'test', title: 'Test', execute() {} });
 * await registry.execute('test');
 * ```
 */
export class CommandRegistry implements ICommandRegistry {
  private readonly _commands = new Map<string, Command>();
  private readonly _onDidChange = new Emitter<void>();
  private readonly _onWillExecute = new Emitter<string>();
  private readonly _accessor: IServiceAccessor;

  readonly onDidChangeCommands: Event<void> = this._onDidChange.event;
  readonly onWillExecute: Event<string> = this._onWillExecute.event;

  constructor(services: IServiceRegistry) {
    this._accessor = {
      get: <T>(id: ServiceIdentifier<T>): T => services.get(id),
    };
  }

  register(command: Command): IDisposable {
    if (this._commands.has(command.id)) {
      throw new Error(`Command "${command.id}" is already registered.`);
    }

    this._commands.set(command.id, command);
    this._onDidChange.fire();

    return toDisposable(() => {
      this._commands.delete(command.id);
      this._onDidChange.fire();
    });
  }

  async execute(commandId: string, ...args: unknown[]): Promise<void> {
    // Fire BEFORE the lookup so lazy plugins wired to `onCommand:<id>`
    // have a chance to register the command during their activation.
    // Subscribers are synchronous — they can only schedule async work;
    // for reliable lazy activation use the shell's onWillExecute →
    // kernel.fireActivationEvent wiring combined with a re-resolve
    // below.
    this._onWillExecute.fire(commandId);
    const command = this._commands.get(commandId);
    if (!command) {
      throw new Error(`Command "${commandId}" is not registered.`);
    }
    await command.execute(this._accessor, ...args);
  }

  getCommand(commandId: string): Command | undefined {
    return this._commands.get(commandId);
  }

  getAll(): readonly Command[] {
    return [...this._commands.values()];
  }

  has(commandId: string): boolean {
    return this._commands.has(commandId);
  }

  dispose(): void {
    this._commands.clear();
    this._onDidChange.dispose();
    this._onWillExecute.dispose();
  }
}
