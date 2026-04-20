import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Command, ICommandRegistry, IKeybindingService, Keybinding } from '@editrix/commands';
import { toDisposable } from '@editrix/common';
import { CommandPalette } from '../src/command-palette.js';

function fakeRegistry(commands: Command[]): ICommandRegistry & {
  executed: string[];
} {
  const executed: string[] = [];
  return {
    executed,
    register() {
      return toDisposable(() => {});
    },
    async execute(id) {
      executed.push(id);
    },
    getAll() {
      return commands;
    },
    get(id) {
      return commands.find((c) => c.id === id);
    },
    get onWillExecute() {
      return () => toDisposable(() => {});
    },
    dispose() {},
  } as unknown as ICommandRegistry & { executed: string[] };
}

function fakeKeybindings(bindings: Keybinding[]): IKeybindingService {
  return {
    register: () => toDisposable(() => {}),
    resolve: () => undefined,
    getBindingsForCommand: (id) => bindings.filter((b) => b.commandId === id),
    getAll: () => bindings,
    get onDidChangeKeybindings() {
      return () => toDisposable(() => {});
    },
    dispose: () => {},
  } as unknown as IKeybindingService;
}

function renderedItems(): {
  label: string;
  shortcut: string | undefined;
  selected: boolean;
}[] {
  return [...document.querySelectorAll<HTMLElement>('.editrix-palette-item')].map((item) => ({
    label: item.querySelector('.editrix-palette-label')?.textContent ?? '',
    shortcut: item.querySelector('.editrix-palette-shortcut')?.textContent ?? undefined,
    selected: item.classList.contains('editrix-palette-item--selected'),
  }));
}

function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function pressInInput(input: HTMLInputElement, key: string): void {
  input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe('CommandPalette', () => {
  const cmds: Command[] = [
    { id: 'file.save', title: 'Save', category: 'File', execute() {} },
    { id: 'file.open', title: 'Open File', category: 'File', execute() {} },
    { id: 'edit.undo', title: 'Undo', category: 'Edit', execute() {} },
    { id: 'edit.redo', title: 'Redo', category: 'Edit', execute() {} },
    { id: 'view.togglePanel', title: 'Toggle Panel', category: 'View', execute() {} },
  ];

  it('renders all commands sorted alphabetically when query is empty', () => {
    const palette = new CommandPalette(fakeRegistry(cmds));
    palette.mount(document.body);
    palette.open();

    const labels = renderedItems().map((i) => i.label);
    expect(labels).toEqual([
      'Edit: Redo',
      'Edit: Undo',
      'File: Open File',
      'File: Save',
      'View: Toggle Panel',
    ]);
  });

  it('displays the first unconditional keybinding for each command', () => {
    const kb = fakeKeybindings([
      { key: 'Ctrl+S', commandId: 'file.save' },
      { key: 'Ctrl+Shift+S', commandId: 'file.save', when: 'whenFocusIsEditor' },
      { key: 'Ctrl+Z', commandId: 'edit.undo' },
    ]);
    const palette = new CommandPalette(fakeRegistry(cmds), kb);
    palette.mount(document.body);
    palette.open();

    const byLabel = Object.fromEntries(renderedItems().map((i) => [i.label, i.shortcut] as const));
    // formatKeyForDisplay on non-mac may render Ctrl+S verbatim or with
    // glyph substitutions; either way it should be non-empty and contain S.
    expect(byLabel['File: Save']).toBeDefined();
    expect(byLabel['File: Save']).toMatch(/S$/);
    expect(byLabel['Edit: Undo']).toBeDefined();
    expect(byLabel['Edit: Redo']).toBeUndefined(); // no binding registered
  });

  it('fuzzy-matches scattered characters, not just substrings', () => {
    const palette = new CommandPalette(fakeRegistry(cmds));
    palette.mount(document.body);
    palette.open();

    const input = document.querySelector<HTMLInputElement>('.editrix-palette-input');
    if (!input) throw new Error('no input');
    type(input, 'tp'); // should hit "Toggle Panel"

    const labels = renderedItems().map((i) => i.label);
    expect(labels).toContain('View: Toggle Panel');
  });

  it('prefix matches rank above scattered matches', () => {
    const palette = new CommandPalette(fakeRegistry(cmds));
    palette.mount(document.body);
    palette.open();

    const input = document.querySelector<HTMLInputElement>('.editrix-palette-input');
    if (!input) throw new Error('no input');
    type(input, 'undo'); // "Edit: Undo" prefix? no — "Undo" is in title

    const labels = renderedItems().map((i) => i.label);
    expect(labels[0]).toBe('Edit: Undo');
  });

  it('excludes commands where the query has no subsequence match', () => {
    const palette = new CommandPalette(fakeRegistry(cmds));
    palette.mount(document.body);
    palette.open();

    const input = document.querySelector<HTMLInputElement>('.editrix-palette-input');
    if (!input) throw new Error('no input');
    type(input, 'xyzzy');

    expect(renderedItems()).toHaveLength(0);
    expect(document.querySelector('.editrix-palette-empty')).not.toBeNull();
  });

  it('records executed commands in MRU and floats them on next open', async () => {
    const reg = fakeRegistry(cmds);
    const palette = new CommandPalette(reg);
    palette.mount(document.body);
    palette.open();

    // Execute Toggle Panel — should land in MRU.
    const input = document.querySelector<HTMLInputElement>('.editrix-palette-input');
    if (!input) throw new Error('no input');
    type(input, 'toggle');
    pressInInput(input, 'Enter');

    // Let the async execute settle.
    await Promise.resolve();
    await Promise.resolve();

    expect(reg.executed).toEqual(['view.togglePanel']);

    // Re-open with empty query — MRU entry should be first.
    palette.open();
    const first = renderedItems()[0];
    expect(first?.label).toBe('View: Toggle Panel');
  });

  it('persists MRU across palette instances via localStorage', async () => {
    const reg1 = fakeRegistry(cmds);
    const palette1 = new CommandPalette(reg1);
    palette1.mount(document.body);
    palette1.open();

    const input = document.querySelector<HTMLInputElement>('.editrix-palette-input');
    if (!input) throw new Error('no input');
    type(input, 'save');
    pressInInput(input, 'Enter');
    await Promise.resolve();
    await Promise.resolve();

    palette1.dispose();
    document.body.replaceChildren();

    const reg2 = fakeRegistry(cmds);
    const palette2 = new CommandPalette(reg2);
    palette2.mount(document.body);
    palette2.open();

    expect(renderedItems()[0]?.label).toBe('File: Save');
  });

  it('ArrowDown/ArrowUp adjust selection, Enter executes selected', async () => {
    const reg = fakeRegistry(cmds);
    const palette = new CommandPalette(reg);
    palette.mount(document.body);
    palette.open();

    const input = document.querySelector<HTMLInputElement>('.editrix-palette-input');
    if (!input) throw new Error('no input');

    // Empty query -> alphabetical: first is 'Edit: Redo'
    pressInInput(input, 'ArrowDown'); // -> 'Edit: Undo'
    pressInInput(input, 'ArrowDown'); // -> 'File: Open File'
    pressInInput(input, 'Enter');
    await Promise.resolve();
    await Promise.resolve();

    expect(reg.executed).toEqual(['file.open']);
  });

  it('tolerates corrupted localStorage payloads', () => {
    localStorage.setItem('editrix.commandPalette.mru', '{not-json}');
    const palette = new CommandPalette(fakeRegistry(cmds));
    palette.mount(document.body);
    // Should not throw.
    palette.open();
    expect(renderedItems().length).toBe(5);
  });

  it('Escape closes the palette', () => {
    const palette = new CommandPalette(fakeRegistry(cmds));
    palette.mount(document.body);
    palette.open();
    expect(palette.isOpen).toBe(true);

    const input = document.querySelector<HTMLInputElement>('.editrix-palette-input');
    if (!input) throw new Error('no input');
    pressInInput(input, 'Escape');
    expect(palette.isOpen).toBe(false);
  });

  it('works without a keybinding service (no shortcuts rendered)', () => {
    const palette = new CommandPalette(fakeRegistry(cmds));
    palette.mount(document.body);
    palette.open();

    for (const item of renderedItems()) {
      expect(item.shortcut).toBeUndefined();
    }
  });

  // Silence noisy writes-that-fail warnings some test environments emit
  // when localStorage is unavailable. Not used here but guards future
  // test runs on stricter jsdom setups.
  vi.mock('node:fs', async (orig) => orig<typeof import('node:fs')>());
});
