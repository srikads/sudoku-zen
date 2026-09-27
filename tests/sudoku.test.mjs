import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROW, COL, BOX, UNITS, CELL_UNITS, PEERS, parse, stringify, computeCandidates,
  isValidPlacement, conflicts, solve, countSolutions, rng, transform, generate,
  bitCount, digitsOf, cellName,
} from '../js/sudoku.js';

const PUZZLE = '53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79';
const SOLUTION = '534678912672195348198342567859761423426853791713924856961537284287419635345286179';

function isValidSolution(str) {
  const g = parse(str);
  if (g.some((d) => !d)) return false;
  return UNITS.every((u) => new Set(u.map((i) => g[i])).size === 9);
}

test('geometry: units, cell units and peers', () => {
  assert.equal(UNITS.length, 27);
  for (const u of UNITS) assert.equal(new Set(u).size, 9);
  assert.equal(ROW(40), 4); assert.equal(COL(40), 4); assert.equal(BOX(40), 4);
  assert.equal(BOX(80), 8); assert.equal(BOX(3), 1); assert.equal(BOX(27), 3);
  for (let i = 0; i < 81; i++) {
    assert.equal(PEERS[i].length, 20);
    assert.deepEqual(CELL_UNITS[i], [ROW(i), 9 + COL(i), 18 + BOX(i)]);
    for (const u of CELL_UNITS[i]) assert.ok(UNITS[u].includes(i));
  }
  assert.equal(cellName(0), 'r1c1');
  assert.equal(cellName(33), 'r4c7');
});

test('bit helpers', () => {
  assert.equal(bitCount(0), 0);
  assert.equal(bitCount(511), 9);
  assert.deepEqual(digitsOf(0b100000101), [1, 3, 9]);
});

test('parse / stringify round trip', () => {
  const g = parse(PUZZLE);
  assert.equal(g.length, 81);
  assert.equal(g[0], 5); assert.equal(g[2], 0);
  assert.equal(stringify(g), PUZZLE);
  assert.equal(stringify(parse(PUZZLE.replace(/\./g, '0'))), PUZZLE);
});

test('candidates, validity and conflicts', () => {
  const g = parse(PUZZLE);
  const c = computeCandidates(g);
  assert.equal(c[0], 0);
  assert.deepEqual(digitsOf(c[2]), [1, 2, 4]); // r1c3
  assert.ok(isValidPlacement(g, 2, 4));
  assert.ok(!isValidPlacement(g, 2, 5));
  assert.equal(conflicts(g).size, 0);
  g[2] = 5;
  assert.deepEqual([...conflicts(g)].sort((a, b) => a - b), [0, 2]);
});

test('solve and countSolutions', () => {
  assert.equal(stringify(solve(PUZZLE)), SOLUTION);
  assert.equal(countSolutions(PUZZLE), 1);
  assert.equal(countSolutions('.'.repeat(81), 2), 2);
  assert.equal(countSolutions('.'.repeat(81), 5), 5);
  const bad = '55' + '.'.repeat(79);
  assert.equal(solve(bad), null);
  assert.equal(countSolutions(bad), 0);
  // a famously hard puzzle
  const hard = '8..........36......7..9.2...5...7.......457.....1...3...1....68..85...1..9....4..';
  assert.equal(stringify(solve(hard)), '812753649943682175675491283154237896369845721287169534521974368438526917796318452');
});

test('rng is deterministic and in [0,1)', () => {
  const a = rng('hello'), b = rng('hello'), c = rng('world'), n = rng(42);
  const xs = Array.from({ length: 100 }, () => a());
  assert.deepEqual(xs, Array.from({ length: 100 }, () => b()));
  assert.notDeepEqual(xs, Array.from({ length: 100 }, () => c()));
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  assert.equal(typeof n(), 'number');
});

test('transform keeps puzzles valid, unique and consistent with the solution', () => {
  const r = rng('transform');
  for (let k = 0; k < 50; k++) {
    const seed = Math.floor(r() * 1e9);
    const p = transform(PUZZLE, rng(seed));
    const s = transform(SOLUTION, rng(seed));
    assert.equal(p.replace(/\./g, '').length, PUZZLE.replace(/\./g, '').length);
    assert.equal(countSolutions(p), 1);
    assert.ok(isValidSolution(s));
    assert.equal(stringify(solve(p)), s);
  }
});

test('generate produces unique-solution puzzles', () => {
  const r = rng('generate-test');
  for (let k = 0; k < 30; k++) {
    const { puzzle, solution } = generate(r);
    assert.equal(countSolutions(puzzle), 1);
    assert.ok(isValidSolution(solution));
    assert.equal(stringify(solve(puzzle)), solution);
    const g = parse(puzzle), s = parse(solution);
    for (let i = 0; i < 81; i++) if (g[i]) assert.equal(g[i], s[i]);
  }
  // deterministic for a given seed
  assert.deepEqual(generate(rng(7)), generate(rng(7)));
});
