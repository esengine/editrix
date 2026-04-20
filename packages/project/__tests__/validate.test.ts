import { describe, expect, it } from 'vitest';
import { validateProjectConfig } from '../src/validate.js';

describe('validateProjectConfig', () => {
  it('accepts a minimal valid config', () => {
    const { data, errors } = validateProjectConfig({
      name: 'Demo',
      version: '0.1.0',
      editrix: '0.1.0',
      plugins: { builtin: true },
    });
    expect(errors).toEqual([]);
    expect(data?.name).toBe('Demo');
    expect(data?.plugins.builtin).toBe(true);
  });

  it('rejects non-object input', () => {
    const { errors } = validateProjectConfig('not-json');
    expect(errors).toContain('editrix.json must be a JSON object');
  });

  it('collects all structural errors, not just the first', () => {
    const { errors, data } = validateProjectConfig({
      name: 123,
      version: true,
      editrix: null,
      plugins: 'nope',
    });
    expect(data).toBeUndefined();
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });

  it('rejects plugins.packages that contain non-string entries', () => {
    const { errors } = validateProjectConfig({
      name: 'X',
      version: '0.1.0',
      editrix: '0.1.0',
      plugins: { packages: ['ok', 5] },
    });
    expect(errors).toContain('plugins.packages must be an array of strings');
  });

  it('accepts optional assets + layouts when well-formed', () => {
    const { data, errors } = validateProjectConfig({
      name: 'X',
      version: '0.1.0',
      editrix: '0.1.0',
      plugins: { builtin: true },
      assets: { roots: ['assets'], ignore: ['*.tmp'] },
      layouts: { default: { preset: 'compact' } },
    });
    expect(errors).toEqual([]);
    expect(data?.assets?.roots).toEqual(['assets']);
    expect(data?.layouts?.['default']?.preset).toBe('compact');
  });
});
