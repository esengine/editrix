import { Emitter } from '@editrix/common';
import type {
    IECSSceneService, ComponentFieldSchema, SceneData, SerializedEntity,
    EntityEvent, ComponentEvent, PropertyEvent,
} from './ecs-scene-service.js';
import type { ESEngineModule, CppRegistry, VectorString } from './estella-service.js';

/** Convert Emscripten VectorString to JS array and delete the vector. */
function vecToArray(vec: VectorString): string[] {
    const result: string[] = [];
    const len = vec.size();
    for (let i = 0; i < len; i++) {
        result.push(vec.get(i));
    }
    vec.delete();
    return result;
}

/** Editor-side entity metadata (not stored in WASM). */
interface EntityMeta {
    name: string;
    parentId: number | null;
    childIds: number[];
    /** Namespaced bag for editor/tooling state (e.g. inspectorComponentOrder). */
    extras: Record<string, unknown>;
}

/**
 * ECS Scene Service — wraps estella WASM editor API.
 *
 * estella ECS is the single source of truth for component data.
 * This service manages entity metadata (name, hierarchy) on the JS side
 * and delegates component CRUD + property access to WASM.
 */
export class ECSSceneService implements IECSSceneService {
    private readonly _module: ESEngineModule;
    private readonly _registry: CppRegistry;
    private readonly _entities = new Map<number, EntityMeta>();
    private _rootIds: number[] = [];
    private readonly _schemas = new Map<string, ComponentFieldSchema[]>();
    private _availableComponents: string[] = [];
    private readonly _renderCallback: (() => void) | undefined;

    // Events
    private readonly _onEntityCreated = new Emitter<EntityEvent>();
    private readonly _onEntityDestroyed = new Emitter<{ entityId: number }>();
    private readonly _onComponentAdded = new Emitter<ComponentEvent>();
    private readonly _onComponentRemoved = new Emitter<ComponentEvent>();
    private readonly _onPropertyChanged = new Emitter<PropertyEvent>();
    private readonly _onHierarchyChanged = new Emitter<void>();

    readonly onEntityCreated = this._onEntityCreated.event;
    readonly onEntityDestroyed = this._onEntityDestroyed.event;
    readonly onComponentAdded = this._onComponentAdded.event;
    readonly onComponentRemoved = this._onComponentRemoved.event;
    readonly onPropertyChanged = this._onPropertyChanged.event;
    readonly onHierarchyChanged = this._onHierarchyChanged.event;

    constructor(module: ESEngineModule, registry: CppRegistry, renderCallback?: () => void) {
        this._module = module;
        this._registry = registry;
        this._renderCallback = renderCallback;
        this._loadSchemas();
    }

    // ── Schema ──────────────────────────────────────────────

    private _loadSchemas(): void {
        this._availableComponents = vecToArray(this._module.editor_getComponentNames());

        for (const name of this._availableComponents) {
            const json = this._module.editor_getComponentSchema(name);
            try {
                const raw = JSON.parse(json) as { key: string; type: string; group: string; values?: string[] }[];
                const fields: ComponentFieldSchema[] = raw.map((f) => ({
                    key: f.key,
                    label: this._humanize(f.key),
                    type: f.type as ComponentFieldSchema['type'],
                    defaultValue: this._defaultForType(f.type),
                    group: f.group,
                    ...(f.values ? { enumValues: f.values } : {}),
                }));
                this._schemas.set(name, fields);
            } catch {
                this._schemas.set(name, []);
            }
        }
    }

    private _humanize(key: string): string {
        const parts = key.split('.');
        const leaf = parts.length > 1 ? parts[parts.length - 1] ?? key : key;
        return leaf
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .replace(/[_-]/g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase());
    }

    private _defaultForType(type: string): unknown {
        switch (type) {
            case 'float': return 0;
            case 'int': return 0;
            case 'bool': return false;
            case 'string': return '';
            case 'color': return { r: 1, g: 1, b: 1, a: 1 };
            case 'asset': return 0;
            case 'entity': return 0;
            case 'enum': return 0;
            default: return 0;
        }
    }

    getComponentSchema(componentName: string): readonly ComponentFieldSchema[] {
        return this._schemas.get(componentName) ?? [];
    }

    getAvailableComponents(): readonly string[] {
        return this._availableComponents;
    }

    // ── Per-entity Metadata ─────────────────────────────────

    getEntityMetadata(entityId: number, key: string): unknown {
        return this._entities.get(entityId)?.extras[key];
    }

    setEntityMetadata(entityId: number, key: string, value: unknown): void {
        const meta = this._entities.get(entityId);
        if (!meta) return;
        if (value === undefined) {
            // Reflect.deleteProperty avoids the @typescript-eslint/no-dynamic-delete
            // warning that fires on the literal `delete obj[key]` form.
            Reflect.deleteProperty(meta.extras, key);
        } else {
            meta.extras[key] = value;
        }
    }

    // ── Entity Lifecycle ────────────────────────────────────

    createEntity(name: string, parentId?: number): number {
        const entityId = this._registry.create();

        // Add Transform by default (all entities have a transform)
        this._module.editor_addComponent(this._registry, entityId, 'Transform');

        const meta: EntityMeta = {
            name,
            parentId: parentId ?? null,
            childIds: [],
            extras: {},
        };
        this._entities.set(entityId, meta);

        if (parentId !== undefined) {
            const parentMeta = this._entities.get(parentId);
            if (parentMeta) {
                parentMeta.childIds.push(entityId);
                this._registry.setParent(entityId, parentId);
            }
        } else {
            this._rootIds.push(entityId);
        }

        this._onEntityCreated.fire({ entityId, name });
        this._onHierarchyChanged.fire();
        this.requestRender();
        return entityId;
    }

    destroyEntity(entityId: number): void {
        const meta = this._entities.get(entityId);
        if (!meta) return;

        // Recursively destroy children first
        for (const childId of [...meta.childIds]) {
            this.destroyEntity(childId);
        }

        // Remove from parent
        if (meta.parentId !== null) {
            const parentMeta = this._entities.get(meta.parentId);
            if (parentMeta) {
                parentMeta.childIds = parentMeta.childIds.filter((id) => id !== entityId);
            }
        } else {
            this._rootIds = this._rootIds.filter((id) => id !== entityId);
        }

        this._registry.destroy(entityId);
        this._entities.delete(entityId);

        this._onEntityDestroyed.fire({ entityId });
        this._onHierarchyChanged.fire();
        this.requestRender();
    }

    // ── Hierarchy ───────────────────────────────────────────

    getParent(entityId: number): number | null {
        return this._entities.get(entityId)?.parentId ?? null;
    }

    getChildren(entityId: number): readonly number[] {
        return this._entities.get(entityId)?.childIds ?? [];
    }

    getRootEntities(): readonly number[] {
        return this._rootIds;
    }

    reparent(entityId: number, newParentId: number | null): void {
        const meta = this._entities.get(entityId);
        if (!meta) return;

        // Remove from old parent
        if (meta.parentId !== null) {
            const oldParent = this._entities.get(meta.parentId);
            if (oldParent) {
                oldParent.childIds = oldParent.childIds.filter((id) => id !== entityId);
            }
        } else {
            this._rootIds = this._rootIds.filter((id) => id !== entityId);
        }

        // Add to new parent
        meta.parentId = newParentId;
        if (newParentId !== null) {
            const newParent = this._entities.get(newParentId);
            if (newParent) {
                newParent.childIds.push(entityId);
            }
            this._registry.setParent(entityId, newParentId);
        } else {
            this._rootIds.push(entityId);
        }

        this._onHierarchyChanged.fire();
    }

    // ── Metadata ────────────────────────────────────────────

    getName(entityId: number): string {
        return this._entities.get(entityId)?.name ?? '';
    }

    setName(entityId: number, name: string): void {
        const meta = this._entities.get(entityId);
        if (meta) {
            meta.name = name;
        }
    }

    // ── Components ──────────────────────────────────────────

    addComponent(entityId: number, componentName: string): void {
        if (this._module.editor_addComponent(this._registry, entityId, componentName)) {
            this._onComponentAdded.fire({ entityId, component: componentName });
            this.requestRender();
        }
    }

    removeComponent(entityId: number, componentName: string): void {
        if (this._module.editor_removeComponent(this._registry, entityId, componentName)) {
            this._onComponentRemoved.fire({ entityId, component: componentName });
            this.requestRender();
        }
    }

    hasComponent(entityId: number, componentName: string): boolean {
        return this._module.editor_hasComponent(this._registry, entityId, componentName);
    }

    getComponents(entityId: number): readonly string[] {
        return vecToArray(this._module.editor_getComponents(this._registry, entityId));
    }

    // ── Properties ──────────────────────────────────────────

    getProperty(entityId: number, componentName: string, fieldPath: string): unknown {
        const schema = this._schemas.get(componentName);
        if (!schema) return undefined;

        const field = schema.find((f) => f.key === fieldPath);
        if (!field) return undefined;

        switch (field.type) {
            case 'float':
            case 'color':
                return this._module.editor_getFloat(this._registry, entityId, componentName, fieldPath);
            case 'int':
            case 'enum':
            case 'asset':
            case 'entity':
                return this._module.editor_getInt(this._registry, entityId, componentName, fieldPath);
            case 'bool':
                return this._module.editor_getBool(this._registry, entityId, componentName, fieldPath);
            case 'string':
                return ''; // String properties not yet supported in editor API
            default:
                return undefined;
        }
    }

    setProperty(entityId: number, componentName: string, fieldPath: string, value: unknown): void {
        const schema = this._schemas.get(componentName);
        if (!schema) return;

        const field = schema.find((f) => f.key === fieldPath);
        if (!field) return;

        let success = false;
        switch (field.type) {
            case 'float':
            case 'color':
                success = this._module.editor_setFloat(this._registry, entityId, componentName, fieldPath, value as number);
                break;
            case 'int':
            case 'enum':
            case 'asset':
            case 'entity':
                success = this._module.editor_setInt(this._registry, entityId, componentName, fieldPath, value as number);
                break;
            case 'bool':
                success = this._module.editor_setBool(this._registry, entityId, componentName, fieldPath, value as boolean);
                break;
            case 'string':
                // String properties not yet supported in editor API
                break;
        }

        if (success) {
            this._onPropertyChanged.fire({ entityId, component: componentName, field: fieldPath, value });
            this.requestRender();
        }
    }

    getComponentData(entityId: number, componentName: string): Record<string, unknown> {
        const schema = this._schemas.get(componentName);
        if (!schema) return {};

        const data: Record<string, unknown> = {};
        for (const field of schema) {
            data[field.key] = this.getProperty(entityId, componentName, field.key);
        }
        return data;
    }

    // ── Serialization ───────────────────────────────────────

    serialize(): SceneData {
        const entities: SerializedEntity[] = [];

        const serializeEntity = (entityId: number): void => {
            const meta = this._entities.get(entityId);
            if (!meta) return;

            const components: Record<string, Record<string, unknown>> = {};
            for (const compName of this.getComponents(entityId)) {
                components[compName] = this.getComponentData(entityId, compName);
            }

            const hasExtras = Object.keys(meta.extras).length > 0;
            entities.push({
                id: entityId,
                name: meta.name,
                components,
                children: [...meta.childIds],
                ...(hasExtras ? { metadata: { ...meta.extras } } : {}),
            });

            for (const childId of meta.childIds) {
                serializeEntity(childId);
            }
        };

        for (const rootId of this._rootIds) {
            serializeEntity(rootId);
        }

        return { version: 1, name: 'Scene', entities };
    }

    deserialize(data: SceneData): void {
        // Clear existing entities
        for (const rootId of [...this._rootIds]) {
            this.destroyEntity(rootId);
        }

        // ID remapping: serialized ID → runtime Entity
        const idMap = new Map<number, number>();

        // Phase 1: create all entities
        for (const entityData of data.entities) {
            const entityId = this._registry.create();
            idMap.set(entityData.id, entityId);
            this._entities.set(entityId, {
                name: entityData.name,
                parentId: null,
                childIds: [],
                extras: entityData.metadata ? { ...entityData.metadata } : {},
            });
        }

        // Phase 2: establish hierarchy
        for (const entityData of data.entities) {
            const entityId = idMap.get(entityData.id);
            if (entityId === undefined) continue;
            for (const childSerializedId of entityData.children) {
                const childId = idMap.get(childSerializedId);
                if (childId === undefined) continue;
                const meta = this._entities.get(entityId);
                const childMeta = this._entities.get(childId);
                if (meta && childMeta) {
                    meta.childIds.push(childId);
                    childMeta.parentId = entityId;
                    this._registry.setParent(childId, entityId);
                }
            }
        }

        // Compute roots
        this._rootIds = [];
        for (const entityData of data.entities) {
            const entityId = idMap.get(entityData.id);
            if (entityId === undefined) continue;
            const meta = this._entities.get(entityId);
            if (meta?.parentId === null) {
                this._rootIds.push(entityId);
            }
        }

        // Phase 3: add components and set properties
        for (const entityData of data.entities) {
            const entityId = idMap.get(entityData.id);
            if (entityId === undefined) continue;
            for (const [compName, compData] of Object.entries(entityData.components)) {
                this._module.editor_addComponent(this._registry, entityId, compName);
                for (const [field, value] of Object.entries(compData)) {
                    this.setProperty(entityId, compName, field, value);
                }
            }
        }

        this._onHierarchyChanged.fire();
        this.requestRender();
    }

    // ── Rendering ───────────────────────────────────────────

    requestRender(): void {
        this._renderCallback?.();
    }

    // ── Dispose ─────────────────────────────────────────────

    dispose(): void {
        this._onEntityCreated.dispose();
        this._onEntityDestroyed.dispose();
        this._onComponentAdded.dispose();
        this._onComponentRemoved.dispose();
        this._onPropertyChanged.dispose();
        this._onHierarchyChanged.dispose();
    }
}
