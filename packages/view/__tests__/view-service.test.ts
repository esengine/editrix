import { describe, expect, it, vi } from 'vitest';
import type { IWidget } from '../src/widget.js';
import { ViewService } from '../src/view-service.js';

function createMockWidget(id: string): IWidget {
  return {
    id,
    mount: vi.fn(),
    resize: vi.fn(),
    focus: vi.fn(),
    hasFocus: false,
    dispose: vi.fn(),
  };
}

describe('ViewService', () => {
  it('should register a widget factory', () => {
    const service = new ViewService();
    service.registerFactory('scene', (id) => createMockWidget(id));

    // Should not throw when creating
    const widget = service.createWidget('scene');
    expect(widget.id).toBe('scene');
  });

  it('should throw when registering duplicate factory', () => {
    const service = new ViewService();
    service.registerFactory('scene', (id) => createMockWidget(id));

    expect(() =>
      service.registerFactory('scene', (id) => createMockWidget(id)),
    ).toThrow('Widget factory for panel "scene" is already registered.');
  });

  it('should throw when creating widget without factory', () => {
    const service = new ViewService();

    expect(() => service.createWidget('nonexistent')).toThrow(
      'No widget factory registered for panel "nonexistent".',
    );
  });

  it('should return existing widget on duplicate createWidget call', () => {
    const service = new ViewService();
    service.registerFactory('scene', (id) => createMockWidget(id));

    const w1 = service.createWidget('scene');
    const w2 = service.createWidget('scene');
    expect(w1).toBe(w2);
  });

  it('should get widget by panel ID', () => {
    const service = new ViewService();
    service.registerFactory('scene', (id) => createMockWidget(id));

    expect(service.getWidget('scene')).toBeUndefined();

    service.createWidget('scene');
    expect(service.getWidget('scene')).toBeDefined();
  });

  it('should destroy a widget', () => {
    const service = new ViewService();
    const widget = createMockWidget('scene');
    service.registerFactory('scene', () => widget);

    service.createWidget('scene');
    service.destroyWidget('scene');

    expect(widget.dispose).toHaveBeenCalledOnce();
    expect(service.getWidget('scene')).toBeUndefined();
  });

  it('should return active widget IDs', () => {
    const service = new ViewService();
    service.registerFactory('a', (id) => createMockWidget(id));
    service.registerFactory('b', (id) => createMockWidget(id));

    service.createWidget('a');
    service.createWidget('b');

    expect(service.getActiveWidgetIds()).toEqual(['a', 'b']);
  });

  it('should fire onDidChangeWidgets on create and destroy', () => {
    const service = new ViewService();
    service.registerFactory('scene', (id) => createMockWidget(id));

    const handler = vi.fn();
    service.onDidChangeWidgets(handler);

    service.createWidget('scene');
    expect(handler).toHaveBeenCalledWith('scene');

    service.destroyWidget('scene');
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('should unregister factory and destroy widget on dispose', () => {
    const service = new ViewService();
    const widget = createMockWidget('scene');
    const d = service.registerFactory('scene', () => widget);

    service.createWidget('scene');
    d.dispose();

    expect(widget.dispose).toHaveBeenCalledOnce();
    expect(service.getWidget('scene')).toBeUndefined();
  });

  it('should dispose all widgets on service dispose', () => {
    const service = new ViewService();
    const w1 = createMockWidget('a');
    const w2 = createMockWidget('b');

    service.registerFactory('a', () => w1);
    service.registerFactory('b', () => w2);
    service.createWidget('a');
    service.createWidget('b');

    service.dispose();

    expect(w1.dispose).toHaveBeenCalledOnce();
    expect(w2.dispose).toHaveBeenCalledOnce();
  });
});
