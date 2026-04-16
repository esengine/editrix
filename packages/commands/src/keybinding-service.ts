import type { Event, IDisposable } from '@editrix/common';
import { createServiceId, Emitter, toDisposable } from '@editrix/common';
import type { IContextKeyService } from './context-key-service.js';

/**
 * A keybinding maps a key combination to a command with an optional when-clause.
 */
export interface Keybinding {
  /** Key combination, e.g. `'Ctrl+S'`, `'Ctrl+Shift+P'`, `'Ctrl+K Ctrl+C'` (chord). */
  readonly key: string;
  /** Command ID to execute when the key is pressed. */
  readonly commandId: string;
  /** Optional arguments to pass to the command. */
  readonly args?: readonly unknown[];
  /** When-clause expression. Binding only activates when this evaluates to true. */
  readonly when?: string;
  /** Priority for conflict resolution. Higher wins. Default is 0. */
  readonly priority?: number;
}

/**
 * Result of resolving a key event against registered keybindings.
 */
export interface ResolvedKeybinding {
  /** The command to execute. */
  readonly commandId: string;
  /** Arguments to pass to the command. */
  readonly args: readonly unknown[] | undefined;
}

/**
 * Manages keybinding registration and resolution.
 *
 * Given a key string and the current context, resolves which command
 * (if any) should execute. Supports when-clauses and priority ordering.
 *
 * @example
 * ```ts
 * const service = new KeybindingService(contextKeyService);
 * service.register({ key: 'Ctrl+S', commandId: 'file.save' });
 * service.register({ key: 'Ctrl+S', commandId: 'special.save', when: 'specialMode' });
 * const result = service.resolve('Ctrl+S'); // depends on context
 * ```
 */
export interface IKeybindingService extends IDisposable {
  /** Register a keybinding. Returns a disposable to unregister. */
  register(binding: Keybinding): IDisposable;

  /** Resolve a key string to the best matching command in the current context. */
  resolve(key: string): ResolvedKeybinding | undefined;

  /** Get all keybindings for a specific command. */
  getBindingsForCommand(commandId: string): readonly Keybinding[];

  /** Get all registered keybindings. */
  getAll(): readonly Keybinding[];

  /** Event fired when keybindings change. */
  readonly onDidChangeKeybindings: Event<void>;
}

/** Service identifier for DI. */
export const IKeybindingService = createServiceId<IKeybindingService>('IKeybindingService');

/**
 * Default implementation of {@link IKeybindingService}.
 *
 * @example
 * ```ts
 * const service = new KeybindingService(contextKeys);
 * service.register({ key: 'Ctrl+Z', commandId: 'editor.undo' });
 * ```
 */
export class KeybindingService implements IKeybindingService {
  private readonly _bindings: Keybinding[] = [];
  private readonly _onDidChange = new Emitter<void>();
  private readonly _contextKeys: IContextKeyService;

  readonly onDidChangeKeybindings: Event<void> = this._onDidChange.event;

  constructor(contextKeys: IContextKeyService) {
    this._contextKeys = contextKeys;
  }

  register(binding: Keybinding): IDisposable {
    this._bindings.push(binding);
    this._onDidChange.fire();

    return toDisposable(() => {
      const idx = this._bindings.indexOf(binding);
      if (idx !== -1) {
        this._bindings.splice(idx, 1);
        this._onDidChange.fire();
      }
    });
  }

  resolve(key: string): ResolvedKeybinding | undefined {
    const normalized = normalizeKey(key);

    // Find all matching bindings whose when-clause passes
    const candidates = this._bindings.filter((b) => {
      if (normalizeKey(b.key) !== normalized) return false;
      if (b.when && !this._contextKeys.evaluate(b.when)) return false;
      return true;
    });

    if (candidates.length === 0) return undefined;

    // Pick the highest priority binding
    candidates.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    const winner = candidates[0];

    if (!winner) return undefined;

    return {
      commandId: winner.commandId,
      args: winner.args,
    };
  }

  getBindingsForCommand(commandId: string): readonly Keybinding[] {
    return this._bindings.filter((b) => b.commandId === commandId);
  }

  getAll(): readonly Keybinding[] {
    return [...this._bindings];
  }

  dispose(): void {
    this._bindings.length = 0;
    this._onDidChange.dispose();
  }
}

/**
 * Normalize a key string for reliable comparison.
 * Sorts modifiers alphabetically: `'Shift+Ctrl+S'` → `'Ctrl+S+Shift'`... no,
 * better: split into parts, sort modifiers, rejoin.
 *
 * Convention: `Ctrl+Alt+Shift+Meta+Key` (alphabetical modifier order, key last).
 */
function normalizeKey(key: string): string {
  // Handle chord sequences (e.g. 'Ctrl+K Ctrl+C')
  return key
    .split(' ')
    .map(normalizeChord)
    .join(' ');
}

function normalizeChord(chord: string): string {
  const parts = chord.split('+').map((p) => p.trim().toLowerCase());
  const modifiers: string[] = [];
  let mainKey = '';

  for (const part of parts) {
    if (part === 'ctrl' || part === 'alt' || part === 'shift' || part === 'meta') {
      modifiers.push(part);
    } else {
      mainKey = part;
    }
  }

  modifiers.sort();
  return [...modifiers, mainKey].join('+');
}
