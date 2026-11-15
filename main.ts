// EMBER YARD v2 — entry program for threejs-fps-02.
//
// Copies game/ and screenshots/ from this repository into the output
// directory and writes dossier.json with the kit's buildDossier library.
// Node 22 standard library only, no network, no timestamps: the same
// repository always writes the same bytes, so the grader's two runs agree.

import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

// The gate's caps, exactly as the kit's vendor header documents them.
const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Copy one top-level tree of the repository into the output directory,
// replacing whatever was there, so a stale file can never survive.
function copyTree(name: string): void {
  const from = join(ROOT, name);
  const to = join(OUT, name);
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
}

function main(): void {
  mkdirSync(OUT, { recursive: true });
  copyTree('game');
  copyTree('screenshots');
  const dossier = buildDossier(OUT, CAPS);
  writeFileSync(join(OUT, 'dossier.json'), dossier);
  console.log(`ember-yard-v2: dossier ${dossier.length} bytes -> ${OUT}`);
}

main();
