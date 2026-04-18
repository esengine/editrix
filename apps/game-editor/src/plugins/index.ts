/**
 * Editor plugin set. Each plugin owns one panel or one piece of cross-cutting
 * wiring (render context, ECS binding, document sync). They are composed by
 * renderer.ts at startup; the dependency graph between them is declared in
 * each plugin's descriptor.dependencies.
 *
 * Activation order (dependency-driven, computed by the kernel):
 *   render-context → ecs-scene → document-sync → project-panels
 *                              ↘ scene-view
 *                              ↘ game-view
 *                              ↘ hierarchy
 *                              ↘ inspector
 */
export { DocumentSyncPlugin } from './document-sync-plugin.js';
export { ECSScenePlugin } from './ecs-scene-plugin.js';
export { GameViewPlugin } from './game-view-plugin.js';
export { HierarchyPlugin } from './hierarchy-plugin.js';
export { InspectorPlugin } from './inspector-plugin.js';
export { ProjectPanelsPlugin } from './project-panels-plugin.js';
export { RenderContextPlugin } from './render-context-plugin.js';
export { SceneViewPlugin } from './scene-view-plugin.js';
