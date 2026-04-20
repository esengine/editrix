import { describe, expect, it } from 'vitest';
import { applyTheme, DARK_THEME, LIGHT_THEME } from '../src/theme.js';

const REQUIRED_COLOR_KEYS = [
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
  'menuBar',
  'toolbar',
  'axisX',
  'axisY',
  'axisZ',
  'success',
  'warning',
  'error',
  'scrollbarThumb',
  'scrollbarThumbHover',
] as const;

describe('DARK_THEME', () => {
  it('should have all required color slots as strings', () => {
    for (const key of REQUIRED_COLOR_KEYS) {
      expect(DARK_THEME.colors).toHaveProperty(key);
      expect(typeof (DARK_THEME.colors as Record<string, unknown>)[key]).toBe('string');
    }
  });

  it('should have a valid id and name', () => {
    expect(DARK_THEME.id).toBe('editrix.dark');
    expect(DARK_THEME.name).toBe('Dark');
  });
});

describe('LIGHT_THEME', () => {
  it('should have all required color slots as strings', () => {
    for (const key of REQUIRED_COLOR_KEYS) {
      expect(LIGHT_THEME.colors).toHaveProperty(key);
      expect(typeof (LIGHT_THEME.colors as Record<string, unknown>)[key]).toBe('string');
    }
  });

  it('should have a distinct id and name', () => {
    expect(LIGHT_THEME.id).toBe('editrix.light');
    expect(LIGHT_THEME.name).toBe('Light');
  });

  it('should differ from dark on core text/background', () => {
    expect(LIGHT_THEME.colors.background).not.toBe(DARK_THEME.colors.background);
    expect(LIGHT_THEME.colors.text).not.toBe(DARK_THEME.colors.text);
  });
});

describe('applyTheme', () => {
  it('installs every color slot as a kebab-cased --editrix- CSS variable', () => {
    const root = document.createElement('div');
    applyTheme(root, LIGHT_THEME);

    expect(root.style.getPropertyValue('--editrix-background')).toBe(LIGHT_THEME.colors.background);
    expect(root.style.getPropertyValue('--editrix-panel-background')).toBe(
      LIGHT_THEME.colors.panelBackground,
    );
    expect(root.style.getPropertyValue('--editrix-scrollbar-thumb')).toBe(
      LIGHT_THEME.colors.scrollbarThumb,
    );
    expect(root.style.getPropertyValue('--editrix-scrollbar-thumb-hover')).toBe(
      LIGHT_THEME.colors.scrollbarThumbHover,
    );
  });

  it('overwrites previously-installed vars when switching themes', () => {
    const root = document.createElement('div');
    applyTheme(root, DARK_THEME);
    expect(root.style.getPropertyValue('--editrix-background')).toBe(DARK_THEME.colors.background);

    applyTheme(root, LIGHT_THEME);
    expect(root.style.getPropertyValue('--editrix-background')).toBe(LIGHT_THEME.colors.background);
    expect(root.style.getPropertyValue('--editrix-text')).toBe(LIGHT_THEME.colors.text);
  });
});
