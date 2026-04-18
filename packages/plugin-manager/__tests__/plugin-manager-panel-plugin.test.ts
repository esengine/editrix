import { describe, expect, it } from 'vitest';
import { PluginManagerPanelPlugin } from '../src/index.js';

describe('PluginManagerPanelPlugin descriptor', () => {
  it('declares the expected plugin id', () => {
    expect(PluginManagerPanelPlugin.descriptor.id).toBe('editrix.plugin-manager');
  });

  it('declares a semver version', () => {
    expect(PluginManagerPanelPlugin.descriptor.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('depends on commands, layout, view, and view-dom', () => {
    const deps = PluginManagerPanelPlugin.descriptor.dependencies ?? [];
    expect(deps).toContain('editrix.commands');
    expect(deps).toContain('editrix.layout');
    expect(deps).toContain('editrix.view');
    expect(deps).toContain('editrix.view-dom');
  });

  it('exposes an activate function', () => {
    expect(typeof PluginManagerPanelPlugin.activate).toBe('function');
  });
});
