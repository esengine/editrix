import type { IDisposable } from '@editrix/common';
import { DisposableStore } from '@editrix/common';
import type { ISettingsService } from '@editrix/core';

/**
 * Utility for reactively binding settings to DOM properties.
 *
 * Reads the initial value and subscribes to changes automatically.
 * All subscriptions are collected and can be disposed at once.
 *
 * @example
 * ```ts
 * const binding = new SettingsBinding(settings);
 *
 * // Bind a setting to a CSS variable on an element
 * binding.bindCssVar(document.body, 'editor.fontSize', '--editor-font-size', 'px');
 *
 * // Bind a setting to a callback
 * binding.bind('console.maxEntries', (value) => list.setMaxItems(value as number));
 *
 * // Bind a setting to element.style property
 * binding.bindStyle(myElement, 'console.fontSize', 'fontSize', 'px');
 *
 * // Later
 * binding.dispose();
 * ```
 */
export class SettingsBinding implements IDisposable {
  private readonly _settings: ISettingsService;
  private readonly _subscriptions = new DisposableStore();

  constructor(settings: ISettingsService) {
    this._settings = settings;
  }

  /**
   * Bind a setting to a callback. Calls immediately with current value,
   * then again on every change.
   */
  bind(key: string, callback: (value: unknown) => void): void {
    callback(this._settings.get(key));

    this._subscriptions.add(
      this._settings.onDidChange(key, (e) => {
        callback(e.newValue);
      }),
    );
  }

  /**
   * Bind a setting to a CSS custom property on an element.
   *
   * @param element The target DOM element
   * @param key Setting key
   * @param cssVar CSS variable name (e.g. `'--editor-font-size'`)
   * @param unit Optional unit suffix (e.g. `'px'`, `'em'`)
   */
  bindCssVar(element: HTMLElement, key: string, cssVar: string, unit = ''): void {
    this.bind(key, (value) => {
      element.style.setProperty(cssVar, `${String(value)}${unit}`);
    });
  }

  /**
   * Bind a setting to an element's inline style property.
   *
   * @param element The target DOM element
   * @param key Setting key
   * @param styleProp CSS property name (camelCase, e.g. `'fontSize'`)
   * @param unit Optional unit suffix
   */
  bindStyle(element: HTMLElement, key: string, styleProp: string, unit = ''): void {
    this.bind(key, (value) => {
      (element.style as unknown as Record<string, string>)[styleProp] = `${String(value)}${unit}`;
    });
  }

  /**
   * Bind a setting to a CSS class toggle on an element.
   * Adds the class when the setting is truthy, removes when falsy.
   */
  bindClass(element: HTMLElement, key: string, className: string): void {
    this.bind(key, (value) => {
      element.classList.toggle(className, Boolean(value));
    });
  }

  dispose(): void {
    this._subscriptions.dispose();
  }
}
