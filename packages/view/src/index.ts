// Widget protocol
export type { IWidget, WidgetFactory } from './widget.js';

// View adapter (IViewAdapter is both an interface and a ServiceIdentifier value)
export type { InputEvent } from './view-adapter.js';
export { IViewAdapter } from './view-adapter.js';

// View service (IViewService is both an interface and a ServiceIdentifier value)
export { IViewService, ViewService } from './view-service.js';

// Plugin
export { ViewPlugin, ViewPluginId } from './view-plugin.js';
