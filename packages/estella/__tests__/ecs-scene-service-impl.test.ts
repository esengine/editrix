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
import { ECSSceneService } from '../src/ecs-scene-service-impl';
import type {
    ESEngineModule,
    CppRegistry,
    VectorString,
} from '../src/estella-service';

// ── Fake registry + module ────────────────────────────────────

interface FakeComponent {
    fields: Map<string, number | boolean>;
}

function vec(items: string[]): VectorString {
    return {
        size: () => items.length,
        get: (i: number) => items[i],
        delete: () => { /* no-op */ },
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
        setParent: (child, parent) => { state.parents.set(child, parent); },
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
            constructor() { Object.assign(this, registry); }
        } as unknown as new () => CppRegistry,
        initRendererWithContext: () => true,
        shutdownRenderer: () => { /* no-op */ },
        renderFrame: () => { /* no-op */ },
        renderFrameWithMatrix: () => { /* no-op */ },
        _malloc: () => 0,
        _free: () => { /* no-op */ },
        HEAPF32: new Float32Array(0),
        GL: { registerContext: () => 0 },
        editor_getComponentNames: () => vec(Object.keys(schema)),
        editor_getComponentSchema: (name: string) => JSON.stringify(
            (schema[name] ?? []).map(f => ({ key: f.key, type: f.type, group: f.group ?? 'General' })),
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
    ScrollView: [
        { key: 'contentEntity', type: 'entity' },
    ],
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
        const newParent = newRoots.find(id => svc.getName(id) === 'Parent')!;
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
        svc.onVisibilityChanged(ev => events.push(ev));

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
        svc.onVisibilityChanged(ev => events.push(ev));
        svc.setVisible(e, true); // already true
        expect(events).toHaveLength(0);
    });

    it('serialize omits visible when true; emits visible=false when hidden', () => {
        const svc = makeService();
        const a = svc.createEntity('A');
        const b = svc.createEntity('B');
        svc.setVisible(b, false);

        const data = svc.serialize();
        const ea = data.entities.find(e => e.name === 'A')!;
        const eb = data.entities.find(e => e.name === 'B')!;
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
            entities: [
                { id: 1, name: 'Legacy', components: {}, children: [] },
            ],
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

describe('ECSSceneService — combined: ref + visibility + metadata round-trip', () => {
    beforeEach(() => { /* fresh service per test */ });

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
