import type { ComponentFieldSchema, FieldType } from './ecs-scene-service.js';

// ─── Component Metadata (matches estella SDK's COMPONENT_META shape) ──

export interface ComponentMeta {
    readonly defaults: Record<string, unknown>;
    readonly assetFields?: readonly string[];
    readonly entityFields?: readonly string[];
    readonly colorKeys?: readonly string[];
    readonly animatableFields?: readonly string[];
}

// ─── Helpers ───────────────────────────────────────────────

function humanize(key: string): string {
    return key
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/[_-]/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

function isVec2(v: unknown): v is { x: number; y: number } {
    return typeof v === 'object' && v !== null
        && 'x' in v && 'y' in v
        && !('z' in v) && !('w' in v)
        && typeof (v as Record<string, unknown>)['x'] === 'number';
}

function isVec3(v: unknown): v is { x: number; y: number; z: number } {
    return typeof v === 'object' && v !== null
        && 'x' in v && 'y' in v && 'z' in v
        && !('w' in v)
        && typeof (v as Record<string, unknown>)['x'] === 'number';
}

function isVec4(v: unknown): v is { x: number; y: number; z: number; w: number } {
    return typeof v === 'object' && v !== null
        && 'x' in v && 'y' in v && 'z' in v && 'w' in v
        && typeof (v as Record<string, unknown>)['x'] === 'number';
}

function isColor(v: unknown): v is { r: number; g: number; b: number; a: number } {
    return typeof v === 'object' && v !== null
        && 'r' in v && 'g' in v && 'b' in v && 'a' in v
        && typeof (v as Record<string, unknown>)['r'] === 'number';
}

// ─── Derive ────────────────────────────────────────────────

function deriveField(
    key: string,
    value: unknown,
    group: string,
    meta: ComponentMeta,
): ComponentFieldSchema[] {
    // Check metadata hints first
    if (meta.colorKeys?.includes(key) || isColor(value)) {
        return [{ key, label: humanize(key), type: 'color', defaultValue: value, group }];
    }
    if (meta.assetFields?.includes(key)) {
        return [{ key, label: humanize(key), type: 'asset', defaultValue: value, group }];
    }
    if (meta.entityFields?.includes(key)) {
        return [{ key, label: humanize(key), type: 'entity', defaultValue: value, group }];
    }

    // Infer from value type
    if (typeof value === 'number') {
        return [{ key, label: humanize(key), type: 'float', defaultValue: value, group }];
    }
    if (typeof value === 'boolean') {
        return [{ key, label: humanize(key), type: 'bool', defaultValue: value, group }];
    }
    if (typeof value === 'string') {
        return [{ key, label: humanize(key), type: 'string', defaultValue: value, group }];
    }

    // Expand vector types into individual number fields
    if (isVec4(value)) {
        return ['x', 'y', 'z', 'w'].map((c) => ({
            key: `${key}.${c}`,
            label: `${humanize(key)} ${c.toUpperCase()}`,
            type: 'float' as FieldType,
            defaultValue: (value as Record<string, number>)[c],
            group,
        }));
    }
    if (isVec3(value)) {
        return ['x', 'y', 'z'].map((c) => ({
            key: `${key}.${c}`,
            label: `${humanize(key)} ${c.toUpperCase()}`,
            type: 'float' as FieldType,
            defaultValue: (value as Record<string, number>)[c],
            group,
        }));
    }
    if (isVec2(value)) {
        return ['x', 'y'].map((c) => ({
            key: `${key}.${c}`,
            label: `${humanize(key)} ${c.toUpperCase()}`,
            type: 'float' as FieldType,
            defaultValue: (value as Record<string, number>)[c],
            group,
        }));
    }

    // Skip unknown types
    return [];
}

/**
 * Derive ComponentFieldSchema[] from an estella component's metadata.
 * Automatically handles: number, boolean, string, Vec2/3/4, Color,
 * asset fields, entity references.
 */
export function deriveComponentSchema(
    componentName: string,
    meta: ComponentMeta,
): ComponentFieldSchema[] {
    const fields: ComponentFieldSchema[] = [];
    for (const [key, value] of Object.entries(meta.defaults)) {
        fields.push(...deriveField(key, value, componentName, meta));
    }
    return fields;
}

/**
 * Derive schemas for ALL components from a COMPONENT_META map.
 * Returns a Map from component name to its field schemas.
 */
export function deriveAllSchemas(
    metaMap: Record<string, ComponentMeta>,
): Map<string, ComponentFieldSchema[]> {
    const result = new Map<string, ComponentFieldSchema[]>();
    for (const [name, meta] of Object.entries(metaMap)) {
        const fields = deriveComponentSchema(name, meta);
        if (fields.length > 0) {
            result.set(name, fields);
        }
    }
    return result;
}
