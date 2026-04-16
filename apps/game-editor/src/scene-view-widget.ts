import { BaseWidget, createIconElement, registerIcon } from '@editrix/view-dom';
import type { ESEngineModule, CppRegistry } from '@editrix/estella';

// ─── Register tool icons ────────────────────────────────

registerIcon('tool-select', '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2l4 12 2-5 5-2L3 2z"/></svg>');

registerIcon('tool-move', '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v12M2 8h12M8 2l-2 2M8 2l2 2M8 14l-2-2M8 14l2-2M2 8l2-2M2 8l2 2M14 8l-2-2M14 8l-2 2"/></svg>');

registerIcon('tool-rotate', '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 8a5 5 0 01-9.17 2.77M3 8a5 5 0 019.17-2.77"/><path d="M13 3v3.5h-3.5M3 13V9.5h3.5"/></svg>');

registerIcon('tool-scale', '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 13V8M3 13h5M3 13l10-10M13 3v5M13 3H8"/></svg>');

registerIcon('snap-grid', '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><circle cx="4" cy="4" r="1.2" fill="currentColor" stroke="none"/><circle cx="8" cy="4" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="4" r="1.2" fill="currentColor" stroke="none"/><circle cx="4" cy="8" r="1.2" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="8" r="1.2" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="8" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg>');

type ToolId = 'select' | 'move' | 'rotate' | 'scale';

/**
 * Scene View with floating toolbar and 3D viewport placeholder.
 *
 * Toolbar matches the Bevy editor reference: tool buttons,
 * snap distance control, and more menu.
 */
export class SceneViewWidget extends BaseWidget {
  private _activeTool: ToolId = 'select';
  private _toolButtons = new Map<ToolId, HTMLElement>();
  private _snapInput: HTMLInputElement | undefined;
  private _canvas: HTMLCanvasElement | undefined;
  private _glContext: WebGL2RenderingContext | null = null;
  private _glContextHandle = 0;
  private _module: ESEngineModule | undefined;
  private _registry: CppRegistry | undefined;
  private _renderRequested = false;

  constructor(id: string) {
    super(id, 'scene-view');
  }

  protected buildContent(root: HTMLElement): void {
    this._injectStyles();

    // Viewport
    const viewport = this.appendElement(root, 'div', 'editrix-sv-viewport');

    // WebGL canvas (fills viewport, behind toolbar)
    this._canvas = document.createElement('canvas');
    this._canvas.className = 'editrix-sv-canvas';
    viewport.appendChild(this._canvas);

    // Floating toolbar
    const toolbar = this.appendElement(viewport, 'div', 'editrix-sv-toolbar');

    // Left: tool buttons
    const toolGroup = this.appendElement(toolbar, 'div', 'editrix-sv-tool-group');

    const tools: { id: ToolId; icon: string; title: string }[] = [
      { id: 'select', icon: 'tool-select', title: 'Select (Q)' },
      { id: 'move', icon: 'tool-move', title: 'Move (W)' },
      { id: 'rotate', icon: 'tool-rotate', title: 'Rotate (E)' },
      { id: 'scale', icon: 'tool-scale', title: 'Scale (R)' },
    ];

    for (const tool of tools) {
      const btn = document.createElement('div');
      btn.className = 'editrix-sv-tool-btn';
      if (tool.id === this._activeTool) btn.classList.add('editrix-sv-tool-btn--active');
      btn.title = tool.title;
      btn.appendChild(createIconElement(tool.icon, 16));
      btn.addEventListener('click', () => { this._setActiveTool(tool.id); });
      toolGroup.appendChild(btn);
      this._toolButtons.set(tool.id, btn);
    }

    // Separator
    this.appendElement(toolbar, 'div', 'editrix-sv-separator');

    // Center: snap controls
    const snapGroup = this.appendElement(toolbar, 'div', 'editrix-sv-snap-group');

    const snapIcon = this.appendElement(snapGroup, 'div', 'editrix-sv-snap-icon');
    snapIcon.appendChild(createIconElement('snap-grid', 16));

    const snapLabel = this.appendElement(snapGroup, 'span', 'editrix-sv-snap-label');
    snapLabel.textContent = 'Snap distance';

    this._snapInput = this.appendElement(snapGroup, 'input', 'editrix-sv-snap-input');
    this._snapInput.type = 'text';
    this._snapInput.value = '5.00';
    this._snapInput.style.width = '48px';

    // Spacer
    const spacer = this.appendElement(toolbar, 'div');
    spacer.style.flex = '1';

    // Right: more menu
    const moreBtn = this.appendElement(toolbar, 'div', 'editrix-sv-tool-btn');
    moreBtn.title = 'More options';
    moreBtn.appendChild(createIconElement('more-vertical', 16));

    // Gizmo (top-right corner)
    const gizmo = this.appendElement(viewport, 'div', 'editrix-sv-gizmo');
    this._buildGizmo(gizmo);
  }

  private _setActiveTool(id: ToolId): void {
    this._activeTool = id;
    for (const [toolId, btn] of this._toolButtons) {
      btn.classList.toggle('editrix-sv-tool-btn--active', toolId === id);
    }
  }

  private _buildGizmo(container: HTMLElement): void {
    // Simple CSS-based 3D axis gizmo
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 60 60');
    svg.setAttribute('width', '60');
    svg.setAttribute('height', '60');
    svg.innerHTML = `
      <line x1="30" y1="30" x2="30" y2="8" stroke="#6bc46d" stroke-width="2"/>
      <line x1="30" y1="30" x2="50" y2="40" stroke="#e55561" stroke-width="2"/>
      <line x1="30" y1="30" x2="10" y2="40" stroke="#5299e0" stroke-width="2"/>
      <circle cx="30" cy="8" r="5" fill="#6bc46d"/>
      <circle cx="50" cy="40" r="5" fill="#e55561"/>
      <circle cx="10" cy="40" r="5" fill="#5299e0"/>
      <text x="30" y="10" fill="#fff" font-size="6" text-anchor="middle" dominant-baseline="middle">Y</text>
      <text x="50" y="42" fill="#fff" font-size="6" text-anchor="middle" dominant-baseline="middle">X</text>
      <text x="10" y="42" fill="#fff" font-size="6" text-anchor="middle" dominant-baseline="middle">Z</text>
    `;
    container.appendChild(svg);
  }

  /**
   * Connect to an estella WASM module and initialize WebGL rendering.
   * Called by the editor panel plugin after the module is loaded.
   */
  initRenderer(module: ESEngineModule): void {
    if (!this._canvas || this._module) return;

    this._glContext = this._canvas.getContext('webgl2', {
      alpha: true,
      depth: true,
      stencil: true,
      antialias: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    });

    if (!this._glContext) {
      console.error('SceneView: Failed to create WebGL2 context');
      return;
    }

    // Register the GL context with Emscripten so initRendererWithContext can use it
    this._glContextHandle = module.GL.registerContext(this._glContext, {
      majorVersion: 2,
      minorVersion: 0,
    });

    if (!module.initRendererWithContext(this._glContextHandle)) {
      console.error('SceneView: Failed to initialize estella renderer');
      return;
    }

    this._module = module;
    this._registry = new module.Registry();
    this.requestRender();
  }

  /** Get the C++ registry (available after initRenderer). */
  getRegistry(): CppRegistry | undefined {
    return this._registry;
  }

  /** Request a render on the next animation frame (coalesced) */
  requestRender(): void {
    if (this._renderRequested) return;
    this._renderRequested = true;
    requestAnimationFrame(() => {
      this._renderRequested = false;
      this._renderFrame();
    });
  }

  private _renderFrame(): void {
    if (!this._module || !this._registry || !this._canvas) return;

    const w = this._canvas.clientWidth;
    const h = this._canvas.clientHeight;
    if (w === 0 || h === 0) return;

    // Sync canvas buffer size
    if (this._canvas.width !== w || this._canvas.height !== h) {
      this._canvas.width = w;
      this._canvas.height = h;
    }

    this._module.renderFrame(this._registry, w, h);
  }

  protected override onResize(width: number, height: number): void {
    if (this._canvas) {
      this._canvas.width = width;
      this._canvas.height = height;
      this.requestRender();
    }
  }

  private _injectStyles(): void {
    const styleId = 'editrix-scene-view-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
/* ── Always hide tab bar in scene-view's group — menubar tabs handle switching ── */
.editrix-tab-group:has([data-panel-id="scene-view"]) > .editrix-tab-bar {
  display: none;
}

.editrix-widget-scene-view {
  background: #2b2b2f;
}

/* ── Canvas ── */
.editrix-sv-canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

/* ── Viewport ── */
.editrix-sv-viewport {
  position: relative;
  width: 100%;
  height: 100%;
  background:
    linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px);
  background-size: 40px 40px;
  background-position: center center;
  overflow: hidden;
}

/* ── Floating toolbar ── */
.editrix-sv-toolbar {
  position: absolute;
  top: 6px;
  left: 6px;
  right: 6px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  background: rgba(30, 30, 34, 0.88);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  backdrop-filter: blur(8px);
  z-index: 10;
}

.editrix-sv-tool-group {
  display: flex;
  align-items: center;
  gap: 2px;
}

.editrix-sv-tool-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 4px;
  cursor: pointer;
  color: var(--editrix-text-dim);
}
.editrix-sv-tool-btn:hover {
  color: var(--editrix-text);
  background: rgba(255, 255, 255, 0.08);
}
.editrix-sv-tool-btn--active {
  color: var(--editrix-text);
  background: rgba(255, 255, 255, 0.12);
}

.editrix-sv-separator {
  width: 1px;
  height: 18px;
  background: rgba(255, 255, 255, 0.1);
  margin: 0 4px;
  flex-shrink: 0;
}

.editrix-sv-snap-group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.editrix-sv-snap-icon {
  display: flex;
  align-items: center;
  color: var(--editrix-text-dim);
}

.editrix-sv-snap-label {
  font-size: 12px;
  color: var(--editrix-text-dim);
  white-space: nowrap;
}

.editrix-sv-snap-input {
  background: #414141;
  border: none;
  color: var(--editrix-text);
  padding: 3px 6px;
  border-radius: 4px;
  font-family: var(--editrix-mono-font, Consolas, monospace);
  font-size: 12px;
  text-align: center;
  outline: none;
}
.editrix-sv-snap-input:focus {
  box-shadow: 0 0 0 1px var(--editrix-accent);
}

/* ── Gizmo ── */
.editrix-sv-gizmo {
  position: absolute;
  top: 50px;
  right: 12px;
  opacity: 0.85;
  pointer-events: none;
}
`;
    document.head.appendChild(style);
  }
}
