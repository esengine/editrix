import { describe, expect, it, vi } from 'vitest';
import { createServiceId } from '@editrix/common';
import { ServiceRegistry } from '@editrix/core';
import { CommandRegistry } from '../src/command-registry.js';

describe('CommandRegistry', () => {
  function setup() {
    const services = new ServiceRegistry();
    const registry = new CommandRegistry(services);
    return { services, registry };
  }

  it('should register and retrieve a command', () => {
    const { registry } = setup();
    registry.register({ id: 'test.cmd', title: 'Test', execute() {} });

    expect(registry.has('test.cmd')).toBe(true);
    expect(registry.getCommand('test.cmd')?.title).toBe('Test');
  });

  it('should throw when registering duplicate command ID', () => {
    const { registry } = setup();
    registry.register({ id: 'test.cmd', title: 'Test', execute() {} });

    expect(() => registry.register({ id: 'test.cmd', title: 'Test2', execute() {} })).toThrow(
      'Command "test.cmd" is already registered.',
    );
  });

  it('should unregister when disposable is disposed', () => {
    const { registry } = setup();
    const d = registry.register({ id: 'test.cmd', title: 'Test', execute() {} });

    d.dispose();
    expect(registry.has('test.cmd')).toBe(false);
  });

  it('should execute a command', async () => {
    const { registry } = setup();
    const handler = vi.fn();
    registry.register({ id: 'test.cmd', title: 'Test', execute: handler });

    await registry.execute('test.cmd', 'arg1', 42);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]![1]).toBe('arg1');
    expect(handler.mock.calls[0]![2]).toBe(42);
  });

  it('should throw when executing unregistered command', async () => {
    const { registry } = setup();

    await expect(registry.execute('nonexistent')).rejects.toThrow(
      'Command "nonexistent" is not registered.',
    );
  });

  it('should provide service accessor to command handler', async () => {
    const { services, registry } = setup();
    const IGreeter = createServiceId<{ greet(): string }>('IGreeter');
    services.register(IGreeter, { greet: () => 'hello' });

    let greeting = '';
    registry.register({
      id: 'test.greet',
      title: 'Greet',
      execute(accessor) {
        greeting = accessor.get(IGreeter).greet();
      },
    });

    await registry.execute('test.greet');
    expect(greeting).toBe('hello');
  });

  it('should return all commands', () => {
    const { registry } = setup();
    registry.register({ id: 'a', title: 'A', execute() {} });
    registry.register({ id: 'b', title: 'B', execute() {} });

    const all = registry.getAll();
    expect(all).toHaveLength(2);
  });

  it('should fire onDidChangeCommands on register and unregister', () => {
    const { registry } = setup();
    const handler = vi.fn();
    registry.onDidChangeCommands(handler);

    const d = registry.register({ id: 'a', title: 'A', execute() {} });
    expect(handler).toHaveBeenCalledTimes(1);

    d.dispose();
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
