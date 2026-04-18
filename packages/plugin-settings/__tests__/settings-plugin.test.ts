import { describe, expect, it } from 'vitest';
import { SettingsPlugin } from '../src/index.js';

describe('SettingsPlugin descriptor', () => {
  it('declares the expected plugin id', () => {
    expect(SettingsPlugin.descriptor.id).toBe('editrix.settings');
  });

  it('declares a semver version', () => {
    expect(SettingsPlugin.descriptor.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('depends on commands, view, and view-dom', () => {
    const deps = SettingsPlugin.descriptor.dependencies ?? [];
    expect(deps).toContain('editrix.commands');
    expect(deps).toContain('editrix.view');
    expect(deps).toContain('editrix.view-dom');
  });

  it('exposes an activate function', () => {
    expect(typeof SettingsPlugin.activate).toBe('function');
  });
});
