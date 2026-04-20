/**
 * Tests for ECSSceneService — focused on the round-trip invariants the
 * editor relies on:
 *   1. Entity-typed component fields survive serialize→deserialize
 *      (the bug found during prefab readiness audit: refs were left as
 *      stale runtime ids and pointed at the wrong entity after reload).
 *   2. Per-entity visibility round-trips and stays mirrored to the engine
 *      `Disabled` tag so renderer state matches editor intent.
 *   3. Editor-side metadata round-trips (asset:* refs, debug markers).
 *
 * The service talks to the WASM module via a small set of `editor_*` calls
 * and a `CppRegistry`. Both are faked in JS — the fake mirrors enough of
 * the contract to exercise the JS-side bookkeeping. Real WASM coverage
 * lives in the engine SDK's own tests; here we want fast unit signal on
 * the bridge code.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { IEcsSdkAdapter } from '../src/ecs-sdk-adapter';
import type { ComponentFieldSchema } from '../src/ecs-scene-service';
import { ECSSceneService } from '../src/ecs-scene-service-impl';
import type { ESEngineModule, CppRegistry, VectorString } from '../src/estella-service';

// ── Fake registry + module ────────────────────────────────────

interface FakeComponent {
  fields: Map<string, number | boolean>;
}

function vec(items: string[]): VectorString {
  return {
    size: () => items.length,
    get: (i: number) => items[i],
    delete: () => {
      /* no-op */
    },
  };
}

function makeFakeWasm(schema: Record<string, { key: string; type: string; group?: string }[]>): {
  module: ESEngineModule;
  registry: CppRegistry;
  state: {
    nextId: number;
    components: Map<number, Map<string, FakeComponent>>;
    parents: Map<number, number>;
  };
} {
  const state = {
    nextId: 1,
    components: new Map<number, Map<string, FakeComponent>>(),
    parents: new Map<number, number>(),
  };

  const registry: CppRegistry = {
    create: () => {
      const id = state.nextId++;
      state.components.set(id, new Map());
      return id;
    },
    destroy: (entity: number) => {
      state.components.delete(entity);
      state.parents.delete(entity);
    },
    valid: (entity: number) => state.components.has(entity),
    entityCount: () => state.components.size,
    setParent: (child, parent) => {
      state.parents.set(child, parent);
    },
  };

  const ensure = (entity: number): Map<string, FakeComponent> => {
    let bag = state.components.get(entity);
    if (!bag) {
      bag = new Map();
      state.components.set(entity, bag);
    }
    return bag;
  };

  const module = {
    Registry: class {
      constructor() {
        Object.assign(this, registry);
      }
    } as unknown as new () => CppRegistry,
    initRendererWithContext: () => true,
    shutdownRenderer: () => {
      /* no-op */
    },
    renderFrame: () => {
      /* no-op */
    },
    renderFrameWithMatrix: () => {
      /* no-op */
    },
    _malloc: () => 0,
    _free: () => {
      /* no-op */
    },
    HEAPF32: new Float32Array(0),
    GL: { registerContext: () => 0 },
    editor_getComponentNames: () => vec(Object.keys(schema)),
    editor_getComponentSchema: (name: string) =>
      JSON.stringify(
        (schema[name] ?? []).map((f) => ({
          key: f.key,
          type: f.type,
          group: f.group ?? 'General',
        })),
      ),
    editor_addComponent: (_reg, entity, name) => {
      const bag = ensure(entity);
      if (bag.has(name)) return false;
      bag.set(name, { fields: new Map() });
      return true;
    },
    editor_removeComponent: (_reg, entity, name) => {
      const bag = ensure(entity);
      return bag.delete(name);
    },
    editor_hasComponent: (_reg, entity, name) => ensure(entity).has(name),
    editor_getComponents: (_reg, entity) => vec([...ensure(entity).keys()]),
    editor_setFloat: (_reg, entity, comp, field, value) => {
      const c = ensure(entity).get(comp);
      if (!c) return false;
      c.fields.set(field, value);
      return true;
    },
    editor_getFloat: (_reg, entity, comp, field) => {
      const c = ensure(entity).get(comp);
      const v = c?.fields.get(field);
      return typeof v === 'number' ? v : 0;
    },
    editor_setInt: (_reg, entity, comp, field, value) => {
      const c = ensure(entity).get(comp);
      if (!c) return false;
      c.fields.set(field, value);
      return true;
    },
    editor_getInt: (_reg, entity, comp, field) => {
      const c = ensure(entity).get(comp);
      const v = c?.fields.get(field);
      return typeof v === 'number' ? v : 0;
    },
    editor_setBool: (_reg, entity, comp, field, value) => {
      const c = ensure(entity).get(comp);
      if (!c) return false;
      c.fields.set(field, value);
      return true;
    },
    editor_getBool: (_reg, entity, comp, field) => {
      const c = ensure(entity).get(comp);
      const v = c?.fields.get(field);
      return typeof v === 'boolean' ? v : false;
    },
  } as unknown as ESEngineModule;

  return { module, registry, state };
}

// Schema covering the field types the bridge exercises.
const SCHEMA = {
  Transform: [
    { key: 'position.x', type: 'float' },
    { key: 'position.y', type: 'float' },
  ],
  ScrollView: [{ key: 'contentEntity', type: 'entity' }],
  Sprite: [
    { key: 'texture', type: 'asset' },
    { key: 'enabled', type: 'bool' },
  ],
  // Tag — has no fields; presence/absence is the signal.
  Disabled: [],
};

// ── Fixtures ──────────────────────────────────────────────────

function makeService(): ECSSceneService {
  const { module, registry } = makeFakeWasm(SCHEMA);
  return new ECSSceneService(module, registry);
}

// ── Tests ─────────────────────────────────────────────────────

describe('ECSSceneService — entity ref remap on round-trip', () => {
  it('rewrites entity refs through the deserialization id map', () => {
    const svc = makeService();

    // Author: parent (with ScrollView pointing at the child)
    const parent = svc.createEntity('Parent');
    const child = svc.createEntity('Child', parent);
    svc.addComponent(parent, 'ScrollView');
    svc.setProperty(parent, 'ScrollView', 'contentEntity', child);

    const beforeRef = svc.getProperty(parent, 'ScrollView', 'contentEntity');
    expect(beforeRef).toBe(child);

    // Round-trip
    const data = svc.serialize();
    svc.deserialize(data);

    // After deserialize, runtime ids change but the ref must follow.
    const newRoots = svc.getRootEntities();
    const newParent = newRoots.find((id) => svc.getName(id) === 'Parent')!;
    const newChild = svc.getChildren(newParent)[0];
    expect(newParent).toBeDefined();
    expect(newChild).toBeDefined();

    const remapped = svc.getProperty(newParent, 'ScrollView', 'contentEntity');
    expect(remapped).toBe(newChild);
    expect(remapped).not.toBe(beforeRef); // proves the id actually changed
  });

  it('clears refs to entities that are not in the loaded scene', () => {
    const svc = makeService();
    const a = svc.createEntity('Owner');
    svc.addComponent(a, 'ScrollView');
    // Hand-craft scene data with a dangling ref (id 999 doesn't exist).
    const data = {
      version: 1,
      name: 'Scene',
      entities: [
        {
          id: a,
          name: 'Owner',
          components: {
            Transform: { 'position.x': 0, 'position.y': 0 },
            ScrollView: { contentEntity: 999 },
          },
          children: [],
        },
      ],
    };
    svc.deserialize(data);
    const root = svc.getRootEntities()[0];
    expect(svc.getProperty(root, 'ScrollView', 'contentEntity')).toBe(0);
  });

  it('leaves non-entity-typed fields alone', () => {
    const svc = makeService();
    const e = svc.createEntity('E');
    svc.addComponent(e, 'Sprite');
    svc.setProperty(e, 'Sprite', 'enabled', true);
    const data = svc.serialize();
    svc.deserialize(data);
    const root = svc.getRootEntities()[0];
    expect(svc.getProperty(root, 'Sprite', 'enabled')).toBe(true);
  });
});

describe('ECSSceneService — visibility persistence', () => {
  it('defaults to visible=true on newly created entities', () => {
    const svc = makeService();
    const e = svc.createEntity('E');
    expect(svc.getVisible(e)).toBe(true);
  });

  it('setVisible(false) adds the Disabled tag and fires onVisibilityChanged', () => {
    const svc = makeService();
    const e = svc.createEntity('E');
    const events: { entityId: number; visible: boolean }[] = [];
    svc.onVisibilityChanged((ev) => events.push(ev));

    svc.setVisible(e, false);
    expect(svc.getVisible(e)).toBe(false);
    expect(svc.hasComponent(e, 'Disabled')).toBe(true);
    expect(events).toEqual([{ entityId: e, visible: false }]);

    svc.setVisible(e, true);
    expect(svc.getVisible(e)).toBe(true);
    expect(svc.hasComponent(e, 'Disabled')).toBe(false);
    expect(events).toEqual([
      { entityId: e, visible: false },
      { entityId: e, visible: true },
    ]);
  });

  it('setVisible to the same value is a no-op (no event, no Disabled toggling)', () => {
    const svc = makeService();
    const e = svc.createEntity('E');
    const events: unknown[] = [];
    svc.onVisibilityChanged((ev) => events.push(ev));
    svc.setVisible(e, true); // already true
    expect(events).toHaveLength(0);
  });

  it('serialize omits visible when true; emits visible=false when hidden', () => {
    const svc = makeService();
    const a = svc.createEntity('A');
    const b = svc.createEntity('B');
    svc.setVisible(b, false);

    const data = svc.serialize();
    const ea = data.entities.find((e) => e.name === 'A')!;
    const eb = data.entities.find((e) => e.name === 'B')!;
    expect(ea.visible).toBeUndefined();
    expect(eb.visible).toBe(false);
    // Disabled is the wire form of visible=false; it should NOT be
    // mirrored into the components dict (the top-level field carries it).
    expect(eb.components.Disabled).toBeUndefined();
  });

  it('deserialize restores visible state and re-applies the Disabled tag', () => {
    const svc = makeService();
    const e = svc.createEntity('E');
    svc.setVisible(e, false);

    const data = svc.serialize();
    svc.deserialize(data);

    const restored = svc.getRootEntities()[0];
    expect(svc.getVisible(restored)).toBe(false);
    expect(svc.hasComponent(restored, 'Disabled')).toBe(true);
  });

  it('round-trips correctly when deserialize sees a missing visible field (defaults to true)', () => {
    const svc = makeService();
    // Hand-craft scene data without the visible field — represents older
    // saved scenes from before the field existed.
    svc.deserialize({
      version: 1,
      name: 'Scene',
      entities: [{ id: 1, name: 'Legacy', components: {}, children: [] }],
    });
    const e = svc.getRootEntities()[0];
    expect(svc.getVisible(e)).toBe(true);
    expect(svc.hasComponent(e, 'Disabled')).toBe(false);
  });
});

describe('ECSSceneService — editor metadata round-trip', () => {
  it('preserves per-entity metadata across serialize/deserialize', () => {
    const svc = makeService();
    const e = svc.createEntity('E');
    svc.setEntityMetadata(e, 'asset:Sprite.texture', 'uuid-abc');
    svc.setEntityMetadata(e, 'debug:autoSpin', true);

    const data = svc.serialize();
    svc.deserialize(data);
    const restored = svc.getRootEntities()[0];

    expect(svc.getEntityMetadata(restored, 'asset:Sprite.texture')).toBe('uuid-abc');
    expect(svc.getEntityMetadata(restored, 'debug:autoSpin')).toBe(true);
  });
});

// ── SDK adapter fake ─────────────────────────────────────────

/**
 * Mimics the runtime App's ScriptStorage well enough to exercise the
 * service's SDK routing: components live in a per-entity Map, schema is
 * pulled from a fixed table, cleanup loops attached components.
 */
function makeFakeAdapter(schemas: Record<string, ComponentFieldSchema[]>): IEcsSdkAdapter & {
  readonly _storage: Map<string, Map<number, Record<string, unknown>>>;
} {
  const storage = new Map<string, Map<number, Record<string, unknown>>>();
  const names = Object.keys(schemas);
  for (const n of names) storage.set(n, new Map());

  const adapter: IEcsSdkAdapter & { readonly _storage: typeof storage } = {
    _storage: storage,
    list: () => names,
    has: (n) => storage.has(n),
    getSchema: (n) => schemas[n] ?? [],
    getDefaults: (n) =>
      schemas[n] ? Object.fromEntries(schemas[n].map((f) => [f.key, f.defaultValue])) : undefined,
    entityHas: (id, n) => storage.get(n)?.has(id) === true,
    entityComponents: (id) => {
      const out: string[] = [];
      for (const [name, bag] of storage) if (bag.has(id)) out.push(name);
      return out;
    },
    insert: (id, n, data) => {
      const bag = storage.get(n);
      if (!bag) return false;
      const defaults = Object.fromEntries((schemas[n] ?? []).map((f) => [f.key, f.defaultValue]));
      bag.set(id, { ...defaults, ...(data ?? {}) });
      return true;
    },
    remove: (id, n) => storage.get(n)?.delete(id) === true,
    getData: (id, n) => {
      const bag = storage.get(n);
      const v = bag?.get(id);
      return v ? { ...v } : undefined;
    },
    setField: (id, n, fieldPath, value) => {
      const bag = storage.get(n);
      const data = bag?.get(id);
      if (!data) return false;
      if (fieldPath.includes('.')) {
        const [head, rest] = [
          fieldPath.slice(0, fieldPath.indexOf('.')),
          fieldPath.slice(fieldPath.indexOf('.') + 1),
        ];
        const inner = data[head];
        if (inner === null || typeof inner !== 'object') return false;
        (inner as Record<string, unknown>)[rest] = value;
        return true;
      }
      data[fieldPath] = value;
      return true;
    },
    cleanupEntity: (id) => {
      for (const bag of storage.values()) bag.delete(id);
    },
  };
  return adapter;
}

describe('ECSSceneService — SDK component routing', () => {
  const SDK_SCHEMAS: Record<string, ComponentFieldSchema[]> = {
    SpriteAnimator: [
      {
        key: 'clip',
        label: 'Clip',
        type: 'asset',
        defaultValue: '',
        group: 'SpriteAnimator',
        assetType: 'anim-clip',
      },
      { key: 'speed', label: 'Speed', type: 'float', defaultValue: 1.0, group: 'SpriteAnimator' },
      {
        key: 'playing',
        label: 'Playing',
        type: 'bool',
        defaultValue: true,
        group: 'SpriteAnimator',
      },
    ],
  };

  it('merges WASM + SDK names in getAvailableComponents, sorted predictably', () => {
    const svc = makeService();
    expect(svc.getAvailableComponents()).toEqual(['Transform', 'ScrollView', 'Sprite', 'Disabled']);
    svc.attachSdkAdapter(makeFakeAdapter(SDK_SCHEMAS));
    // SDK entries are appended after WASM, in alphabetical order.
    expect(svc.getAvailableComponents()).toEqual([
      'Transform',
      'ScrollView',
      'Sprite',
      'Disabled',
      'SpriteAnimator',
    ]);
  });

  it('routes add / has / getComponents / remove through the adapter', () => {
    const svc = makeService();
    const adapter = makeFakeAdapter(SDK_SCHEMAS);
    svc.attachSdkAdapter(adapter);
    const e = svc.createEntity('E');

    svc.addComponent(e, 'SpriteAnimator');
    expect(svc.hasComponent(e, 'SpriteAnimator')).toBe(true);
    expect(svc.getComponents(e)).toContain('SpriteAnimator');

    svc.removeComponent(e, 'SpriteAnimator');
    expect(svc.hasComponent(e, 'SpriteAnimator')).toBe(false);
    expect(svc.getComponents(e)).not.toContain('SpriteAnimator');
  });

  it('getProperty / setProperty route to adapter for SDK fields, including dot-paths', () => {
    const svc = makeService();
    const adapter = makeFakeAdapter({
      MyComp: [
        { key: 'scalar', label: 'Scalar', type: 'float', defaultValue: 0, group: 'MyComp' },
        { key: 'vec.x', label: 'Vec X', type: 'float', defaultValue: 0, group: 'MyComp' },
        { key: 'vec.y', label: 'Vec Y', type: 'float', defaultValue: 0, group: 'MyComp' },
      ],
    });
    svc.attachSdkAdapter(adapter);
    const e = svc.createEntity('E');

    // Seed nested data — adapter doesn't build shape from schema alone.
    adapter.insert(e, 'MyComp', { scalar: 0, vec: { x: 0, y: 0 } });

    svc.setProperty(e, 'MyComp', 'scalar', 3);
    svc.setProperty(e, 'MyComp', 'vec.x', 7);

    expect(svc.getProperty(e, 'MyComp', 'scalar')).toBe(3);
    expect(svc.getProperty(e, 'MyComp', 'vec.x')).toBe(7);
    expect(svc.getProperty(e, 'MyComp', 'vec.y')).toBe(0);
  });

  it('serializes + deserializes SDK components alongside WASM', () => {
    const svc = makeService();
    const adapter = makeFakeAdapter(SDK_SCHEMAS);
    svc.attachSdkAdapter(adapter);

    const e = svc.createEntity('E');
    svc.addComponent(e, 'SpriteAnimator');
    svc.setProperty(e, 'SpriteAnimator', 'speed', 2.5);

    const data = svc.serialize();
    expect(data.entities[0]?.components['SpriteAnimator']).toBeDefined();
    expect(data.entities[0]?.components['SpriteAnimator']).toMatchObject({
      speed: 2.5,
      playing: true,
    });

    svc.deserialize(data);
    const restored = svc.getRootEntities()[0];
    expect(restored).toBeDefined();
    if (restored === undefined) return;
    expect(svc.hasComponent(restored, 'SpriteAnimator')).toBe(true);
    expect(svc.getProperty(restored, 'SpriteAnimator', 'speed')).toBe(2.5);
  });

  it('destroyEntity cleans up the adapter storage', () => {
    const svc = makeService();
    const adapter = makeFakeAdapter(SDK_SCHEMAS);
    svc.attachSdkAdapter(adapter);

    const e = svc.createEntity('E');
    svc.addComponent(e, 'SpriteAnimator');
    expect(adapter.entityHas(e, 'SpriteAnimator')).toBe(true);

    svc.destroyEntity(e);
    expect(adapter.entityHas(e, 'SpriteAnimator')).toBe(false);
  });

  it('buffers unknown components at deserialize time and flushes on attach', () => {
    const svc = makeService();
    // NB: no adapter attached yet. Scene names an unknown component.
    svc.deserialize({
      version: 1,
      name: 'S',
      entities: [
        {
          id: 1,
          name: 'E',
          components: { SpriteAnimator: { clip: '', speed: 3, playing: true } },
          children: [],
        },
      ],
    });
    // Without an adapter, SpriteAnimator isn't visible yet.
    const e = svc.getRootEntities()[0];
    expect(e).toBeDefined();
    if (e === undefined) return;
    expect(svc.hasComponent(e, 'SpriteAnimator')).toBe(false);

    // Attach the adapter. The pending component should flush in.
    const adapter = makeFakeAdapter(SDK_SCHEMAS);
    svc.attachSdkAdapter(adapter);
    expect(svc.hasComponent(e, 'SpriteAnimator')).toBe(true);
    expect(svc.getProperty(e, 'SpriteAnimator', 'speed')).toBe(3);
  });

  it('preserves pending components through serialize when adapter is absent', () => {
    const svc = makeService();
    svc.deserialize({
      version: 1,
      name: 'S',
      entities: [
        {
          id: 1,
          name: 'E',
          components: { MysteryComp: { x: 42 } },
          children: [],
        },
      ],
    });
    const data = svc.serialize();
    expect(data.entities[0]?.components['MysteryComp']).toEqual({ x: 42 });
  });
});

describe('ECSSceneService — combined: ref + visibility + metadata round-trip', () => {
  beforeEach(() => {
    /* fresh service per test */
  });

  it('survives a save/load cycle with all editor invariants intact', () => {
    const svc = makeService();
    const root = svc.createEntity('Root');
    const child = svc.createEntity('Child', root);
    svc.addComponent(root, 'ScrollView');
    svc.setProperty(root, 'ScrollView', 'contentEntity', child);
    svc.setVisible(child, false);
    svc.setEntityMetadata(root, 'inspectorComponentOrder', ['Transform', 'ScrollView']);

    // Two save/load cycles to catch ids that drift after the first one.
    let data = svc.serialize();
    svc.deserialize(data);
    data = svc.serialize();
    svc.deserialize(data);

    const newRoot = svc.getRootEntities()[0];
    const newChild = svc.getChildren(newRoot)[0];
    expect(svc.getProperty(newRoot, 'ScrollView', 'contentEntity')).toBe(newChild);
    expect(svc.getVisible(newChild)).toBe(false);
    expect(svc.hasComponent(newChild, 'Disabled')).toBe(true);
    expect(svc.getEntityMetadata(newRoot, 'inspectorComponentOrder')).toEqual([
      'Transform',
      'ScrollView',
    ]);
  });
});
