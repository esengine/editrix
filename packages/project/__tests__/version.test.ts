import { describe, expect, it } from 'vitest';
import { classifyProjectVersion, compareVersions } from '../src/version.js';

describe('compareVersions', () => {
  it('returns 0 for equal versions', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('returns -1 when the left side is older', () => {
    expect(compareVersions('1.2.3', '1.2.4')).toBe(-1);
    expect(compareVersions('1.2.0', '1.3.0')).toBe(-1);
    expect(compareVersions('0.9.9', '1.0.0')).toBe(-1);
  });

  it('returns 1 when the left side is newer', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
  });

  it('treats missing components as zero', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1', '1.0.1')).toBe(-1);
  });
});

describe('classifyProjectVersion', () => {
  it('returns unknown when the project version is missing', () => {
    expect(classifyProjectVersion(null, '0.1.0').status).toBe('unknown');
    expect(classifyProjectVersion('', '0.1.0').status).toBe('unknown');
    expect(classifyProjectVersion(undefined, '0.1.0').status).toBe('unknown');
  });

  it('classifies drift directions', () => {
    expect(classifyProjectVersion('0.1.0', '0.1.0').status).toBe('ok');
    expect(classifyProjectVersion('0.1.0', '0.2.0').status).toBe('project-older');
    expect(classifyProjectVersion('0.3.0', '0.2.0').status).toBe('project-newer');
  });
});
