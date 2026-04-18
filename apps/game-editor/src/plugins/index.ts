/**
 * Editor plugin set. Each plugin owns one panel or one piece of cross-cutting
 * wiring (project, filesystem, render context, ECS binding, document sync).
 * Composed by renderer.ts at startup; the dependency graph between them is
 * declared in each plugin's descriptor.dependencies.
 *
 * Activation order (dependency-driven, computed by the kernel):
 *   project, filesystem  (no deps; foundational app context)
 *   render-context
 *   ecs-scene → document-sync → project-panels
 *             ↘ scene-view
 *             ↘ game-view
 *             ↘ hierarchy
 *             ↘ inspector
 */
export { DocumentSyncPlugin } from './document-sync-plugin.js';
export { ECSScenePlugin } from './ecs-scene-plugin.js';
export { FilesystemPlugin } from './filesystem-plugin.js';
export { GameViewPlugin } from './game-view-plugin.js';
export { HierarchyPlugin } from './hierarchy-plugin.js';
export { InspectorPlugin } from './inspector-plugin.js';
export { ProjectPanelsPlugin } from './project-panels-plugin.js';
export { ProjectPlugin } from './project-plugin.js';
export { RenderContextPlugin } from './render-context-plugin.js';
export { SceneViewPlugin } from './scene-view-plugin.js';
