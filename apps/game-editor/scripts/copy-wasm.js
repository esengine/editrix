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
import { cpSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const vendor = resolve(here, '../../../vendor/estella');
const wasmDir = resolve(here, '../wasm');
mkdirSync(wasmDir, { recursive: true });

// [source absolute path, destination filename inside wasm/]
// Paths track the current CMake layout: `build-web/sdk/esengine.{js,wasm}`
// for the wasm runtime + glue, `sdk/dist/index.bundled.js` for the rollup
// output.
const copies = [
  [join(vendor, 'build-web/sdk/esengine.js'), 'esengine.js'],
  [join(vendor, 'build-web/sdk/esengine.wasm'), 'esengine.wasm'],
  [join(vendor, 'sdk/dist/index.bundled.js'), 'esengine.bundled.js'],
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

// Warn if the wasm binary predates ecs component sources. The most common
// cause of "my C++ change doesn't show up" is running the editor before
// rebuilding wasm — surface it loudly here instead of silent-shipping the
// stale binary.
const wasmPath = join(wasmDir, 'esengine.wasm');
try {
  const wasmMTime = statSync(wasmPath).mtimeMs;
  const componentsDir = join(vendor, 'src/esengine/ecs/components');
  let newestHpp = 0;
  for (const name of readdirSync(componentsDir)) {
    const m = statSync(join(componentsDir, name)).mtimeMs;
    if (m > newestHpp) newestHpp = m;
  }
  if (newestHpp > wasmMTime) {
    console.warn('\n[copy-wasm] WARNING: esengine.wasm is older than an ecs/components/*.hpp.');
    console.warn(
      '[copy-wasm]   Rebuild wasm first:  cd vendor/estella && node build-tools/cli.js build -t web',
    );
    console.warn('[copy-wasm]   Then re-run:         pnpm run copy:wasm\n');
  }
} catch {
  // Best-effort check — not worth failing the build if stat fails.
}
