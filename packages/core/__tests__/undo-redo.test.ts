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

    service.push(makeOp('A', () => order.push('undo-A'), () => order.push('redo-A')));
    service.push(makeOp('B', () => order.push('undo-B'), () => order.push('redo-B')));

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
});
