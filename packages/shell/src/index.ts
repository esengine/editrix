// Main entry point
export type { CreateEditorOptions, EditorInstance } from './create-editor.js';
export { createEditor } from './create-editor.js';

// Re-export commonly used types for convenience
export type {
  ConfirmDialogOptions,
  DialogButton,
  DialogButtonVariant,
  DocumentHandler,
  DocumentInfo,
  InputDialogOptions,
  IPlugin,
  IPluginContext,
  IPluginScanner,
  MessageDialogOptions,
  Notification,
  NotificationAction,
  NotificationOptions,
  NotificationSeverity,
  PluginManifest,
  SettingDescriptor,
  SettingGroup,
  UndoRedoOperation,
} from '@editrix/core';
export {
  createExtensionPointId,
  createServiceId,
  DocumentService,
  IClipboardService,
  IDialogService,
  IDocumentService,
  INotificationService,
  IPluginManager,
  ISettingsService,
  IUndoRedoService,
} from '@editrix/core';
export type { Command, Keybinding } from '@editrix/commands';
export {
  formatKeyForDisplay,
  ICommandRegistry,
  IKeybindingService,
  keyboardEventToKey,
} from '@editrix/commands';
export { ILayoutService } from '@editrix/layout';
export type { PanelDescriptor } from '@editrix/layout';
export type { IWidget } from '@editrix/view';
export { IViewAdapter, IViewService } from '@editrix/view';
export { IPropertyService, ISelectionService } from '@editrix/properties';
export type { PropertySchema } from '@editrix/properties';
