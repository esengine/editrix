import { describe, expect, it, vi } from 'vitest';
import type { PropertySchema } from '../src/property-schema.js';
import { PropertyService } from '../src/property-service.js';

const testSchema: PropertySchema = {
  id: 'transform',
  groups: [
    {
      id: 'transform',
      label: 'Transform',
      properties: [
        { key: 'position', label: 'Position', type: 'vector3' },
        { key: 'scale', label: 'Scale', type: 'vector3' },
      ],
    },
  ],
};

describe('PropertyService', () => {
  it('should register and retrieve a schema', () => {
    const service = new PropertyService();
    service.registerSchema(testSchema);
    expect(service.getSchema('transform')).toBe(testSchema);
  });

  it('should throw when registering duplicate schema', () => {
    const service = new PropertyService();
    service.registerSchema(testSchema);
    expect(() => service.registerSchema(testSchema)).toThrow(
      'Property schema "transform" is already registered.',
    );
  });

  it('should unregister schema when disposable is disposed', () => {
    const service = new PropertyService();
    const d = service.registerSchema(testSchema);
    d.dispose();
    expect(service.getSchema('transform')).toBeUndefined();
  });

  it('should set and get a single value', () => {
    const service = new PropertyService();
    service.setValue('node-1', 'position.x', 42);
    expect(service.getValue('node-1', 'position.x')).toBe(42);
  });

  it('should set multiple values at once', () => {
    const service = new PropertyService();
    service.setValues('node-1', { x: 1, y: 2, z: 3 });

    expect(service.getValue('node-1', 'x')).toBe(1);
    expect(service.getValue('node-1', 'y')).toBe(2);
    expect(service.getValue('node-1', 'z')).toBe(3);
  });

  it('should return all values for a target', () => {
    const service = new PropertyService();
    service.setValues('node-1', { a: 1, b: 2 });

    const values = service.getValues('node-1');
    expect(values).toEqual({ a: 1, b: 2 });
  });

  it('should return empty object for unknown target', () => {
    const service = new PropertyService();
    expect(service.getValues('nonexistent')).toEqual({});
  });

  it('should clear values for a target', () => {
    const service = new PropertyService();
    service.setValue('node-1', 'x', 10);
    service.clearValues('node-1');
    expect(service.getValue('node-1', 'x')).toBeUndefined();
  });

  it('should fire onDidChangeProperty on setValue', () => {
    const service = new PropertyService();
    const handler = vi.fn();
    service.onDidChangeProperty(handler);

    service.setValue('node-1', 'x', 42);

    expect(handler).toHaveBeenCalledWith({
      targetId: 'node-1',
      key: 'x',
      oldValue: undefined,
      newValue: 42,
    });
  });

  it('should fire onDidChangeProperty for each key in setValues', () => {
    const service = new PropertyService();
    const handler = vi.fn();
    service.onDidChangeProperty(handler);

    service.setValues('node-1', { a: 1, b: 2 });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('should fire onDidChangeSchemas on register/unregister', () => {
    const service = new PropertyService();
    const handler = vi.fn();
    service.onDidChangeSchemas(handler);

    const d = service.registerSchema(testSchema);
    expect(handler).toHaveBeenCalledTimes(1);

    d.dispose();
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
