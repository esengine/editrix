import { afterEach, describe, expect, it } from 'vitest';
import { DomDialogService } from '../src/dialog-service.js';

function dispatchKey(key: string): void {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  document.dispatchEvent(ev);
}

function clickButton(label: string): void {
  const btn = [...document.querySelectorAll<HTMLButtonElement>('.editrix-dialog-btn')].find(
    (el) => el.textContent === label,
  );
  if (!btn) throw new Error(`No button labelled "${label}"`);
  btn.click();
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('DomDialogService', () => {
  describe('showMessage', () => {
    it('resolves with the clicked button id', async () => {
      const svc = new DomDialogService();
      const p = svc.showMessage({
        message: 'Hi',
        buttons: [
          { id: 'ok', label: 'OK', isDefault: true },
          { id: 'cancel', label: 'Cancel', isCancel: true },
        ],
      });
      clickButton('OK');
      await expect(p).resolves.toBe('ok');
    });

    it('resolves with the cancel-button id on Escape', async () => {
      const svc = new DomDialogService();
      const p = svc.showMessage({
        message: 'Hi',
        buttons: [
          { id: 'ok', label: 'OK', isDefault: true },
          { id: 'cancel', label: 'Cancel', isCancel: true },
        ],
      });
      dispatchKey('Escape');
      await expect(p).resolves.toBe('cancel');
    });

    it('resolves with the default-button id on Enter', async () => {
      const svc = new DomDialogService();
      const p = svc.showMessage({
        message: 'Hi',
        buttons: [
          { id: 'cancel', label: 'Cancel', isCancel: true },
          { id: 'ok', label: 'OK', isDefault: true },
        ],
      });
      dispatchKey('Enter');
      await expect(p).resolves.toBe('ok');
    });

    it('rejects when buttons is empty', async () => {
      const svc = new DomDialogService();
      // The function is async but this specific check runs sync then
      // returns a rejected promise. Either way — it must not render a
      // buttonless dialog.
      await expect(svc.showMessage({ message: 'Hi', buttons: [] })).rejects.toThrow(/non-empty/);
    });

    it('removes the overlay after resolution', async () => {
      const svc = new DomDialogService();
      const p = svc.showMessage({
        message: 'Hi',
        buttons: [{ id: 'ok', label: 'OK' }],
      });
      expect(document.querySelector('.editrix-dialog-overlay')).not.toBeNull();
      clickButton('OK');
      await p;
      expect(document.querySelector('.editrix-dialog-overlay')).toBeNull();
    });
  });

  describe('confirm', () => {
    it('resolves true on OK and false on Cancel', async () => {
      const svc = new DomDialogService();
      const a = svc.confirm({ message: 'Sure?' });
      clickButton('OK');
      await expect(a).resolves.toBe(true);

      const b = svc.confirm({ message: 'Sure?' });
      clickButton('Cancel');
      await expect(b).resolves.toBe(false);
    });

    it('honours a custom okLabel', async () => {
      const svc = new DomDialogService();
      const p = svc.confirm({ message: 'Delete?', okLabel: 'Delete', destructive: true });
      clickButton('Delete');
      await expect(p).resolves.toBe(true);
    });
  });

  describe('prompt', () => {
    it('resolves with the input value on Enter', async () => {
      const svc = new DomDialogService();
      const p = svc.prompt({ title: 'Name' });
      const input = document.querySelector<HTMLInputElement>('.editrix-dialog-input');
      if (!input) throw new Error('no input');
      input.value = 'Alice';
      const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      input.dispatchEvent(ev);
      await expect(p).resolves.toBe('Alice');
    });

    it('resolves null on Escape', async () => {
      const svc = new DomDialogService();
      const p = svc.prompt({ title: 'Name' });
      dispatchKey('Escape');
      await expect(p).resolves.toBeNull();
    });

    it('keeps the dialog open when validate returns an error', async () => {
      const svc = new DomDialogService();
      const p = svc.prompt({
        title: 'Name',
        validate: (v) => (v.length === 0 ? 'required' : undefined),
      });
      const input = document.querySelector<HTMLInputElement>('.editrix-dialog-input');
      if (!input) throw new Error('no input');
      input.value = '';
      const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      input.dispatchEvent(ev);
      // Overlay stays — unresolved.
      expect(document.querySelector('.editrix-dialog-overlay')).not.toBeNull();
      // Error message is surfaced.
      const err = document.querySelector('.editrix-dialog-error');
      expect(err?.textContent).toBe('required');
      // Now enter a valid value.
      input.value = 'OK';
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
      await expect(p).resolves.toBe('OK');
    });
  });
});
