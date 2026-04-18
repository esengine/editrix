let _isMacCache: boolean | undefined;

export function isMac(): boolean {
  if (_isMacCache !== undefined) return _isMacCache;
  const g = globalThis as { navigator?: { userAgent?: string; platform?: string }; process?: { platform?: string } };
  if (g.navigator) {
    const ua = g.navigator.userAgent ?? '';
    const plat = g.navigator.platform ?? '';
    _isMacCache = /Mac|iPod|iPhone|iPad/.test(plat) || /Macintosh/.test(ua);
    return _isMacCache;
  }
  _isMacCache = g.process?.platform === 'darwin';
  return _isMacCache;
}
