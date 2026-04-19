/**
 * Type of a property value. Determines which UI control the inspector renders.
 *
 * - `asset`  — value is an asset reference (typically a UUID string identifying
 *              an entry in the asset catalog). The inspector should render an
 *              asset-picker rather than treating the value as a primitive.
 * - `entity` — value is a reference to another entity (typically a numeric id
 *              or stable handle). The inspector should render an entity picker.
 */
export type PropertyType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'color'
  | 'vector2'
  | 'vector3'
  | 'enum'
  | 'range'
  | 'object'
  | 'array'
  | 'asset'
  | 'entity';

/**
 * Describes a single editable property.
 *
 * This is the data that drives the Inspector panel.
 * Plugins declare property schemas for their objects; the view layer
 * reads these schemas and auto-generates appropriate editor controls.
 *
 * @example
 * ```ts
 * const transformSchema: PropertyDescriptor[] = [
 *   { key: 'position', label: 'Position', type: 'vector3', defaultValue: { x: 0, y: 0, z: 0 } },
 *   { key: 'rotation', label: 'Rotation', type: 'vector3', defaultValue: { x: 0, y: 0, z: 0 } },
 *   { key: 'scale',    label: 'Scale',    type: 'vector3', defaultValue: { x: 1, y: 1, z: 1 } },
 * ];
 * ```
 */
export interface PropertyDescriptor {
  /** Unique key within the schema, used as the property path. */
  readonly key: string;
  /** Human-readable label for the UI. */
  readonly label: string;
  /** The value type. */
  readonly type: PropertyType;
  /** Default value for new objects. */
  readonly defaultValue?: unknown;
  /** Whether this property is read-only. Default: false. */
  readonly readOnly?: boolean;
  /** Tooltip / help text. */
  readonly description?: string;
  /** For `'enum'` type: the list of allowed values. */
  readonly enumValues?: readonly string[];
  /** For `'range'` type: min value. */
  readonly min?: number;
  /** For `'range'` type: max value. */
  readonly max?: number;
  /** For `'range'` type: step increment. */
  readonly step?: number;
  /** For `'object'` type: nested property descriptors. */
  readonly children?: readonly PropertyDescriptor[];
  /** For `'array'` type: schema for each array element. */
  readonly itemSchema?: PropertyDescriptor;
  /**
   * For `'asset'` type: the asset-kind the field expects (e.g.
   * `'texture'`, `'anim-clip'`). When set, the host's asset picker
   * filters its list by this kind. Undefined = show all assets.
   */
  readonly assetType?: string;
  /** Validation function. Returns an error message or undefined. */
  readonly validate?: (value: unknown) => string | undefined;
}

/**
 * A named group of property descriptors.
 * Inspector typically renders each group as a collapsible section.
 */
export interface PropertyGroup {
  /** Group identifier. */
  readonly id: string;
  /** Display name. */
  readonly label: string;
  /** Icon name from the icon registry. */
  readonly icon?: string;
  /** Properties in this group. */
  readonly properties: readonly PropertyDescriptor[];
  /** Whether the group is collapsed by default. */
  readonly collapsed?: boolean;
}

/**
 * A complete property schema for an inspectable object type.
 */
export interface PropertySchema {
  /** Schema identifier (typically the object type name). */
  readonly id: string;
  /** Groups of properties. */
  readonly groups: readonly PropertyGroup[];
}
