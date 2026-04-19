let isMacCache: boolean | undefined;

export function isMac(): boolean {
  if (isMacCache !== undefined) return isMacCache;
  const g = globalThis as { navigator?: { userAgent?: string; platform?: string }; process?: { platform?: string } };
  if (g.navigator) {
    const ua = g.navigator.userAgent ?? '';
    const plat = g.navigator.platform ?? '';
    isMacCache = /Mac|iPod|iPhone|iPad/.test(plat) || ua.includes('Macintosh');
    return isMacCache;
  }
  isMacCache = g.process?.platform === 'darwin';
  return isMacCache;
}
