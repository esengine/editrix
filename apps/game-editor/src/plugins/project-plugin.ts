import { IWorkspaceService } from '@editrix/core';
import type { IPlugin, IPluginContext } from '@editrix/shell';
import { IProjectService } from '../services.js';

interface ElectronProjectApi {
  getProjectPath(): string;
}

function getApi(): ElectronProjectApi | undefined {
  return (window as unknown as { electronAPI?: ElectronProjectApi }).electronAPI;
}

/**
 * Project wiring for the game editor.
 *
 * Two jobs:
 *   1. **Seed the framework's {@link IWorkspaceService}** with the Electron
 *      host's project path. (`createEditor` already seeded it from the
 *      `workspace` option when the host provided one; if not, we fall
 *      through to reading `window.electronAPI.getProjectPath` here.)
 *   2. **Expose the app-local {@link IProjectService} adapter** — a thin
 *      layer on top of the workspace service that keeps the existing
 *      editor-plugin surface (`project.path`, `project.assetRoots`,
 *      `project.resolve`) stable while the workspace abstraction
 *      settles in.
 */
export const ProjectPlugin: IPlugin = {
  descriptor: {
    id: 'app.project',
    version: '1.0.0',
  },
  activate(ctx: IPluginContext) {
    const workspace = ctx.services.get(IWorkspaceService);

    // Fall through to Electron if the shell didn't seed a workspace.
    if (!workspace.isOpen) {
      const raw = getApi()?.getProjectPath() ?? '';
      const normalised = raw.replace(/\\/g, '/').replace(/\/$/, '');
      if (normalised !== '') {
        workspace.setWorkspace({ path: normalised, config: undefined });
      }
    }

    const service: IProjectService = {
      get path() {
        return workspace.path;
      },
      get isOpen() {
        return workspace.isOpen;
      },
      get assetRoots() {
        const roots = workspace.assetRoots;
        return roots.length > 0 ? roots : ['assets'];
      },
      resolve: (relativePath: string): string => workspace.resolve(relativePath),
    };
    ctx.subscriptions.add(ctx.services.register(IProjectService, service));
  },
};
