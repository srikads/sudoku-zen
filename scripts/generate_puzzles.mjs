#!/usr/bin/env node
// Generate and grade puzzles for data/puzzles.json.
//
// Usage:
//   node scripts/generate_puzzles.mjs [--budget SECONDS] [--out FILE] [--seed S]
//   node scripts/generate_puzzles.mjs --merge FILE [FILE...] [--cap N]  (merge shards into --out, max N per level, default 300)
//
// Resumable & incremental: existing puzzles in --out (default data/puzzles.json) are kept,
// new ones are merged in and duplicates dropped. Run several processes with different
// --out shard files and --seed values in parallel, then --merge them.
//
// Level acceptance (see rate() in js/techniques.js for the grading itself):
//   Beginner  tier-1 puzzles with clues added back from the solution to 36-40 givens
//   Medium    tier-1 puzzles topped up to 28-32 givens, or tier 2 with few tier-2 steps
//   Hard/Expert/Master  as graded
//   All levels: the grade must be the same for two random symmetry transforms of the puzzle.
//   Extreme   graded tier 6 AND at least two tier-6 steps (so it is clearly harder than Master)

import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { generate, rng, parse, stringify, countSolutions, transform } from '../js/sudoku.js';
import { rate, solveLogically } from '../js/techniques.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = [300, 300, 300, 300, 300, 300];

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};
const OUT = resolve(opt('--out', resolve(ROOT, 'data/puzzles.json')));
const BUDGET = Number(opt('--budget', 300)) * 1000;
const SEED = opt('--seed', String(Date.now()));

function load(file) {
  if (!existsSync(file)) return [[], [], [], [], [], []];
  const j = JSON.parse(readFileSync(file, 'utf8'));
  return Array.from({ length: 6 }, (_, k) => (j.levels && j.levels[k]) || []);
}

function save(file, levels) {
  const tmp = file + '.tmp';
  const body = '{\n  "version": 1,\n  "levels": [\n' +
    levels.map((l) => '    [' + l.map((p) => JSON.stringify(p)).join(',\n     ') + ']').join(',\n') +
    '\n  ]\n}\n';
  writeFileSync(tmp, body);
  renameSync(tmp, file);
}

function merge(into, from, cap = Infinity) {
  const seen = new Set(into.flat());
  for (let k = 0; k < 6; k++) for (const p of from[k]) if (!seen.has(p) && into[k].length < cap) { seen.add(p); into[k].push(p); }
  return into;
}

const counts = (levels) => levels.map((l) => l.length).join(' / ');

if (args.includes('--merge')) {
  const files = [];
  for (let i = args.indexOf('--merge') + 1; i < args.length && !args[i].startsWith('--'); i++) files.push(args[i]);
  const levels = load(OUT);
  const cap = Number(opt('--cap', 300));
  for (const f of files) merge(levels, load(resolve(f)), cap);
  save(OUT, levels);
  console.log(`merged ${files.length} file(s) into ${OUT}: ${counts(levels)}`);
  process.exit(0);
}

/** Add clues from the solution (random cells) until the puzzle has `target` givens. */
function addClues(puzzle, solution, target, rand) {
  const g = parse(puzzle);
  const empties = [];
  for (let i = 0; i < 81; i++) if (!g[i]) empties.push(i);
  for (let i = empties.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [empties[i], empties[j]] = [empties[j], empties[i]];
  }
  let n = 81 - empties.length;
  for (const i of empties) { if (n >= target) break; g[i] = solution.charCodeAt(i) - 48; n++; }
  return stringify(g);
}

const levels = load(OUT);
const seen = new Set(levels.flat());
const rand = rng(`gen:${SEED}`);
const start = Date.now();
let lastSave = start, generated = 0, added = 0;

function accept(level, puzzle) {
  if (level < 0 || levels[level].length >= TARGETS[level] || seen.has(puzzle)) return false;
  // grading must be stable under symmetry transforms (the app always transforms)
  for (let k = 0; k < 2; k++) if (rate(transform(puzzle, rand)).level !== level) return false;
  seen.add(puzzle); levels[level].push(puzzle); added++;
  return true;
}

console.log(`start ${OUT}: ${counts(levels)} (seed ${SEED}, budget ${BUDGET / 1000}s)`);
while (Date.now() - start < BUDGET && levels.some((l, k) => l.length < TARGETS[k])) {
  const { puzzle, solution } = generate(rand);
  generated++;
  const r = rate(puzzle);
  if (r.level < 0) continue;
  if (r.maxTier <= 1) {
    if (levels[0].length < TARGETS[0]) {
      const p = addClues(puzzle, solution, 36 + Math.floor(rand() * 5), rand);
      if (rate(p).level === 0) accept(0, p);
    }
    if (levels[1].length < TARGETS[1]) {
      const p = r.givens < 28 ? addClues(puzzle, solution, 28 + Math.floor(rand() * 5), rand) : puzzle;
      if (rate(p).level === 1) accept(1, p);
    }
  } else if (r.level === 5) {
    const t6 = solveLogically(puzzle).steps.filter((s) => s.tier === 6).length;
    if (t6 >= 2) accept(5, puzzle);
  } else {
    accept(r.level, puzzle);
  }
  if (Date.now() - lastSave > 15000) {
    save(OUT, levels);
    lastSave = Date.now();
    console.log(`${((Date.now() - start) / 1000).toFixed(0)}s generated ${generated}: ${counts(levels)}`);
  }
}
// final sanity: every stored puzzle must be unique
for (const l of levels) for (const p of l) if (countSolutions(p, 2) !== 1) throw new Error('non-unique puzzle ' + p);
save(OUT, levels);
console.log(`done in ${((Date.now() - start) / 1000).toFixed(0)}s, generated ${generated}, added ${added}: ${counts(levels)}`);
