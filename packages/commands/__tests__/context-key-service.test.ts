import { describe, expect, it, vi } from 'vitest';
import { ContextKeyService } from '../src/context-key-service.js';

describe('ContextKeyService', () => {
  it('should set and get a context key', () => {
    const ctx = new ContextKeyService();
    ctx.set('editorFocus', true);
    expect(ctx.get('editorFocus')).toBe(true);
  });

  it('should return undefined for unset keys', () => {
    const ctx = new ContextKeyService();
    expect(ctx.get('nonexistent')).toBeUndefined();
  });

  it('should delete a context key', () => {
    const ctx = new ContextKeyService();
    ctx.set('key', 'value');
    ctx.delete('key');
    expect(ctx.get('key')).toBeUndefined();
  });

  it('should remove key when the returned disposable is disposed', () => {
    const ctx = new ContextKeyService();
    const d = ctx.set('temp', 42);
    expect(ctx.get('temp')).toBe(42);
    d.dispose();
    expect(ctx.get('temp')).toBeUndefined();
  });

  it('should fire onDidChangeContext when keys change', () => {
    const ctx = new ContextKeyService();
    const handler = vi.fn();
    ctx.onDidChangeContext(handler);

    ctx.set('a', 1);
    expect(handler).toHaveBeenCalledWith('a');

    ctx.delete('a');
    expect(handler).toHaveBeenCalledTimes(2);
  });

  describe('evaluate', () => {
    it('should evaluate truthy key', () => {
      const ctx = new ContextKeyService();
      ctx.set('editorFocus', true);
      expect(ctx.evaluate('editorFocus')).toBe(true);
    });

    it('should evaluate falsy/missing key', () => {
      const ctx = new ContextKeyService();
      expect(ctx.evaluate('editorFocus')).toBe(false);

      ctx.set('editorFocus', false);
      expect(ctx.evaluate('editorFocus')).toBe(false);
    });

    it('should evaluate negation', () => {
      const ctx = new ContextKeyService();
      ctx.set('readOnly', false);
      expect(ctx.evaluate('!readOnly')).toBe(true);

      ctx.set('readOnly', true);
      expect(ctx.evaluate('!readOnly')).toBe(false);
    });

    it('should evaluate equality', () => {
      const ctx = new ContextKeyService();
      ctx.set('panelType', 'scene');
      expect(ctx.evaluate('panelType == scene')).toBe(true);
      expect(ctx.evaluate('panelType == inspector')).toBe(false);
    });

    it('should evaluate inequality', () => {
      const ctx = new ContextKeyService();
      ctx.set('panelType', 'scene');
      expect(ctx.evaluate('panelType != inspector')).toBe(true);
      expect(ctx.evaluate('panelType != scene')).toBe(false);
    });

    it('should evaluate AND expressions', () => {
      const ctx = new ContextKeyService();
      ctx.set('editorFocus', true);
      ctx.set('canSave', true);
      expect(ctx.evaluate('editorFocus && canSave')).toBe(true);

      ctx.set('canSave', false);
      expect(ctx.evaluate('editorFocus && canSave')).toBe(false);
    });

    it('should evaluate OR expressions', () => {
      const ctx = new ContextKeyService();
      ctx.set('a', false);
      ctx.set('b', true);
      expect(ctx.evaluate('a || b')).toBe(true);

      ctx.set('b', false);
      expect(ctx.evaluate('a || b')).toBe(false);
    });

    it('should give AND higher precedence than OR', () => {
      const ctx = new ContextKeyService();
      ctx.set('a', true);
      ctx.set('b', false);
      ctx.set('c', true);

      // a || b && c → a || (b && c) → true || false → true
      expect(ctx.evaluate('a || b && c')).toBe(true);
    });

    it('should return true for empty expression', () => {
      const ctx = new ContextKeyService();
      expect(ctx.evaluate('')).toBe(true);
      expect(ctx.evaluate('  ')).toBe(true);
    });

    it('should handle complex expressions', () => {
      const ctx = new ContextKeyService();
      ctx.set('editorFocus', true);
      ctx.set('panelType', 'scene');
      ctx.set('readOnly', false);

      expect(ctx.evaluate('editorFocus && panelType == scene && !readOnly')).toBe(true);
      expect(ctx.evaluate('editorFocus && panelType == inspector && !readOnly')).toBe(false);
    });
  });
});
