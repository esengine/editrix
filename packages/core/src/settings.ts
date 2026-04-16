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
 * Payload when a setting value changes.
 */
export interface SettingChangeEvent {
  readonly key: string;
  readonly oldValue: unknown;
  readonly newValue: unknown;
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

  /** Get the current value (user value if set, otherwise default). */
  get(key: string): unknown;

  /** Set a user value. Fires a change event. */
  set(key: string, value: unknown): void;

  /** Reset a setting to its default. Fires a change event. */
  reset(key: string): void;

  /** Whether the user has explicitly set a value (differs from default). */
  isModified(key: string): boolean;

  /** Subscribe to changes on a specific key. */
  onDidChange(key: string, handler: (event: SettingChangeEvent) => void): IDisposable;

  /** Subscribe to all setting changes. */
  readonly onDidChangeAny: Event<SettingChangeEvent>;

  /** Export all user-modified values as a plain object (for persistence). */
  exportUserValues(): Record<string, unknown>;

  /** Import user values (e.g. from a saved file). Fires change events. */
  importUserValues(values: Record<string, unknown>): void;
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
  private readonly _keyListeners = new Map<string, Set<(e: SettingChangeEvent) => void>>();
  private readonly _onDidChangeAny = new Emitter<SettingChangeEvent>();

  readonly onDidChangeAny: Event<SettingChangeEvent> = this._onDidChangeAny.event;

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
    if (this._userValues.has(key)) {
      return this._userValues.get(key);
    }
    const desc = this._descriptors.get(key);
    return desc?.defaultValue;
  }

  set(key: string, value: unknown): void {
    const oldValue = this.get(key);
    this._userValues.set(key, value);
    const event: SettingChangeEvent = { key, oldValue, newValue: value };
    this._fireChange(event);
  }

  reset(key: string): void {
    if (!this._userValues.has(key)) return;
    const oldValue = this._userValues.get(key);
    this._userValues.delete(key);
    const desc = this._descriptors.get(key);
    const event: SettingChangeEvent = {
      key,
      oldValue,
      newValue: desc?.defaultValue,
    };
    this._fireChange(event);
  }

  isModified(key: string): boolean {
    return this._userValues.has(key);
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
    const result: Record<string, unknown> = {};
    for (const [key, value] of this._userValues) {
      result[key] = value;
    }
    return result;
  }

  importUserValues(values: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(values)) {
      this.set(key, value);
    }
  }

  dispose(): void {
    this._groups.length = 0;
    this._descriptors.clear();
    this._userValues.clear();
    this._keyListeners.clear();
    this._onDidChangeAny.dispose();
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
}
