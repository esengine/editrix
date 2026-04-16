import { describe, expect, it, vi } from 'vitest';
import { SceneService } from '../src/scene-service.js';
import type { SceneNode } from '../src/scene-service.js';

function mkNode(id: string, name: string, type = 'gameobject'): SceneNode {
  return { id, name, type, icon: 'box', children: [], visible: true };
}

describe('SceneService', () => {
  it('should add root nodes', () => {
    const s = new SceneService();
    s.addNode(mkNode('a', 'Node A'));
    expect(s.getRootIds()).toEqual(['a']);
    expect(s.getNode('a')?.name).toBe('Node A');
  });

  it('should add child nodes', () => {
    const s = new SceneService();
    s.addNode(mkNode('parent', 'Parent'));
    s.addNode(mkNode('child', 'Child'), 'parent');

    const children = s.getChildren('parent');
    expect(children).toHaveLength(1);
    expect(children[0]?.id).toBe('child');
  });

  it('should remove nodes', () => {
    const s = new SceneService();
    s.addNode(mkNode('a', 'A'));
    s.removeNode('a');
    expect(s.getNode('a')).toBeUndefined();
    expect(s.getRootIds()).toEqual([]);
  });

  it('should remove child reference from parent', () => {
    const s = new SceneService();
    s.addNode(mkNode('p', 'Parent'));
    s.addNode(mkNode('c', 'Child'), 'p');
    s.removeNode('c');
    expect(s.getChildren('p')).toHaveLength(0);
  });

  it('should set and get properties', () => {
    const s = new SceneService();
    s.registerNodeType({
      type: 'obj',
      label: 'Object',
      properties: [{ key: 'x', label: 'X', type: 'number', defaultValue: 0 }],
    });
    s.addNode(mkNode('n', 'N', 'obj'));

    expect(s.getProperty('n', 'x')).toBe(0);
    s.setProperty('n', 'x', 42);
    expect(s.getProperty('n', 'x')).toBe(42);
  });

  it('should initialize defaults from schema', () => {
    const s = new SceneService();
    s.registerNodeType({
      type: 'obj',
      label: 'Object',
      properties: [
        { key: 'a', label: 'A', type: 'number', defaultValue: 10 },
        { key: 'b', label: 'B', type: 'boolean', defaultValue: true },
      ],
    });
    s.addNode(mkNode('n', 'N', 'obj'));
    expect(s.getProperties('n')).toEqual({ a: 10, b: true });
  });

  it('should set node name and visibility', () => {
    const s = new SceneService();
    s.addNode(mkNode('n', 'Old'));
    s.setNodeName('n', 'New');
    expect(s.getNode('n')?.name).toBe('New');

    s.setNodeVisible('n', false);
    expect(s.getNode('n')?.visible).toBe(false);
  });

  it('should fire onDidChangeScene on add/remove/modify', () => {
    const s = new SceneService();
    const handler = vi.fn();
    s.onDidChangeScene(handler);

    s.addNode(mkNode('a', 'A'));
    expect(handler).toHaveBeenCalledWith({ nodeId: 'a', changeType: 'added' });

    s.setNodeName('a', 'B');
    expect(handler).toHaveBeenCalledWith({ nodeId: 'a', changeType: 'modified' });

    s.removeNode('a');
    expect(handler).toHaveBeenCalledWith({ nodeId: 'a', changeType: 'removed' });
  });

  it('should fire onDidChangeProperty', () => {
    const s = new SceneService();
    const handler = vi.fn();
    s.onDidChangeProperty(handler);

    s.setProperty('n', 'x', 5);
    expect(handler).toHaveBeenCalledWith({ nodeId: 'n', key: 'x', oldValue: undefined, newValue: 5 });
  });

  it('should get node type schema', () => {
    const s = new SceneService();
    const schema = { type: 't', label: 'T', properties: [] };
    s.registerNodeType(schema);
    expect(s.getNodeTypeSchema('t')).toBe(schema);
  });

  it('should unregister node type schema', () => {
    const s = new SceneService();
    const d = s.registerNodeType({ type: 't', label: 'T', properties: [] });
    d.dispose();
    expect(s.getNodeTypeSchema('t')).toBeUndefined();
  });
});
