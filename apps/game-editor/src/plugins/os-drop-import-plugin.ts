import { toDisposable } from '@editrix/common';
import { IFileSystemService } from '@editrix/core';
import { IConsoleService } from '@editrix/plugin-console';
import type { IPlugin, IPluginContext } from '@editrix/shell';
import { IProjectService } from '../services.js';

const ASSETS_DIR = 'assets';

export const OSDropImportPlugin: IPlugin = {
  descriptor: {
    id: 'app.os-drop-import',
    version: '1.0.0',
    dependencies: ['app.filesystem', 'app.project'],
  },
  activate(ctx: IPluginContext) {
    const fs = ctx.services.get(IFileSystemService);
    const project = ctx.services.get(IProjectService);

    // Global dragover to allow drop. Without preventDefault on dragover,
    // the drop event never fires.
    const onDragOver = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };

    const onDrop = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (!project.isOpen) return;
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      void importFiles(files, project.resolve(ASSETS_DIR), fs, ctx);
    };

    document.addEventListener('dragover', onDragOver);
    document.addEventListener('drop', onDrop);
    ctx.subscriptions.add(toDisposable(() => {
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('drop', onDrop);
    }));
  },
};

function hasFiles(e: DragEvent): boolean {
  return e.dataTransfer?.types.includes('Files') ?? false;
}

async function importFiles(
  files: File[],
  targetDir: string,
  fs: IFileSystemService,
  ctx: IPluginContext,
): Promise<void> {
  const log = (level: 'info' | 'warn' | 'error', msg: string): void => {
    try { ctx.services.get(IConsoleService).log(level, msg, 'asset-import'); } catch { /* console may not be up yet */ }
  };
  // Electron 34+ removed File.path; resolve via preload-exposed webUtils.
  const api = (window as unknown as { electronAPI?: { getPathForFile?(f: File): string } }).electronAPI;
  try { await fs.mkdir(targetDir); } catch { /* already exists is fine */ }

  for (const file of files) {
    const src = api?.getPathForFile?.(file);
    if (!src) {
      log('warn', `Skipped "${file.name}" — drag source has no filesystem path.`);
      continue;
    }
    const dest = await nextAvailable(fs, targetDir, file.name);
    try {
      await fs.copy(src, dest);
      log('info', `Imported ${file.name} → ${relativeTail(dest)}`);
    } catch (err) {
      log('error', `Import ${file.name} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/** Resolve `dir/name`, or `dir/name-2` / `-3` if the first is taken. */
async function nextAvailable(fs: IFileSystemService, dir: string, name: string): Promise<string> {
  const candidate = `${dir}/${name}`;
  if (!(await fs.exists(candidate))) return candidate;
  const dotIdx = name.lastIndexOf('.');
  const stem = dotIdx > 0 ? name.slice(0, dotIdx) : name;
  const ext = dotIdx > 0 ? name.slice(dotIdx) : '';
  for (let i = 2; i < 1000; i++) {
    const retry = `${dir}/${stem}-${String(i)}${ext}`;
    if (!(await fs.exists(retry))) return retry;
  }
  return candidate;
}

function relativeTail(absPath: string): string {
  const idx = absPath.indexOf('/assets/');
  return idx === -1 ? absPath : absPath.slice(idx + 1);
}
