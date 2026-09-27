// Pure game logic: scoring, undo, mistakes, notes, hints bookkeeping, stats aggregation.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BASE, PAR_MIN, MAX_HINTS, createGame, restartGame, placeDigit, toggleNote, erase, autoNotes,
  undo, chargeHint, applyStep, secondChance, finishWin, resultOf, timeBonus, fmtTime, isLocked,
  errorsOf, digitCounts, hintsLeft, hintNotes, cleanGrid, candidates, unitsOf, PEERS, UNIT_CELLS,
} from "../js/rules.js";
import {
  aggregate, addRecord, newBests, dailyStreak, bestDailyStreak, monthComplete, addDays, localISO,
  freshState,
} from "../js/store.js";

// A valid solution grid and a puzzle with a few holes.
const SOL = "534678912672195348198342567859761423426853791713924856961537284287419635345286179";
const holes = [0, 1, 2, 10, 40, 41, 80, 72, 8];
const PUZ = [...SOL].map((ch, i) => (holes.includes(i) ? "." : ch)).join("");
const sol = (i) => +SOL[i];
const wrongDigit = (i) => (sol(i) % 9) + 1;
const game = (level = 0) => createGame({ puzzle: PUZ, solution: SOL, level, now: 1 });

test("geometry helpers", () => {
  assert.equal(UNIT_CELLS.length, 27);
  assert.deepEqual(unitsOf(0), [0, 9, 18]);
  assert.deepEqual(unitsOf(80), [8, 17, 26]);
  assert.ok(PEERS.every((p) => p.length === 20));
});

test("createGame: givens, completed units detected, locked cells", () => {
  const g = game();
  assert.equal(g.grid.filter((v) => v === 0).length, holes.length);
  // row 3 (index 3) has no holes -> already done
  assert.ok(g.done.includes(3));
  assert.ok(!g.done.includes(0));
  assert.ok(isLocked(g, 3));
  assert.ok(!isLocked(g, 0));
});

test("correct placement scores BASE, unit completion adds 2*BASE per unit", () => {
  for (let level = 0; level < 6; level++) {
    const g = game(level);
    const r = placeDigit(g, 0, sol(0));
    assert.ok(r.correct && r.changed);
    assert.equal(r.points, BASE[level]);
    assert.equal(g.score, BASE[level]);
  }
  // cell 10 is the only hole of row 1 -> one unit bonus
  const g1 = game(1);
  const r1 = placeDigit(g1, 10, sol(10));
  assert.deepEqual(r1.units, [1]);
  assert.equal(r1.points, BASE[1] * 3);
  // holes 40,41 are the last of row 4 and box 4; 41 is alone in column 5
  const g = game(2);
  placeDigit(g, 40, sol(40));
  const before = g.score;
  const r = placeDigit(g, 41, sol(41));
  assert.deepEqual(r.units.sort((a, b) => a - b), [4, 9 + 5, 18 + 4]);
  assert.equal(r.points, BASE[2] * (1 + 2 * 3));
  assert.equal(g.score, before + r.points);
});

test("wrong placement: mistake +1, no points, red cell, 3 mistakes = game over", () => {
  const g = game(1);
  let r = placeDigit(g, 0, wrongDigit(0));
  assert.ok(r.mistake && !r.correct);
  assert.equal(r.points, 0);
  assert.equal(g.mistakes, 1);
  assert.ok(errorsOf(g).has(0));
  assert.ok(!isLocked(g, 0), "a wrong digit can be overwritten");
  placeDigit(g, 1, wrongDigit(1));
  r = placeDigit(g, 2, wrongDigit(2));
  assert.equal(g.mistakes, 3);
  assert.ok(r.gameOver && g.over);
  // no moves once over
  assert.equal(placeDigit(g, 8, sol(8)).changed, false);
  assert.equal(g.score, 0);
});

test("mistake limit off: never game over", () => {
  const g = game();
  for (const i of [0, 1, 2, 8]) placeDigit(g, i, wrongDigit(i), { mistakeLimit: false });
  assert.equal(g.mistakes, 4);
  assert.ok(!g.over);
});

test("second chance clears wrong digits and allows one more mistake; game is no longer perfect", () => {
  const g = game();
  for (const i of [0, 1, 2]) placeDigit(g, i, wrongDigit(i));
  assert.ok(g.over);
  secondChance(g);
  assert.ok(!g.over && g.secondChance);
  assert.equal(g.mistakes, 2);
  assert.equal(errorsOf(g).size, 0);
  assert.ok(placeDigit(g, 0, wrongDigit(0)).gameOver);
});

test("same digit twice / locked cell / given is a no-op", () => {
  const g = game();
  placeDigit(g, 0, sol(0));
  assert.equal(placeDigit(g, 0, sol(0)).changed, false);
  assert.equal(placeDigit(g, 3, 1).changed, false);   // given
  assert.equal(g.history.length, 1);
});

test("undo reverts digit, notes and score but keeps mistakes", () => {
  const g = game(3);
  toggleNote(g, 1, sol(0));            // a note in a peer with digit sol(0)
  toggleNote(g, 1, sol(1));
  placeDigit(g, 0, sol(0));            // auto-removes the peer note
  assert.equal(g.notes[1] & (1 << (sol(0) - 1)), 0);
  assert.equal(g.score, BASE[3]);
  assert.deepEqual(undo(g).sort(), [0, 1]);
  assert.equal(g.grid[0], 0);
  assert.equal(g.score, 0);
  assert.ok(g.notes[1] & (1 << (sol(0) - 1)), "peer note restored");
  placeDigit(g, 0, wrongDigit(0));
  undo(g);
  assert.equal(g.grid[0], 0);
  assert.equal(g.mistakes, 1, "undo does not refund mistakes");
  undo(g); undo(g);
  assert.equal(g.notes[1], 0);
  assert.equal(undo(g), null, "empty history");
});

test("undo of a unit-completing move un-marks the unit (bonus can be earned again)", () => {
  const g = game(0);
  placeDigit(g, 40, sol(40));
  const r = placeDigit(g, 41, sol(41));
  assert.ok(g.done.includes(4));
  undo(g);
  assert.ok(!g.done.includes(4));
  assert.equal(placeDigit(g, 41, sol(41)).points, r.points);
});

test("auto-remove notes can be switched off", () => {
  const g = game();
  toggleNote(g, 1, sol(0));
  placeDigit(g, 0, sol(0), { autoRemoveNotes: false });
  assert.ok(g.notes[1] & (1 << (sol(0) - 1)));
});

test("notes: toggle on empty cells only; erase clears notes or a wrong digit, not correct ones", () => {
  const g = game();
  assert.ok(toggleNote(g, 0, 5));
  assert.equal(g.notes[0], 1 << 4);
  assert.ok(toggleNote(g, 0, 5));
  assert.equal(g.notes[0], 0);
  assert.equal(toggleNote(g, 3, 1), false);
  toggleNote(g, 0, 2);
  assert.ok(erase(g, 0));
  assert.equal(g.notes[0], 0);
  assert.equal(erase(g, 0), false, "nothing to erase");
  placeDigit(g, 0, wrongDigit(0));
  assert.ok(erase(g, 0));
  assert.equal(g.grid[0], 0);
  placeDigit(g, 0, sol(0));
  assert.equal(erase(g, 0), false, "correct digits are locked");
});

test("autoNotes fills candidates, ignoring wrong digits, and is one undo step", () => {
  const g = game(3);
  placeDigit(g, 0, wrongDigit(0));
  assert.ok(autoNotes(g));
  const cand = candidates(cleanGrid(g));
  for (const i of holes) if (i !== 0) assert.equal(g.notes[i], cand[i]);
  assert.ok(g.notes[1] & (1 << (sol(1) - 1)));
  assert.equal(autoNotes(g), false, "already complete");
  undo(g);
  assert.ok(g.notes.every((n) => n === 0));
});

test("hints: max 3, each costs 3*BASE with floor 0", () => {
  const g = game(2);
  placeDigit(g, 0, sol(0));
  placeDigit(g, 1, sol(1));
  placeDigit(g, 2, sol(2));   // completes nothing? score >= 3*BASE
  const s = g.score;
  assert.ok(chargeHint(g));
  assert.equal(g.score, Math.max(0, s - 3 * BASE[2]));
  assert.ok(chargeHint(g));
  assert.ok(chargeHint(g));
  assert.equal(g.score, 0);
  assert.equal(hintsLeft(g), 0);
  assert.equal(chargeHint(g), false);
  assert.equal(g.hints, MAX_HINTS);
});

test("applyStep: hinted placement earns 0 points, eliminations edit notes, undoable", () => {
  const g = game(4);
  const base = hintNotes(g);
  const step = {
    technique: "naked_single",
    placements: [{ cell: 0, digit: sol(0) }],
    eliminations: [{ cell: 1, digit: sol(0) === 9 ? 8 : 9 }],
  };
  const res = applyStep(g, step, base);
  assert.ok(res.changed);
  assert.equal(g.grid[0], sol(0));
  assert.equal(g.score, 0);
  assert.ok(g.notes[1] !== 0 && !(g.notes[1] & (1 << (step.eliminations[0].digit - 1))));
  undo(g);
  assert.equal(g.grid[0], 0);
  assert.equal(g.notes[1], 0);
});

test("hintNotes respects player notes only when they contain the solution digit", () => {
  const g = game();
  const cand = candidates(cleanGrid(g));
  toggleNote(g, 0, sol(0));
  toggleNote(g, 1, wrongDigit(1));   // notes that exclude the solution are ignored
  const hn = hintNotes(g);
  assert.equal(hn[0], (1 << (sol(0) - 1)) & cand[0]);
  assert.equal(hn[1], cand[1]);
});

test("win: time bonus, perfect flag and result record", () => {
  const g = game(0);
  for (const i of holes) placeDigit(g, i, sol(i));
  assert.ok(g.won);
  g.elapsed = 60;
  const before = g.score;
  const bonus = finishWin(g);
  assert.equal(bonus, Math.round(BASE[0] * 20 * (1 - 60 / (PAR_MIN[0] * 60))));
  assert.equal(g.score, before + bonus);
  const rec = resultOf(g, true, 123);
  assert.deepEqual(rec, { at: 123, level: 0, daily: null, won: true, time: 60, score: g.score, mistakes: 0, hints: 0, perfect: true });
  assert.equal(undo(g), null, "no undo after win");
});

test("timeBonus is 0 at or beyond par and never negative", () => {
  assert.equal(timeBonus(3, 0), BASE[3] * 20);
  assert.equal(timeBonus(3, PAR_MIN[3] * 60), 0);
  assert.equal(timeBonus(3, 99999), 0);
});

test("perfect requires no mistakes, no hints, no second chance", () => {
  const g = game();
  placeDigit(g, 0, wrongDigit(0));
  erase(g, 0);
  for (const i of holes) placeDigit(g, i, sol(i));
  assert.equal(resultOf(g, true).perfect, false);
});

test("restartGame gives a fresh copy of the same puzzle", () => {
  const g = game(5);
  placeDigit(g, 0, wrongDigit(0));
  const r = restartGame(g, 5);
  assert.equal(r.puzzle, g.puzzle);
  assert.equal(r.level, 5);
  assert.equal(r.mistakes, 0);
  assert.equal(r.history.length, 0);
});

test("digitCounts counts correct digits only; fmtTime", () => {
  const g = game();
  placeDigit(g, 0, wrongDigit(0));
  const c = digitCounts(g);
  assert.equal(c.reduce((a, b) => a + b, 0), 81 - holes.length);
  assert.equal(fmtTime(0), "00:00");
  assert.equal(fmtTime(75), "01:15");
  assert.equal(fmtTime(3725), "1:02:05");
});

test("game object survives a JSON round-trip (auto-save)", () => {
  const g = game(2);
  placeDigit(g, 0, sol(0));
  toggleNote(g, 1, 3);
  const g2 = JSON.parse(JSON.stringify(g));
  assert.deepEqual(undo(g2), undo(g));
  assert.deepEqual(g2, g);
});

// ---- stats ----------------------------------------------------------------------

const rec = (o) => ({ at: 0, level: 0, daily: null, won: true, time: 100, score: 500, mistakes: 0, hints: 0, perfect: true, ...o });

test("aggregate: per level and All", () => {
  const st = freshState().stats;
  st.started = [3, 1, 0, 0, 0, 0];
  addRecord(st, rec({ time: 120, score: 400 }));
  addRecord(st, rec({ won: false, perfect: false, score: 0 }));
  addRecord(st, rec({ time: 90, score: 700, perfect: false, mistakes: 1 }));
  addRecord(st, rec({ level: 1, time: 300, score: 900 }));
  const a0 = aggregate(st, 0);
  assert.equal(a0.started, 3);
  assert.equal(a0.won, 2);
  assert.equal(a0.winRate, 2 / 3);
  assert.equal(a0.bestTime, 90);
  assert.equal(a0.avgTime, 105);
  assert.equal(a0.bestScore, 700);
  assert.equal(a0.totalScore, 1100);
  assert.equal(a0.perfect, 1);
  assert.equal(a0.streak, 1);
  assert.equal(a0.bestStreak, 1);
  const all = aggregate(st);
  assert.equal(all.started, 4);
  assert.equal(all.won, 3);
  assert.equal(all.streak, 2);
  assert.equal(all.bestScore, 900);
  const empty = aggregate(st, 5);
  assert.equal(empty.winRate, 0);
  assert.equal(empty.bestTime, null);
});

test("newBests compares against earlier records of the same level", () => {
  const st = freshState().stats;
  assert.deepEqual(newBests(st, rec({})), ["time", "score"]);
  addRecord(st, rec({ time: 100, score: 500 }));
  assert.deepEqual(newBests(st, rec({ time: 90, score: 400 })), ["time"]);
  assert.deepEqual(newBests(st, rec({ time: 120, score: 600 })), ["score"]);
  assert.deepEqual(newBests(st, rec({ won: false })), []);
});

test("records are capped", () => {
  const st = freshState().stats;
  for (let k = 0; k < 1100; k++) addRecord(st, rec({ at: k }));
  assert.equal(st.records.length, 1000);
  assert.equal(st.records[0].at, 100);
});

test("daily streaks and month completion", () => {
  const map = {};
  for (const d of ["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-05", "2026-03-06"]) map[d] = { time: 1, score: 1, level: 2 };
  assert.equal(dailyStreak(map, "2026-03-06"), 2);
  assert.equal(dailyStreak(map, "2026-03-07"), 2, "today not solved yet keeps yesterday's streak");
  assert.equal(dailyStreak(map, "2026-03-08"), 0);
  assert.equal(bestDailyStreak(map), 3);
  assert.equal(monthComplete(map, 2026, 2), false);
  const feb = {};
  for (let d = 1; d <= 28; d++) feb[`2026-02-${String(d).padStart(2, "0")}`] = {};
  assert.equal(monthComplete(feb, 2026, 1), true);
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
  assert.match(localISO(new Date(2026, 8, 7)), /^2026-09-07$/);
});
