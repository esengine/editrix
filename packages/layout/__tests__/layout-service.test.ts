import { describe, expect, it, vi } from 'vitest';
import { LayoutService } from '../src/layout-service.js';
import { findPanel, getAllPanelIds } from '../src/layout-tree.js';

describe('LayoutService', () => {
  it('should register and retrieve a panel descriptor', () => {
    const service = new LayoutService();
    service.registerPanel({ id: 'scene', title: 'Scene View' });

    expect(service.getDescriptor('scene')?.title).toBe('Scene View');
    expect(service.getAllDescriptors()).toHaveLength(1);
  });

  it('should throw when registering duplicate panel', () => {
    const service = new LayoutService();
    service.registerPanel({ id: 'scene', title: 'Scene View' });

    expect(() => service.registerPanel({ id: 'scene', title: 'Scene View 2' })).toThrow(
      'Panel "scene" is already registered.',
    );
  });

  it('should unregister panel when disposable is disposed', () => {
    const service = new LayoutService();
    const d = service.registerPanel({ id: 'scene', title: 'Scene View' });
    d.dispose();

    expect(service.getDescriptor('scene')).toBeUndefined();
  });

  it('should open a panel into the layout', () => {
    const service = new LayoutService();
    service.registerPanel({ id: 'scene', title: 'Scene View', defaultRegion: 'center' });
    service.openPanel('scene');

    const ids = service.getOpenPanelIds();
    expect(ids).toContain('scene');
  });

  it('should throw when opening an unregistered panel', () => {
    const service = new LayoutService();
    expect(() => service.openPanel('nonexistent')).toThrow(
      'Panel "nonexistent" is not registered.',
    );
  });

  it('should place panels in different regions', () => {
    const service = new LayoutService();
    service.registerPanel({ id: 'scene', title: 'Scene', defaultRegion: 'center' });
    service.registerPanel({ id: 'inspector', title: 'Inspector', defaultRegion: 'right' });
    service.registerPanel({ id: 'console', title: 'Console', defaultRegion: 'bottom' });

    service.openPanel('scene');
    service.openPanel('inspector');
    service.openPanel('console');

    const layout = service.getLayout();
    const ids = getAllPanelIds(layout);
    expect(ids).toContain('scene');
    expect(ids).toContain('inspector');
    expect(ids).toContain('console');
  });

  it('should close a panel from the layout', () => {
    const service = new LayoutService();
    service.registerPanel({ id: 'scene', title: 'Scene' });
    service.openPanel('scene');
    service.closePanel('scene');

    expect(service.getOpenPanelIds()).not.toContain('scene');
    // Descriptor should still be registered
    expect(service.getDescriptor('scene')).toBeDefined();
  });

  it('should activate a panel', () => {
    const service = new LayoutService();
    service.registerPanel({ id: 'scene', title: 'Scene', defaultRegion: 'center' });
    service.registerPanel({ id: 'game', title: 'Game', defaultRegion: 'center' });

    service.openPanel('scene');
    service.openPanel('game');
    service.activatePanel('scene');

    const found = findPanel(service.getLayout(), 'scene');
    expect(found?.node.activeIndex).toBe(0);
  });

  it('should fire onDidChangeLayout when layout changes', () => {
    const service = new LayoutService();
    service.registerPanel({ id: 'scene', title: 'Scene' });

    const handler = vi.fn();
    service.onDidChangeLayout(handler);

    service.openPanel('scene');
    expect(handler).toHaveBeenCalledTimes(1);

    service.closePanel('scene');
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('should fire onDidChangePanels when panels are registered/unregistered', () => {
    const service = new LayoutService();
    const handler = vi.fn();
    service.onDidChangePanels(handler);

    const d = service.registerPanel({ id: 'scene', title: 'Scene' });
    expect(handler).toHaveBeenCalledTimes(1);

    d.dispose();
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('should support setLayout for restoring a saved layout', () => {
    const service = new LayoutService();
    const customLayout = {
      type: 'tab-group' as const,
      panels: ['a', 'b'],
      activeIndex: 1,
    };

    service.setLayout(customLayout);
    expect(service.getLayout()).toBe(customLayout);
    expect(service.getOpenPanelIds()).toEqual(['a', 'b']);
  });

  it('should dispose factories when panel is unregistered', () => {
    const service = new LayoutService();
    const disposeFn = vi.fn();
    const factory = {
      descriptor: { id: 'scene', title: 'Scene' },
      dispose: disposeFn,
    };

    const d = service.registerPanel({ id: 'scene', title: 'Scene' }, factory);
    d.dispose();

    expect(disposeFn).toHaveBeenCalledOnce();
  });
});
