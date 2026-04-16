import { setCssVars } from './dom-utils.js';

/**
 * Theme definition. All colors are CSS color values.
 */
export interface EditorTheme {
  readonly id: string;
  readonly name: string;
  readonly colors: ThemeColors;
}

/**
 * Color slots used by the editor shell.
 */
export interface ThemeColors {
  readonly background: string;
  readonly surface: string;
  readonly border: string;
  readonly text: string;
  readonly textDim: string;
  readonly accent: string;
  readonly accentText: string;
  readonly panelBackground: string;
  readonly tabActive: string;
  readonly tabInactive: string;
  readonly statusBar: string;
  readonly statusBarText: string;
  readonly overlay: string;
  readonly menuBar: string;
  readonly toolbar: string;
  readonly axisX: string;
  readonly axisY: string;
  readonly axisZ: string;
  readonly success: string;
  readonly warning: string;
  readonly error: string;
}

/**
 * Default dark theme — deep neutral tones designed for professional editors.
 */
export const DARK_THEME: EditorTheme = {
  id: 'editrix.dark',
  name: 'Dark',
  colors: {
    background: '#1b1b1f',
    surface: '#252529',
    border: '#2e2e34',
    text: '#cccccc',
    textDim: '#7e7e86',
    accent: '#4a8fff',
    accentText: '#ffffff',
    panelBackground: '#1b1b1f',
    tabActive: '#2c2c32',
    tabInactive: '#1b1b1f',
    statusBar: '#252529',
    statusBarText: '#7e7e86',
    overlay: 'rgba(0, 0, 0, 0.65)',
    menuBar: '#1b1b1f',
    toolbar: '#252529',
    axisX: '#e55561',
    axisY: '#6bc46d',
    axisZ: '#5299e0',
    success: '#98c379',
    warning: '#e5c07b',
    error: '#e06c75',
  },
};

/**
 * Apply a theme to the document root via CSS custom properties.
 *
 * @example
 * ```ts
 * applyTheme(document.documentElement, DARK_THEME);
 * ```
 */
export function applyTheme(root: HTMLElement, theme: EditorTheme): void {
  const vars: Record<string, string> = {};
  for (const [key, value] of Object.entries(theme.colors) as [string, string][]) {
    // camelCase → kebab-case: panelBackground → panel-background
    const cssKey = `--editrix-${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;
    vars[cssKey] = value;
  }
  setCssVars(root, vars);
}
