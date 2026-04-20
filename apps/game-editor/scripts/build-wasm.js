#!/usr/bin/env node

/**
 * Build estella WASM modules for the game editor.
 *
 * Usage:
 *   node scripts/build-wasm.js              # Build core only
 *   node scripts/build-wasm.js --all        # Build core + all optional modules
 *   node scripts/build-wasm.js --physics    # Build core + physics
 */

import { execSync } from 'child_process';
import { cpSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ESTELLA = path.resolve(ROOT, '../../vendor/estella');
const CLI = path.resolve(ESTELLA, 'build-tools/cli.js');
const OUTPUT = path.resolve(ROOT, 'wasm');

const TARGETS = {
  core: { flag: 'web', files: ['esengine.js', 'esengine.wasm'] },
  physics: { flag: 'physics', files: ['physics.js', 'physics.wasm'] },
  spine: { flag: 'spine', files: ['spine42.js', 'spine42.wasm'] },
};

const args = process.argv.slice(2);
const buildAll = args.includes('--all');
const targetNames = buildAll
  ? Object.keys(TARGETS)
  : ['core', ...Object.keys(TARGETS).filter((t) => t !== 'core' && args.includes(`--${t}`))];

mkdirSync(OUTPUT, { recursive: true });

for (const name of targetNames) {
  const target = TARGETS[name];
  console.log(`\n--- Building ${name} (target: ${target.flag}) ---`);

  try {
    execSync(`node ${CLI} build -t ${target.flag}`, {
      cwd: ESTELLA,
      stdio: 'inherit',
    });
  } catch {
    console.error(`Failed to build ${name}`);
    process.exit(1);
  }

  // Copy outputs to editor wasm directory
  for (const file of target.files) {
    const src = path.join(ESTELLA, 'build/wasm/web', file);
    if (!existsSync(src)) {
      // Try sdk output path
      const altSrc = path.join(ESTELLA, 'sdk', file);
      if (existsSync(altSrc)) {
        cpSync(altSrc, path.join(OUTPUT, file));
        console.log(`  Copied ${file}`);
        continue;
      }
      console.warn(`  Warning: ${file} not found`);
      continue;
    }
    cpSync(src, path.join(OUTPUT, file));
    console.log(`  Copied ${file}`);
  }
}

console.log(`\nWASM build complete → ${OUTPUT}`);
