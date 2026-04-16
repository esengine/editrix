import { createServiceId, type IDisposable, Emitter, type Event } from '@editrix/common';

/**
 * Minimal type for the Emscripten-generated WASM module.
 * Full type lives in estella SDK — here we only declare what the service needs.
 */
export interface ESEngineModule {
    Registry: new () => unknown;
    initRendererWithContext(contextHandle: number): boolean;
    shutdownRenderer(): void;
    renderFrame(registry: unknown, width: number, height: number): void;
    GL: {
        registerContext(ctx: WebGLRenderingContext | WebGL2RenderingContext, attrs: Record<string, unknown>): number;
    };
    [key: string]: unknown;
}

export type EstellaModuleName = 'physics' | 'spine' | 'particles' | 'tilemap';

export interface IEstellaService extends IDisposable {
    /** Load the core WASM module from a base path */
    loadCore(wasmBasePath: string): Promise<void>;

    /** Load an optional side module by name */
    loadModule(name: EstellaModuleName): Promise<void>;

    /** The loaded WASM module (undefined until loadCore completes) */
    readonly module: ESEngineModule | undefined;

    /** Whether the core module is loaded and ready */
    readonly isReady: boolean;

    /** Fires when the core module finishes loading */
    readonly onReady: Event<ESEngineModule>;
}

export const IEstellaService = createServiceId<IEstellaService>('IEstellaService');

export class EstellaService implements IEstellaService {
    private _module: ESEngineModule | undefined;
    private _ready = new Emitter<ESEngineModule>();
    private _wasmBasePath = '';

    get module(): ESEngineModule | undefined { return this._module; }
    get isReady(): boolean { return this._module !== undefined; }
    get onReady(): Event<ESEngineModule> { return this._ready.event; }

    async loadCore(wasmBasePath: string): Promise<void> {
        if (this._module) return;

        // Resolve relative paths against the current document location
        const base = new URL(wasmBasePath, globalThis.location?.href ?? 'file:///').href;
        this._wasmBasePath = base.endsWith('/') ? base : base + '/';

        const jsUrl = this._wasmBasePath + 'esengine.js';
        const wasmUrl = this._wasmBasePath + 'esengine.wasm';

        const factory = await this.loadScript(jsUrl);

        this._module = await factory({
            locateFile: (file: string) => {
                if (file.endsWith('.wasm')) return wasmUrl;
                return this._wasmBasePath + file;
            },
        }) as ESEngineModule;

        this._ready.fire(this._module);
    }

    async loadModule(name: EstellaModuleName): Promise<void> {
        if (!this._module) {
            throw new Error(`Cannot load module '${name}' before core is loaded`);
        }

        const fileMap: Record<EstellaModuleName, string> = {
            physics: 'physics.wasm',
            spine: 'spine42.wasm',
            particles: 'particles.wasm',
            tilemap: 'tilemap.wasm',
        };

        const file = fileMap[name];
        if (!file) throw new Error(`Unknown module: ${name}`);

        const url = this._wasmBasePath + file;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);

        const buffer = await response.arrayBuffer();

        // Emscripten side module dynamic loading
        const mod = this._module as Record<string, unknown>;
        if (typeof mod['loadDynamicLibrary'] === 'function') {
            await (mod['loadDynamicLibrary'] as (data: ArrayBuffer) => Promise<void>)(buffer);
        }
    }

    private async loadScript(url: string): Promise<(opts: Record<string, unknown>) => Promise<unknown>> {
        // In Electron, we can use dynamic import for the Emscripten wrapper.
        // The wrapper is a UMD/ESM module that exports a factory.
        const mod = await import(/* @vite-ignore */ url);
        return mod.default ?? mod;
    }

    dispose(): void {
        if (this._module) {
            try {
                this._module.shutdownRenderer();
            } catch { /* may not be initialized */ }
            this._module = undefined;
        }
        this._ready.dispose();
    }
}
