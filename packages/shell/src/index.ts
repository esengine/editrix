// Main entry point
export type { CreateEditorOptions, EditorInstance } from './create-editor.js';
export { createEditor } from './create-editor.js';

// Re-export commonly used types for convenience
export type { DocumentHandler, DocumentInfo, IPlugin, IPluginContext, IPluginScanner, PluginManifest, SettingDescriptor, SettingGroup, UndoRedoOperation } from '@editrix/core';
export { createExtensionPointId, createServiceId, DocumentService, IDocumentService, IPluginManager, ISettingsService, IUndoRedoService } from '@editrix/core';
export type { Command } from '@editrix/commands';
export { ICommandRegistry } from '@editrix/commands';
export { ILayoutService } from '@editrix/layout';
export type { PanelDescriptor } from '@editrix/layout';
export type { IWidget } from '@editrix/view';
export { IViewService } from '@editrix/view';
export { IPropertyService, ISelectionService } from '@editrix/properties';
export type { PropertySchema } from '@editrix/properties';
