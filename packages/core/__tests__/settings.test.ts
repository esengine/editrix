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

  describe('schema enforcement', () => {
    it('should throw on type mismatch for primitive settings', () => {
      const s = setup();
      expect(() => s.set('editor.fontSize', '14')).toThrow('expects a number');
      expect(() => s.set('editor.wordWrap', 1)).toThrow('expects a boolean');
    });

    it('should throw when an enum value is not in the allowed set', () => {
      const s = setup();
      expect(() => s.set('editor.theme', 'midnight')).toThrow('not in the allowed set');
    });

    it('should clamp a range value silently and surface the fix-up via onError', () => {
      const s = new SettingsService();
      s.registerGroup({
        id: 'audio',
        label: 'Audio',
        settings: [
          { key: 'audio.volume', label: 'Volume', type: 'range', defaultValue: 50, min: 0, max: 100 },
        ],
      });
      const errors: unknown[] = [];
      s.onError((e) => errors.push(e));

      s.set('audio.volume', 250);

      expect(s.get('audio.volume')).toBe(100);
      expect(errors).toHaveLength(1);
    });

    it('should not enforce schema on unknown keys (no descriptor = no contract)', () => {
      const s = new SettingsService();
      // Lock in current behavior — set() on unknown keys is a free pass for
      // user-extension scenarios that haven't registered yet.
      s.set('plugin.foo.unknown', { arbitrary: 'shape' });
      expect(s.get('plugin.foo.unknown')).toEqual({ arbitrary: 'shape' });
    });

    it('should skip invalid entries during importUserValues and fire onError per skip', () => {
      const s = setup();
      const errors: { key: string }[] = [];
      s.onError((e) => errors.push(e as { key: string }));

      s.importUserValues({
        'editor.fontSize': 'oops', // bad type — skipped
        'editor.wordWrap': false, // valid — applied
        'editor.theme': 'midnight', // bad enum — skipped
      });

      expect(s.get('editor.fontSize')).toBe(14); // default unchanged
      expect(s.get('editor.wordWrap')).toBe(false); // applied
      expect(s.get('editor.theme')).toBe('dark'); // default unchanged
      expect(errors.map((e) => e.key).sort()).toEqual(['editor.fontSize', 'editor.theme']);
    });
  });
});
