import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MenuBar } from '../src/menu-bar.js';

function pressKey(key: string, init: Partial<KeyboardEventInit> = {}): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
}

function releaseKey(key: string): void {
  document.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
}

function activeMenuLabel(): string | null {
  return (
    document.querySelector('.editrix-menubar-item--active .editrix-menubar-item-label')
      ?.textContent ?? null
  );
}

function selectedItemLabel(): string | null {
  return document.querySelector('.editrix-menubar-dropdown-item--selected')?.textContent ?? null;
}

let bar: MenuBar;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  bar = new MenuBar();
  bar.mount(container);
});

afterEach(() => {
  bar.dispose();
  document.body.replaceChildren();
  delete document.body.dataset['altDown'];
});

function addStandardMenus(
  handlers: { [id: string]: ReturnType<typeof vi.fn> } = {},
): typeof handlers {
  const saved = (handlers['file.save'] ??= vi.fn());
  const exit = (handlers['file.exit'] ??= vi.fn());
  const undo = (handlers['edit.undo'] ??= vi.fn());
  bar.addMenu({
    id: 'file',
    label: '&File',
    items: [
      { id: 'file.save', label: '&Save', onClick: saved },
      { id: 'sep', label: '', separator: true },
      { id: 'file.exit', label: 'E&xit', onClick: exit },
    ],
  });
  bar.addMenu({
    id: 'edit',
    label: '&Edit',
    items: [{ id: 'edit.undo', label: '&Undo', onClick: undo }],
  });
  return handlers;
}

describe('MenuBar keyboard access', () => {
  it('underlines the mnemonic character in menu labels', () => {
    bar.addMenu({ id: 'file', label: '&File', items: [] });
    const underline = container.querySelector('.editrix-menubar-mnemonic');
    expect(underline).not.toBeNull();
    expect(underline?.textContent).toBe('F');
  });

  it('Alt+F opens the File menu', () => {
    addStandardMenus();
    pressKey('F', { altKey: true });
    expect(activeMenuLabel()).toContain('File');
  });

  it('mnemonic matching is case-insensitive', () => {
    addStandardMenus();
    pressKey('f', { altKey: true });
    expect(activeMenuLabel()).toContain('File');
  });

  it('Alt+mnemonic ignores Ctrl / Meta / Shift modifiers', () => {
    addStandardMenus();
    pressKey('F', { altKey: true, ctrlKey: true });
    expect(activeMenuLabel()).toBeNull(); // Alt+Ctrl+F is a hotkey, not a mnemonic
  });

  it('selects the first activatable item when a menu opens', () => {
    addStandardMenus();
    pressKey('F', { altKey: true });
    expect(selectedItemLabel()).toContain('Save');
  });

  it('ArrowDown skips separators when moving selection', () => {
    addStandardMenus();
    pressKey('F', { altKey: true });
    pressKey('ArrowDown'); // Save -> Exit (skip separator)
    expect(selectedItemLabel()).toContain('Exit');
  });

  it('ArrowUp wraps from the first item to the last', () => {
    addStandardMenus();
    pressKey('F', { altKey: true });
    pressKey('ArrowUp');
    expect(selectedItemLabel()).toContain('Exit');
  });

  it('ArrowRight / ArrowLeft cycle between menus', () => {
    addStandardMenus();
    pressKey('F', { altKey: true });
    pressKey('ArrowRight');
    expect(activeMenuLabel()).toContain('Edit');
    pressKey('ArrowLeft');
    expect(activeMenuLabel()).toContain('File');
  });

  it('Enter fires the selected item and closes the menu', () => {
    const handlers = addStandardMenus();
    pressKey('F', { altKey: true });
    pressKey('ArrowDown'); // select Exit
    pressKey('Enter');
    expect(handlers['file.exit']).toHaveBeenCalledOnce();
    expect(activeMenuLabel()).toBeNull();
  });

  it('Escape closes the menu without firing anything', () => {
    const handlers = addStandardMenus();
    pressKey('F', { altKey: true });
    pressKey('Escape');
    expect(activeMenuLabel()).toBeNull();
    expect(handlers['file.save']).not.toHaveBeenCalled();
  });

  it('plain letter inside an open menu triggers the matching item', () => {
    const handlers = addStandardMenus();
    pressKey('F', { altKey: true });
    pressKey('x'); // E&xit mnemonic
    expect(handlers['file.exit']).toHaveBeenCalledOnce();
    expect(activeMenuLabel()).toBeNull();
  });

  it('restores focus to the previously-focused element on close', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    addStandardMenus();
    pressKey('F', { altKey: true });
    pressKey('Escape');

    expect(document.activeElement).toBe(trigger);
  });

  it('toggles body[data-alt-down] so stylesheet can reveal mnemonic underlines', () => {
    pressKey('Alt');
    expect(document.body.dataset['altDown']).toBe('true');
    releaseKey('Alt');
    expect(document.body.dataset['altDown']).toBeUndefined();
  });

  it('clears data-alt-down on window blur to avoid stuck state', () => {
    pressKey('Alt');
    window.dispatchEvent(new Event('blur'));
    expect(document.body.dataset['altDown']).toBeUndefined();
  });

  it('falls back to the first alphanumeric character when no & is present', () => {
    let fired = false;
    bar.addMenu({
      id: 'help',
      label: 'Help',
      items: [{ id: 'about', label: 'About', onClick: () => (fired = true) }],
    });
    pressKey('h', { altKey: true });
    expect(activeMenuLabel()).toBe('Help');
    pressKey('Enter');
    expect(fired).toBe(true);
  });
});
