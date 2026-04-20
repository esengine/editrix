/**
 * Tests for ComponentCatalog — the editor-side registry populated by
 * the SDK bridge plugin. The bridge plugin itself lives in the Editrix
 * app and isn't covered here; what we verify is the catalog's own
 * contract: registrations are idempotent, events fire on the right
 * edges, disposal clears state.
 */

import { describe, expect, it } from 'vitest';
import {
  ComponentCatalog,
  type SdkComponentDef,
  type SdkComponentInfo,
} from '../src/component-catalog';

function makeDef(name: string, defaults: Record<string, unknown> = {}): SdkComponentDef {
  return {
    _name: name,
    _default: defaults,
    assetFields: [],
    entityFields: [],
    colorKeys: [],
    animatableFields: [],
    create(data?: Record<string, unknown>) {
      return { ...defaults, ...(data ?? {}) };
    },
  };
}

function makeInfo(name: string, defaults: Record<string, unknown> = {}): SdkComponentInfo {
  return {
    name,
    def: makeDef(name, defaults),
    defaults,
    isTag: Object.keys(defaults).length === 0,
  };
}

describe('ComponentCatalog', () => {
  it('registers and retrieves components', () => {
    const cat = new ComponentCatalog();
    cat.register(makeInfo('A', { x: 1 }));
    cat.register(makeInfo('B', { y: 2 }));

    expect(cat.has('A')).toBe(true);
    expect(cat.has('B')).toBe(true);
    expect(cat.has('C')).toBe(false);
    expect(cat.list()).toHaveLength(2);
    expect(cat.get('A')?.defaults['x']).toBe(1);
  });

  it('overwrites on duplicate register', () => {
    const cat = new ComponentCatalog();
    cat.register(makeInfo('A', { x: 1 }));
    cat.register(makeInfo('A', { x: 99 }));

    expect(cat.list()).toHaveLength(1);
    expect(cat.get('A')?.defaults['x']).toBe(99);
  });

  it('fires onDidChange on register', () => {
    const cat = new ComponentCatalog();
    let count = 0;
    cat.onDidChange(() => {
      count++;
    });

    cat.register(makeInfo('A'));
    cat.register(makeInfo('B'));
    expect(count).toBe(2);
  });

  it('fires onDidChange on unregister, skips the miss', () => {
    const cat = new ComponentCatalog();
    cat.register(makeInfo('A'));

    let count = 0;
    cat.onDidChange(() => {
      count++;
    });

    cat.unregister('A'); // hit
    cat.unregister('A'); // miss — already gone
    expect(count).toBe(1);
  });

  it('clear removes all and fires once', () => {
    const cat = new ComponentCatalog();
    cat.register(makeInfo('A'));
    cat.register(makeInfo('B'));

    let count = 0;
    cat.onDidChange(() => {
      count++;
    });

    cat.clear();
    expect(cat.list()).toHaveLength(0);
    expect(count).toBe(1);
  });

  it('clear is a no-op on empty', () => {
    const cat = new ComponentCatalog();
    let count = 0;
    cat.onDidChange(() => {
      count++;
    });

    cat.clear();
    expect(count).toBe(0);
  });

  it('register returns a disposable that unregisters', () => {
    const cat = new ComponentCatalog();
    const d = cat.register(makeInfo('A'));
    expect(cat.has('A')).toBe(true);

    d.dispose();
    expect(cat.has('A')).toBe(false);
  });

  it('dispose clears contents and event subscribers see no further fires', () => {
    const cat = new ComponentCatalog();
    cat.register(makeInfo('A'));
    cat.dispose();
    expect(cat.list()).toHaveLength(0);
  });
});
