/**
 * `editrix.json` runtime validation.
 *
 * Accepts parsed JSON (`unknown`) and either returns a typed
 * {@link ProjectConfig} or a list of human-readable errors. We don't
 * pull in a schema library — the config is small, the checks are
 * strictly structural, and errors read better when hand-written
 * (`"plugins.builtin must be a boolean"` rather than a JSON Pointer).
 */

import type { AssetConfig, LayoutPreset, PluginConfig, ProjectConfig } from './config.js';

export interface ValidationResult {
  readonly data?: ProjectConfig;
  readonly errors: readonly string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function validatePluginConfig(value: unknown, errors: string[]): PluginConfig | undefined {
  if (value === undefined) return { builtin: true };
  if (!isRecord(value)) {
    errors.push('plugins must be an object');
    return undefined;
  }
  const out: { builtin?: boolean; packages?: readonly string[]; local?: readonly string[] } = {};
  if ('builtin' in value) {
    if (typeof value['builtin'] !== 'boolean') {
      errors.push('plugins.builtin must be a boolean');
    } else {
      out.builtin = value['builtin'];
    }
  }
  if ('packages' in value) {
    if (!isStringArray(value['packages'])) {
      errors.push('plugins.packages must be an array of strings');
    } else {
      out.packages = value['packages'];
    }
  }
  if ('local' in value) {
    if (!isStringArray(value['local'])) {
      errors.push('plugins.local must be an array of strings');
    } else {
      out.local = value['local'];
    }
  }
  return out;
}

function validateAssetConfig(value: unknown, errors: string[]): AssetConfig | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    errors.push('assets must be an object');
    return undefined;
  }
  const out: { roots?: readonly string[]; ignore?: readonly string[] } = {};
  if ('roots' in value) {
    if (!isStringArray(value['roots'])) {
      errors.push('assets.roots must be an array of strings');
    } else {
      out.roots = value['roots'];
    }
  }
  if ('ignore' in value) {
    if (!isStringArray(value['ignore'])) {
      errors.push('assets.ignore must be an array of strings');
    } else {
      out.ignore = value['ignore'];
    }
  }
  return out;
}

function validateLayouts(
  value: unknown,
  errors: string[],
): Record<string, LayoutPreset> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    errors.push('layouts must be an object');
    return undefined;
  }
  const out: Record<string, LayoutPreset> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isRecord(entry)) {
      errors.push(`layouts.${key} must be an object`);
      continue;
    }
    const preset: { preset?: string; file?: string } = {};
    if ('preset' in entry) {
      if (typeof entry['preset'] !== 'string') {
        errors.push(`layouts.${key}.preset must be a string`);
      } else {
        preset.preset = entry['preset'];
      }
    }
    if ('file' in entry) {
      if (typeof entry['file'] !== 'string') {
        errors.push(`layouts.${key}.file must be a string`);
      } else {
        preset.file = entry['file'];
      }
    }
    out[key] = preset;
  }
  return out;
}

/**
 * Validate a parsed `editrix.json`. On success `result.data` holds the
 * typed config; on failure `result.errors` holds one string per problem.
 * The function never throws.
 */
export function validateProjectConfig(raw: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(raw)) {
    return { errors: ['editrix.json must be a JSON object'] };
  }

  const { name, version, editrix } = raw;
  if (typeof name !== 'string' || name.length === 0) errors.push('name must be a non-empty string');
  if (typeof version !== 'string') errors.push('version must be a string');
  if (typeof editrix !== 'string') errors.push('editrix must be a string');
  if ('template' in raw && raw['template'] !== undefined && typeof raw['template'] !== 'string') {
    errors.push('template must be a string when present');
  }
  if ('settings' in raw && raw['settings'] !== undefined && !isRecord(raw['settings'])) {
    errors.push('settings must be an object');
  }

  const plugins = validatePluginConfig(raw['plugins'], errors);
  if (plugins === undefined && !errors.some((e) => e.startsWith('plugins'))) {
    errors.push('plugins is required');
  }

  const assets = validateAssetConfig(raw['assets'], errors);
  const layouts = validateLayouts(raw['layouts'], errors);

  if (errors.length > 0) return { errors };

  const config: ProjectConfig = {
    name: name as string,
    version: version as string,
    editrix: editrix as string,
    ...(typeof raw['template'] === 'string' ? { template: raw['template'] } : {}),
    plugins: plugins ?? { builtin: true },
    ...(isRecord(raw['settings']) ? { settings: raw['settings'] } : {}),
    ...(layouts !== undefined ? { layouts } : {}),
    ...(assets !== undefined ? { assets } : {}),
  };
  return { data: config, errors: [] };
}
