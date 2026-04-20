import { toDisposable } from '@editrix/common';
import type { IDisposable } from '@editrix/common';
import type { IPlugin, IPluginContext } from '@editrix/shell';
import { IInspectorComponentFilter } from '../services.js';

class InspectorComponentFilter implements IInspectorComponentFilter {
  private readonly _predicates = new Set<(name: string) => boolean>();

  register(predicate: (componentName: string) => boolean): IDisposable {
    this._predicates.add(predicate);
    return toDisposable(() => {
      this._predicates.delete(predicate);
    });
  }

  isHidden(componentName: string): boolean {
    for (const p of this._predicates) {
      if (p(componentName)) return true;
    }
    return false;
  }
}

// Stand-alone plugin (no deps) so predicate producers and consumers can both
// depend on it without forming a cycle through the full Inspector.
export const InspectorFiltersPlugin: IPlugin = {
  descriptor: {
    id: 'app.inspector-filters',
    version: '1.0.0',
    dependencies: [],
  },
  activate(ctx: IPluginContext) {
    ctx.subscriptions.add(
      ctx.services.register(IInspectorComponentFilter, new InspectorComponentFilter()),
    );
  },
};
