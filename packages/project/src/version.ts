/**
 * Semver comparison + project-vs-runtime drift classification.
 *
 * Runs in browser, node, and Electron contexts — no I/O, no external
 * deps. The launcher (node) uses it to badge project entries, the
 * editor (renderer) uses it to warn on open.
 */

export type ProjectVersionStatus = 'ok' | 'project-older' | 'project-newer' | 'unknown';

export interface ProjectVersionInfo {
  /** The `editrix` field from the project's manifest, or `null` if unreadable. */
  readonly projectVersion: string | null;
  /** Classification against the runtime version. */
  readonly status: ProjectVersionStatus;
}

function parseSemver(v: string): [number, number, number] {
  const parts = v.split('.').map((s) => {
    const n = Number.parseInt(s, 10);
    return Number.isFinite(n) ? n : 0;
  });
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/**
 * `-1 | 0 | 1` — same return-shape as {@link Array.sort}'s comparator.
 * Trailing missing components are treated as zero so `1.0` matches `1.0.0`.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const [am, an, ap] = parseSemver(a);
  const [bm, bn, bp] = parseSemver(b);
  if (am !== bm) return am < bm ? -1 : 1;
  if (an !== bn) return an < bn ? -1 : 1;
  if (ap !== bp) return ap < bp ? -1 : 1;
  return 0;
}

/**
 * Classify a project's `editrix` version against the running editor's
 * version. `unknown` is returned when either side is missing or doesn't
 * parse — callers get a tri-state outcome suitable for badge rendering
 * without separate try/catch handling.
 */
export function classifyProjectVersion(
  projectVersion: string | null | undefined,
  runtimeVersion: string,
): ProjectVersionInfo {
  if (typeof projectVersion !== 'string' || projectVersion.length === 0) {
    return { projectVersion: null, status: 'unknown' };
  }
  const cmp = compareVersions(projectVersion, runtimeVersion);
  if (cmp === 0) return { projectVersion, status: 'ok' };
  return { projectVersion, status: cmp < 0 ? 'project-older' : 'project-newer' };
}
