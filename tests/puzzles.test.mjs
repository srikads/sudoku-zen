import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, solve, stringify, countSolutions, UNITS, rng } from '../js/sudoku.js';
import { rate } from '../js/techniques.js';
import { LEVELS, setPool, randomPuzzle, dailyPuzzle, dayNumber, dailyLevel } from '../js/puzzles.js';

const POOL = JSON.parse(readFileSync(new URL('../data/puzzles.json', import.meta.url), 'utf8'));
setPool(POOL);

function assertPair({ puzzle, solution }) {
  assert.equal(puzzle.length, 81);
  assert.equal(solution.length, 81);
  const g = parse(puzzle), s = parse(solution);
  assert.ok(UNITS.every((u) => new Set(u.map((i) => s[i])).size === 9 && !u.some((i) => !s[i])));
  for (let i = 0; i < 81; i++) if (g[i]) assert.equal(g[i], s[i]);
  assert.equal(countSolutions(puzzle), 1);
}

test('LEVELS', () => {
  assert.deepEqual(LEVELS, ['Beginner', 'Medium', 'Hard', 'Expert', 'Master', 'Extreme']);
});

test('pool file format and sizes', () => {
  assert.equal(POOL.version, 1);
  assert.equal(POOL.levels.length, 6);
  POOL.levels.forEach((l, k) => assert.ok(l.length >= 40, `${LEVELS[k]} has only ${l.length}`));
  const all = POOL.levels.flat();
  assert.equal(new Set(all).size, all.length, 'no duplicates');
  for (const p of all) assert.match(p, /^[1-9.]{81}$/);
});

test('every pool puzzle is unique and rates to its level', () => {
  POOL.levels.forEach((list, level) => {
    for (const p of list) {
      assert.equal(countSolutions(p), 1, p);
      const r = rate(p);
      assert.ok(r.solved, p);
      assert.equal(r.level, level, `${p} rated ${r.level}, stored as ${level}`);
    }
  });
});

test('randomPuzzle returns a valid transformed puzzle of the requested level', () => {
  const r = rng('random-puzzle');
  for (let level = 0; level < 6; level++) {
    for (let k = 0; k < 5; k++) {
      const p = randomPuzzle(level, r);
      assertPair(p);
      assert.equal(stringify(solve(p.puzzle)), p.solution);
    }
  }
  // deterministic when given a seeded generator
  assert.deepEqual(randomPuzzle(3, rng(5)), randomPuzzle(3, rng(5)));
  // works with the default Math.random too
  assertPair(randomPuzzle(0));
});

test('dayNumber and daily level cycle Hard, Expert, Master, Extreme', () => {
  assert.equal(dayNumber('2026-01-01'), 0);
  assert.equal(dayNumber('2026-01-02'), 1);
  assert.equal(dayNumber('2026-12-31'), 364);
  assert.equal(dayNumber('2025-12-31'), -1);
  const expected = [2, 3, 4, 5];
  for (let n = 0; n < 12; n++) {
    const d = new Date(Date.UTC(2026, 0, 1 + n)).toISOString().slice(0, 10);
    assert.equal(dailyLevel(d), expected[n % 4]);
    assert.equal(dailyPuzzle(d).level, expected[n % 4]);
  }
  assert.equal(dailyLevel('2025-12-31'), 5);
});

test('dailyPuzzle is deterministic, valid and varies by day', () => {
  const a = dailyPuzzle('2026-03-15');
  const b = dailyPuzzle('2026-03-15');
  assert.deepEqual(a, b);
  assertPair(a);
  const seen = new Set();
  for (let n = 0; n < 30; n++) {
    const d = new Date(Date.UTC(2026, 5, 1 + n)).toISOString().slice(0, 10);
    const p = dailyPuzzle(d);
    assertPair(p);
    seen.add(p.puzzle);
    const r = rate(p.puzzle);
    assert.equal(r.level, p.level, `daily ${d} graded ${r.level}`);
  }
  assert.equal(seen.size, 30);
});

test('setPool rejects malformed pools', () => {
  assert.throws(() => setPool({ version: 1, levels: [[]] }));
  setPool(POOL);
});
