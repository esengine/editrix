import { describe, expect, it, vi } from 'vitest';
import type { DocumentHandler } from '../src/document.js';
import { DocumentService } from '../src/document.js';

interface FakeFs {
  readonly readFile: (path: string) => Promise<string>;
  readonly writeFile: (path: string, content: string) => Promise<void>;
  readonly written: Map<string, string>;
}

function fakeFs(initial: Record<string, string> = {}): FakeFs {
  const store = new Map(Object.entries(initial));
  const written = new Map<string, string>();
  return {
    written,
    async readFile(path) {
      const v = store.get(path);
      if (v === undefined) throw new Error(`ENOENT: ${path}`);
      return v;
    },
    async writeFile(path, content) {
      store.set(path, content);
      written.set(path, content);
    },
  };
}

function sceneHandler(): DocumentHandler & {
  loaded: string[];
  serialized: string[];
} {
  const loaded: string[] = [];
  const serialized: string[] = [];
  return {
    extensions: ['.scene.json'],
    async load(path, content) {
      loaded.push(`${path}:${content}`);
    },
    async serialize(path) {
      serialized.push(path);
      return `serialized(${path})`;
    },
    loaded,
    serialized,
  };
}

describe('DocumentService', () => {
  describe('open', () => {
    it('should read the file, dispatch to a handler, and activate the document', async () => {
      const fs = fakeFs({ '/proj/main.scene.json': '{"v":1}' });
      const service = new DocumentService(fs.readFile, fs.writeFile);
      const handler = sceneHandler();
      service.registerHandler(handler);

      await service.open('/proj/main.scene.json');

      expect(handler.loaded).toEqual(['/proj/main.scene.json:{"v":1}']);
      expect(service.activeDocument).toBe('/proj/main.scene.json');
      expect(service.getOpenDocuments()).toHaveLength(1);
    });

    it('should normalize backslashes in the file path', async () => {
      const fs = fakeFs({ '/proj/main.scene.json': '{}' });
      const service = new DocumentService(fs.readFile, fs.writeFile);
      service.registerHandler(sceneHandler());

      await service.open('\\proj\\main.scene.json');

      expect(service.activeDocument).toBe('/proj/main.scene.json');
    });

    it('should re-activate an already-open document without re-reading', async () => {
      const fs = fakeFs({ '/proj/a.scene.json': '{}', '/proj/b.scene.json': '{}' });
      const readSpy = vi.fn(fs.readFile);
      const service = new DocumentService(readSpy, fs.writeFile);
      service.registerHandler(sceneHandler());

      await service.open('/proj/a.scene.json');
      await service.open('/proj/b.scene.json');
      readSpy.mockClear();

      await service.open('/proj/a.scene.json');

      expect(readSpy).not.toHaveBeenCalled();
      expect(service.activeDocument).toBe('/proj/a.scene.json');
    });

    it('should throw a path-tagged error when no handler matches', async () => {
      const fs = fakeFs({ '/proj/x.unknown': 'data' });
      const service = new DocumentService(fs.readFile, fs.writeFile);

      await expect(service.open('/proj/x.unknown')).rejects.toThrow(
        'No document handler registered for "/proj/x.unknown"',
      );
    });

    it('should wrap read failures with the file path', async () => {
      const fs = fakeFs(); // no files
      const service = new DocumentService(fs.readFile, fs.writeFile);
      service.registerHandler(sceneHandler());

      await expect(service.open('/proj/missing.scene.json')).rejects.toThrow(
        'Failed to read document "/proj/missing.scene.json"',
      );
    });

    it('should wrap handler.load failures with the file path', async () => {
      const fs = fakeFs({ '/proj/bad.scene.json': '{}' });
      const service = new DocumentService(fs.readFile, fs.writeFile);
      service.registerHandler({
        extensions: ['.scene.json'],
        async load() {
          throw new Error('schema mismatch');
        },
        async serialize() {
          return '';
        },
      });

      await expect(service.open('/proj/bad.scene.json')).rejects.toThrow(
        'Failed to load document "/proj/bad.scene.json"',
      );
      expect(service.getOpenDocuments()).toHaveLength(0);
    });

    it('should fire onDidChangeDocuments and onDidChangeActive on open', async () => {
      const fs = fakeFs({ '/proj/a.scene.json': '{}' });
      const service = new DocumentService(fs.readFile, fs.writeFile);
      service.registerHandler(sceneHandler());

      const docs = vi.fn();
      const active = vi.fn();
      service.onDidChangeDocuments(docs);
      service.onDidChangeActive(active);

      await service.open('/proj/a.scene.json');

      expect(docs).toHaveBeenCalledOnce();
      expect(active).toHaveBeenCalledWith('/proj/a.scene.json');
    });
  });

  describe('save', () => {
    it('should serialize via handler and write to disk, clearing dirty', async () => {
      const fs = fakeFs({ '/proj/a.scene.json': '{}' });
      const service = new DocumentService(fs.readFile, fs.writeFile);
      service.registerHandler(sceneHandler());

      await service.open('/proj/a.scene.json');
      service.setDirty('/proj/a.scene.json', true);

      await service.save('/proj/a.scene.json');

      expect(fs.written.get('/proj/a.scene.json')).toBe('serialized(/proj/a.scene.json)');
      expect(service.getOpenDocuments()[0]?.dirty).toBe(false);
    });

    it('should silently no-op when document is not open', async () => {
      const fs = fakeFs();
      const service = new DocumentService(fs.readFile, fs.writeFile);
      service.registerHandler(sceneHandler());

      // Locks in current behavior — caller must check open state if it cares.
      await expect(service.save('/proj/never-opened.scene.json')).resolves.toBeUndefined();
      expect(fs.written.size).toBe(0);
    });

    it('should wrap serialize failures with the file path', async () => {
      const fs = fakeFs({ '/proj/a.scene.json': '{}' });
      const service = new DocumentService(fs.readFile, fs.writeFile);
      service.registerHandler({
        extensions: ['.scene.json'],
        async load() {},
        async serialize() {
          throw new Error('serializer crashed');
        },
      });
      await service.open('/proj/a.scene.json');

      await expect(service.save('/proj/a.scene.json')).rejects.toThrow(
        'Failed to serialize document "/proj/a.scene.json"',
      );
    });

    it('should wrap write failures with the file path and leave dirty flag intact', async () => {
      const fs = fakeFs({ '/proj/a.scene.json': '{}' });
      const failingWrite = vi.fn(async () => {
        throw new Error('disk full');
      });
      const service = new DocumentService(fs.readFile, failingWrite);
      service.registerHandler(sceneHandler());
      await service.open('/proj/a.scene.json');
      service.setDirty('/proj/a.scene.json', true);

      await expect(service.save('/proj/a.scene.json')).rejects.toThrow(
        'Failed to write document "/proj/a.scene.json"',
      );
      // Dirty must stay true so the user knows the change still hasn't hit disk.
      expect(service.getOpenDocuments()[0]?.dirty).toBe(true);
    });
  });

  describe('saveAs', () => {
    it('should serialize via source handler, write to destination, rekey the document', async () => {
      const fs = fakeFs({ '/proj/a.scene.json': '{}' });
      const service = new DocumentService(fs.readFile, fs.writeFile);
      service.registerHandler(sceneHandler());

      await service.open('/proj/a.scene.json');
      service.setDirty('/proj/a.scene.json', true);

      await service.saveAs('/proj/a.scene.json', '/proj/b.scene.json');

      expect(fs.written.get('/proj/b.scene.json')).toBe('serialized(/proj/a.scene.json)');
      expect(service.activeDocument).toBe('/proj/b.scene.json');
      expect(service.getOpenDocuments()).toHaveLength(1);
      expect(service.getOpenDocuments()[0]?.dirty).toBe(false);
    });

    it('should transfer active state when the source was active', async () => {
      const fs = fakeFs({ '/proj/a.scene.json': '{}', '/proj/other.scene.json': '{}' });
      const service = new DocumentService(fs.readFile, fs.writeFile);
      service.registerHandler(sceneHandler());
      await service.open('/proj/other.scene.json');
      await service.open('/proj/a.scene.json'); // now active

      const active = vi.fn();
      service.onDidChangeActive(active);

      await service.saveAs('/proj/a.scene.json', '/proj/renamed.scene.json');

      expect(service.activeDocument).toBe('/proj/renamed.scene.json');
      expect(active).toHaveBeenCalledWith('/proj/renamed.scene.json');
    });

    it('should treat same-path saveAs as a regular save (no rekey, clears dirty)', async () => {
      const fs = fakeFs({ '/proj/a.scene.json': '{}' });
      const service = new DocumentService(fs.readFile, fs.writeFile);
      service.registerHandler(sceneHandler());
      await service.open('/proj/a.scene.json');
      service.setDirty('/proj/a.scene.json', true);

      await service.saveAs('/proj/a.scene.json', '/proj/a.scene.json');

      expect(fs.written.get('/proj/a.scene.json')).toBe('serialized(/proj/a.scene.json)');
      expect(service.getOpenDocuments()[0]?.dirty).toBe(false);
      expect(service.getOpenDocuments()).toHaveLength(1);
    });

    it('should throw when the source document is not open', async () => {
      const fs = fakeFs();
      const service = new DocumentService(fs.readFile, fs.writeFile);
      service.registerHandler(sceneHandler());

      await expect(service.saveAs('/proj/ghost.scene.json', '/proj/b.scene.json')).rejects.toThrow(
        '"/proj/ghost.scene.json" is not open',
      );
    });

    it('should throw when the destination collides with another open document', async () => {
      const fs = fakeFs({ '/proj/a.scene.json': '{}', '/proj/b.scene.json': '{}' });
      const service = new DocumentService(fs.readFile, fs.writeFile);
      service.registerHandler(sceneHandler());
      await service.open('/proj/a.scene.json');
      await service.open('/proj/b.scene.json');

      await expect(service.saveAs('/proj/a.scene.json', '/proj/b.scene.json')).rejects.toThrow(
        'already open at that path',
      );
    });

    it('should throw when no handler matches the destination extension', async () => {
      const fs = fakeFs({ '/proj/a.scene.json': '{}' });
      const service = new DocumentService(fs.readFile, fs.writeFile);
      service.registerHandler(sceneHandler());
      await service.open('/proj/a.scene.json');

      await expect(service.saveAs('/proj/a.scene.json', '/proj/a.unknown')).rejects.toThrow(
        'No document handler registered for "/proj/a.unknown"',
      );
    });
  });

  describe('revert', () => {
    it('should re-read from disk, re-load through the handler, and clear dirty', async () => {
      const fs = fakeFs({ '/proj/a.scene.json': '{"v":1}' });
      const service = new DocumentService(fs.readFile, fs.writeFile);
      const handler = sceneHandler();
      service.registerHandler(handler);

      await service.open('/proj/a.scene.json');
      service.setDirty('/proj/a.scene.json', true);
      handler.loaded.length = 0;

      // Simulate external change on disk before revert.
      await fs.writeFile('/proj/a.scene.json', '{"v":2}');
      await service.revert('/proj/a.scene.json');

      expect(handler.loaded).toEqual(['/proj/a.scene.json:{"v":2}']);
      expect(service.getOpenDocuments()[0]?.dirty).toBe(false);
    });

    it('should throw when the document is not open', async () => {
      const fs = fakeFs();
      const service = new DocumentService(fs.readFile, fs.writeFile);
      service.registerHandler(sceneHandler());

      await expect(service.revert('/proj/ghost.scene.json')).rejects.toThrow(
        '"/proj/ghost.scene.json" is not open',
      );
    });

    it('should wrap read failures and leave the document untouched', async () => {
      const calls = { read: 0 };
      const readFile = async (path: string): Promise<string> => {
        calls.read++;
        if (calls.read === 1) return '{"v":1}'; // open succeeds
        throw new Error('disk error'); // revert fails
      };
      const writeFile = async (): Promise<void> => {};
      const service = new DocumentService(readFile, writeFile);
      service.registerHandler(sceneHandler());
      await service.open('/proj/a.scene.json');
      service.setDirty('/proj/a.scene.json', true);

      await expect(service.revert('/proj/a.scene.json')).rejects.toThrow(
        'Failed to read document "/proj/a.scene.json"',
      );
      expect(service.getOpenDocuments()[0]?.dirty).toBe(true); // dirty preserved
    });
  });

  describe('close', () => {
    it('should remove the document and pick a new active one', async () => {
      const fs = fakeFs({ '/proj/a.scene.json': '{}', '/proj/b.scene.json': '{}' });
      const service = new DocumentService(fs.readFile, fs.writeFile);
      service.registerHandler(sceneHandler());

      await service.open('/proj/a.scene.json');
      await service.open('/proj/b.scene.json');

      service.close('/proj/b.scene.json');

      expect(service.activeDocument).toBe('/proj/a.scene.json');
      expect(service.getOpenDocuments()).toHaveLength(1);
    });

    it('should set active to null when the last document closes', async () => {
      const fs = fakeFs({ '/proj/a.scene.json': '{}' });
      const service = new DocumentService(fs.readFile, fs.writeFile);
      service.registerHandler(sceneHandler());
      await service.open('/proj/a.scene.json');

      service.close('/proj/a.scene.json');

      expect(service.activeDocument).toBeNull();
    });

    it('should be a no-op when the document is not open', () => {
      const fs = fakeFs();
      const service = new DocumentService(fs.readFile, fs.writeFile);
      const docs = vi.fn();
      service.onDidChangeDocuments(docs);

      service.close('/never');

      expect(docs).not.toHaveBeenCalled();
    });
  });

  describe('setDirty', () => {
    it('should fire onDidChangeDirty only on actual transitions', async () => {
      const fs = fakeFs({ '/proj/a.scene.json': '{}' });
      const service = new DocumentService(fs.readFile, fs.writeFile);
      service.registerHandler(sceneHandler());
      await service.open('/proj/a.scene.json');

      const handler = vi.fn();
      service.onDidChangeDirty(handler);

      service.setDirty('/proj/a.scene.json', false); // already false
      service.setDirty('/proj/a.scene.json', true);
      service.setDirty('/proj/a.scene.json', true); // no change
      service.setDirty('/proj/a.scene.json', false);

      expect(handler).toHaveBeenCalledTimes(2);
    });
  });

  describe('handler unregister', () => {
    it('should drop the handler when the disposable is disposed', async () => {
      const fs = fakeFs({ '/proj/a.scene.json': '{}' });
      const service = new DocumentService(fs.readFile, fs.writeFile);
      const reg = service.registerHandler(sceneHandler());

      reg.dispose();

      await expect(service.open('/proj/a.scene.json')).rejects.toThrow('No document handler');
    });
  });
});
