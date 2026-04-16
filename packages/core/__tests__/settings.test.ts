import { describe, expect, it, vi } from 'vitest';
import { SettingsService } from '../src/settings.js';

describe('SettingsService', () => {
  function setup() {
    const service = new SettingsService();
    service.registerGroup({
      id: 'editor',
      label: 'Editor',
      settings: [
        { key: 'editor.fontSize', label: 'Font Size', type: 'number', defaultValue: 14 },
        { key: 'editor.wordWrap', label: 'Word Wrap', type: 'boolean', defaultValue: true },
        { key: 'editor.theme', label: 'Theme', type: 'enum', defaultValue: 'dark', enumValues: ['dark', 'light'] },
      ],
    });
    return service;
  }

  it('should return default values', () => {
    const s = setup();
    expect(s.get('editor.fontSize')).toBe(14);
    expect(s.get('editor.wordWrap')).toBe(true);
    expect(s.get('editor.theme')).toBe('dark');
  });

  it('should return undefined for unknown keys', () => {
    const s = setup();
    expect(s.get('nonexistent')).toBeUndefined();
  });

  it('should set and get user values', () => {
    const s = setup();
    s.set('editor.fontSize', 18);
    expect(s.get('editor.fontSize')).toBe(18);
  });

  it('should report isModified correctly', () => {
    const s = setup();
    expect(s.isModified('editor.fontSize')).toBe(false);
    s.set('editor.fontSize', 18);
    expect(s.isModified('editor.fontSize')).toBe(true);
  });

  it('should reset to default', () => {
    const s = setup();
    s.set('editor.fontSize', 18);
    s.reset('editor.fontSize');
    expect(s.get('editor.fontSize')).toBe(14);
    expect(s.isModified('editor.fontSize')).toBe(false);
  });

  it('should fire onDidChangeAny on set', () => {
    const s = setup();
    const handler = vi.fn();
    s.onDidChangeAny(handler);

    s.set('editor.fontSize', 20);

    expect(handler).toHaveBeenCalledWith({
      key: 'editor.fontSize',
      oldValue: 14,
      newValue: 20,
    });
  });

  it('should fire key-specific listener', () => {
    const s = setup();
    const handler = vi.fn();
    s.onDidChange('editor.fontSize', handler);

    s.set('editor.fontSize', 20);
    s.set('editor.wordWrap', false);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      key: 'editor.fontSize',
      oldValue: 14,
      newValue: 20,
    });
  });

  it('should fire onDidChangeAny on reset', () => {
    const s = setup();
    s.set('editor.fontSize', 20);

    const handler = vi.fn();
    s.onDidChangeAny(handler);
    s.reset('editor.fontSize');

    expect(handler).toHaveBeenCalledWith({
      key: 'editor.fontSize',
      oldValue: 20,
      newValue: 14,
    });
  });

  it('should export user values', () => {
    const s = setup();
    s.set('editor.fontSize', 20);
    s.set('editor.theme', 'light');

    const exported = s.exportUserValues();
    expect(exported).toEqual({ 'editor.fontSize': 20, 'editor.theme': 'light' });
  });

  it('should import user values', () => {
    const s = setup();
    s.importUserValues({ 'editor.fontSize': 16, 'editor.wordWrap': false });

    expect(s.get('editor.fontSize')).toBe(16);
    expect(s.get('editor.wordWrap')).toBe(false);
  });

  it('should get groups and descriptors', () => {
    const s = setup();
    expect(s.getGroups()).toHaveLength(1);
    expect(s.getGroups()[0]?.label).toBe('Editor');

    const desc = s.getDescriptor('editor.fontSize');
    expect(desc?.type).toBe('number');
    expect(desc?.defaultValue).toBe(14);
  });

  it('should unregister group', () => {
    const s = new SettingsService();
    const d = s.registerGroup({
      id: 'test',
      label: 'Test',
      settings: [{ key: 'test.x', label: 'X', type: 'number', defaultValue: 0 }],
    });

    expect(s.getDescriptor('test.x')).toBeDefined();
    d.dispose();
    expect(s.getDescriptor('test.x')).toBeUndefined();
  });
});
