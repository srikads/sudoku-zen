import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { parse, stringify, solve, generate, rng, transform, computeCandidates, cellName } from '../js/sudoku.js';
import { TECHNIQUES, nextStep, solveLogically, rate, hint, applyStep, findStep } from '../js/techniques.js';

const EXPECTED_IDS = {
  1: ['full_house', 'naked_single', 'hidden_single'],
  2: ['pointing', 'claiming', 'naked_pair', 'hidden_pair'],
  3: ['naked_triple', 'hidden_triple', 'naked_quad', 'hidden_quad'],
  4: ['x_wing', 'skyscraper', 'two_string_kite', 'empty_rectangle', 'xy_wing', 'w_wing', 'simple_coloring'],
  5: ['swordfish', 'jellyfish', 'finned_x_wing', 'finned_swordfish', 'xyz_wing', 'unique_rectangle', 'bug_plus_one', 'x_chain'],
  6: ['xy_chain', 'wxyz_wing', 'aic', 'forcing_chain'],
};

// Positions mined with the solver: in each puzzle, solveLogically uses the technique.
const EXAMPLES = {
  full_house: '..3..58..6.......1...8......97..4..22....3......5...8..4.3.96....5....9.7....2.4.',
  naked_single: '..3..58..6.......1...8......97..4..22....3......5...8..4.3.96....5....9.7....2.4.',
  hidden_single: '..3..58..6.......1...8......97..4..22....3......5...8..4.3.96....5....9.7....2.4.',
  pointing: '..3..58..6.......1...8......97..4..22....3......5...8..4.3.96....5....9.7....2.4.',
  claiming: '.8..7..9....8..6...324..5.........2.1..26.9...5.1.3...3....1..5.256...4.4........',
  naked_pair: '..3..58..6.......1...8......97..4..22....3......5...8..4.3.96....5....9.7....2.4.',
  hidden_pair: '..3..58..6.......1...8......97..4..22....3......5...8..4.3.96....5....9.7....2.4.',
  naked_triple: '...3.68.2.7.....4.8..45..1.5..2.8..4..6.1.5....................48...52.6263.....1',
  hidden_triple: '...8..13...4.....5....96...9...7...3.....5427....1....23..8..7..7.....5.4....3..6',
  naked_quad: '......49.1.6...7.....2.83..46.....3.2...5..8...5..1.4..51..7....8...4......6.3...',
  hidden_quad: '...95.3...9..734.5..1.....6.....4..8..62...3..2..3......2..7...64.......3..496...',
  x_wing: '.8..7..9....8..6...324..5.........2.1..26.9...5.1.3...3....1..5.256...4.4........',
  skyscraper: '..3..58..6.......1...8......97..4..22....3......5...8..4.3.96....5....9.7....2.4.',
  two_string_kite: '..3..58..6.......1...8......97..4..22....3......5...8..4.3.96....5....9.7....2.4.',
  empty_rectangle: '.8..7..9....8..6...324..5.........2.1..26.9...5.1.3...3....1..5.256...4.4........',
  xy_wing: '..3..58..6.......1...8......97..4..22....3......5...8..4.3.96....5....9.7....2.4.',
  w_wing: '.8..7..9....8..6...324..5.........2.1..26.9...5.1.3...3....1..5.256...4.4........',
  simple_coloring: '.693.....753....9...8.9...6.2.7....48.......23....4.8.5...2.1...9....248.....975.',
  swordfish: '..45.62..2...4..51..1....9.....67........9.....81....51....3.8.4......32..7.8...6',
  jellyfish: '.....7....814..7..4.5..3.1..36..58..5.......6..83..57..6.8..4.2..7..496....6.....',
  finned_x_wing: '3...4.....42...5....8.95..2...9.....2..678..9.....2...9..78.2....6...98.....3...7',
  finned_swordfish: '3...4.....42...5....8.95..2...9.....2..678..9.....2...9..78.2....6...98.....3...7',
  xyz_wing: '6..9....2....561..4....7.8..46.......1...5..75.78....12....9......5.2..89..37..5.',
  unique_rectangle: '3...4.....42...5....8.95..2...9.....2..678..9.....2...9..78.2....6...98.....3...7',
  bug_plus_one: '36.2....89..1..2...4..9...6...8.96.3....4....8.93.2...7...8..2...6..3..72....1.69',
  x_chain: '.8..7..9....8..6...324..5.........2.1..26.9...5.1.3...3....1..5.256...4.4........',
  xy_chain: '..3..58..6.......1...8......97..4..22....3......5...8..4.3.96....5....9.7....2.4.',
  wxyz_wing: '..9..7..21...8.......2..983.4.8....15..1.2..99....5.2.365..4.......3...42..9..3..',
  aic: '..3..58..6.......1...8......97..4..22....3......5...8..4.3.96....5....9.7....2.4.',
  forcing_chain: '..3..58..6.......1...8......97..4..22....3......5...8..4.3.96....5....9.7....2.4.',
};

const VALID_CELL_ROLES = new Set(['base', 'cover', 'pivot', 'pincer', 'fin', 'target']);
const VALID_CAND_ROLES = new Set(['key', 'elim', 'place', 'colorA', 'colorB']);

function assertStepShape(s) {
  assert.equal(typeof s.technique, 'string');
  assert.equal(typeof s.name, 'string');
  assert.equal(typeof s.tier, 'number');
  assert.ok(Array.isArray(s.placements) && Array.isArray(s.eliminations));
  assert.ok(s.placements.length + s.eliminations.length > 0, 'step makes progress');
  const h = s.highlight;
  assert.ok(Array.isArray(h.units) && Array.isArray(h.cells) && Array.isArray(h.cands) && Array.isArray(h.links));
  for (const u of h.units) assert.ok(u >= 0 && u < 27);
  for (const c of h.cells) assert.ok(VALID_CELL_ROLES.has(c.role), `cell role ${c.role}`);
  for (const c of h.cands) assert.ok(VALID_CAND_ROLES.has(c.role), `cand role ${c.role}`);
  for (const l of h.links) assert.ok(l.from && l.to && typeof l.strong === 'boolean');
  for (const e of s.eliminations) assert.ok(h.cands.some((c) => c.cell === e.cell && c.digit === e.digit && c.role === 'elim'), 'elim highlighted');
  for (const p of s.placements) assert.ok(h.cands.some((c) => c.cell === p.cell && c.digit === p.digit && c.role === 'place'), 'placement highlighted');
  assert.match(s.text, /r\dc\d/);
}

function assertSound(puzzle, steps, sol) {
  for (const s of steps) {
    for (const p of s.placements) assert.equal(p.digit, sol[p.cell], `${s.technique} placed wrong digit in ${puzzle}: ${s.text}`);
    for (const e of s.eliminations) assert.notEqual(e.digit, sol[e.cell], `${s.technique} removed solution digit in ${puzzle}: ${s.text}`);
  }
}

test('TECHNIQUES table covers every id with correct tiers, ordered by tier', () => {
  const ids = TECHNIQUES.map((t) => t.id);
  for (const [tier, list] of Object.entries(EXPECTED_IDS)) {
    for (const id of list) {
      const t = TECHNIQUES.find((x) => x.id === id);
      assert.ok(t, `missing ${id}`);
      assert.equal(t.tier, Number(tier), id);
      assert.equal(typeof t.find, 'function');
      assert.equal(typeof t.name, 'string');
    }
  }
  assert.equal(ids.length, Object.values(EXPECTED_IDS).flat().length);
  for (let i = 1; i < TECHNIQUES.length; i++) assert.ok(TECHNIQUES[i].tier >= TECHNIQUES[i - 1].tier);
  assert.equal(TECHNIQUES[TECHNIQUES.length - 1].id, 'forcing_chain');
});

for (const [id, puzzle] of Object.entries(EXAMPLES)) {
  test(`technique ${id}: used soundly on a mined position`, () => {
    const sol = solve(puzzle);
    const res = solveLogically(puzzle);
    assert.ok(res.solved);
    assert.equal(stringify(res.grid), stringify(sol));
    const uses = res.steps.filter((s) => s.technique === id);
    assert.ok(uses.length > 0, `${id} not used`);
    for (const s of uses) assertStepShape(s);
    assertSound(puzzle, res.steps, sol);
  });
}

// ---------------------------------------------------------------------------
// Textbook positions built directly from candidate masks.

const ALL = 511, B = (...ds) => ds.reduce((m, d) => m | (1 << (d - 1)), 0);
const idx = (r, c) => (r - 1) * 9 + (c - 1);
const ROWS = (i) => (i / 9) | 0;

test('textbook: full house, naked single, hidden single', () => {
  const sol = parse('534678912672195348198342567859761423426853791713924856961537284287419635345286179');
  const g = sol.slice(); g[idx(1, 1)] = 0;
  let s = nextStep(g, computeCandidates(g));
  assert.equal(s.technique, 'full_house');
  assert.deepEqual(s.placements, [{ cell: 0, digit: 5 }]);

  const g2 = sol.slice(); g2[idx(1, 1)] = 0; g2[idx(1, 2)] = 0; g2[idx(2, 1)] = 0; g2[idx(2, 2)] = 0;
  // no unit has a single hole, each cell has one candidate -> naked single first
  s = nextStep(g2, computeCandidates(g2));
  assert.equal(s.technique, 'naked_single');
  assert.deepEqual(s.placements, [{ cell: 0, digit: 5 }]);

  // hidden single: 1 only possible in r1c1 of row 1 by candidates
  const grid = new Array(81).fill(0);
  const c = new Array(81).fill(ALL & ~B(1));
  c[idx(1, 1)] = B(1, 2, 3);
  s = findStep('hidden_single', grid, c);
  assert.equal(s.technique, 'hidden_single');
  assert.deepEqual(s.placements, [{ cell: 0, digit: 1 }]);
});

test('textbook: pointing and claiming', () => {
  const grid = new Array(81).fill(0);
  const c = new Array(81).fill(ALL);
  // in box 1, 4 only in row 1 (r1c1, r1c2)
  for (const i of [idx(1, 3), idx(2, 1), idx(2, 2), idx(2, 3), idx(3, 1), idx(3, 2), idx(3, 3)]) c[i] &= ~B(4);
  const s = findStep('pointing', grid, c);
  assert.equal(s.technique, 'pointing');
  assert.deepEqual(s.eliminations.map((e) => cellName(e.cell)), ['r1c4', 'r1c5', 'r1c6', 'r1c7', 'r1c8', 'r1c9']);
  assert.ok(s.eliminations.every((e) => e.digit === 4));

  const c2 = new Array(81).fill(ALL);
  // in row 5, 7 only in box 5
  for (let col = 1; col <= 9; col++) if (col < 4 || col > 6) c2[idx(5, col)] &= ~B(7);
  const s2 = findStep('claiming', grid, c2);
  assert.equal(s2.technique, 'claiming');
  assert.deepEqual(s2.eliminations.map((e) => cellName(e.cell)), ['r4c4', 'r4c5', 'r4c6', 'r6c4', 'r6c5', 'r6c6']);
});

test('textbook: naked pair and hidden pair', () => {
  const grid = new Array(81).fill(0);
  const c = new Array(81).fill(ALL);
  c[idx(1, 1)] = B(2, 8); c[idx(1, 5)] = B(2, 8);
  const s = findStep('naked_pair', grid, c);
  assert.equal(s.eliminations.length, 14); // 2 and 8 from the other 7 cells of row 1
  assert.ok(s.eliminations.every((e) => ROWS(e.cell) === 0 && (e.digit === 2 || e.digit === 8)));

  const c2 = new Array(81).fill(ALL);
  for (let col = 3; col <= 9; col++) c2[idx(9, col)] &= ~B(3, 6);
  const s2 = findStep('hidden_pair', grid, c2);
  assert.deepEqual([...new Set(s2.eliminations.map((e) => cellName(e.cell)))], ['r9c1', 'r9c2']);
  assert.ok(s2.eliminations.every((e) => e.digit !== 3 && e.digit !== 6));
});

test('textbook: X-Wing', () => {
  const grid = new Array(81).fill(0);
  const c = new Array(81).fill(ALL);
  for (const r of [2, 6]) for (let col = 1; col <= 9; col++) if (col !== 3 && col !== 8) c[idx(r, col)] &= ~B(7);
  const s = findStep('x_wing', grid, c);
  assert.equal(s.technique, 'x_wing');
  assert.equal(s.eliminations.length, 14);
  assert.ok(s.eliminations.every((e) => e.digit === 7 && [2, 7].includes(e.cell % 9) && ![1, 5].includes(ROWS(e.cell))));
  assert.match(s.text, /X-Wing on 7 in rows 2 and 6 \(columns 3 and 8\)/);
});

test('textbook: XY-Wing', () => {
  const grid = new Array(81).fill(0);
  const c = new Array(81).fill(ALL);
  c[idx(1, 1)] = B(1, 2); c[idx(1, 5)] = B(1, 3); c[idx(5, 1)] = B(2, 3);
  const s = findStep('xy_wing', grid, c);
  assert.equal(s.technique, 'xy_wing');
  assert.deepEqual(s.eliminations, [{ cell: idx(5, 5), digit: 3 }]);
  assert.ok(s.highlight.cells.some((x) => x.cell === 0 && x.role === 'pivot'));
});

test('textbook: Unique Rectangle type 1', () => {
  const grid = new Array(81).fill(0);
  const c = new Array(81).fill(ALL);
  c[idx(1, 1)] = B(1, 2); c[idx(1, 2)] = B(1, 2); c[idx(4, 1)] = B(1, 2); c[idx(4, 2)] = B(1, 2, 5);
  const s = findStep('unique_rectangle', grid, c);
  assert.equal(s.technique, 'unique_rectangle');
  assert.deepEqual(s.eliminations, [{ cell: idx(4, 2), digit: 1 }, { cell: idx(4, 2), digit: 2 }]);
});

// ---------------------------------------------------------------------------

test('soundness fuzz: every step of solveLogically agrees with the solution', () => {
  const r = rng('soundness-fuzz');
  const puzzles = [];
  for (let k = 0; k < 250; k++) puzzles.push(generate(r).puzzle);
  const poolFile = new URL('../data/puzzles.json', import.meta.url);
  if (existsSync(poolFile)) {
    const pool = JSON.parse(readFileSync(poolFile, 'utf8'));
    for (const level of [3, 4, 5]) puzzles.push(...pool.levels[level].slice(0, 40).map((p) => transform(p, r)));
  }
  const used = new Set();
  for (const p of puzzles) {
    const sol = solve(p);
    const res = solveLogically(p);
    assertSound(p, res.steps, sol);
    for (const s of res.steps) used.add(s.technique);
    if (res.solved) assert.equal(stringify(res.grid), stringify(sol));
  }
  assert.ok(used.size >= 15, `only ${used.size} techniques exercised`);
});

test('soundness fuzz: hints from random mid-game states with random (valid) notes', () => {
  const r = rng('hint-fuzz');
  for (let k = 0; k < 60; k++) {
    const { puzzle, solution } = generate(r);
    const sol = parse(solution);
    const g = parse(puzzle);
    // fill some cells correctly
    for (let i = 0; i < 81; i++) if (!g[i] && r() < 0.3) g[i] = sol[i];
    const cands = computeCandidates(g);
    const notes = cands.map((m, i) => {
      if (!m || r() < 0.5) return 0;
      let n = m;
      for (let d = 1; d <= 9; d++) if (d !== sol[i] && r() < 0.3) n &= ~(1 << (d - 1));
      if (r() < 0.1) n &= ~(1 << (sol[i] - 1)); // a wrong note set (missing the answer) must be ignored
      return n;
    });
    const h = hint(g, notes, sol);
    assert.ok(h, 'hint available');
    for (const p of h.placements) assert.equal(p.digit, sol[p.cell]);
    for (const e of h.eliminations) assert.notEqual(e.digit, sol[e.cell]);
  }
});

test('hint ignores wrong entries and respects valid notes', () => {
  const puzzle = '53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79';
  const sol = solve(puzzle);
  const g = parse(puzzle);
  g[2] = 9; // wrong digit entered by the player (not the solution 4)
  const h = hint(g, null, sol);
  assert.ok(h);
  for (const p of h.placements) assert.equal(p.digit, sol[p.cell]);
  assert.ok(!h.placements.some((p) => p.cell === 2 && p.digit === 9));
});

test('hint falls back to reveal when no technique applies', () => {
  // famously hard puzzle: the logical solver gets stuck part way
  const hard = '8..........36......7..9.2...5...7.......457.....1...3...1....68..85...1..9....4..';
  const sol = solve(hard);
  const res = solveLogically(hard);
  assertSound(hard, res.steps, sol);
  if (res.solved) return;
  // replay to get the stuck candidate state, pass it as the player's notes
  const g = parse(hard), c = computeCandidates(g);
  for (const st of res.steps) applyStep(g, c, st);
  const h = hint(res.grid, c, sol);
  assert.equal(h.technique, 'reveal');
  assert.equal(h.placements.length, 1);
  assert.equal(h.placements[0].digit, sol[h.placements[0].cell]);
});

test('applyStep applies placements, peer cleanup and eliminations', () => {
  const g = new Array(81).fill(0);
  const c = new Array(81).fill(ALL);
  applyStep(g, c, { placements: [{ cell: 0, digit: 5 }], eliminations: [{ cell: 80, digit: 9 }] });
  assert.equal(g[0], 5);
  assert.equal(c[0], 0);
  assert.equal(c[1] & B(5), 0);
  assert.equal(c[9] & B(5), 0);
  assert.equal(c[10] & B(5), 0);
  assert.equal(c[80], ALL & ~B(9));
  assert.equal(c[40], ALL);
});

test('rate: levels follow the grading rules and are fast', () => {
  const easy = '53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79';
  const r0 = rate(easy);
  assert.equal(r0.maxTier, 1);
  assert.equal(r0.givens, 30);
  assert.equal(r0.level, 1); // singles only but fewer than 36 givens -> Medium
  assert.ok(r0.solved);
  // add givens from the solution -> Beginner
  const sol = solve(easy);
  const g = parse(easy);
  for (let i = 0, n = 30; i < 81 && n < 38; i++) if (!g[i]) { g[i] = sol[i]; n++; }
  const rb = rate(stringify(g));
  assert.equal(rb.level, 0);
  assert.equal(rb.givens, 38);
  const r = rng('rate');
  const t0 = performance.now();
  let n = 0;
  for (let k = 0; k < 100; k++) {
    const { puzzle } = generate(r);
    const res = rate(puzzle);
    n++;
    assert.ok(res.level >= -1 && res.level <= 5);
    if (res.solved) {
      if (res.maxTier === 1) assert.equal(res.level, res.givens >= 36 ? 0 : 1);
      if (res.maxTier >= 4) assert.equal(res.level, res.maxTier - 1);
      if (res.maxTier === 3) assert.equal(res.level, 2);
    } else assert.equal(res.level, -1);
    assert.equal(Object.values(res.counts).reduce((a, b) => a + b, 0) > 0, true);
  }
  const avg = (performance.now() - t0) / n;
  assert.ok(avg < 100, `rate too slow: ${avg}ms`);
});
