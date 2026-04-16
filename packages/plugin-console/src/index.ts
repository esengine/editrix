// Console widget
export type { ConsoleEntry, LogLevel } from './console-widget.js';
export { ConsoleWidget } from './console-widget.js';

// Console plugin + service (IConsoleService is both an interface and a ServiceIdentifier value)
export { ConsolePlugin, IConsoleService } from './console-plugin.js';

// Default export for dynamic loading via PluginLoader
export { ConsolePlugin as default } from './console-plugin.js';
