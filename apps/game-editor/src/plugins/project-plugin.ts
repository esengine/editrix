import type { IPlugin, IPluginContext } from '@editrix/shell';
import { IProjectService } from '../services.js';

interface ElectronProjectApi {
  getProjectPath(): string;
}

function getApi(): ElectronProjectApi | undefined {
  return (window as unknown as { electronAPI?: ElectronProjectApi }).electronAPI;
}

/**
 * Owns the open-project context. Reads the project path from the Electron host
 * once at activation and exposes it as a stable {@link IProjectService} so
 * plugins and widgets don't have to scrape `window.electronAPI` themselves.
 *
 * The asset root list mirrors what `editrix.json` declares; for now we hard-code
 * the conventional `assets/` until the project config loader is plugin-ified.
 */
export const ProjectPlugin: IPlugin = {
  descriptor: {
    id: 'app.project',
    version: '1.0.0',
  },
  activate(ctx: IPluginContext) {
    const raw = getApi()?.getProjectPath() ?? '';
    const path = raw.replace(/\\/g, '/').replace(/\/$/, '');

    const service: IProjectService = {
      path,
      isOpen: path !== '',
      assetRoots: ['assets'],
      resolve(relativePath: string): string {
        if (path === '') return '';
        const cleaned = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
        return `${path}/${cleaned}`;
      },
    };
    ctx.subscriptions.add(ctx.services.register(IProjectService, service));
  },
};
