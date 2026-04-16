// Re-export everything from @editrix/common for convenience
export type { Event, ExtensionPointId, IDisposable, ServiceIdentifier } from '@editrix/common';
export {
  createExtensionPointId,
  createServiceId,
  DisposableStore,
  Emitter,
  isDisposable,
  toDisposable,
} from '@editrix/common';

// Core types
export { PluginState, ServiceScope } from './types.js';

// Event bus
export type { IEventBus } from './event-bus.js';
export { EventBus } from './event-bus.js';

// Service registry
export type { IServiceRegistry } from './service-registry.js';
export { ServiceRegistry } from './service-registry.js';

// Extension points
export type {
  ExtensionPointOptions,
  IExtensionPoint,
  IExtensionPointAccess,
} from './extension-point-registry.js';
export { ExtensionPointRegistry } from './extension-point-registry.js';

// Plugin system
export type { IPlugin, IPluginContext, IPluginDescriptor } from './plugin.js';

// Kernel
export type { IKernel } from './kernel.js';
export { createKernel } from './kernel.js';

// Plugin manifest
export type { DiscoveredPlugin, PluginManifest } from './plugin-manifest.js';
export { validateManifest } from './plugin-manifest.js';

// Plugin loader
export type { IPluginScanner, PluginLoadResult } from './plugin-loader.js';
export { IPluginLoader, PluginLoader } from './plugin-loader.js';

// Plugin manager
export type { PluginInfo, PluginStatusChangeEvent } from './plugin-manager.js';
export { IPluginManager, PluginManager } from './plugin-manager.js';

// Settings
export type { SettingChangeEvent, SettingDescriptor, SettingGroup, SettingType } from './settings.js';
export { ISettingsService, SettingsService } from './settings.js';

// Document management
export type { DocumentHandler, DocumentInfo } from './document.js';
export { DocumentService, IDocumentService } from './document.js';

// Filesystem
export type {
  FileChangeEvent,
  FileEntry,
  FileEntryType,
  FileStat,
} from './filesystem.js';
export {
  IFileSystemService,
  getBaseName,
  getExtension,
  getParentPath,
  joinPath,
  normalizePath,
} from './filesystem.js';

// Project configuration
export type {
  AssetConfig,
  LauncherConfig,
  LauncherProjectEntry,
  LayoutPreset,
  PluginConfig,
  ProjectConfig,
} from './project.js';
export { createDefaultProjectConfig } from './project.js';

// Undo/Redo
export type { UndoRedoOperation, UndoRedoStateEvent } from './undo-redo.js';
export { IUndoRedoService, UndoRedoService } from './undo-redo.js';
