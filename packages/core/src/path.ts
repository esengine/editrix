import type { IDisposable } from '@editrix/common';
import { createServiceId } from '@editrix/common';

/**
 * Cross-platform path utilities for the framework.
 *
 * Paths are forward-slash normalized — Windows-style backslashes and
 * repeated slashes collapse to single `/`. No trailing slash is kept
 * except on the root. `drive:` prefixes (e.g. `C:/`) count as absolute
 * on any platform so the framework can reason about them uniformly.
 *
 * Stays deliberately thin: no `node:path` dependency (renderer is
 * browser-only), no URL handling, no globbing. Enough for the
 * join/dirname/relative pattern that shows up across apps and plugins.
 */
export interface IPathService extends IDisposable {
  /** Join segments with `/`, collapsing duplicates and `.` entries. */
  join(...parts: string[]): string;

  /** Directory portion of a path — everything before the last `/`. */
  dirname(path: string): string;

  /** Last path segment. Empty string for the root. */
  basename(path: string, ext?: string): string;

  /** Extension of the last segment, including the leading `.`, or empty. */
  extname(path: string): string;

  /**
   * Collapse `.` and `..` segments and normalize separators. Does not
   * resolve symlinks or check existence.
   */
  normalize(path: string): string;

  /**
   * Path `to` expressed relative to `from`. Both inputs are normalized
   * first. Returns a `../`-prefixed path when the target is outside.
   */
  relative(from: string, to: string): string;

  /** True when `path` is absolute (leading `/` or `drive:` prefix). */
  isAbsolute(path: string): boolean;
}

export const IPathService = createServiceId<IPathService>('IPathService');

/**
 * Default {@link IPathService} implementation. Stateless; dispose is a
 * no-op but kept to satisfy the IDisposable contract so callers can
 * treat it uniformly with other services.
 */
export class PathService implements IPathService {
  join(...parts: string[]): string {
    if (parts.length === 0) return '.';
    const nonEmpty = parts.filter((p) => p.length > 0);
    if (nonEmpty.length === 0) return '.';
    const joined = nonEmpty.map((p) => toForward(p)).join('/');
    return this.normalize(joined);
  }

  dirname(path: string): string {
    const norm = this.normalize(path);
    if (norm === '/' || norm === '.') return norm;
    const stripped = stripTrailingSlash(norm);
    const idx = stripped.lastIndexOf('/');
    if (idx === -1) return '.';
    if (idx === 0) return '/';
    // Preserve `C:/` as its own root when a drive-letter path bottoms out.
    if (idx === 2 && /^[A-Za-z]:$/.test(stripped.slice(0, 2))) return stripped.slice(0, 3);
    return stripped.slice(0, idx);
  }

  basename(path: string, ext?: string): string {
    const norm = this.normalize(path);
    const stripped = stripTrailingSlash(norm);
    const idx = stripped.lastIndexOf('/');
    let base = idx === -1 ? stripped : stripped.slice(idx + 1);
    if (ext !== undefined && base.endsWith(ext) && base !== ext) {
      base = base.slice(0, base.length - ext.length);
    }
    return base;
  }

  extname(path: string): string {
    const base = this.basename(path);
    const idx = base.lastIndexOf('.');
    // A leading `.` (dotfile) has no extension.
    if (idx <= 0) return '';
    return base.slice(idx);
  }

  normalize(path: string): string {
    const forward = toForward(path);
    if (forward.length === 0) return '.';

    const isAbs = this._isAbsoluteForward(forward);
    const drive = driveLetterPrefix(forward);

    const rest = drive ? forward.slice(drive.length) : forward;
    const startsWithSlash = rest.startsWith('/');

    const segments: string[] = [];
    for (const seg of rest.split('/')) {
      if (seg === '' || seg === '.') continue;
      if (seg === '..') {
        if (segments.length > 0 && segments[segments.length - 1] !== '..') {
          segments.pop();
        } else if (!isAbs) {
          segments.push('..');
        }
        // When absolute, `..` at the root silently stays at root.
        continue;
      }
      segments.push(seg);
    }

    let out = segments.join('/');
    if (startsWithSlash) out = '/' + out;
    if (drive) out = drive + out;
    if (out === '') return isAbs ? '/' : '.';
    return out;
  }

  relative(from: string, to: string): string {
    const fromN = this.normalize(from);
    const toN = this.normalize(to);
    if (fromN === toN) return '';

    const fromSegs = splitSegments(fromN);
    const toSegs = splitSegments(toN);

    let i = 0;
    const minLen = Math.min(fromSegs.length, toSegs.length);
    while (i < minLen && fromSegs[i] === toSegs[i]) i++;

    const up = fromSegs.length - i;
    const down = toSegs.slice(i);
    const parts: string[] = [];
    for (let j = 0; j < up; j++) parts.push('..');
    parts.push(...down);
    return parts.join('/') || '.';
  }

  isAbsolute(path: string): boolean {
    return this._isAbsoluteForward(toForward(path));
  }

  dispose(): void {
    /* stateless */
  }

  private _isAbsoluteForward(path: string): boolean {
    if (path.startsWith('/')) return true;
    return /^[A-Za-z]:\//.test(path);
  }
}

function toForward(path: string): string {
  return path.replace(/\\/g, '/');
}

function stripTrailingSlash(path: string): string {
  if (path.length <= 1) return path;
  return path.endsWith('/') ? path.slice(0, -1) : path;
}

function driveLetterPrefix(path: string): string {
  const match = /^([A-Za-z]):/.exec(path);
  return match ? match[0] : '';
}

function splitSegments(path: string): string[] {
  // Keep the drive/root so `relative('/a', '/b')` ignores shared root.
  return path.split('/').filter((s) => s !== '');
}
