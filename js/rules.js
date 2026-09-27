// Pure game rules: state of one game, placements, notes, undo, mistakes,
// hints bookkeeping and sudoku.com-style scoring. No DOM, no storage, no
// engine imports — so it is unit-tested directly in Node (tests/game.test.mjs).
//
// A game object is plain JSON (it is saved to localStorage after every move):
// { v, level, daily, puzzle, solution, grid[81], notes[81], mistakes, hints,
//   score, elapsed, secondChance, history[], done[], over, won, started }

export const BASE = [10, 20, 30, 45, 60, 80];        // points per correct placement, by level
export const PAR_MIN = [6, 10, 15, 25, 40, 60];      // par minutes for the win time bonus
export const MAX_HINTS = 3;
export const MAX_MISTAKES = 3;
const HISTORY_CAP = 400;

// ---- local grid geometry (kept here so this module stays dependency-free) ----
export const UNIT_CELLS = [];
for (let r = 0; r < 9; r++) UNIT_CELLS.push([...Array(9)].map((_, c) => r * 9 + c));
for (let c = 0; c < 9; c++) UNIT_CELLS.push([...Array(9)].map((_, r) => r * 9 + c));
for (let b = 0; b < 9; b++) {
  const r0 = 3 * ((b / 3) | 0), c0 = 3 * (b % 3);
  UNIT_CELLS.push([...Array(9)].map((_, k) => (r0 + ((k / 3) | 0)) * 9 + c0 + (k % 3)));
}
export const unitsOf = (i) => [(i / 9) | 0, 9 + (i % 9), 18 + 3 * ((i / 27) | 0) + (((i % 9) / 3) | 0)];
export const PEERS = [...Array(81)].map((_, i) => {
  const s = new Set();
  for (const u of unitsOf(i)) for (const j of UNIT_CELLS[u]) if (j !== i) s.add(j);
  return [...s];
});
const bit = (d) => 1 << (d - 1);

export function toGrid(x) {
  if (Array.isArray(x)) return x.map((v) => +v || 0);
  return [...String(x)].map((ch) => (ch >= "1" && ch <= "9" ? +ch : 0));
}
export const toStr = (x) => (Array.isArray(x) ? x.map((v) => v || ".").join("") : String(x));

// ---- creation ----------------------------------------------------------------

export function createGame({ puzzle, solution, level = 0, daily = null, now = Date.now() }) {
  const g = {
    v: 1,
    level,
    daily,
    puzzle: toStr(puzzle).replace(/0/g, "."),
    solution: toStr(solution),
    grid: toGrid(puzzle),
    notes: Array(81).fill(0),
    mistakes: 0,
    hints: 0,
    score: 0,
    elapsed: 0,
    secondChance: false,
    history: [],
    done: [],
    over: false,
    won: false,
    started: now,
  };
  g.done = UNIT_CELLS.map((_, u) => u).filter((u) => unitComplete(g, u));
  return g;
}

/** Same puzzle from scratch (Restart). */
export const restartGame = (g, now = Date.now()) =>
  createGame({ puzzle: g.puzzle, solution: g.solution, level: g.level, daily: g.daily, now });

// ---- queries -------------------------------------------------------------------

export const solDigit = (g, i) => +g.solution[i];
export const givensOf = (g) => [...g.puzzle].map((ch) => ch >= "1" && ch <= "9");
export const isGiven = (g, i) => g.puzzle[i] >= "1" && g.puzzle[i] <= "9";
/** Givens and correct entries can't be changed any more (like sudoku.com). */
export const isLocked = (g, i) => isGiven(g, i) || (g.grid[i] !== 0 && g.grid[i] === solDigit(g, i));
export const isWrong = (g, i) => g.grid[i] !== 0 && g.grid[i] !== solDigit(g, i);
export const unitComplete = (g, u) => UNIT_CELLS[u].every((j) => g.grid[j] === solDigit(g, j));
export const isSolved = (g) => g.grid.every((v, i) => v === solDigit(g, i));
export const isPerfect = (g) => g.mistakes === 0 && g.hints === 0 && !g.secondChance;
export const hintsLeft = (g) => Math.max(0, MAX_HINTS - g.hints);

export function errorsOf(g) {
  const s = new Set();
  g.grid.forEach((v, i) => { if (isWrong(g, i)) s.add(i); });
  return s;
}

/** Player grid with wrong digits removed (what the engine should reason about). */
export const cleanGrid = (g) => g.grid.map((v, i) => (isWrong(g, i) ? 0 : v));

/** counts[d] = cells correctly showing digit d (givens included). */
export function digitCounts(g) {
  const counts = Array(10).fill(0);
  g.grid.forEach((v, i) => { if (v && v === solDigit(g, i)) counts[v]++; });
  return counts;
}

/** Peer-based candidates of a grid (0 = empty). Filled cells -> 0. */
export function candidates(grid) {
  return grid.map((v, i) => {
    if (v) return 0;
    let m = 511;
    for (const j of PEERS[i]) if (grid[j]) m &= ~bit(grid[j]);
    return m;
  });
}

/**
 * Candidates as the hint engine sees them (SPEC "Hints"): computed candidates,
 * intersected with the player's notes where those notes contain the solution digit.
 */
export function hintNotes(g) {
  const cg = cleanGrid(g), cand = candidates(cg);
  return cg.map((v, i) => {
    if (v) return 0;
    const n = g.notes[i];
    return n && n & bit(solDigit(g, i)) ? n & cand[i] : cand[i];
  });
}

export const timeBonus = (level, seconds) =>
  Math.round(BASE[level] * 20 * Math.max(0, 1 - seconds / (PAR_MIN[level] * 60)));

export function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const mm = String(m).padStart(2, "0"), ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// ---- moves (mutating; each pushes one undo entry) -------------------------------

function snapshot(g, cells) {
  return [...new Set(cells)].map((i) => ({ i, v: g.grid[i], n: g.notes[i] }));
}
function push(g, entry) {
  g.history.push(entry);
  if (g.history.length > HISTORY_CAP) g.history.shift();
}
/** Mark newly completed units of cell i; returns them. */
function completeUnits(g, i) {
  const out = [];
  for (const u of unitsOf(i)) if (!g.done.includes(u) && unitComplete(g, u)) { g.done.push(u); out.push(u); }
  return out;
}
function peersWithNote(g, i, d) {
  return PEERS[i].filter((j) => g.grid[j] === 0 && g.notes[j] & bit(d));
}

/**
 * Enter digit d in cell i.
 * opts: { autoRemoveNotes = true, mistakeLimit = true }
 * -> { changed, correct, mistake, gameOver, units: [completed unit idx], won, points }
 */
export function placeDigit(g, i, d, opts = {}) {
  const none = { changed: false, correct: false, mistake: false, gameOver: false, units: [], won: false, points: 0 };
  if (g.won || g.over || isLocked(g, i) || g.grid[i] === d) return none;
  const correct = d === solDigit(g, i);
  const autoRemove = opts.autoRemoveNotes !== false;
  const touched = [i, ...(correct && autoRemove ? peersWithNote(g, i, d) : [])];
  const entry = { cells: snapshot(g, touched), score: 0, units: [] };
  g.grid[i] = d;
  g.notes[i] = 0;
  let points = 0, units = [], gameOver = false, won = false;
  if (correct) {
    if (autoRemove) for (const j of touched) if (j !== i) g.notes[j] &= ~bit(d);
    units = completeUnits(g, i);
    points = BASE[g.level] * (1 + 2 * units.length);
    g.score += points;
    entry.score = points;
    entry.units = units;
    won = isSolved(g);
    if (won) g.won = true;
  } else {
    g.mistakes++;
    if (opts.mistakeLimit !== false && g.mistakes >= MAX_MISTAKES) gameOver = g.over = true;
  }
  push(g, entry);
  return { changed: true, correct, mistake: !correct, gameOver, units, won, points };
}

/** Toggle pencil mark d in cell i (only on empty cells). */
export function toggleNote(g, i, d) {
  if (g.won || g.over || g.grid[i] !== 0) return false;
  push(g, { cells: snapshot(g, [i]), score: 0, units: [] });
  g.notes[i] ^= bit(d);
  return true;
}

/** Erase a wrong digit or the notes of a cell. */
export function erase(g, i) {
  if (g.won || g.over || isLocked(g, i) || (g.grid[i] === 0 && g.notes[i] === 0)) return false;
  push(g, { cells: snapshot(g, [i]), score: 0, units: [] });
  g.grid[i] = 0;
  g.notes[i] = 0;
  return true;
}

/** Fill every empty cell's notes with its candidates (ignoring wrong digits). */
export function autoNotes(g) {
  if (g.won || g.over) return false;
  const cand = candidates(cleanGrid(g));
  const changed = [];
  g.grid.forEach((v, i) => { if (v === 0 && g.notes[i] !== cand[i]) changed.push(i); });
  if (!changed.length) return false;
  push(g, { cells: snapshot(g, changed), score: 0, units: [] });
  for (const i of changed) g.notes[i] = cand[i];
  return true;
}

/** Spend a hint: -3*BASE (floor 0). Not undoable. */
export function chargeHint(g) {
  if (g.hints >= MAX_HINTS) return false;
  g.hints++;
  g.score = Math.max(0, g.score - 3 * BASE[g.level]);
  return true;
}

/**
 * Apply an engine Step: place its digits (0 points) and remove its eliminations
 * from the notes. `baseNotes` = the notes that were displayed (see hintNotes), used
 * for cells where the player had no notes. One undo entry.
 */
export function applyStep(g, step, baseNotes = g.notes, opts = {}) {
  const res = { changed: false, units: [], won: false };
  if (g.won || g.over || !step) return res;
  const autoRemove = opts.autoRemoveNotes !== false;
  const place = (step.placements || []).filter((p) => g.grid[p.cell] !== p.digit && !isLocked(g, p.cell));
  const elim = (step.eliminations || []).filter((e) => g.grid[e.cell] === 0);
  const touched = [];
  for (const p of place) {
    touched.push(p.cell);
    if (autoRemove) touched.push(...peersWithNote(g, p.cell, p.digit));
  }
  for (const e of elim) touched.push(e.cell);
  if (!touched.length) return res;
  const entry = { cells: snapshot(g, touched), score: 0, units: [] };
  for (const e of elim) {
    if (g.notes[e.cell] === 0) g.notes[e.cell] = baseNotes[e.cell] || 0;
    g.notes[e.cell] &= ~bit(e.digit);
  }
  for (const p of place) {
    g.grid[p.cell] = p.digit;
    g.notes[p.cell] = 0;
    if (autoRemove) for (const j of PEERS[p.cell]) if (g.grid[j] === 0) g.notes[j] &= ~bit(p.digit);
    // hinted placements earn nothing, but their units count as done (no later bonus)
    res.units.push(...completeUnits(g, p.cell));
  }
  entry.units = res.units;
  push(g, entry);
  res.changed = true;
  res.won = isSolved(g);
  if (res.won) g.won = true;
  return res;
}

/** Revert the last move. Mistakes and hint penalties stay. Returns touched cells or null. */
export function undo(g) {
  if (g.won || g.over) return null;
  const e = g.history.pop();
  if (!e) return null;
  for (const c of e.cells) { g.grid[c.i] = c.v; g.notes[c.i] = c.n; }
  g.score = Math.max(0, g.score - e.score);
  g.done = g.done.filter((u) => !e.units.includes(u));
  return e.cells.map((c) => c.i);
}

/** Continue after 3 mistakes: wrong digits are removed, one more mistake allowed. */
export function secondChance(g) {
  g.over = false;
  g.secondChance = true;
  g.mistakes = MAX_MISTAKES - 1;
  g.grid.forEach((v, i) => { if (isWrong(g, i)) g.grid[i] = 0; });
}

/** Add the win time bonus; returns it. Call once when g.won became true. */
export function finishWin(g) {
  const bonus = timeBonus(g.level, g.elapsed);
  g.score += bonus;
  return bonus;
}

/** Result record for stats. */
export function resultOf(g, won, now = Date.now()) {
  return {
    at: now,
    level: g.level,
    daily: g.daily || null,
    won: !!won,
    time: Math.floor(g.elapsed),
    score: g.score,
    mistakes: g.mistakes,
    hints: g.hints,
    perfect: !!won && isPerfect(g),
  };
}
