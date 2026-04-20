import type { Event, IDisposable } from '@editrix/common';
import { createServiceId, Emitter, toDisposable } from '@editrix/common';

/**
 * Type of a setting value. Determines which control the UI renders.
 */
export type SettingType = 'string' | 'number' | 'boolean' | 'enum' | 'range' | 'color';

/**
 * Describes a single configurable setting.
 */
export interface SettingDescriptor {
  /** Full key, e.g. `'editrix.console.maxLogEntries'`. */
  readonly key: string;
  /** Human-readable label. */
  readonly label: string;
  /** The value type. */
  readonly type: SettingType;
  /** Default value. */
  readonly defaultValue: unknown;
  /** Help text shown below the control. */
  readonly description?: string;
  /** For `'enum'`: allowed values. */
  readonly enumValues?: readonly string[];
  /** For `'range'`: minimum. */
  readonly min?: number;
  /** For `'range'`: maximum. */
  readonly max?: number;
  /** For `'range'`: step. */
  readonly step?: number;
}

/**
 * A group of settings registered by a plugin.
 */
export interface SettingGroup {
  /** Group identifier (usually the plugin id). */
  readonly id: string;
  /** Display name for the group header. */
  readonly label: string;
  /** Settings in this group. */
  readonly settings: readonly SettingDescriptor[];
}

/**
 * Where a setting value lives. Workspace values override user values,
 * which override the schema default. Workspace values are owned by
 * whatever is hosting the current project (editrix.json, etc.); user
 * values are the editor's global preferences.
 */
export type SettingsScope = 'user' | 'workspace';

/**
 * Payload when a setting value changes.
 *
 * `oldValue` and `newValue` are always the *effective* values (the
 * result of merging across scopes). Writes to a scope that aren't
 * currently winning the merge don't fire an event — so subscribers
 * never see a notification for a change the user isn't perceiving.
 */
export interface SettingChangeEvent {
  readonly key: string;
  readonly oldValue: unknown;
  readonly newValue: unknown;
}

/**
 * Payload for the {@link ISettingsService.onError} event.
 *
 * Used for non-fatal schema issues — currently only out-of-range numeric values,
 * which are clamped silently into the descriptor's [min, max] before storage.
 */
export interface SettingsValidationError {
  readonly key: string;
  /** The value the caller passed before any normalization. */
  readonly attemptedValue: unknown;
  /** The value actually stored after clamping. */
  readonly storedValue: unknown;
  /** Human-readable reason describing what was adjusted. */
  readonly reason: string;
}

/**
 * Manages setting schema registration and value storage.
 *
 * Plugins register groups of settings with their schemas. Users and code
 * read/write values via `get`/`set`. Changes fire events so any part of
 * the editor can react. Values that differ from defaults can be serialized
 * for persistence.
 *
 * @example
 * ```ts
 * const settings = kernel.services.get(ISettingsService);
 *
 * // Plugin declares settings
 * settings.registerGroup({
 *   id: 'editrix.console',
 *   label: 'Console',
 *   settings: [
 *     { key: 'editrix.console.maxEntries', label: 'Max Entries', type: 'number', defaultValue: 1000 },
 *   ],
 * });
 *
 * // Read / write
 * settings.get('editrix.console.maxEntries'); // 1000 (default)
 * settings.set('editrix.console.maxEntries', 500);
 *
 * // React to changes
 * settings.onDidChange('editrix.console.maxEntries', (e) => {
 *   console.log('changed to', e.newValue);
 * });
 * ```
 */
export interface ISettingsService extends IDisposable {
  /** Register a group of settings. Returns a disposable to unregister. */
  registerGroup(group: SettingGroup): IDisposable;

  /** Get all registered groups. */
  getGroups(): readonly SettingGroup[];

  /** Get the descriptor for a specific setting key. */
  getDescriptor(key: string): SettingDescriptor | undefined;

  /**
   * Get the effective value: workspace override if set, otherwise user
   * value if set, otherwise the schema default.
   */
  get(key: string): unknown;

  /**
   * Set a value in the given scope (default `'user'`). Fires a change
   * event only if the effective value actually changes — e.g. writing
   * to user scope when workspace already overrides is a silent no-op
   * for listeners.
   */
  set(key: string, value: unknown, scope?: SettingsScope): void;

  /**
   * Clear a value from the given scope (default `'user'`) so it falls
   * back to the next scope down. Fires a change event only if the
   * effective value changes.
   */
  reset(key: string, scope?: SettingsScope): void;

  /**
   * Whether a value has been explicitly set. With no scope, reports
   * "modified in any scope". With a scope, reports only that scope.
   */
  isModified(key: string, scope?: SettingsScope): boolean;

  /** Subscribe to changes on a specific key. */
  onDidChange(key: string, handler: (event: SettingChangeEvent) => void): IDisposable;

  /** Subscribe to all setting changes. */
  readonly onDidChangeAny: Event<SettingChangeEvent>;

  /**
   * Fired when a value was accepted only after a schema fix-up (e.g. clamped
   * to a range). Hard violations (wrong type, enum miss) throw instead.
   */
  readonly onError: Event<SettingsValidationError>;

  /** Export all user-scope values as a plain object (for persistence). */
  exportUserValues(): Record<string, unknown>;

  /**
   * Import values into the user scope. Fires change events. Invalid
   * entries are skipped and reported via {@link onError} so a corrupted
   * file can't take down startup; valid entries still apply.
   */
  importUserValues(values: Record<string, unknown>): void;

  /** Export the currently-installed workspace-scope values. */
  exportWorkspaceValues(): Record<string, unknown>;

  /**
   * Atomically replace the entire workspace scope. Fires change events
   * for every key whose effective value moved, including keys that were
   * in the previous workspace map but aren't in `values`. Passing `{}`
   * is the correct way to clear the scope when a workspace closes.
   *
   * Invalid entries (type mismatch, enum miss) are skipped and surfaced
   * via {@link onError}; the rest still apply. Out-of-range numerics
   * are clamped silently as with {@link set}.
   */
  setWorkspaceValues(values: Record<string, unknown>): void;
}

/** Service identifier for DI. */
export const ISettingsService = createServiceId<ISettingsService>('ISettingsService');

/**
 * Default implementation of {@link ISettingsService}.
 *
 * @example
 * ```ts
 * const settings = new SettingsService();
 * settings.registerGroup({ id: 'editor', label: 'Editor', settings: [...] });
 * settings.get('editor.fontSize'); // returns default
 * ```
 */
export class SettingsService implements ISettingsService {
  private readonly _groups: SettingGroup[] = [];
  private readonly _descriptors = new Map<string, SettingDescriptor>();
  private readonly _userValues = new Map<string, unknown>();
  private readonly _workspaceValues = new Map<string, unknown>();
  private readonly _keyListeners = new Map<string, Set<(e: SettingChangeEvent) => void>>();
  private readonly _onDidChangeAny = new Emitter<SettingChangeEvent>();
  private readonly _onError = new Emitter<SettingsValidationError>();

  readonly onDidChangeAny: Event<SettingChangeEvent> = this._onDidChangeAny.event;
  readonly onError: Event<SettingsValidationError> = this._onError.event;

  registerGroup(group: SettingGroup): IDisposable {
    this._groups.push(group);
    for (const setting of group.settings) {
      this._descriptors.set(setting.key, setting);
    }

    return toDisposable(() => {
      const idx = this._groups.indexOf(group);
      if (idx !== -1) this._groups.splice(idx, 1);
      for (const setting of group.settings) {
        this._descriptors.delete(setting.key);
      }
    });
  }

  getGroups(): readonly SettingGroup[] {
    return this._groups;
  }

  getDescriptor(key: string): SettingDescriptor | undefined {
    return this._descriptors.get(key);
  }

  get(key: string): unknown {
    if (this._workspaceValues.has(key)) {
      return this._workspaceValues.get(key);
    }
    if (this._userValues.has(key)) {
      return this._userValues.get(key);
    }
    const desc = this._descriptors.get(key);
    return desc?.defaultValue;
  }

  set(key: string, value: unknown, scope: SettingsScope = 'user'): void {
    const stored = this._normalizeOrThrow(key, value);
    const oldEffective = this.get(key);
    this._scopeMap(scope).set(key, stored);
    const newEffective = this.get(key);
    if (oldEffective !== newEffective) {
      this._fireChange({ key, oldValue: oldEffective, newValue: newEffective });
    }
  }

  reset(key: string, scope: SettingsScope = 'user'): void {
    const map = this._scopeMap(scope);
    if (!map.has(key)) return;
    const oldEffective = this.get(key);
    map.delete(key);
    const newEffective = this.get(key);
    if (oldEffective !== newEffective) {
      this._fireChange({ key, oldValue: oldEffective, newValue: newEffective });
    }
  }

  isModified(key: string, scope?: SettingsScope): boolean {
    if (scope === 'user') return this._userValues.has(key);
    if (scope === 'workspace') return this._workspaceValues.has(key);
    return this._userValues.has(key) || this._workspaceValues.has(key);
  }

  onDidChange(key: string, handler: (event: SettingChangeEvent) => void): IDisposable {
    let listeners = this._keyListeners.get(key);
    if (!listeners) {
      listeners = new Set();
      this._keyListeners.set(key, listeners);
    }
    listeners.add(handler);

    return toDisposable(() => {
      listeners.delete(handler);
      if (listeners.size === 0) {
        this._keyListeners.delete(key);
      }
    });
  }

  exportUserValues(): Record<string, unknown> {
    return Object.fromEntries(this._userValues);
  }

  importUserValues(values: Record<string, unknown>): void {
    // A bad entry (corrupted file, schema drift) should not block the rest —
    // skip it, surface via onError, keep applying the others.
    for (const [key, value] of Object.entries(values)) {
      try {
        this.set(key, value, 'user');
      } catch (error) {
        this._onError.fire({
          key,
          attemptedValue: value,
          storedValue: this.get(key),
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  exportWorkspaceValues(): Record<string, unknown> {
    return Object.fromEntries(this._workspaceValues);
  }

  setWorkspaceValues(values: Record<string, unknown>): void {
    // Compute effective-before for every key that might transition:
    // anything currently in workspace (may disappear) + anything in the
    // new payload (may appear). Then replace atomically and fire a
    // single event per key whose effective value actually moved.
    const affected = new Set<string>([
      ...this._workspaceValues.keys(),
      ...Object.keys(values),
    ]);
    const before = new Map<string, unknown>();
    for (const key of affected) before.set(key, this.get(key));

    this._workspaceValues.clear();
    for (const [key, value] of Object.entries(values)) {
      try {
        this._workspaceValues.set(key, this._normalizeOrThrow(key, value));
      } catch (error) {
        this._onError.fire({
          key,
          attemptedValue: value,
          storedValue: this.get(key),
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    for (const key of affected) {
      const oldEffective = before.get(key);
      const newEffective = this.get(key);
      if (oldEffective !== newEffective) {
        this._fireChange({ key, oldValue: oldEffective, newValue: newEffective });
      }
    }
  }

  dispose(): void {
    this._groups.length = 0;
    this._descriptors.clear();
    this._userValues.clear();
    this._workspaceValues.clear();
    this._keyListeners.clear();
    this._onDidChangeAny.dispose();
    this._onError.dispose();
  }

  private _scopeMap(scope: SettingsScope): Map<string, unknown> {
    return scope === 'workspace' ? this._workspaceValues : this._userValues;
  }

  private _fireChange(event: SettingChangeEvent): void {
    this._onDidChangeAny.fire(event);
    const listeners = this._keyListeners.get(event.key);
    if (listeners) {
      for (const handler of listeners) {
        handler(event);
      }
    }
  }

  /**
   * Run schema checks against a candidate value. Returns the value to actually
   * store (which may differ from the input — e.g. a clamped range). Throws on
   * hard violations so callers and importUserValues can decide how to react.
   */
  private _normalizeOrThrow(key: string, value: unknown): unknown {
    const desc = this._descriptors.get(key);
    if (!desc) return value; // unknown key — no schema to enforce against

    switch (desc.type) {
      case 'string':
      case 'color':
        if (typeof value !== 'string') {
          throw new Error(`Setting "${key}" expects a string, got ${typeof value}.`);
        }
        return value;
      case 'boolean':
        if (typeof value !== 'boolean') {
          throw new Error(`Setting "${key}" expects a boolean, got ${typeof value}.`);
        }
        return value;
      case 'number':
        if (typeof value !== 'number' || Number.isNaN(value)) {
          throw new Error(`Setting "${key}" expects a number, got ${typeof value}.`);
        }
        return value;
      case 'enum':
        if (typeof value !== 'string') {
          throw new Error(`Setting "${key}" expects an enum string, got ${typeof value}.`);
        }
        if (desc.enumValues && !desc.enumValues.includes(value)) {
          throw new Error(
            `Setting "${key}" value "${value}" is not in the allowed set [${desc.enumValues.join(', ')}].`,
          );
        }
        return value;
      case 'range': {
        if (typeof value !== 'number' || Number.isNaN(value)) {
          throw new Error(`Setting "${key}" expects a numeric range value, got ${typeof value}.`);
        }
        let clamped = value;
        if (desc.min !== undefined && clamped < desc.min) clamped = desc.min;
        if (desc.max !== undefined && clamped > desc.max) clamped = desc.max;
        if (clamped !== value) {
          this._onError.fire({
            key,
            attemptedValue: value,
            storedValue: clamped,
            reason: `Value ${value} clamped into [${desc.min ?? '-∞'}, ${desc.max ?? '+∞'}].`,
          });
        }
        return clamped;
      }
    }
  }
}
