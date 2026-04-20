/**
 * @editrix/core — kernel, plugin system, and core services.
 *
 * Organized into logical sections. Consumers typically import the types they
 * need from the top of the barrel (IPlugin, IKernel, service identifiers) and
 * the concrete implementations only when bootstrapping (createKernel,
 * SettingsService, etc.). Everything exported from `@editrix/common` is
 * re-exported here for convenience so downstream packages can depend on a
 * single entry point.
 */

// ── Re-exports from @editrix/common (for single-entry convenience) ─────────
export type { Event, ExtensionPointId, IDisposable, ServiceIdentifier } from '@editrix/common';
export {
  createExtensionPointId,
  createServiceId,
  DisposableStore,
  Emitter,
  isDisposable,
  toDisposable,
} from '@editrix/common';

// ── Core enums shared across kernel subsystems ─────────────────────────────
export { PluginState, ServiceScope } from './types.js';

// ── Event bus: kernel-wide pub/sub for framework events ────────────────────
export type { IEventBus } from './event-bus.js';
export { EventBus } from './event-bus.js';

// ── Service registry: DI container keyed by ServiceIdentifier ──────────────
export type { IServiceRegistry } from './service-registry.js';
export { ServiceRegistry } from './service-registry.js';

// ── Extension points: typed contribution slots ─────────────────────────────
export type {
  ExtensionPointOptions,
  IExtensionPoint,
  IExtensionPointAccess,
} from './extension-point-registry.js';
export { ExtensionPointRegistry } from './extension-point-registry.js';

// ── Plugin contract: what a plugin must implement ──────────────────────────
export type { IPlugin, IPluginContext, IPluginDescriptor } from './plugin.js';

// ── Kernel: app-level orchestrator (created via createKernel) ──────────────
export type { IKernel } from './kernel.js';
export { createKernel } from './kernel.js';

// ── Plugin manifest: static descriptor validated at load time ──────────────
export type { DiscoveredPlugin, PluginManifest } from './plugin-manifest.js';
export { validateManifest } from './plugin-manifest.js';

// ── Plugin loader: discovers and loads plugins from a scanner ──────────────
export type { IPluginScanner, PluginLoadResult } from './plugin-loader.js';
export { IPluginLoader, PluginLoader } from './plugin-loader.js';

// ── Plugin manager: runtime plugin state (enable/disable/info) ─────────────
export type { PluginInfo, PluginStatusChangeEvent } from './plugin-manager.js';
export { IPluginManager, PluginManager } from './plugin-manager.js';

// ── Settings service: typed, persisted key/value config ────────────────────
export type {
  SettingChangeEvent,
  SettingDescriptor,
  SettingGroup,
  SettingType,
} from './settings.js';
export { ISettingsService, SettingsService } from './settings.js';

// ── Document service: open/close/save for editor documents ─────────────────
export type { DocumentHandler, DocumentInfo } from './document.js';
export { DocumentService, IDocumentService } from './document.js';

// ── Filesystem abstraction: pluggable backend for file IO ──────────────────
export type { FileChangeEvent, FileEntry, FileEntryType, FileStat } from './filesystem.js';
export {
  IFileSystemService,
  getBaseName,
  getExtension,
  getParentPath,
  joinPath,
  normalizePath,
} from './filesystem.js';

// ── Project configuration: shape of a saved project + launcher state ───────
export type {
  AssetConfig,
  LauncherConfig,
  LauncherProjectEntry,
  LayoutPreset,
  PluginConfig,
  ProjectConfig,
} from './project.js';
export { createDefaultProjectConfig } from './project.js';

// ── Undo/Redo service: app-level operation history ─────────────────────────
export type { UndoRedoOperation, UndoRedoStateEvent } from './undo-redo.js';
export { IUndoRedoService, UndoRedoService } from './undo-redo.js';

// ── Dialog service: modal confirm / prompt / message boxes ─────────────────
export type {
  ConfirmDialogOptions,
  DialogButton,
  DialogButtonVariant,
  InputDialogOptions,
  MessageDialogOptions,
} from './dialog.js';
export { IDialogService } from './dialog.js';

// ── Notification service: non-modal toasts ────────────────────────────────
export type {
  Notification,
  NotificationAction,
  NotificationOptions,
  NotificationSeverity,
} from './notification.js';
export { INotificationService } from './notification.js';

// ── Clipboard service: platform-agnostic text clipboard ───────────────────
export { IClipboardService } from './clipboard.js';
