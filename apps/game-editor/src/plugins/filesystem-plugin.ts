import { IFileSystemService } from '@editrix/core';
import type { IPlugin, IPluginContext } from '@editrix/shell';
import { ElectronFileSystemService } from '../electron-filesystem.js';

/**
 * Registers the Electron-backed {@link IFileSystemService} so plugins consume
 * filesystem access through DI rather than scraping `window.electronAPI.fs`
 * directly. This is the only place that knows about the preload bridge —
 * a future web build can swap in a different implementation.
 */
export const FilesystemPlugin: IPlugin = {
  descriptor: {
    id: 'app.filesystem',
    version: '1.0.0',
  },
  activate(ctx: IPluginContext) {
    const service = new ElectronFileSystemService();
    ctx.subscriptions.add(service);
    ctx.subscriptions.add(ctx.services.register(IFileSystemService, service));
  },
};
