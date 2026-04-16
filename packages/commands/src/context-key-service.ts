import type { Event, IDisposable } from '@editrix/common';
import { Emitter, toDisposable } from '@editrix/common';

/**
 * Manages context keys that control when-clause evaluation.
 *
 * Plugins set context keys to describe the current editor state
 * (e.g. `editorFocus`, `panelType == 'scene'`). Keybindings reference
 * these keys in their `when` clauses to conditionally activate.
 *
 * @example
 * ```ts
 * const ctx = new ContextKeyService();
 * ctx.set('editorFocus', true);
 * ctx.set('activePanel', 'scene');
 * ctx.evaluate('editorFocus && activePanel == scene'); // true
 * ```
 */
export interface IContextKeyService extends IDisposable {
  /** Set a context key value. Returns a disposable that removes the key. */
  set(key: string, value: unknown): IDisposable;

  /** Get the current value of a context key. */
  get(key: string): unknown;

  /** Remove a context key. */
  delete(key: string): void;

  /** Evaluate a when-clause expression against the current context. */
  evaluate(expression: string): boolean;

  /** Event fired when any context key changes. Payload is the changed key name. */
  readonly onDidChangeContext: Event<string>;
}

/**
 * Default implementation of {@link IContextKeyService}.
 *
 * @example
 * ```ts
 * const ctx = new ContextKeyService();
 * ctx.set('editorFocus', true);
 * ctx.evaluate('editorFocus'); // true
 * ctx.evaluate('!editorFocus'); // false
 * ```
 */
export class ContextKeyService implements IContextKeyService {
  private readonly _keys = new Map<string, unknown>();
  private readonly _onDidChange = new Emitter<string>();

  readonly onDidChangeContext: Event<string> = this._onDidChange.event;

  set(key: string, value: unknown): IDisposable {
    this._keys.set(key, value);
    this._onDidChange.fire(key);
    return toDisposable(() => {
      this.delete(key);
    });
  }

  get(key: string): unknown {
    return this._keys.get(key);
  }

  delete(key: string): void {
    if (this._keys.has(key)) {
      this._keys.delete(key);
      this._onDidChange.fire(key);
    }
  }

  /**
   * Evaluate a when-clause expression.
   *
   * Supported syntax:
   * - `key` — truthy check
   * - `!key` — falsy check
   * - `key == value` — equality
   * - `key != value` — inequality
   * - `expr1 && expr2` — logical AND
   * - `expr1 || expr2` — logical OR
   *
   * `&&` binds tighter than `||` (standard precedence).
   */
  evaluate(expression: string): boolean {
    const trimmed = expression.trim();
    if (trimmed === '') return true;
    return evaluateOr(trimmed, this._keys);
  }

  dispose(): void {
    this._keys.clear();
    this._onDidChange.dispose();
  }
}

// ─── When-clause parser (recursive descent) ──────────────

/** OR has lowest precedence: `a || b || c` */
function evaluateOr(expr: string, keys: ReadonlyMap<string, unknown>): boolean {
  const parts = splitTopLevel(expr, '||');
  return parts.some((part) => evaluateAnd(part.trim(), keys));
}

/** AND has higher precedence: `a && b && c` */
function evaluateAnd(expr: string, keys: ReadonlyMap<string, unknown>): boolean {
  const parts = splitTopLevel(expr, '&&');
  return parts.every((part) => evaluateAtom(part.trim(), keys));
}

/** Atom: `key`, `!key`, `key == value`, `key != value` */
function evaluateAtom(expr: string, keys: ReadonlyMap<string, unknown>): boolean {
  if (expr.startsWith('!')) {
    return !evaluateAtom(expr.slice(1).trim(), keys);
  }

  if (expr.includes('!=')) {
    const [key, value] = splitOnce(expr, '!=');
    const resolved = keys.get(key.trim());
    return stringify(resolved) !== value.trim();
  }

  if (expr.includes('==')) {
    const [key, value] = splitOnce(expr, '==');
    const resolved = keys.get(key.trim());
    return stringify(resolved) === value.trim();
  }

  // Simple truthy check
  return Boolean(keys.get(expr));
}

/**
 * Split on a delimiter, but only at the top level (not inside nested expressions).
 * For simplicity, we don't support parentheses yet — just flat split.
 */
function splitTopLevel(expr: string, delimiter: string): string[] {
  const results: string[] = [];
  let current = '';
  let i = 0;

  while (i < expr.length) {
    if (expr.startsWith(delimiter, i)) {
      results.push(current);
      current = '';
      i += delimiter.length;
    } else {
      current += expr.charAt(i);
      i++;
    }
  }

  results.push(current);
  return results;
}

/** Split a string on the first occurrence of a delimiter. */
function splitOnce(str: string, delimiter: string): [string, string] {
  const idx = str.indexOf(delimiter);
  return [str.slice(0, idx), str.slice(idx + delimiter.length)];
}

/** Safely convert a context key value to a comparable string. */
function stringify(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value as string | number | boolean);
}
