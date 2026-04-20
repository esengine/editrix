import { describe, expect, it } from 'vitest';
import { DARK_THEME } from '../src/theme.js';

describe('DARK_THEME', () => {
  it('should have all required color slots', () => {
    const required = [
      'background',
      'surface',
      'border',
      'text',
      'textDim',
      'accent',
      'accentText',
      'panelBackground',
      'tabActive',
      'tabInactive',
      'statusBar',
      'statusBarText',
      'overlay',
    ];

    for (const key of required) {
      expect(DARK_THEME.colors).toHaveProperty(key);
      expect(typeof (DARK_THEME.colors as Record<string, unknown>)[key]).toBe('string');
    }
  });

  it('should have a valid id and name', () => {
    expect(DARK_THEME.id).toBe('editrix.dark');
    expect(DARK_THEME.name).toBe('Dark');
  });
});
