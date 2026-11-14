// EMBER YARD — entry program for make.fun threejs-fps-02.
//
// Copies the playable game (game/) and its screenshots (screenshots/) from
// this repository into the output directory and writes dossier.json with the
// kit's buildDossier library. Node 22, standard library only.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// The program is deterministic: directory entries are visited in sorted
// order and every byte copied is a byte from the repository, so two runs
// over the same commit write byte-identical output.
import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)));
const OUTPUT_DIR = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

// The gate's own limits, passed straight through to the dossier builder so
// the file it writes is the file the gate rebuilds and compares byte for byte.
const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 256 * 1024 },
  game_max_files: 993,
  game_max_bytes: 48 * 1024 * 1024,
  game_path_max_bytes: 1000,
} as const;

/** Copy one tree into the output dir, visiting entries in sorted order. */
function copyTree(sourceDir: string, targetDir: string): number {
  let copied = 0;
  const walk = (from: string, to: string): void => {
    mkdirSync(to, { recursive: true });
    for (const name of readdirSync(from).sort()) {
      const fromPath = join(from, name);
      const toPath = join(to, name);
      if (statSync(fromPath).isDirectory()) {
        walk(fromPath, toPath);
      } else {
        cpSync(fromPath, toPath);
        copied += 1;
      }
    }
  };
  walk(sourceDir, targetDir);
  return copied;
}

/** The entrypoint: stage the game, build the dossier, report what landed. */
function main(): void {
  const gameDir = join(REPO_ROOT, 'game');
  const shotsDir = join(REPO_ROOT, 'screenshots');
  if (!existsSync(join(gameDir, 'index.html'))) {
    throw new Error('main.ts: game/index.html is missing from the repository');
  }
  const shotNames = existsSync(shotsDir)
    ? readdirSync(shotsDir).sort().filter((n) => !n.startsWith('.'))
    : [];
  if (shotNames.length < 3 || shotNames.length > 4) {
    throw new Error(`main.ts: screenshots/ must hold 3 or 4 images, found ${shotNames.length}`);
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const gameFiles = copyTree(gameDir, join(OUTPUT_DIR, 'game'));
  const shotFiles = copyTree(shotsDir, join(OUTPUT_DIR, 'screenshots'));

  const dossier = buildDossier(OUTPUT_DIR, CAPS);
  if (dossier.length > 1536 * 1024) {
    throw new Error(`main.ts: dossier.json ${dossier.length} bytes exceeds the 1.5 MiB cap`);
  }
  writeFileSync(join(OUTPUT_DIR, 'dossier.json'), dossier);
  console.log(
    `ember-yard: ${gameFiles} game files, ${shotFiles} screenshots ` +
      `(${shotNames.join(', ')}), dossier.json ${dossier.length} bytes -> ${OUTPUT_DIR}`,
  );
}

main();
