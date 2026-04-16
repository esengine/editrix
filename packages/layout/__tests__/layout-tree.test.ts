import { describe, expect, it } from 'vitest';
import type { LayoutNode } from '../src/layout-tree.js';
import {
  addPanelToGroup,
  findPanel,
  getAllPanelIds,
  removePanel,
  setActiveTab,
} from '../src/layout-tree.js';

const simpleLayout: LayoutNode = {
  type: 'split',
  direction: 'horizontal',
  children: [
    { node: { type: 'tab-group', panels: ['hierarchy'], activeIndex: 0 }, weight: 0.2 },
    { node: { type: 'tab-group', panels: ['scene', 'game'], activeIndex: 0 }, weight: 0.6 },
    { node: { type: 'tab-group', panels: ['inspector'], activeIndex: 0 }, weight: 0.2 },
  ],
};

describe('findPanel', () => {
  it('should find a panel in a tab group', () => {
    const result = findPanel(simpleLayout, 'scene');
    expect(result).toBeDefined();
    expect(result?.node.panels).toContain('scene');
    expect(result?.path).toEqual([1]);
  });

  it('should return undefined for nonexistent panel', () => {
    expect(findPanel(simpleLayout, 'nonexistent')).toBeUndefined();
  });

  it('should find panel in a flat tab-group root', () => {
    const flat: LayoutNode = { type: 'tab-group', panels: ['a', 'b'], activeIndex: 0 };
    const result = findPanel(flat, 'b');
    expect(result?.path).toEqual([]);
  });
});

describe('addPanelToGroup', () => {
  it('should add a panel to the specified tab group', () => {
    const updated = addPanelToGroup(simpleLayout, 'console', [1]);
    const found = findPanel(updated, 'console');
    expect(found?.node.panels).toContain('console');
    expect(found?.node.activeIndex).toBe(2); // new panel becomes active
  });

  it('should not mutate the original tree', () => {
    addPanelToGroup(simpleLayout, 'console', [1]);
    const original = findPanel(simpleLayout, 'console');
    expect(original).toBeUndefined();
  });
});

describe('removePanel', () => {
  it('should remove a panel from its tab group', () => {
    const updated = removePanel(simpleLayout, 'scene');
    expect(findPanel(updated, 'scene')).toBeUndefined();
    // 'game' should still be in that group
    expect(findPanel(updated, 'game')).toBeDefined();
  });

  it('should remove empty tab groups and renormalize weights', () => {
    const updated = removePanel(simpleLayout, 'hierarchy');
    // The hierarchy group had only one panel, so it should be removed
    expect(findPanel(updated, 'hierarchy')).toBeUndefined();
    if (updated.type === 'split') {
      expect(updated.children).toHaveLength(2);
      const totalWeight = updated.children.reduce((s, c) => s + c.weight, 0);
      expect(totalWeight).toBeCloseTo(1.0);
    }
  });

  it('should not mutate the original tree', () => {
    removePanel(simpleLayout, 'inspector');
    expect(findPanel(simpleLayout, 'inspector')).toBeDefined();
  });
});

describe('setActiveTab', () => {
  it('should change the active tab index', () => {
    const updated = setActiveTab(simpleLayout, 'game');
    const found = findPanel(updated, 'game');
    expect(found?.node.activeIndex).toBe(1);
  });

  it('should return same tree if panel not found', () => {
    const updated = setActiveTab(simpleLayout, 'nonexistent');
    expect(updated).toBe(simpleLayout);
  });
});

describe('getAllPanelIds', () => {
  it('should collect all panel IDs from the tree', () => {
    const ids = getAllPanelIds(simpleLayout);
    expect(ids).toEqual(['hierarchy', 'scene', 'game', 'inspector']);
  });

  it('should return empty array for empty tab group', () => {
    const empty: LayoutNode = { type: 'tab-group', panels: [], activeIndex: 0 };
    expect(getAllPanelIds(empty)).toEqual([]);
  });
});
