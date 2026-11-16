// main.ts — EMBER YARD v3 entry program (threejs-fps-02).
// Copies game/ and screenshots/ from this repository into the output
// directory and writes /output/dossier.json with buildDossier from
// vendor/makefun-threejs.ts. Standard library only; no network.
// The program is deterministic: two runs write byte-identical output.
import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const REPO_ROOT = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR || '/output';

// The gate's caps, from the competition rules (RULES.txt, "The gate").
const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 48 * 1024 * 1024,
  game_path_max_bytes: 1000,
};

function copyTree(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src).sort()) {
    const from = join(src, entry);
    const to = join(dst, entry);
    const st = statSync(from);
    if (st.isDirectory()) copyTree(from, to);
    else if (st.isFile()) cpSync(from, to);
  }
}

function main() {
  const gameSrc = join(REPO_ROOT, 'game');
  const shotsSrc = join(REPO_ROOT, 'screenshots');
  if (!existsSync(gameSrc)) throw new Error('main.ts: game/ is missing from the repository');
  if (!existsSync(shotsSrc)) throw new Error('main.ts: screenshots/ is missing from the repository');
  mkdirSync(OUT_DIR, { recursive: true });
  copyTree(gameSrc, join(OUT_DIR, 'game'));
  copyTree(shotsSrc, join(OUT_DIR, 'screenshots'));
  const dossier = buildDossier(OUT_DIR, CAPS);
  writeFileSync(join(OUT_DIR, 'dossier.json'), dossier);
  console.log(`wrote ${OUT_DIR}/dossier.json (${dossier.length} bytes)`);
}

main();
