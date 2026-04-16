import type { Event, IDisposable } from '@editrix/common';
import { createServiceId, Emitter, toDisposable } from '@editrix/common';
import type { SettingType } from '@editrix/core';

/**
 * A node in the scene graph.
 */
export interface SceneNode {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly icon?: string;
  readonly children: readonly string[];
  readonly visible: boolean;
}

/**
 * Describes a property on a node type.
 */
export interface ScenePropertyDescriptor {
  readonly key: string;
  readonly label: string;
  readonly type: SettingType;
  readonly defaultValue: unknown;
  readonly group?: string;
  readonly description?: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly enumValues?: readonly string[];
}

/**
 * Schema for a node type — defines which properties it has.
 */
export interface NodeTypeSchema {
  readonly type: string;
  readonly label: string;
  readonly properties: readonly ScenePropertyDescriptor[];
}

/**
 * Event when a scene node changes.
 */
export interface SceneChangeEvent {
  readonly nodeId: string;
  readonly changeType: 'added' | 'removed' | 'modified' | 'reordered';
}

/**
 * Event when a node property changes.
 */
export interface ScenePropertyChangeEvent {
  readonly nodeId: string;
  readonly key: string;
  readonly oldValue: unknown;
  readonly newValue: unknown;
}

/**
 * Central scene data model. Holds the node tree, type schemas,
 * and property values. All modifications fire events for UI updates.
 *
 * @example
 * ```ts
 * const scene = new SceneService();
 * scene.registerNodeType({ type: 'mesh', label: 'Mesh', properties: [...] });
 * scene.addNode({ id: 'player', name: 'Player', type: 'mesh', ... });
 * scene.setProperty('player', 'position.x', 10);
 * ```
 */
export interface ISceneService extends IDisposable {
  registerNodeType(schema: NodeTypeSchema): IDisposable;
  getNodeTypeSchema(type: string): NodeTypeSchema | undefined;

  addNode(node: SceneNode, parentId?: string): void;
  removeNode(nodeId: string): void;
  getNode(nodeId: string): SceneNode | undefined;
  getRootIds(): readonly string[];
  getChildren(nodeId: string): readonly SceneNode[];

  setNodeName(nodeId: string, name: string): void;
  setNodeVisible(nodeId: string, visible: boolean): void;

  setProperty(nodeId: string, key: string, value: unknown): void;
  getProperty(nodeId: string, key: string): unknown;
  getProperties(nodeId: string): Record<string, unknown>;

  /** Clear all nodes and properties (but keep registered schemas). */
  clear(): void;

  /** Serialize the entire scene to a JSON-compatible object. */
  serialize(): SceneFileData;

  /** Deserialize scene data, replacing all current nodes and properties. */
  deserialize(data: SceneFileData): void;

  readonly onDidChangeScene: Event<SceneChangeEvent>;
  readonly onDidChangeProperty: Event<ScenePropertyChangeEvent>;
}

/**
 * Serialized scene file format.
 */
export interface SceneFileData {
  readonly $type: 'editrix:scene';
  readonly $version: number;
  readonly name: string;
  readonly nodeTypes: readonly NodeTypeSchema[];
  readonly nodes: readonly SerializedNode[];
}

/**
 * A single serialized node with its properties.
 */
export interface SerializedNode {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly icon?: string;
  readonly visible: boolean;
  readonly parentId?: string;
  readonly properties: Record<string, unknown>;
}

/** Service identifier for DI. */
export const ISceneService = createServiceId<ISceneService>('ISceneService');

/**
 * Default implementation of {@link ISceneService}.
 */
export class SceneService implements ISceneService {
  private readonly _nodes = new Map<string, SceneNode>();
  private readonly _rootIds: string[] = [];
  private readonly _schemas = new Map<string, NodeTypeSchema>();
  private readonly _properties = new Map<string, Record<string, unknown>>();

  private readonly _onDidChangeScene = new Emitter<SceneChangeEvent>();
  private readonly _onDidChangeProperty = new Emitter<ScenePropertyChangeEvent>();

  readonly onDidChangeScene: Event<SceneChangeEvent> = this._onDidChangeScene.event;
  readonly onDidChangeProperty: Event<ScenePropertyChangeEvent> = this._onDidChangeProperty.event;

  registerNodeType(schema: NodeTypeSchema): IDisposable {
    this._schemas.set(schema.type, schema);
    return toDisposable(() => { this._schemas.delete(schema.type); });
  }

  getNodeTypeSchema(type: string): NodeTypeSchema | undefined {
    return this._schemas.get(type);
  }

  addNode(node: SceneNode, parentId?: string): void {
    this._nodes.set(node.id, node);

    // Initialize default property values from schema
    const schema = this._schemas.get(node.type);
    if (schema) {
      const props: Record<string, unknown> = {};
      for (const pd of schema.properties) {
        props[pd.key] = pd.defaultValue;
      }
      this._properties.set(node.id, props);
    }

    if (parentId) {
      const parent = this._nodes.get(parentId);
      if (parent) {
        this._nodes.set(parentId, {
          ...parent,
          children: [...parent.children, node.id],
        });
      }
    } else {
      this._rootIds.push(node.id);
    }

    this._onDidChangeScene.fire({ nodeId: node.id, changeType: 'added' });
  }

  removeNode(nodeId: string): void {
    this._nodes.delete(nodeId);
    this._properties.delete(nodeId);

    const rootIdx = this._rootIds.indexOf(nodeId);
    if (rootIdx !== -1) this._rootIds.splice(rootIdx, 1);

    // Remove from parent's children
    for (const [id, node] of this._nodes) {
      if (node.children.includes(nodeId)) {
        this._nodes.set(id, {
          ...node,
          children: node.children.filter((c) => c !== nodeId),
        });
      }
    }

    this._onDidChangeScene.fire({ nodeId, changeType: 'removed' });
  }

  getNode(nodeId: string): SceneNode | undefined {
    return this._nodes.get(nodeId);
  }

  getRootIds(): readonly string[] {
    return this._rootIds;
  }

  getChildren(nodeId: string): readonly SceneNode[] {
    const node = this._nodes.get(nodeId);
    if (!node) return [];
    return node.children
      .map((id) => this._nodes.get(id))
      .filter((n): n is SceneNode => n !== undefined);
  }

  setNodeName(nodeId: string, name: string): void {
    const node = this._nodes.get(nodeId);
    if (!node) return;
    this._nodes.set(nodeId, { ...node, name });
    this._onDidChangeScene.fire({ nodeId, changeType: 'modified' });
  }

  setNodeVisible(nodeId: string, visible: boolean): void {
    const node = this._nodes.get(nodeId);
    if (!node) return;
    this._nodes.set(nodeId, { ...node, visible });
    this._onDidChangeScene.fire({ nodeId, changeType: 'modified' });
  }

  setProperty(nodeId: string, key: string, value: unknown): void {
    let props = this._properties.get(nodeId);
    if (!props) {
      props = {};
      this._properties.set(nodeId, props);
    }
    const oldValue = props[key];
    props[key] = value;
    this._onDidChangeProperty.fire({ nodeId, key, oldValue, newValue: value });
  }

  getProperty(nodeId: string, key: string): unknown {
    return this._properties.get(nodeId)?.[key];
  }

  getProperties(nodeId: string): Record<string, unknown> {
    return { ...this._properties.get(nodeId) };
  }

  clear(): void {
    this._nodes.clear();
    this._rootIds.length = 0;
    this._properties.clear();
    // Keep schemas — they're type definitions, not instance data
  }

  serialize(): SceneFileData {
    const nodes: SerializedNode[] = [];

    // Build a parentId map
    const parentMap = new Map<string, string>();
    for (const [id, node] of this._nodes) {
      for (const childId of node.children) {
        parentMap.set(childId, id);
      }
    }

    // Serialize nodes in tree order (roots first, then depth-first)
    const visited = new Set<string>();
    const walk = (nodeId: string): void => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      const node = this._nodes.get(nodeId);
      if (!node) return;
      const serialized: SerializedNode = {
        id: node.id,
        name: node.name,
        type: node.type,
        visible: node.visible,
        properties: this.getProperties(node.id),
        ...(node.icon !== undefined ? { icon: node.icon } : {}),
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        ...(parentMap.has(node.id) ? { parentId: parentMap.get(node.id)! } : {}),
      };
      nodes.push(serialized);
      for (const childId of node.children) {
        walk(childId);
      }
    };

    for (const rootId of this._rootIds) {
      walk(rootId);
    }

    return {
      $type: 'editrix:scene',
      $version: 1,
      name: 'Scene',
      nodeTypes: [...this._schemas.values()],
      nodes,
    };
  }

  deserialize(data: SceneFileData): void {
    this.clear();

    // Register node types from file
    for (const schema of data.nodeTypes) {
      if (!this._schemas.has(schema.type)) {
        this.registerNodeType(schema);
      }
    }

    // Add nodes in order (parents before children)
    for (const sn of data.nodes) {
      const node: SceneNode = {
        id: sn.id,
        name: sn.name,
        type: sn.type,
        visible: sn.visible,
        children: [],
        ...(sn.icon !== undefined ? { icon: sn.icon } : {}),
      };
      this.addNode(node, sn.parentId);

      // Restore properties (overwrite defaults set by addNode)
      for (const [key, value] of Object.entries(sn.properties)) {
        this.setProperty(sn.id, key, value);
      }
    }
  }

  dispose(): void {
    this._nodes.clear();
    this._rootIds.length = 0;
    this._schemas.clear();
    this._properties.clear();
    this._onDidChangeScene.dispose();
    this._onDidChangeProperty.dispose();
  }
}
