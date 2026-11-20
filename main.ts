// token-radar-01 — the entry's program.
//
// What it does, in order:
//   1. reads the sealed snapshot (/input/snapshot.json, or --input <file|dir>, or MAKEFUN_INPUT_DIR);
//   2. scores it with the model in lib/model.ts into a ranked board of pre-token protocols;
//   3. writes /output/board.json, the dashboard's data.js, the dashboard/ and screenshots/
//      directories, and /output/dossier.json through the vendored make.fun library.
//
// The board it writes is one the gate takes: every watchlist slug covered, ranks 1..N, implied
// value that never rises as rank ascends, and 3-12 farm steps of 20-600 characters per row.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

/** Where this repository's own dashboard/ and screenshots/ live. */
const here = fileURLToPath(new URL('.', import.meta.url));

/** The dossier's text cap: source past it is cut, so the dashboard's page stays small. */
const TEXT_MAX_BYTES = 65_536;

/** --name <value> out of the arguments, or `fallback` when the flag is absent. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

// The snapshot's location: /input inside the grader, a path of our own outside it.
const inputArg = arg('input', process.env.MAKEFUN_INPUT_DIR ?? '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile} — pass --input <snapshot.json|dir> or mount /input\n`);
  process.exit(2);
}

// Where everything lands: /output inside the grader, MAKEFUN_OUTPUT_DIR outside it.
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

// Read, score, and refuse our own mistakes before anything is written.
const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping dot-names the gate refuses. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3 || shots.length > 4) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} images — hand in 3 or 4\n`);
  process.exit(1);
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ` +
    `${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote board.json, data.js, dashboard/, screenshots/ (${shots.length} images) and dossier.json\n`,
);
