import { describe, expect, it, vi } from 'vitest';
import { createServiceId } from '@editrix/common';
import { ServiceRegistry } from '../src/service-registry.js';

interface ICounter {
  count: number;
  increment(): void;
}

const ICounter = createServiceId<ICounter>('ICounter');
const ILogger = createServiceId<{ log(msg: string): void }>('ILogger');

describe('ServiceRegistry', () => {
  it('should register and resolve a service instance', () => {
    const registry = new ServiceRegistry();
    const counter: ICounter = {
      count: 0,
      increment() {
        this.count++;
      },
    };

    registry.register(ICounter, counter);
    const resolved = registry.get(ICounter);

    expect(resolved).toBe(counter);
  });

  it('should throw when resolving an unregistered service', () => {
    const registry = new ServiceRegistry();

    expect(() => registry.get(ICounter)).toThrow('Service "ICounter" is not registered.');
  });

  it('should return undefined for getOptional on unregistered service', () => {
    const registry = new ServiceRegistry();

    expect(registry.getOptional(ICounter)).toBeUndefined();
  });

  it('should report has() correctly', () => {
    const registry = new ServiceRegistry();

    expect(registry.has(ICounter)).toBe(false);

    registry.register(ICounter, { count: 0, increment() {} });

    expect(registry.has(ICounter)).toBe(true);
  });

  it('should throw when registering a service twice', () => {
    const registry = new ServiceRegistry();
    registry.register(ICounter, { count: 0, increment() {} });

    expect(() =>
      registry.register(ICounter, { count: 0, increment() {} }),
    ).toThrow('Service "ICounter" is already registered.');
  });

  it('should unregister when the returned disposable is disposed', () => {
    const registry = new ServiceRegistry();
    const disposable = registry.register(ICounter, { count: 0, increment() {} });

    expect(registry.has(ICounter)).toBe(true);
    disposable.dispose();
    expect(registry.has(ICounter)).toBe(false);
  });

  it('should fire onDidChangeService when a service is registered', () => {
    const registry = new ServiceRegistry();
    const handler = vi.fn();

    registry.onDidChangeService(handler);
    registry.register(ICounter, { count: 0, increment() {} });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should fire onDidChangeService when a service is unregistered', () => {
    const registry = new ServiceRegistry();
    const handler = vi.fn();

    const disposable = registry.register(ICounter, { count: 0, increment() {} });
    registry.onDidChangeService(handler);

    disposable.dispose();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should support multiple different services', () => {
    const registry = new ServiceRegistry();
    const counter: ICounter = { count: 0, increment() {} };
    const logger = { log: vi.fn() };

    registry.register(ICounter, counter);
    registry.register(ILogger, logger);

    expect(registry.get(ICounter)).toBe(counter);
    expect(registry.get(ILogger)).toBe(logger);
  });

  it('should clean up on dispose', () => {
    const registry = new ServiceRegistry();
    registry.register(ICounter, { count: 0, increment() {} });

    registry.dispose();

    expect(registry.has(ICounter)).toBe(false);
  });
});
