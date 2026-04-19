/**
 * Sprite animation authoring plugin.
 *
 * Owns the in-memory state for every `.esanim` tab that's currently open,
 * the `.esanim` document handler (load / serialize), the film-strip tab
 * and Content Browser icon, and the "New Animation Clip" menu entry.
 *
 * The actual editor UI is {@link AnimationEditorWidget}, mounted inside
 * the viewport as an overlay whenever the active document is `.esanim`
 * (wired by {@link ViewportPlugin}).
 */

import { Emitter } from '@editrix/common';
import { IFileSystemService } from '@editrix/core';
import type { IPlugin, IPluginContext } from '@editrix/shell';
import { ICommandRegistry, IDocumentService } from '@editrix/shell';
import { registerIcon } from '@editrix/view-dom';
import { showInputDialog } from '../dialogs.js';
import {
  IAnimationService,
  IProjectService,
  type AnimClipData,
  type AnimFrameData,
} from '../services.js';

const ANIM_CLIP_VERSION = '1.0';
const ANIM_CLIP_EXT = '.esanim';
const DEFAULT_FPS = 12;

// Film-strip icon — four perforation slots on a rectangle outline. Plain
// currentColor so it tints with the row's text color (tab, hierarchy, etc.).
registerIcon(
  'anim-clip',
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'
  + '<rect x="3" y="4" width="18" height="16" rx="2"/>'
  + '<path d="M3 9h18M3 15h18M8 4v16M16 4v16"/>'
  + '</svg>',
);

function emptyClip(): AnimClipData {
  return { version: ANIM_CLIP_VERSION, type: 'animation-clip', fps: DEFAULT_FPS, loop: true, frames: [] };
}

function parseClip(raw: string, filePath: string): AnimClipData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`"${filePath}" is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`"${filePath}" is not an animation-clip document.`);
  }
  const obj = parsed as Record<string, unknown>;
  if (obj['type'] !== 'animation-clip') {
    throw new Error(`"${filePath}" is missing type:"animation-clip".`);
  }
  const frames: AnimFrameData[] = [];
  const rawFrames = Array.isArray(obj['frames']) ? obj['frames'] : [];
  for (const f of rawFrames) {
    if (typeof f !== 'object' || f === null) continue;
    const frame = f as Record<string, unknown>;
    if (typeof frame['texture'] !== 'string') continue;
    const duration = typeof frame['duration'] === 'number' ? frame['duration'] : undefined;
    frames.push(duration !== undefined ? { texture: frame['texture'], duration } : { texture: frame['texture'] });
  }
  return {
    version: typeof obj['version'] === 'string' ? obj['version'] : ANIM_CLIP_VERSION,
    type: 'animation-clip',
    fps: typeof obj['fps'] === 'number' && obj['fps'] > 0 ? obj['fps'] : DEFAULT_FPS,
    loop: typeof obj['loop'] === 'boolean' ? obj['loop'] : true,
    frames,
  };
}

function serializeClip(data: AnimClipData): string {
  const body = {
    version: data.version,
    type: data.type,
    fps: data.fps,
    loop: data.loop,
    frames: data.frames.map((f) => (f.duration !== undefined ? { texture: f.texture, duration: f.duration } : { texture: f.texture })),
  };
  return `${JSON.stringify(body, null, 2)}\n`;
}

async function uniqueClipPath(fs: IFileSystemService, dir: string, baseName: string): Promise<string> {
  const primary = `${dir}/${baseName}${ANIM_CLIP_EXT}`;
  if (!(await fs.exists(primary))) return primary;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${dir}/${baseName}_${String(i)}${ANIM_CLIP_EXT}`;
    if (!(await fs.exists(candidate))) return candidate;
  }
  throw new Error(`Could not allocate a unique filename for "${baseName}" in ${dir}.`);
}

function uuidv4(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const AnimationPlugin: IPlugin = {
  descriptor: {
    id: 'app.animation',
    version: '1.0.0',
    dependencies: ['app.filesystem', 'app.project', 'app.document-sync'],
  },
  activate(ctx: IPluginContext) {
    const fileSystem = ctx.services.get(IFileSystemService);
    const project = ctx.services.get(IProjectService);
    const documentService = ctx.services.get(IDocumentService);
    const commands = ctx.services.get(ICommandRegistry);

    const clips = new Map<string, AnimClipData>();
    const onDidChangeClip = new Emitter<{ filePath: string; data: AnimClipData }>();
    ctx.subscriptions.add(onDidChangeClip);

    const getClip = (filePath: string): AnimClipData | undefined => clips.get(filePath);

    const updateClip = (filePath: string, next: AnimClipData): void => {
      if (!clips.has(filePath)) {
        throw new Error(`Cannot update clip — "${filePath}" is not an open document.`);
      }
      clips.set(filePath, next);
      documentService.setDirty(filePath, true);
      onDidChangeClip.fire({ filePath, data: next });
    };

    const createClip = async (filePath: string): Promise<string> => {
      // Ensure parent dir exists.
      const slash = filePath.lastIndexOf('/');
      if (slash > 0) await fileSystem.mkdir(filePath.slice(0, slash));
      const uuid = uuidv4();
      const metaDoc = { uuid, version: 1, importer: {} };
      await fileSystem.writeFile(`${filePath}.meta`, `${JSON.stringify(metaDoc, null, 2)}\n`);
      await fileSystem.writeFile(filePath, serializeClip(emptyClip()));
      await documentService.open(filePath);
      return uuid;
    };

    ctx.subscriptions.add(ctx.services.register(IAnimationService, {
      getClip,
      updateClip,
      createClip,
      onDidChangeClip: onDidChangeClip.event,
    }));

    ctx.subscriptions.add(
      documentService.registerHandler({
        extensions: [ANIM_CLIP_EXT],
        load(filePath, content): Promise<void> {
          const data = parseClip(content, filePath);
          clips.set(filePath, data);
          onDidChangeClip.fire({ filePath, data });
          return Promise.resolve();
        },
        serialize(filePath): Promise<string> {
          const data = clips.get(filePath) ?? emptyClip();
          return Promise.resolve(serializeClip(data));
        },
      }),
    );

    ctx.subscriptions.add(documentService.onDidChangeDocuments(() => {
      // Drop in-memory clips whose tabs are no longer open.
      const open = new Set(documentService.getOpenDocuments().map((d) => d.filePath));
      for (const key of [...clips.keys()]) {
        if (!open.has(key)) clips.delete(key);
      }
    }));

    ctx.subscriptions.add(
      commands.register({
        id: 'animation.newClip',
        title: 'New Animation Clip',
        category: 'Animation',
        async execute(_accessor, ...args: unknown[]): Promise<void> {
          if (!project.isOpen) return;
          const opts = (args[0] ?? {}) as { targetDirPath?: string };
          const targetDir = (typeof opts.targetDirPath === 'string' && opts.targetDirPath !== '')
            ? opts.targetDirPath
            : project.resolve('assets/animations');

          const entered = await showInputDialog('New Animation Clip', {
            initialValue: 'clip',
            placeholder: 'filename',
            okLabel: 'Create',
          });
          if (!entered) return;
          const trimmed = entered.trim();
          if (!trimmed) return;
          const safe = trimmed.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'clip';

          await fileSystem.mkdir(targetDir);
          const filePath = await uniqueClipPath(fileSystem, targetDir, safe);
          await createClip(filePath);
        },
      }),
    );
  },
};
