import { describe, expect, it } from 'vitest';
import { ConsolePlugin, IConsoleService } from '../src/index.js';

describe('ConsolePlugin descriptor', () => {
  it('declares the expected plugin id', () => {
    expect(ConsolePlugin.descriptor.id).toBe('editrix.console');
  });

  it('declares a semver version', () => {
    expect(ConsolePlugin.descriptor.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('depends on commands, layout, and view', () => {
    const deps = ConsolePlugin.descriptor.dependencies ?? [];
    expect(deps).toContain('editrix.commands');
    expect(deps).toContain('editrix.layout');
    expect(deps).toContain('editrix.view');
  });

  it('exposes an activate function', () => {
    expect(typeof ConsolePlugin.activate).toBe('function');
  });

  it('publishes the IConsoleService identifier', () => {
    expect(IConsoleService).toBeDefined();
  });
});
