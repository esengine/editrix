import { describe, expect, it } from 'vitest';
import { deriveAllSchemas, deriveComponentSchema } from '../src/component-schema.js';

describe('deriveComponentSchema', () => {
  it('flags color fields from the colorKeys hint', () => {
    const schema = deriveComponentSchema('Sprite', {
      defaults: { tint: { r: 1, g: 1, b: 1, a: 1 } },
      colorKeys: ['tint'],
    });
    expect(schema).toEqual([
      {
        key: 'tint',
        label: 'Tint',
        type: 'color',
        defaultValue: { r: 1, g: 1, b: 1, a: 1 },
        group: 'Sprite',
      },
    ]);
  });

  it('flags asset fields from the assetFields hint', () => {
    const schema = deriveComponentSchema('Sprite', {
      defaults: { texture: '' },
      assetFields: ['texture'],
    });
    expect(schema[0]?.type).toBe('asset');
  });

  it('expands a Vec3 default into three float fields', () => {
    const schema = deriveComponentSchema('Transform', {
      defaults: { position: { x: 1, y: 2, z: 3 } },
    });
    expect(schema.map((f) => f.key)).toEqual(['position.x', 'position.y', 'position.z']);
    expect(schema.every((f) => f.type === 'float')).toBe(true);
  });

  it('infers primitive types from value shape', () => {
    const schema = deriveComponentSchema('X', {
      defaults: { speed: 2, enabled: true, tag: 'hero' },
    });
    const byKey = Object.fromEntries(schema.map((f) => [f.key, f.type]));
    expect(byKey).toEqual({ speed: 'float', enabled: 'bool', tag: 'string' });
  });

  it('humanises camelCase keys for labels', () => {
    const [field] = deriveComponentSchema('X', { defaults: { maxHealth: 10 } });
    expect(field?.label).toBe('Max Health');
  });

  it('skips unknown value shapes without throwing', () => {
    const schema = deriveComponentSchema('X', {
      defaults: { mystery: { foo: 'bar' } },
    });
    expect(schema).toHaveLength(0);
  });
});

describe('deriveAllSchemas', () => {
  it('skips components that produce no schema', () => {
    const map = deriveAllSchemas({
      Real: { defaults: { value: 1 } },
      Empty: { defaults: { mystery: { foo: 'bar' } } },
    });
    expect(map.has('Real')).toBe(true);
    expect(map.has('Empty')).toBe(false);
  });
});
