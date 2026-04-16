import { describe, expect, it } from 'vitest';
import { ContextKeyService } from '../src/context-key-service.js';
import { KeybindingService } from '../src/keybinding-service.js';

describe('KeybindingService', () => {
  function setup() {
    const contextKeys = new ContextKeyService();
    const service = new KeybindingService(contextKeys);
    return { contextKeys, service };
  }

  it('should register and resolve a simple keybinding', () => {
    const { service } = setup();
    service.register({ key: 'Ctrl+S', commandId: 'file.save' });

    const result = service.resolve('Ctrl+S');
    expect(result).toEqual({ commandId: 'file.save', args: undefined });
  });

  it('should return undefined for unbound key', () => {
    const { service } = setup();
    expect(service.resolve('Ctrl+X')).toBeUndefined();
  });

  it('should normalize key order (Shift+Ctrl → Ctrl+Shift)', () => {
    const { service } = setup();
    service.register({ key: 'Shift+Ctrl+P', commandId: 'palette' });

    // Resolve with different modifier order
    expect(service.resolve('Ctrl+Shift+P')).toEqual({ commandId: 'palette', args: undefined });
  });

  it('should be case-insensitive', () => {
    const { service } = setup();
    service.register({ key: 'ctrl+s', commandId: 'file.save' });

    expect(service.resolve('Ctrl+S')).toEqual({ commandId: 'file.save', args: undefined });
  });

  it('should respect when-clauses', () => {
    const { contextKeys, service } = setup();
    service.register({ key: 'Ctrl+S', commandId: 'file.save', when: 'canSave' });

    // canSave is not set → falsy → binding should not activate
    expect(service.resolve('Ctrl+S')).toBeUndefined();

    contextKeys.set('canSave', true);
    expect(service.resolve('Ctrl+S')).toEqual({ commandId: 'file.save', args: undefined });
  });

  it('should pick higher priority binding on conflict', () => {
    const { contextKeys, service } = setup();
    contextKeys.set('editorFocus', true);

    service.register({ key: 'Ctrl+S', commandId: 'file.save', priority: 0 });
    service.register({
      key: 'Ctrl+S',
      commandId: 'special.save',
      when: 'editorFocus',
      priority: 10,
    });

    const result = service.resolve('Ctrl+S');
    expect(result?.commandId).toBe('special.save');
  });

  it('should unregister when disposable is disposed', () => {
    const { service } = setup();
    const d = service.register({ key: 'Ctrl+Z', commandId: 'undo' });

    expect(service.resolve('Ctrl+Z')).toBeDefined();
    d.dispose();
    expect(service.resolve('Ctrl+Z')).toBeUndefined();
  });

  it('should return bindings for a command', () => {
    const { service } = setup();
    service.register({ key: 'Ctrl+Z', commandId: 'undo' });
    service.register({ key: 'Ctrl+Shift+Z', commandId: 'redo' });
    service.register({ key: 'Meta+Z', commandId: 'undo' });

    const bindings = service.getBindingsForCommand('undo');
    expect(bindings).toHaveLength(2);
  });

  it('should pass args through to resolved binding', () => {
    const { service } = setup();
    service.register({ key: 'F5', commandId: 'debug.start', args: ['launch'] });

    const result = service.resolve('F5');
    expect(result).toEqual({ commandId: 'debug.start', args: ['launch'] });
  });
});
