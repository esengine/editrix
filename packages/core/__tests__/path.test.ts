import { describe, expect, it } from 'vitest';
import { PathService } from '../src/path.js';

const svc = new PathService();

describe('PathService.join', () => {
  it('joins forward-slash segments and collapses duplicates', () => {
    expect(svc.join('a', 'b', 'c')).toBe('a/b/c');
    expect(svc.join('a/', '/b/', '/c')).toBe('a/b/c');
  });

  it('converts backslashes to forward slashes', () => {
    expect(svc.join('a\\b', 'c\\d')).toBe('a/b/c/d');
  });

  it('preserves leading slash for absolute joins', () => {
    expect(svc.join('/a', 'b')).toBe('/a/b');
  });

  it('returns "." for empty or no-op input', () => {
    expect(svc.join()).toBe('.');
    expect(svc.join('', '')).toBe('.');
  });

  it('collapses "." and ".." segments', () => {
    expect(svc.join('a', '.', 'b')).toBe('a/b');
    expect(svc.join('a', '..', 'b')).toBe('b');
  });
});

describe('PathService.dirname', () => {
  it('returns everything before the last slash', () => {
    expect(svc.dirname('/a/b/c.txt')).toBe('/a/b');
    expect(svc.dirname('a/b/c')).toBe('a/b');
  });

  it('returns "." for a bare filename', () => {
    expect(svc.dirname('file.txt')).toBe('.');
  });

  it('returns "/" for a top-level file', () => {
    expect(svc.dirname('/file.txt')).toBe('/');
  });

  it('keeps a drive-letter root intact', () => {
    expect(svc.dirname('C:/file.txt')).toBe('C:/');
  });
});

describe('PathService.basename', () => {
  it('returns the last segment', () => {
    expect(svc.basename('/a/b/c.txt')).toBe('c.txt');
  });

  it('strips a matching extension when asked', () => {
    expect(svc.basename('/a/b/c.txt', '.txt')).toBe('c');
  });

  it('does not strip an extension that is the entire filename', () => {
    // Matching POSIX: basename('.bashrc', '.bashrc') === '.bashrc'.
    expect(svc.basename('.bashrc', '.bashrc')).toBe('.bashrc');
  });

  it('handles trailing slashes', () => {
    expect(svc.basename('/a/b/')).toBe('b');
  });
});

describe('PathService.extname', () => {
  it('returns the last `.` extension', () => {
    expect(svc.extname('foo.txt')).toBe('.txt');
    expect(svc.extname('foo.tar.gz')).toBe('.gz');
  });

  it('returns empty for files without extension', () => {
    expect(svc.extname('foo')).toBe('');
  });

  it('returns empty for dotfiles with no second dot', () => {
    expect(svc.extname('.bashrc')).toBe('');
  });
});

describe('PathService.normalize', () => {
  it('collapses redundant separators', () => {
    expect(svc.normalize('a//b///c')).toBe('a/b/c');
  });

  it('collapses "./" and "../" segments', () => {
    expect(svc.normalize('a/./b/../c')).toBe('a/c');
    expect(svc.normalize('./a/b')).toBe('a/b');
  });

  it('stops `..` at an absolute root', () => {
    expect(svc.normalize('/../../a')).toBe('/a');
  });

  it("keeps relative `..` when it can't resolve", () => {
    expect(svc.normalize('../../foo')).toBe('../../foo');
  });

  it('preserves drive-letter roots', () => {
    expect(svc.normalize('C:\\a\\..\\b')).toBe('C:/b');
  });
});

describe('PathService.relative', () => {
  it('returns an empty string when paths are equal', () => {
    expect(svc.relative('/a/b', '/a/b')).toBe('');
  });

  it('walks up then down to express the delta', () => {
    expect(svc.relative('/a/b/c', '/a/b/d/e')).toBe('../d/e');
    expect(svc.relative('/a/b', '/a')).toBe('..');
  });

  it('handles unrelated absolute roots gracefully', () => {
    // Both are normalized as rooted; walking up from /a/b to / and down to /x.
    expect(svc.relative('/a/b', '/x/y')).toBe('../../x/y');
  });
});

describe('PathService.isAbsolute', () => {
  it('recognizes POSIX-style roots', () => {
    expect(svc.isAbsolute('/a/b')).toBe(true);
  });

  it('recognizes drive-letter roots', () => {
    expect(svc.isAbsolute('C:/a')).toBe(true);
    expect(svc.isAbsolute('c:\\a')).toBe(true);
  });

  it('rejects relative paths', () => {
    expect(svc.isAbsolute('a/b')).toBe(false);
    expect(svc.isAbsolute('')).toBe(false);
  });
});
