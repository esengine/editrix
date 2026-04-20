import type { Command, ICommandRegistry, IKeybindingService } from '@editrix/commands';
import { formatKeyForDisplay } from '@editrix/commands';
import type { IDisposable } from '@editrix/common';
import { DisposableStore, toDisposable } from '@editrix/common';
import { createElement } from './dom-utils.js';

/**
 * Key under which the MRU list is persisted. Scoped per origin so two
 * editor instances sharing localStorage don't trample each other.
 */
const MRU_STORAGE_KEY = 'editrix.commandPalette.mru';
const MRU_LIMIT = 8;

/**
 * Scored match result. `score` is larger for better matches; -Infinity
 * means no match. Runs are the character indices in the title that
 * matched the query (unused for rendering today, but would drive
 * highlighting if added).
 */
interface Match {
  readonly command: Command;
  readonly score: number;
}

/**
 * Subsequence-match scorer. Not a full fuzzy algorithm (no bonuses for
 * word boundaries beyond camelCase/space), but good enough for a few
 * hundred commands: higher for consecutive hits, penalty for gaps,
 * heavy bonus for prefix matches. Returns -Infinity if any query char
 * isn't found.
 */
function fuzzyScore(query: string, text: string): number {
  if (query.length === 0) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();

  if (t.startsWith(q)) return 1000 - text.length; // prefix wins

  let qi = 0;
  let score = 0;
  let prevMatched = -2;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      // Consecutive run bonus.
      if (ti === prevMatched + 1) score += 5;
      // Word-boundary bonus.
      const prev = ti > 0 ? t[ti - 1] : ' ';
      if (prev === ' ' || prev === '.' || prev === '-' || prev === '_') score += 3;
      score += 1;
      prevMatched = ti;
      qi++;
    }
  }
  if (qi < q.length) return -Infinity;
  // Penalty for long tails — prefer shorter matches all else equal.
  return score - text.length * 0.01;
}

function loadMru(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(MRU_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}

function saveMru(ids: readonly string[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(MRU_STORAGE_KEY, JSON.stringify(ids.slice(0, MRU_LIMIT)));
  } catch {
    // Quota exhausted / private browsing — MRU is best-effort.
  }
}

/**
 * DOM-based command palette overlay.
 *
 * Opens as a centered modal with a search input. Commands are ranked
 * with fuzzy subsequence matching; recently used commands float above
 * equal-scoring alternatives. Bound keyboard shortcuts are rendered
 * right-aligned so the user discovers them while browsing.
 *
 * @example
 * ```ts
 * const palette = new CommandPalette(commandRegistry, keybindingService);
 * palette.mount(document.body);
 * palette.open();
 * ```
 */
export class CommandPalette implements IDisposable {
  private readonly _commandRegistry: ICommandRegistry;
  private readonly _keybindingService: IKeybindingService | undefined;
  private readonly _subscriptions = new DisposableStore();
  private _overlay: HTMLElement | undefined;
  private _input: HTMLInputElement | undefined;
  private _list: HTMLElement | undefined;
  private _isOpen = false;
  private _selectedIndex = 0;
  private _filteredCommands: Command[] = [];
  private _mru: string[] = loadMru();

  constructor(commandRegistry: ICommandRegistry, keybindingService?: IKeybindingService) {
    this._commandRegistry = commandRegistry;
    this._keybindingService = keybindingService;
  }

  mount(container: HTMLElement): void {
    this._overlay = createElement('div', 'editrix-palette-overlay');
    this._overlay.style.display = 'none';

    const dialog = createElement('div', 'editrix-palette-dialog');

    this._input = createElement('input', 'editrix-palette-input');
    this._input.type = 'text';
    this._input.placeholder = 'Type a command...';
    dialog.appendChild(this._input);

    this._list = createElement('div', 'editrix-palette-list');
    dialog.appendChild(this._list);

    this._overlay.appendChild(dialog);
    container.appendChild(this._overlay);

    this._subscriptions.add(
      toDisposable(() => {
        this._overlay?.remove();
      }),
    );

    this._input.addEventListener('input', () => {
      this._filter();
    });

    this._input.addEventListener('keydown', (e) => {
      this._handleKeydown(e);
    });

    this._overlay.addEventListener('click', (e) => {
      if (e.target === this._overlay) {
        this.close();
      }
    });
  }

  open(): void {
    if (!this._overlay || !this._input) return;
    this._isOpen = true;
    this._overlay.style.display = '';
    this._input.value = '';
    this._selectedIndex = 0;
    this._filter();
    this._input.focus();
  }

  close(): void {
    if (!this._overlay) return;
    this._isOpen = false;
    this._overlay.style.display = 'none';
  }

  get isOpen(): boolean {
    return this._isOpen;
  }

  dispose(): void {
    this._subscriptions.dispose();
  }

  private _filter(): void {
    if (!this._input || !this._list) return;

    const query = this._input.value;
    const all = this._commandRegistry.getAll();

    if (query === '') {
      // Empty query: MRU first (in recent-use order), then the rest
      // alphabetically by category+title. Stable, predictable.
      const mruSet = new Set(this._mru);
      const mruCommands = this._mru
        .map((id) => all.find((c) => c.id === id))
        .filter((c): c is Command => c !== undefined);
      const rest = all
        .filter((c) => !mruSet.has(c.id))
        .sort((a, b) => {
          const ak = `${a.category ?? ''} ${a.title}`;
          const bk = `${b.category ?? ''} ${b.title}`;
          return ak.localeCompare(bk);
        });
      this._filteredCommands = [...mruCommands, ...rest];
    } else {
      const matches: Match[] = [];
      for (const cmd of all) {
        const searchText = `${cmd.category ?? ''} ${cmd.title}`;
        const score = fuzzyScore(query, searchText);
        if (score === -Infinity) continue;
        // MRU boost so recently-used equal matches float up.
        const mruBoost = this._mru.includes(cmd.id) ? 50 - this._mru.indexOf(cmd.id) * 5 : 0;
        matches.push({ command: cmd, score: score + mruBoost });
      }
      matches.sort((a, b) => b.score - a.score);
      this._filteredCommands = matches.map((m) => m.command);
    }

    this._selectedIndex = Math.min(
      this._selectedIndex,
      Math.max(0, this._filteredCommands.length - 1),
    );
    this._renderList();
  }

  private _renderList(): void {
    if (!this._list) return;

    this._list.innerHTML = '';

    if (this._filteredCommands.length === 0) {
      const empty = createElement('div', 'editrix-palette-empty');
      empty.textContent = 'No commands found';
      this._list.appendChild(empty);
      return;
    }

    for (let i = 0; i < this._filteredCommands.length; i++) {
      const cmd = this._filteredCommands[i];
      if (!cmd) continue;
      const item = createElement('div', 'editrix-palette-item');
      if (i === this._selectedIndex) {
        item.classList.add('editrix-palette-item--selected');
      }

      const label = createElement('span', 'editrix-palette-label');

      if (cmd.category) {
        const cat = createElement('span', 'editrix-palette-category');
        cat.textContent = cmd.category + ': ';
        label.appendChild(cat);
      }

      const title = createElement('span', 'editrix-palette-title');
      title.textContent = cmd.title;
      label.appendChild(title);

      item.appendChild(label);

      const shortcut = this._firstKeybindingFor(cmd.id);
      if (shortcut !== undefined) {
        const kbd = createElement('span', 'editrix-palette-shortcut');
        kbd.textContent = formatKeyForDisplay(shortcut);
        item.appendChild(kbd);
      }

      item.addEventListener('click', () => {
        void this._execute(cmd.id);
      });

      this._list.appendChild(item);
    }
  }

  private _firstKeybindingFor(commandId: string): string | undefined {
    const svc = this._keybindingService;
    if (!svc) return undefined;
    const bindings = svc.getBindingsForCommand(commandId);
    // Pick the first unconditional binding for display (command palette
    // can't evaluate the when-clause without a context snapshot).
    const unconditional = bindings.find((b) => b.when === undefined);
    return unconditional?.key ?? bindings[0]?.key;
  }

  private _handleKeydown(e: KeyboardEvent): void {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this._selectedIndex = Math.min(this._selectedIndex + 1, this._filteredCommands.length - 1);
        this._renderList();
        break;

      case 'ArrowUp':
        e.preventDefault();
        this._selectedIndex = Math.max(this._selectedIndex - 1, 0);
        this._renderList();
        break;

      case 'Enter': {
        e.preventDefault();
        const cmd = this._filteredCommands[this._selectedIndex];
        if (cmd) {
          void this._execute(cmd.id);
        }
        break;
      }

      case 'Escape':
        this.close();
        break;
    }
  }

  private async _execute(commandId: string): Promise<void> {
    this.close();
    this._recordMru(commandId);
    await this._commandRegistry.execute(commandId);
  }

  private _recordMru(commandId: string): void {
    this._mru = [commandId, ...this._mru.filter((id) => id !== commandId)].slice(0, MRU_LIMIT);
    saveMru(this._mru);
  }
}
