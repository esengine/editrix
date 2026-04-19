import { createServiceId, type IDisposable, type Event } from '@editrix/common';

// ─── Field Schema ──────────────────────────────────────────

export type FieldType = 'float' | 'int' | 'bool' | 'string' | 'color' | 'enum' | 'asset' | 'entity';

export interface ComponentFieldSchema {
    readonly key: string;
    readonly label: string;
    readonly type: FieldType;
    readonly defaultValue: unknown;
    readonly group: string;
    readonly min?: number;
    readonly max?: number;
    readonly step?: number;
    readonly enumValues?: readonly string[];
}

// ─── Scene Data (serialization) ────────────────────────────

export interface SerializedEntity {
    readonly id: number;
    readonly name: string;
    readonly components: Record<string, Record<string, unknown>>;
    readonly children: number[];
    /**
     * Per-entity editor/tooling metadata that survives scene round-trip.
     * Not interpreted by the ECS — callers namespace their own keys
     * (e.g. 'inspectorComponentOrder').
     */
    readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface SceneData {
    readonly version: number;
    readonly name: string;
    readonly entities: SerializedEntity[];
}

// ─── Events ────────────────────────────────────────────────

export interface EntityEvent {
    readonly entityId: number;
    readonly name: string;
}

export interface ComponentEvent {
    readonly entityId: number;
    readonly component: string;
}

export interface PropertyEvent {
    readonly entityId: number;
    readonly component: string;
    readonly field: string;
    readonly value: unknown;
}

// ─── IECSSceneService ──────────────────────────────────────

export interface IECSSceneService extends IDisposable {
    // Entity lifecycle
    createEntity(name: string, parentId?: number): number;
    destroyEntity(entityId: number): void;

    // Hierarchy
    getParent(entityId: number): number | null;
    getChildren(entityId: number): readonly number[];
    getRootEntities(): readonly number[];
    reparent(entityId: number, newParentId: number | null): void;
    /** Move to a new (parent, index). Cycle-guarded. `newIndex` undefined = append. */
    moveEntity(entityId: number, newParentId: number | null, newIndex?: number): void;
    /** Atomic batch move — sources land as a contiguous block at newIndex. */
    moveEntities(entityIds: readonly number[], newParentId: number | null, newIndex?: number): void;

    // Metadata
    getName(entityId: number): string;
    setName(entityId: number, name: string): void;

    // Components
    addComponent(entityId: number, componentName: string): void;
    removeComponent(entityId: number, componentName: string): void;
    hasComponent(entityId: number, componentName: string): boolean;
    getComponents(entityId: number): readonly string[];

    // Properties
    getProperty(entityId: number, componentName: string, fieldPath: string): unknown;
    setProperty(entityId: number, componentName: string, fieldPath: string, value: unknown): void;
    getComponentData(entityId: number, componentName: string): Record<string, unknown>;

    // Schema
    getComponentSchema(componentName: string): readonly ComponentFieldSchema[];
    getAvailableComponents(): readonly string[];

    // Per-entity metadata (editor/tooling state, round-tripped via SerializedEntity.metadata)
    getEntityMetadata(entityId: number, key: string): unknown;
    setEntityMetadata(entityId: number, key: string, value: unknown): void;

    // Events
    readonly onEntityCreated: Event<EntityEvent>;
    readonly onEntityDestroyed: Event<{ entityId: number }>;
    readonly onComponentAdded: Event<ComponentEvent>;
    readonly onComponentRemoved: Event<ComponentEvent>;
    readonly onPropertyChanged: Event<PropertyEvent>;
    readonly onHierarchyChanged: Event<void>;
    readonly onMetadataChanged: Event<{ entityId: number; key: string; value: unknown }>;

    // Serialization
    serialize(): SceneData;
    deserialize(data: SceneData): void;

    // Rendering
    requestRender(): void;

    /** Handles for runtime App.connectCpp(registry, module). */
    getCppHandle(): { readonly module: unknown; readonly registry: unknown };
}

export const IECSSceneService = createServiceId<IECSSceneService>('IECSSceneService');
