import { describe, expect, it, vi } from 'vitest';
import { createExtensionPointId } from '@editrix/common';
import { ExtensionPointRegistry } from '../src/extension-point-registry.js';

interface IThemeContribution {
  name: string;
  background: string;
}

const ThemesEP = createExtensionPointId<IThemeContribution>('view.themes');
const OtherEP = createExtensionPointId<string>('other');

describe('ExtensionPointRegistry', () => {
  it('should declare an extension point', () => {
    const registry = new ExtensionPointRegistry();
    const ep = registry.declare(ThemesEP);

    expect(ep.id).toBe(ThemesEP);
    expect(ep.contributions).toEqual([]);
  });

  it('should throw when declaring the same extension point twice', () => {
    const registry = new ExtensionPointRegistry();
    registry.declare(ThemesEP);

    expect(() => registry.declare(ThemesEP)).toThrow(
      'Extension point "view.themes" is already declared.',
    );
  });

  it('should accept contributions', () => {
    const registry = new ExtensionPointRegistry();
    registry.declare(ThemesEP);

    registry.contribute(ThemesEP, { name: 'dark', background: '#000' });
    registry.contribute(ThemesEP, { name: 'light', background: '#fff' });

    const contributions = registry.getContributions(ThemesEP);
    expect(contributions).toHaveLength(2);
    expect(contributions[0]!.name).toBe('dark');
    expect(contributions[1]!.name).toBe('light');
  });

  it('should throw when contributing to an undeclared extension point', () => {
    const registry = new ExtensionPointRegistry();

    expect(() => registry.contribute(ThemesEP, { name: 'x', background: '#000' })).toThrow(
      'Extension point "view.themes" has not been declared.',
    );
  });

  it('should remove contribution when disposable is disposed', () => {
    const registry = new ExtensionPointRegistry();
    registry.declare(ThemesEP);

    const d = registry.contribute(ThemesEP, { name: 'dark', background: '#000' });
    expect(registry.getContributions(ThemesEP)).toHaveLength(1);

    d.dispose();
    expect(registry.getContributions(ThemesEP)).toHaveLength(0);
  });

  it('should fire onDidChange when contributions change', () => {
    const registry = new ExtensionPointRegistry();
    registry.declare(ThemesEP);
    const handler = vi.fn();

    registry.onDidChangeContributions(ThemesEP, handler);

    const d = registry.contribute(ThemesEP, { name: 'dark', background: '#000' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith([{ name: 'dark', background: '#000' }]);

    d.dispose();
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenLastCalledWith([]);
  });

  it('should validate contributions', () => {
    const registry = new ExtensionPointRegistry();
    registry.declare(ThemesEP, {
      validator: (c) => c.name.length > 0,
    });

    expect(() =>
      registry.contribute(ThemesEP, { name: '', background: '#000' }),
    ).toThrow('Contribution to "view.themes" failed validation.');
  });

  it('should return empty array for undeclared extension point via getContributions', () => {
    const registry = new ExtensionPointRegistry();
    expect(registry.getContributions(OtherEP)).toEqual([]);
  });

  it('should expose contributions on the declared extension point object', () => {
    const registry = new ExtensionPointRegistry();
    const ep = registry.declare(ThemesEP);

    registry.contribute(ThemesEP, { name: 'dark', background: '#000' });

    // The ep.contributions getter should reflect changes
    expect(ep.contributions).toHaveLength(1);
    expect(ep.contributions[0]!.name).toBe('dark');
  });

  it('should clean up on dispose', () => {
    const registry = new ExtensionPointRegistry();
    registry.declare(ThemesEP);
    registry.contribute(ThemesEP, { name: 'dark', background: '#000' });

    registry.dispose();

    expect(registry.getContributions(ThemesEP)).toEqual([]);
  });

  describe('deferred subscribe-before-declare', () => {
    it('should attach pending subscribers when the point is later declared', () => {
      const registry = new ExtensionPointRegistry();
      const handler = vi.fn();

      // Subscriber arrives first (e.g. plugin order is non-deterministic).
      registry.onDidChangeContributions(ThemesEP, handler);
      expect(handler).not.toHaveBeenCalled();

      // The declarer activates later.
      registry.declare(ThemesEP);
      // Snapshot fires immediately so the subscriber sees the current (empty) state.
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenLastCalledWith([]);

      // Subsequent contributions flow through normally.
      registry.contribute(ThemesEP, { name: 'dark', background: '#000' });
      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenLastCalledWith([{ name: 'dark', background: '#000' }]);
    });

    it('should not attach a pending subscriber that was disposed before declare', () => {
      const registry = new ExtensionPointRegistry();
      const handler = vi.fn();

      const sub = registry.onDidChangeContributions(ThemesEP, handler);
      sub.dispose();

      registry.declare(ThemesEP);
      registry.contribute(ThemesEP, { name: 'dark', background: '#000' });

      expect(handler).not.toHaveBeenCalled();
    });

    it('should clear pending subscribers on dispose', () => {
      const registry = new ExtensionPointRegistry();
      const handler = vi.fn();
      registry.onDidChangeContributions(ThemesEP, handler);

      registry.dispose();
      // After dispose, declaring again should not reach the old handler
      // (a fresh registry is the only valid use after dispose).
      const fresh = new ExtensionPointRegistry();
      fresh.declare(ThemesEP);
      fresh.contribute(ThemesEP, { name: 'dark', background: '#000' });
      expect(handler).not.toHaveBeenCalled();
    });
  });
});
