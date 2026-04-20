// Icons
export {
  createIconElement,
  defaultIconRegistry,
  getIcon,
  IconRegistry,
  registerIcon,
} from './icons.js';

// DOM utilities
export { clearChildren, createElement, setCssVars } from './dom-utils.js';

// Theme system
export type { EditorTheme, ThemeColors } from './theme.js';
export { applyTheme, DARK_THEME } from './theme.js';

// Menu bar
export type { MenuBarTab, MenuDescriptor, MenuItem } from './menu-bar.js';
export { MenuBar } from './menu-bar.js';

// Editor toolbar
export type { EditorToolbarItem } from './editor-toolbar.js';
export { EditorToolbar } from './editor-toolbar.js';

// Document tab bar
export type { DocumentTabItem } from './document-tab-bar.js';
export { DocumentTabBar } from './document-tab-bar.js';

// Layout renderer
export type {
  PanelCloseHandler,
  TabAddHandler,
  TabClickHandler,
  TabDropHandler,
  TitleResolver,
  WidgetResolver,
} from './layout-renderer.js';
export { LayoutRenderer } from './layout-renderer.js';

// Command palette
export { CommandPalette } from './command-palette.js';

// Status bar
export type { StatusBarItem } from './status-bar.js';
export { StatusBar } from './status-bar.js';

// Activity bar + Sidebar
export type { SidebarViewDescriptor } from './activity-bar.js';
export { ActivityBar } from './activity-bar.js';
export type { SidebarWidgetFactory } from './sidebar.js';
export { Sidebar } from './sidebar.js';

// DOM view adapter
export type { DomViewAdapterOptions } from './dom-view-adapter.js';
export { DomViewAdapter } from './dom-view-adapter.js';

// Default styles
export { injectDefaultStyles } from './default-styles.js';

// Context menu
export type { ContextMenuHandle, ContextMenuItem, ContextMenuOptions } from './context-menu.js';
export { showContextMenu } from './context-menu.js';

// Quick pick
export type { QuickPickHandle, QuickPickItem, QuickPickOptions } from './quick-pick.js';
export { showQuickPick } from './quick-pick.js';

// Widget primitives
export { BaseWidget } from './widgets/base-widget.js';
export type { ListItem, ListWidgetOptions } from './widgets/list-widget.js';
export { ListWidget } from './widgets/list-widget.js';
export type {
  AssetPickerBinding,
  AssetRefPreview,
  PropertyChangeHandler,
  PropertyGridOptions,
  PropertyGridDataOptions,
  FieldMenuEvent,
  ComponentReorderEvent,
} from './widgets/property-grid-widget.js';
export { PropertyGridWidget } from './widgets/property-grid-widget.js';
export type { ToolbarAction } from './widgets/toolbar-widget.js';
export { Toolbar } from './widgets/toolbar-widget.js';
export type { TreeNode, TreeWidgetOptions } from './widgets/tree-widget.js';
export { TreeWidget } from './widgets/tree-widget.js';

// Settings binding
export { SettingsBinding } from './settings-binding.js';

// Dialog service (DOM impl)
export { DomDialogService } from './dialog-service.js';

// Notification service (DOM impl)
export { DomNotificationService } from './notification-service.js';

// Clipboard service (navigator.clipboard wrapper)
export { NavigatorClipboardService } from './clipboard-service.js';

// Plugin factory
export { createDomViewPlugin, ViewDomPluginId } from './dom-view-plugin.js';
