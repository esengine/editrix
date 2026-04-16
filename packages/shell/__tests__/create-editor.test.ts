import { describe, expect, it } from 'vitest';

describe('createEditor', () => {
  it('should export createEditor function', async () => {
    const mod = await import('../src/create-editor.js');
    expect(typeof mod.createEditor).toBe('function');
  });
});
