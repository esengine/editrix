import type { Event, IDisposable } from '@editrix/common';
import { createServiceId, Emitter, toDisposable } from '@editrix/common';
import type { PropertySchema } from './property-schema.js';

/**
 * A property change event. Emitted whenever a property value is modified.
 */
export interface PropertyChangeEvent {
  /** The target object ID. */
  readonly targetId: string;
  /** The property key path (e.g. `'position.x'`). */
  readonly key: string;
  /** The old value. */
  readonly oldValue: unknown;
  /** The new value. */
  readonly newValue: unknown;
}

/**
 * Central property service. Manages property schemas and value storage.
 *
 * Plugins register schemas for their object types. When the user selects
 * an object, the Inspector reads its schema and current values to render
 * the property editor. Changes are funneled through this service so that
 * undo/redo and change events work uniformly.
 *
 * @example
 * ```ts
 * const service = new PropertyService();
 * service.registerSchema(transformSchema);
 * service.setValues('node-1', { position: { x: 1, y: 2, z: 3 } });
 * service.setValue('node-1', 'position.x', 10);
 * ```
 */
export interface IPropertyService extends IDisposable {
  /** Register a property schema for an object type. */
  registerSchema(schema: PropertySchema): IDisposable;

  /** Get a registered schema by ID. */
  getSchema(schemaId: string): PropertySchema | undefined;

  /** Set multiple property values for a target object at once. */
  setValues(targetId: string, values: Record<string, unknown>): void;

  /** Set a single property value by key path. */
  setValue(targetId: string, key: string, value: unknown): void;

  /** Get a single property value by key path. */
  getValue(targetId: string, key: string): unknown;

  /** Get all property values for a target object. */
  getValues(targetId: string): Record<string, unknown>;

  /** Remove all values for a target object. */
  clearValues(targetId: string): void;

  /** Event fired when any property value changes. */
  readonly onDidChangeProperty: Event<PropertyChangeEvent>;

  /** Event fired when schemas change (registered/unregistered). */
  readonly onDidChangeSchemas: Event<void>;
}

/** Service identifier for DI. */
export const IPropertyService = createServiceId<IPropertyService>('IPropertyService');

/**
 * Default implementation of {@link IPropertyService}.
 *
 * @example
 * ```ts
 * const service = new PropertyService();
 * service.registerSchema({ id: 'transform', groups: [...] });
 * service.setValue('obj1', 'position.x', 42);
 * ```
 */
export class PropertyService implements IPropertyService {
  private readonly _schemas = new Map<string, PropertySchema>();
  private readonly _values = new Map<string, Record<string, unknown>>();
  private readonly _onDidChangeProperty = new Emitter<PropertyChangeEvent>();
  private readonly _onDidChangeSchemas = new Emitter<void>();

  readonly onDidChangeProperty: Event<PropertyChangeEvent> = this._onDidChangeProperty.event;
  readonly onDidChangeSchemas: Event<void> = this._onDidChangeSchemas.event;

  registerSchema(schema: PropertySchema): IDisposable {
    if (this._schemas.has(schema.id)) {
      throw new Error(`Property schema "${schema.id}" is already registered.`);
    }

    this._schemas.set(schema.id, schema);
    this._onDidChangeSchemas.fire();

    return toDisposable(() => {
      this._schemas.delete(schema.id);
      this._onDidChangeSchemas.fire();
    });
  }

  getSchema(schemaId: string): PropertySchema | undefined {
    return this._schemas.get(schemaId);
  }

  setValues(targetId: string, values: Record<string, unknown>): void {
    const current = this._getOrCreate(targetId);
    for (const [key, newValue] of Object.entries(values)) {
      const oldValue = current[key];
      current[key] = newValue;
      this._onDidChangeProperty.fire({ targetId, key, oldValue, newValue });
    }
  }

  setValue(targetId: string, key: string, value: unknown): void {
    const current = this._getOrCreate(targetId);
    const oldValue = current[key];
    current[key] = value;
    this._onDidChangeProperty.fire({ targetId, key, oldValue, newValue: value });
  }

  getValue(targetId: string, key: string): unknown {
    return this._values.get(targetId)?.[key];
  }

  getValues(targetId: string): Record<string, unknown> {
    return { ...this._values.get(targetId) };
  }

  clearValues(targetId: string): void {
    this._values.delete(targetId);
  }

  dispose(): void {
    this._schemas.clear();
    this._values.clear();
    this._onDidChangeProperty.dispose();
    this._onDidChangeSchemas.dispose();
  }

  private _getOrCreate(targetId: string): Record<string, unknown> {
    let values = this._values.get(targetId);
    if (!values) {
      values = {};
      this._values.set(targetId, values);
    }
    return values;
  }
}
