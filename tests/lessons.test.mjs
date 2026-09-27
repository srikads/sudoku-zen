import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { parse, solve, computeCandidates, bitCount } from '../js/sudoku.js';
import { TECHNIQUES, findStep } from '../js/techniques.js';
import { checkPractice, validPlacement, stepBoard } from '../js/learn.js';

const PATH = new URL('../data/lessons.json', import.meta.url);
const data = JSON.parse(readFileSync(PATH, 'utf8'));
const lessons = data.lessons;
const byId = Object.fromEntries(lessons.map((l) => [l.id, l]));
const CELL_ROLES = new Set(['base', 'cover', 'pivot', 'pincer', 'fin', 'target']);
const CAND_ROLES = new Set(['key', 'elim', 'place', 'colorA', 'colorB']);
const key = (x) => `${x.cell}:${x.digit}`;
const sameSet = (a, b) => assert.deepEqual(a.map(key).sort(), b.map(key).sort());

test('json size budget', () => {
  const kb = statSync(PATH).size / 1024;
  assert.ok(kb < 400, `lessons.json is ${kb.toFixed(1)} KB`);
});

test('every technique has exactly one lesson; chapters and order are sane', () => {
  for (const t of TECHNIQUES) {
    const l = byId[t.id];
    assert.ok(l, `no lesson for ${t.id}`);
    assert.equal(l.tier, t.tier, t.id);
    assert.equal(l.title, t.name, t.id);
  }
  assert.equal(new Set(lessons.map((l) => l.id)).size, lessons.length, 'duplicate lesson ids');
  assert.equal(lessons.length, TECHNIQUES.length + 1, 'techniques + intro');
  assert.equal(lessons[0].id, 'intro');
  const chIds = data.chapters.map((c) => c.id);
  for (const l of lessons) assert.ok(chIds.includes(l.chapter), `${l.id}: unknown chapter`);
  // chapters are contiguous and in order
  const seq = lessons.map((l) => l.chapter);
  assert.deepEqual(seq, [...seq].sort((a, b) => a - b));
  for (const l of lessons) {
    assert.ok(l.summary && l.summary.length < 90, `${l.id}: summary`);
    assert.ok(Array.isArray(l.intro) && l.intro.length >= 2 && l.intro.length <= 4, `${l.id}: intro paragraphs`);
  }
});

function checkPosition(l, pos, label) {
  const where = `${l.id} ${label}`;
  assert.equal(pos.grid.length, 81, where);
  assert.equal(pos.cands.length, 81, where);
  const grid = parse(pos.grid);
  // givens are a subset of the grid, and the grid is consistent with the puzzle's unique solution
  const sol = solve(parse(pos.puzzle));
  assert.ok(sol, `${where}: puzzle unsolvable`);
  for (let i = 0; i < 81; i++) {
    if (pos.puzzle[i] !== '.') assert.equal(grid[i], +pos.puzzle[i], `${where}: given changed`);
    if (grid[i]) {
      assert.equal(grid[i], sol[i], `${where}: wrong digit in grid`);
      assert.equal(pos.cands[i], 0, `${where}: filled cell has notes`);
    } else {
      assert.ok(pos.cands[i] & (1 << (sol[i] - 1)), `${where}: notes of ${i} lost the solution`);
      // notes never contain a digit already in a peer (realistic pencil marks)
      assert.equal(pos.cands[i] & ~computeCandidates(grid)[i], 0, `${where}: impossible note in ${i}`);
    }
  }
  // re-running the technique reproduces the stored step
  const s = findStep(l.id, grid, pos.cands.slice());
  assert.ok(s, `${where}: findStep returned null`);
  sameSet(s.eliminations, pos.step.eliminations);
  sameSet(s.placements, pos.step.placements);
  assert.ok(s.eliminations.length + s.placements.length > 0, `${where}: no progress`);
  // soundness vs the solution
  for (const e of s.eliminations) assert.notEqual(sol[e.cell], e.digit, `${where}: unsound elimination ${key(e)}`);
  for (const p of s.placements) assert.equal(sol[p.cell], p.digit, `${where}: wrong placement ${key(p)}`);
  checkSteps(l, pos, where);
}

function checkHighlight(hl, where, grid, cands) {
  for (const u of hl.units || []) assert.ok(Number.isInteger(u) && u >= 0 && u < 27, `${where}: unit ${u}`);
  for (const c of hl.cells || []) {
    assert.ok(Number.isInteger(c.cell) && c.cell >= 0 && c.cell < 81, `${where}: cell ${c.cell}`);
    assert.ok(CELL_ROLES.has(c.role), `${where}: cell role ${c.role}`);
  }
  for (const c of hl.cands || []) {
    assert.ok(Number.isInteger(c.cell) && c.cell >= 0 && c.cell < 81, `${where}: cand cell`);
    assert.ok(c.digit >= 1 && c.digit <= 9, `${where}: cand digit`);
    assert.ok(CAND_ROLES.has(c.role), `${where}: cand role ${c.role}`);
    if (c.role !== 'place') assert.ok(!grid[c.cell] && (cands[c.cell] & (1 << (c.digit - 1))), `${where}: highlighted candidate ${key(c)} is not a note`);
  }
  for (const k of hl.links || []) {
    for (const end of [k.from, k.to]) {
      assert.ok(end.cell >= 0 && end.cell < 81 && end.digit >= 1 && end.digit <= 9, `${where}: link end`);
      assert.ok(cands[end.cell] & (1 << (end.digit - 1)), `${where}: link end ${key(end)} is not a note`);
    }
    assert.equal(typeof k.strong, 'boolean');
  }
}

function checkSteps(l, pos, where) {
  assert.ok(pos.steps.length >= 3 && pos.steps.length <= 6, `${where}: ${pos.steps.length} steps`);
  pos.steps.forEach((st, k) => {
    assert.ok(typeof st.text === 'string' && st.text.length > 10, `${where}: step ${k} text`);
    assert.ok(!/undefined|NaN|\[object/.test(st.text), `${where}: step ${k} text: ${st.text}`);
    const { grid, notes } = stepBoard(pos, st.apply ? { ...st, apply: false } : st);
    checkHighlight(st.hl || {}, `${where} step ${k + 1}`, grid, notes);
  });
  // the final step shows the full result
  const last = pos.steps[pos.steps.length - 1].hl || {};
  const shown = (last.cands || []).filter((c) => c.role === 'elim' || c.role === 'place');
  sameSet(shown, [...pos.step.eliminations, ...pos.step.placements]);
  // step 1 never reveals the answer
  const first = pos.steps[0].hl || {};
  assert.ok(!(first.cands || []).some((c) => c.role === 'elim' || c.role === 'place'), `${where}: step 1 gives away the result`);
  // narration mentions every eliminated/placed cell
  const text = pos.steps.map((s) => s.text).join(' ');
  for (const e of [...pos.step.eliminations, ...pos.step.placements]) {
    const name = `r${((e.cell / 9) | 0) + 1}c${(e.cell % 9) + 1}`;
    assert.ok(text.includes(name), `${where}: narration never names ${name}`);
  }
}

for (const l of lessons) {
  if (l.id === 'intro') continue;
  test(`lesson ${l.id}: example and practice are verified`, () => {
    checkPosition(l, l.example, 'example');
    assert.ok(l.practice, `${l.id}: no practice`);
    checkPosition(l, l.practice, 'practice');
    assert.notEqual(l.practice.puzzle, l.example.puzzle, `${l.id}: practice from the same puzzle`);
    assert.ok(l.practice.task && l.practice.task.length > 10, `${l.id}: task text`);
    assert.equal(l.mode, l.example.step.placements.length ? 'place' : 'elim', `${l.id}: mode`);
  });
}

test('intro lesson is well formed', () => {
  const l = byId.intro;
  assert.equal(l.mode, 'none');
  assert.equal(l.practice, undefined);
  const grid = parse(l.example.grid);
  assert.deepEqual(l.example.cands, computeCandidates(grid));
  l.example.steps.forEach((st, k) => checkHighlight(st.hl || {}, `intro step ${k + 1}`, grid, l.example.cands));
});

test('checkPractice: correct, partial, wrong and empty answers', () => {
  for (const l of lessons) {
    if (!l.practice) continue;
    const st = l.practice.step;
    if (l.mode === 'place') {
      assert.equal(checkPractice(l, st.placements).ok, true, l.id);
      assert.equal(checkPractice(l, []).ok, false);
      const sol = solve(parse(l.practice.grid));
      const target = st.placements[0];
      const wrongDigit = [1, 2, 3, 4, 5, 6, 7, 8, 9].find((d) => d !== sol[target.cell]);
      const r = checkPractice(l, [{ cell: target.cell, digit: wrongDigit }]);
      assert.equal(r.ok, false, l.id);
      assert.ok(r.message.length > 5);
    } else {
      assert.equal(checkPractice(l, st.eliminations).ok, true, l.id);
      assert.equal(checkPractice(l, [...st.eliminations].reverse()).ok, true, l.id);
      assert.equal(checkPractice(l, []).ok, false);
      if (st.eliminations.length > 1) {
        const r = checkPractice(l, st.eliminations.slice(1));
        assert.equal(r.ok, false);
        assert.equal(r.found, st.eliminations.length - 1);
        assert.match(r.message, /You found/);
      }
      // marking the solution digit somewhere is reported as such
      const grid = parse(l.practice.grid), sol = solve(parse(l.practice.grid));
      const i = grid.findIndex((d) => !d);
      const r2 = checkPractice(l, [...st.eliminations, { cell: i, digit: sol[i] }]);
      assert.equal(r2.ok, false);
      assert.equal(r2.wrong[0].why, 'solution');
      assert.match(r2.message, /actually the solution/);
    }
  }
});

test('validPlacement accepts any genuine single of the lesson type', () => {
  const l = byId.naked_single;
  const grid = parse(l.practice.grid), cands = l.practice.cands;
  for (let i = 0; i < 81; i++) {
    if (grid[i] || bitCount(cands[i]) !== 1) continue;
    const d = 32 - Math.clz32(cands[i]);
    assert.equal(validPlacement('naked_single', grid, cands, i, d), true);
  }
  const hs = byId.hidden_single.practice;
  const p = hs.step.placements[0];
  assert.equal(validPlacement('hidden_single', parse(hs.grid), hs.cands, p.cell, p.digit), true);
  const fh = byId.full_house.practice;
  const q = fh.step.placements[0];
  assert.equal(validPlacement('full_house', parse(fh.grid), fh.cands, q.cell, q.digit), true);
});
