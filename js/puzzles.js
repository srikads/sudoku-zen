// Sudoku Zen — puzzle pool: loads data/puzzles.json, picks + transforms puzzles,
// deterministic daily puzzle. Works in browsers (fetch) and Node (setPool).

import { rng, transform, solve, stringify } from './sudoku.js';

export const LEVELS = ['Beginner', 'Medium', 'Hard', 'Expert', 'Master', 'Extreme'];
export const DAILY_LEVELS = [2, 3, 4, 5];
const EPOCH = Date.UTC(2026, 0, 1);

let pool = null;
let loading = null;

/** Inject a pool object ({version, levels:[[str...] x6]}); used by tests and loadPool. */
export function setPool(obj) {
  if (!obj || !Array.isArray(obj.levels) || obj.levels.length !== 6) throw new Error('Invalid puzzle pool');
  pool = obj.levels.map((l) => l.slice());
}

export function hasPool() {
  return pool !== null;
}

export function loadPool(url = 'data/puzzles.json') {
  if (pool) return Promise.resolve();
  if (!loading) {
    loading = fetch(url)
      .then((r) => { if (!r.ok) throw new Error(`Failed to load puzzles (${r.status})`); return r.json(); })
      .then((j) => setPool(j))
      .catch((e) => { loading = null; throw e; });
  }
  return loading;
}

function requirePool() {
  if (!pool) throw new Error('Puzzle pool not loaded; call loadPool() first');
  return pool;
}

/** Nearest non-empty level (prefers the requested one, then lower, then higher). */
function levelWithPuzzles(level) {
  const p = requirePool();
  const order = [level];
  for (let k = 1; k < 6; k++) order.push(level - k, level + k);
  for (const l of order) if (l >= 0 && l < 6 && p[l].length) return l;
  throw new Error('Puzzle pool is empty');
}

function build(str, rand) {
  const puzzle = transform(str, rand);
  const sol = solve(puzzle);
  return { puzzle, solution: stringify(sol) };
}

/** Random pool entry of the given level with a random symmetry transform. */
export function randomPuzzle(level, rand = Math.random) {
  const l = levelWithPuzzles(level);
  const list = pool[l];
  const src = list[Math.floor(rand() * list.length)];
  return build(src, rng(Math.floor(rand() * 4294967296)));
}

/** Days since 2026-01-01 for an ISO date "YYYY-MM-DD" (UTC calendar date). */
export function dayNumber(dateISO) {
  const [y, m, d] = String(dateISO).slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - EPOCH) / 86400000);
}

export function dailyLevel(dateISO) {
  const n = dayNumber(dateISO);
  return DAILY_LEVELS[((n % 4) + 4) % 4];
}

/** Deterministic daily puzzle: level cycles Hard, Expert, Master, Extreme by day number. */
export function dailyPuzzle(dateISO) {
  const date = String(dateISO).slice(0, 10);
  const level = levelWithPuzzles(dailyLevel(date));
  const rand = rng(`sudoku-zen-daily:${date}`);
  const list = pool[level];
  const src = list[Math.floor(rand() * list.length)];
  return { ...build(src, rand), level };
}
