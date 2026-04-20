import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorToolbar } from '../src/editor-toolbar.js';

let toolbar: EditorToolbar;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  toolbar = new EditorToolbar();
  toolbar.mount(container);
});

afterEach(() => {
  toolbar.dispose();
  document.body.replaceChildren();
});

function firstButton(): HTMLButtonElement {
  const btn = container.querySelector<HTMLButtonElement>('.editrix-editor-toolbar-btn');
  if (!btn) throw new Error('no button rendered');
  return btn;
}

describe('EditorToolbar', () => {
  it('hides the toolbar until at least one item is added', () => {
    expect(container.style.display).toBe('none');

    toolbar.addItem({ id: 'a', icon: 'x', tooltip: 'A', onClick: () => {} });
    expect(container.style.display).not.toBe('none');
  });

  it('renders button with tooltip from item', () => {
    toolbar.addItem({ id: 'undo', icon: 'undo', tooltip: 'Undo: Move Node', onClick: () => {} });
    expect(firstButton().title).toBe('Undo: Move Node');
  });

  it('addItem disposable removes the button', () => {
    const d = toolbar.addItem({ id: 'x', icon: 'x', tooltip: 'X', onClick: () => {} });
    expect(container.querySelectorAll('.editrix-editor-toolbar-btn')).toHaveLength(1);
    d.dispose();
    expect(container.querySelectorAll('.editrix-editor-toolbar-btn')).toHaveLength(0);
  });

  it('setDisabled flips the disabled attribute and suppresses clicks', () => {
    const click = vi.fn();
    toolbar.addItem({ id: 'u', icon: 'x', tooltip: 'U', onClick: click });

    toolbar.setDisabled('u', true);
    expect(firstButton().disabled).toBe(true);

    firstButton().click();
    expect(click).not.toHaveBeenCalled();

    toolbar.setDisabled('u', false);
    expect(firstButton().disabled).toBe(false);
    firstButton().click();
    expect(click).toHaveBeenCalledOnce();
  });

  it('initial disabled:true renders the button disabled from the start', () => {
    toolbar.addItem({
      id: 'u',
      icon: 'x',
      tooltip: 'U',
      disabled: true,
      onClick: () => {},
    });
    expect(firstButton().disabled).toBe(true);
  });

  it('setTooltip updates the rendered title in place', () => {
    toolbar.addItem({ id: 'u', icon: 'x', tooltip: 'Undo', onClick: () => {} });
    expect(firstButton().title).toBe('Undo');

    toolbar.setTooltip('u', 'Undo: Move Node');
    expect(firstButton().title).toBe('Undo: Move Node');
  });

  it('setToggled adds and removes the toggled class', () => {
    toolbar.addItem({ id: 't', icon: 'x', tooltip: 'T', onClick: () => {} });
    toolbar.setToggled('t', true);
    expect(firstButton().classList.contains('editrix-editor-toolbar-btn--toggled')).toBe(true);
    toolbar.setToggled('t', false);
    expect(firstButton().classList.contains('editrix-editor-toolbar-btn--toggled')).toBe(false);
  });

  it('setDisabled / setTooltip are no-ops for an unknown id', () => {
    toolbar.addItem({ id: 'u', icon: 'x', tooltip: 'U', onClick: () => {} });
    expect(() => toolbar.setDisabled('ghost', true)).not.toThrow();
    expect(() => toolbar.setTooltip('ghost', 'nope')).not.toThrow();
    expect(firstButton().disabled).toBe(false);
    expect(firstButton().title).toBe('U');
  });
});
