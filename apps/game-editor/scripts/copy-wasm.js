#!/usr/bin/env node
/**
 * Copy estella's runtime artifacts into apps/game-editor/wasm/.
 *
 * The editor serves these via the `estella://` protocol at runtime. Three
 * files make up the full runtime:
 *
 *   esengine.js          — Emscripten glue (loads the WASM and exposes its
 *                          exports under a JS API the editor calls via
 *                          EstellaService.loadCore).
 *   esengine.wasm        — compiled C++ engine (components, physics bridge,
 *                          rendering primitives).
 *   esengine.bundled.js  — TypeScript runtime SDK bundled to one ESM file
 *                          (App, Plugin, Schedule, systems…). Only needed
 *                          when Play mode runs, but downloading at startup
 *                          avoids the first-play pause.
 *
 * Run via `pnpm run copy:wasm` whenever the vendored estella SDK updates.
 */
import { cpSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const vendor = resolve(here, '../../../vendor/estella');
const wasmDir = resolve(here, '../wasm');
mkdirSync(wasmDir, { recursive: true });

// [source absolute path, destination filename inside wasm/]
const copies = [
  [join(vendor, 'desktop/public/wasm/esengine.js'), 'esengine.js'],
  [join(vendor, 'desktop/public/wasm/esengine.wasm'), 'esengine.wasm'],
  [join(vendor, 'desktop/public/sdk/esm/esengine.bundled.js'), 'esengine.bundled.js'],
];

let copied = 0;
let missing = 0;
for (const [src, dstName] of copies) {
  const dst = join(wasmDir, dstName);
  try {
    statSync(src);
  } catch {
    console.warn(`[copy-wasm] MISSING: ${src}`);
    missing++;
    continue;
  }
  cpSync(src, dst);
  console.log(`[copy-wasm] ${dstName}  ←  ${src}`);
  copied++;
}

console.log(`[copy-wasm] ${String(copied)} copied, ${String(missing)} missing.`);
if (missing > 0) {
  // Non-zero exit so CI fails loudly when the vendor tree drifts.
  process.exit(1);
}
