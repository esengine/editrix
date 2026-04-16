// Panel descriptors
export type { IPanelFactory, LayoutRegion, PanelDescriptor } from './panel.js';

// Layout tree (immutable data model + operations)
export type { LayoutChild, LayoutNode, SplitNode, TabGroupNode } from './layout-tree.js';
export {
  addPanelToGroup,
  findPanel,
  getAllPanelIds,
  movePanelToGroup,
  movePanelToSplit,
  removePanel,
  reorderPanel,
  serializeLayout,
  setActiveTab,
} from './layout-tree.js';

// Layout service (ILayoutService is both an interface and a ServiceIdentifier value)
export { ILayoutService, LayoutService } from './layout-service.js';

// Plugin
export { LayoutPlugin } from './layout-plugin.js';
