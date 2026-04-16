import { describe, expect, it, vi } from 'vitest';
import { SelectionService } from '../src/selection-service.js';

describe('SelectionService', () => {
  it('should select objects', () => {
    const service = new SelectionService();
    service.select(['node-1', 'node-2']);
    expect(service.getSelection()).toEqual(['node-1', 'node-2']);
  });

  it('should replace previous selection', () => {
    const service = new SelectionService();
    service.select(['node-1']);
    service.select(['node-2']);
    expect(service.getSelection()).toEqual(['node-2']);
  });

  it('should add to selection', () => {
    const service = new SelectionService();
    service.select(['node-1']);
    service.addToSelection(['node-2', 'node-3']);
    expect(service.getSelection()).toEqual(['node-1', 'node-2', 'node-3']);
  });

  it('should not add duplicates', () => {
    const service = new SelectionService();
    service.select(['node-1']);
    service.addToSelection(['node-1', 'node-2']);
    expect(service.getSelection()).toEqual(['node-1', 'node-2']);
  });

  it('should remove from selection', () => {
    const service = new SelectionService();
    service.select(['a', 'b', 'c']);
    service.removeFromSelection(['b']);
    expect(service.getSelection()).toEqual(['a', 'c']);
  });

  it('should clear selection', () => {
    const service = new SelectionService();
    service.select(['a', 'b']);
    service.clearSelection();
    expect(service.getSelection()).toEqual([]);
  });

  it('should not fire event when clearing empty selection', () => {
    const service = new SelectionService();
    const handler = vi.fn();
    service.onDidChangeSelection(handler);
    service.clearSelection();
    expect(handler).not.toHaveBeenCalled();
  });

  it('should check if object is selected', () => {
    const service = new SelectionService();
    service.select(['node-1']);
    expect(service.isSelected('node-1')).toBe(true);
    expect(service.isSelected('node-2')).toBe(false);
  });

  it('should fire onDidChangeSelection on changes', () => {
    const service = new SelectionService();
    const handler = vi.fn();
    service.onDidChangeSelection(handler);

    service.select(['a']);
    expect(handler).toHaveBeenCalledWith(['a']);

    service.addToSelection(['b']);
    expect(handler).toHaveBeenCalledWith(['a', 'b']);

    service.clearSelection();
    expect(handler).toHaveBeenCalledWith([]);
  });
});
