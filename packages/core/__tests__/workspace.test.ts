import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceConfig } from '../src/workspace.js';
import { WorkspaceService } from '../src/workspace.js';

const minimalConfig: WorkspaceConfig = {
  name: 'Demo',
  version: '0.1.0',
  editrix: '0.1.0',
  plugins: { builtin: true },
};

describe('WorkspaceService', () => {
  it('starts closed when no initial state is given', () => {
    const ws = new WorkspaceService();
    expect(ws.isOpen).toBe(false);
    expect(ws.path).toBe('');
    expect(ws.config).toBeUndefined();
    expect(ws.assetRoots).toEqual([]);
  });

  it('accepts a seeded path + config at construction', () => {
    const ws = new WorkspaceService({ path: '/proj', config: minimalConfig });
    expect(ws.isOpen).toBe(true);
    expect(ws.path).toBe('/proj');
    expect(ws.config?.name).toBe('Demo');
  });

  it('fires onDidChange when setWorkspace is called', () => {
    const ws = new WorkspaceService();
    const spy = vi.fn();
    ws.onDidChange(spy);
    ws.setWorkspace({ path: '/a', config: minimalConfig });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ path: '/a', config: minimalConfig });
  });

  it('fires onDidChange with empty path + undefined config on close', () => {
    const ws = new WorkspaceService({ path: '/a', config: minimalConfig });
    const spy = vi.fn();
    ws.onDidChange(spy);
    ws.setWorkspace({ path: '', config: undefined });
    expect(spy).toHaveBeenCalledWith({ path: '', config: undefined });
    expect(ws.isOpen).toBe(false);
  });

  it('exposes assetRoots from the config', () => {
    const withRoots: WorkspaceConfig = {
      ...minimalConfig,
      assets: { roots: ['assets', 'content'] },
    };
    const ws = new WorkspaceService({ path: '/p', config: withRoots });
    expect(ws.assetRoots).toEqual(['assets', 'content']);
  });

  it('returns an empty array for assetRoots when none are configured', () => {
    const ws = new WorkspaceService({ path: '/p', config: minimalConfig });
    expect(ws.assetRoots).toEqual([]);
  });

  it('resolve returns the workspace root when given an empty relative path', () => {
    const ws = new WorkspaceService({ path: '/proj', config: minimalConfig });
    expect(ws.resolve('')).toBe('/proj');
  });

  it('resolve joins the workspace path with a relative', () => {
    const ws = new WorkspaceService({ path: '/proj', config: minimalConfig });
    expect(ws.resolve('scenes/main.scene.json')).toBe('/proj/scenes/main.scene.json');
  });

  it('resolve strips leading slashes from the relative path', () => {
    const ws = new WorkspaceService({ path: '/proj', config: minimalConfig });
    expect(ws.resolve('/scenes/main.scene.json')).toBe('/proj/scenes/main.scene.json');
    expect(ws.resolve('///a')).toBe('/proj/a');
  });

  it('resolve returns empty string when no workspace is open', () => {
    const ws = new WorkspaceService();
    expect(ws.resolve('anything')).toBe('');
  });

  it('dispose removes subscribers so future fires are no-ops', () => {
    const ws = new WorkspaceService();
    const spy = vi.fn();
    ws.onDidChange(spy);
    ws.dispose();
    // After dispose the emitter is gone; no throw, no callback fired.
    ws.setWorkspace({ path: '/a', config: minimalConfig });
    expect(spy).not.toHaveBeenCalled();
  });
});
