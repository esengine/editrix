import { describe, expect, it, vi } from 'vitest';
import { UndoRedoService } from '../src/undo-redo.js';

describe('UndoRedoService', () => {
  function makeOp(label: string, undoFn = vi.fn(), redoFn = vi.fn()) {
    return { label, undo: undoFn, redo: redoFn };
  }

  it('should push and undo a single operation', () => {
    const service = new UndoRedoService();
    const op = makeOp('Set Color');

    service.push(op);
    expect(service.canUndo()).toBe(true);
    expect(service.getUndoLabel()).toBe('Set Color');

    service.undo();
    expect(op.undo).toHaveBeenCalledOnce();
    expect(service.canUndo()).toBe(false);
  });

  it('should redo after undo', () => {
    const service = new UndoRedoService();
    const op = makeOp('Move');

    service.push(op);
    service.undo();
    expect(service.canRedo()).toBe(true);
    expect(service.getRedoLabel()).toBe('Move');

    service.redo();
    expect(op.redo).toHaveBeenCalledOnce();
    expect(service.canRedo()).toBe(false);
    expect(service.canUndo()).toBe(true);
  });

  it('should clear redo stack when pushing new operation', () => {
    const service = new UndoRedoService();
    service.push(makeOp('A'));
    service.undo();
    expect(service.canRedo()).toBe(true);

    service.push(makeOp('B'));
    expect(service.canRedo()).toBe(false);
  });

  it('should handle multiple undo/redo in order', () => {
    const service = new UndoRedoService();
    const order: string[] = [];

    service.push(
      makeOp(
        'A',
        () => order.push('undo-A'),
        () => order.push('redo-A'),
      ),
    );
    service.push(
      makeOp(
        'B',
        () => order.push('undo-B'),
        () => order.push('redo-B'),
      ),
    );

    service.undo();
    service.undo();
    expect(order).toEqual(['undo-B', 'undo-A']);

    service.redo();
    service.redo();
    expect(order).toEqual(['undo-B', 'undo-A', 'redo-A', 'redo-B']);
  });

  it('should do nothing when undo/redo on empty stack', () => {
    const service = new UndoRedoService();
    service.undo();
    service.redo();
    expect(service.canUndo()).toBe(false);
    expect(service.canRedo()).toBe(false);
  });

  describe('group transactions', () => {
    it('should undo a group as a single step', () => {
      const service = new UndoRedoService();
      const op1 = makeOp('A');
      const op2 = makeOp('B');

      service.beginGroup('Batch');
      service.push(op1);
      service.push(op2);
      service.endGroup();

      expect(service.getUndoLabel()).toBe('Batch');

      service.undo();
      expect(op2.undo).toHaveBeenCalledOnce();
      expect(op1.undo).toHaveBeenCalledOnce();
      expect(service.canUndo()).toBe(false);
    });

    it('should undo group in reverse order', () => {
      const service = new UndoRedoService();
      const order: string[] = [];

      service.beginGroup('G');
      service.push(makeOp('1', () => order.push('u1')));
      service.push(makeOp('2', () => order.push('u2')));
      service.push(makeOp('3', () => order.push('u3')));
      service.endGroup();

      service.undo();
      expect(order).toEqual(['u3', 'u2', 'u1']);
    });

    it('should redo group in forward order', () => {
      const service = new UndoRedoService();
      const order: string[] = [];

      service.beginGroup('G');
      service.push(makeOp('1', vi.fn(), () => order.push('r1')));
      service.push(makeOp('2', vi.fn(), () => order.push('r2')));
      service.endGroup();

      service.undo();
      service.redo();
      expect(order).toEqual(['r1', 'r2']);
    });

    it('should skip empty group', () => {
      const service = new UndoRedoService();
      service.beginGroup('Empty');
      service.endGroup();
      expect(service.canUndo()).toBe(false);
    });

    it('should throw on nested beginGroup', () => {
      const service = new UndoRedoService();
      service.beginGroup('A');
      expect(() => service.beginGroup('B')).toThrow('Cannot nest');
    });

    it('should throw on endGroup without beginGroup', () => {
      const service = new UndoRedoService();
      expect(() => service.endGroup()).toThrow('No active group');
    });
  });

  it('should fire onDidChangeState on push/undo/redo', () => {
    const service = new UndoRedoService();
    const handler = vi.fn();
    service.onDidChangeState(handler);

    service.push(makeOp('X'));
    expect(handler).toHaveBeenCalledWith({
      canUndo: true,
      canRedo: false,
      undoLabel: 'X',
      redoLabel: undefined,
    });

    service.undo();
    expect(handler).toHaveBeenCalledWith({
      canUndo: false,
      canRedo: true,
      undoLabel: undefined,
      redoLabel: 'X',
    });
  });

  it('should respect maxStackSize', () => {
    const service = new UndoRedoService();
    service.setMaxStackSize(3);

    service.push(makeOp('A'));
    service.push(makeOp('B'));
    service.push(makeOp('C'));
    service.push(makeOp('D'));

    // A should have been dropped
    expect(service.getUndoLabel()).toBe('D');
    service.undo();
    expect(service.getUndoLabel()).toBe('C');
    service.undo();
    expect(service.getUndoLabel()).toBe('B');
    service.undo();
    expect(service.canUndo()).toBe(false);
  });

  it('should clear all history', () => {
    const service = new UndoRedoService();
    service.push(makeOp('A'));
    service.push(makeOp('B'));
    service.undo();

    service.clear();
    expect(service.canUndo()).toBe(false);
    expect(service.canRedo()).toBe(false);
  });

  describe('per-resource stacks', () => {
    function withKey(label: string, resourceKey: string, undoFn = vi.fn(), redoFn = vi.fn()) {
      return { label, undo: undoFn, redo: redoFn, resourceKey };
    }

    it('should keep separate undo histories per resource', () => {
      const service = new UndoRedoService();
      const docA = '/a.scene.json';
      const docB = '/b.scene.json';

      service.push(withKey('A1', docA));
      service.push(withKey('A2', docA));
      service.push(withKey('B1', docB));

      expect(service.canUndo(docA)).toBe(true);
      expect(service.canUndo(docB)).toBe(true);
      expect(service.getUndoLabel(docA)).toBe('A2');
      expect(service.getUndoLabel(docB)).toBe('B1');
      // Global stack untouched
      expect(service.canUndo()).toBe(false);
    });

    it('should not let one resource undo affect another', () => {
      const service = new UndoRedoService();
      const aUndo = vi.fn();
      const bUndo = vi.fn();
      service.push(withKey('A', '/a', aUndo));
      service.push(withKey('B', '/b', bUndo));

      service.undo('/a');

      expect(aUndo).toHaveBeenCalledOnce();
      expect(bUndo).not.toHaveBeenCalled();
      expect(service.canUndo('/b')).toBe(true);
    });

    it('should clear redo only for the resource being pushed to', () => {
      const service = new UndoRedoService();
      service.push(withKey('A1', '/a'));
      service.push(withKey('B1', '/b'));
      service.undo('/a');
      service.undo('/b');
      expect(service.canRedo('/a')).toBe(true);
      expect(service.canRedo('/b')).toBe(true);

      // New push to /a clears /a's redo but leaves /b's intact.
      service.push(withKey('A2', '/a'));
      expect(service.canRedo('/a')).toBe(false);
      expect(service.canRedo('/b')).toBe(true);
    });

    it('should clear a single resource via clearResource', () => {
      const service = new UndoRedoService();
      service.push(withKey('A1', '/a'));
      service.push(withKey('B1', '/b'));

      service.clearResource('/a');

      expect(service.canUndo('/a')).toBe(false);
      expect(service.canUndo('/b')).toBe(true);
    });

    it('should associate group with the explicit resourceKey', () => {
      const service = new UndoRedoService();
      service.beginGroup('Batch', '/doc');
      service.push(makeOp('1'));
      service.push(makeOp('2'));
      service.endGroup();

      expect(service.canUndo('/doc')).toBe(true);
      expect(service.canUndo()).toBe(false);
    });

    it('should include resourceKey in onDidChangeState for non-global pushes', () => {
      const service = new UndoRedoService();
      const handler = vi.fn();
      service.onDidChangeState(handler);

      service.push(withKey('A', '/doc'));

      expect(handler).toHaveBeenCalledWith({
        canUndo: true,
        canRedo: false,
        undoLabel: 'A',
        redoLabel: undefined,
        resourceKey: '/doc',
      });
    });
  });

  describe('operation error isolation', () => {
    it('should fire onError when op.undo throws and still rotate the entry to redo', () => {
      const service = new UndoRedoService();
      const errors: unknown[] = [];
      service.onError((e) => errors.push(e));
      service.push(
        makeOp('Bad', () => {
          throw new Error('undo blew up');
        }),
      );

      service.undo();

      // The buggy op did not strand the stack — user can redo to step forward.
      expect(service.canRedo()).toBe(true);
      expect(service.canUndo()).toBe(false);
      expect(errors).toHaveLength(1);
      expect((errors[0] as { phase: string }).phase).toBe('undo');
    });

    it('should fire onError when op.redo throws and still rotate the entry to undo', () => {
      const service = new UndoRedoService();
      const errors: unknown[] = [];
      service.onError((e) => errors.push(e));
      service.push(
        makeOp('Bad', vi.fn(), () => {
          throw new Error('redo blew up');
        }),
      );
      service.undo();

      service.redo();

      expect(service.canUndo()).toBe(true);
      expect(errors).toHaveLength(1);
      expect((errors[0] as { phase: string }).phase).toBe('redo');
    });

    it('should keep running remaining ops in a group when one throws during undo', () => {
      const service = new UndoRedoService();
      const order: string[] = [];
      service.onError(() => order.push('error'));

      service.beginGroup('G');
      service.push(makeOp('1', () => order.push('u1')));
      service.push(
        makeOp('2', () => {
          throw new Error('boom');
        }),
      );
      service.push(makeOp('3', () => order.push('u3')));
      service.endGroup();

      service.undo();

      // Reverse order: 3, 2 (errors), 1.
      expect(order).toEqual(['u3', 'error', 'u1']);
    });
  });
});
