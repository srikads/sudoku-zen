// Sudoku Zen — core engine: grid helpers, bitmask solver, generator, transforms, RNG.
// Pure ES module, runs in browsers and Node. Cell index i = r*9 + c.

export const ROW = (i) => (i / 9) | 0;
export const COL = (i) => i % 9;
export const BOX = (i) => 3 * ((i / 27) | 0) + (((i % 9) / 3) | 0);

/** UNITS[0..8] rows, [9..17] columns, [18..26] boxes; each an array of 9 cell indices. */
export const UNITS = [];
for (let r = 0; r < 9; r++) UNITS.push(Array.from({ length: 9 }, (_, c) => r * 9 + c));
for (let c = 0; c < 9; c++) UNITS.push(Array.from({ length: 9 }, (_, r) => r * 9 + c));
for (let b = 0; b < 9; b++) {
  const r0 = 3 * ((b / 3) | 0), c0 = 3 * (b % 3);
  UNITS.push(Array.from({ length: 9 }, (_, k) => (r0 + ((k / 3) | 0)) * 9 + c0 + (k % 3)));
}

/** CELL_UNITS[i] = [rowUnit, colUnit, boxUnit] */
export const CELL_UNITS = Array.from({ length: 81 }, (_, i) => [ROW(i), 9 + COL(i), 18 + BOX(i)]);

/** PEERS[i] = the 20 other cells sharing a unit with i (sorted). */
export const PEERS = Array.from({ length: 81 }, (_, i) => {
  const s = new Set();
  for (const u of CELL_UNITS[i]) for (const j of UNITS[u]) if (j !== i) s.add(j);
  return [...s].sort((a, b) => a - b);
});

const POP = new Uint8Array(512);
for (let m = 1; m < 512; m++) POP[m] = POP[m >> 1] + (m & 1);

export const bitCount = (mask) => POP[mask & 511];
export const digitsOf = (mask) => {
  const out = [];
  for (let d = 1; d <= 9; d++) if (mask & (1 << (d - 1))) out.push(d);
  return out;
};
export const cellName = (i) => `r${ROW(i) + 1}c${COL(i) + 1}`;

export function parse(str) {
  const s = String(str).replace(/\s+/g, '');
  if (s.length !== 81) throw new Error('Puzzle string must have 81 cells');
  const g = new Array(81);
  for (let i = 0; i < 81; i++) {
    const ch = s[i];
    g[i] = ch >= '1' && ch <= '9' ? ch.charCodeAt(0) - 48 : 0;
  }
  return g;
}

export function stringify(grid) {
  let s = '';
  for (let i = 0; i < 81; i++) s += grid[i] ? String(grid[i]) : '.';
  return s;
}

export function computeCandidates(grid) {
  const used = new Uint16Array(27);
  for (let i = 0; i < 81; i++) {
    const d = grid[i];
    if (d) {
      const b = 1 << (d - 1);
      used[ROW(i)] |= b; used[9 + COL(i)] |= b; used[18 + BOX(i)] |= b;
    }
  }
  const cands = new Array(81);
  for (let i = 0; i < 81; i++) {
    cands[i] = grid[i] ? 0 : 511 & ~(used[ROW(i)] | used[9 + COL(i)] | used[18 + BOX(i)]);
  }
  return cands;
}

export function isValidPlacement(grid, i, d) {
  for (const j of PEERS[i]) if (grid[j] === d) return false;
  return true;
}

export function conflicts(grid) {
  const out = new Set();
  for (let i = 0; i < 81; i++) {
    const d = grid[i];
    if (!d) continue;
    for (const j of PEERS[i]) if (grid[j] === d) { out.add(i); out.add(j); }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Bitmask backtracking solver with MRV (minimum remaining values) heuristic.

const ROWOF = new Uint8Array(81), COLOF = new Uint8Array(81), BOXOF = new Uint8Array(81);
for (let i = 0; i < 81; i++) { ROWOF[i] = ROW(i); COLOF[i] = COL(i); BOXOF[i] = BOX(i); }

/**
 * Core search. Returns number of solutions found (up to limit). If `out` is given,
 * the first solution is copied into it. `order` (optional) is a digit order array
 * used to randomise the search (for generating full grids).
 */
function search(grid, limit, out, order) {
  const cells = new Uint8Array(81);
  const rows = new Uint16Array(9), cols = new Uint16Array(9), boxes = new Uint16Array(9);
  for (let i = 0; i < 81; i++) {
    const d = grid[i] | 0;
    if (d) {
      const b = 1 << (d - 1);
      if ((rows[ROWOF[i]] | cols[COLOF[i]] | boxes[BOXOF[i]]) & b) return 0; // invalid givens
      rows[ROWOF[i]] |= b; cols[COLOF[i]] |= b; boxes[BOXOF[i]] |= b;
      cells[i] = d;
    }
  }
  const empties = [];
  for (let i = 0; i < 81; i++) if (!cells[i]) empties.push(i);
  const n = empties.length;
  const emp = Uint8Array.from(empties);
  let count = 0;

  function rec(k) {
    if (k === n) {
      count++;
      if (out && count === 1) for (let i = 0; i < 81; i++) out[i] = cells[i];
      return count >= limit;
    }
    // MRV: pick the empty cell (from position k on) with fewest candidates
    let best = k, bestMask = 0, bestCount = 10;
    for (let j = k; j < n; j++) {
      const i = emp[j];
      const m = 511 & ~(rows[ROWOF[i]] | cols[COLOF[i]] | boxes[BOXOF[i]]);
      const c = POP[m];
      if (c < bestCount) {
        bestCount = c; best = j; bestMask = m;
        if (c <= 1) break;
      }
    }
    if (bestCount === 0) return false;
    const tmp = emp[k]; emp[k] = emp[best]; emp[best] = tmp;
    const i = emp[k];
    const r = ROWOF[i], c = COLOF[i], b = BOXOF[i];
    if (order) {
      for (let t = 0; t < 9; t++) {
        const d = order[t];
        const bit = 1 << (d - 1);
        if (!(bestMask & bit)) continue;
        rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit; cells[i] = d;
        if (rec(k + 1)) return true;
        rows[r] &= ~bit; cols[c] &= ~bit; boxes[b] &= ~bit; cells[i] = 0;
      }
    } else {
      let m = bestMask;
      while (m) {
        const bit = m & -m; m &= m - 1;
        const d = 32 - Math.clz32(bit);
        rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit; cells[i] = d;
        if (rec(k + 1)) return true;
        rows[r] &= ~bit; cols[c] &= ~bit; boxes[b] &= ~bit; cells[i] = 0;
      }
    }
    emp[best] = emp[k]; emp[k] = tmp;
    return false;
  }
  rec(0);
  return count;
}

export function solve(grid) {
  const g = typeof grid === 'string' ? parse(grid) : grid;
  const out = new Array(81).fill(0);
  return search(g, 1, out) ? out : null;
}

export function countSolutions(grid, limit = 2) {
  const g = typeof grid === 'string' ? parse(grid) : grid;
  return search(g, limit, null);
}

// ---------------------------------------------------------------------------
// RNG: mulberry32, string seeds hashed with cyrb53-style mixing to 32 bits.

function hashString(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 ^ h2) >>> 0;
}

export function rng(seed) {
  let a = typeof seed === 'string' ? hashString(seed) : (Number(seed) >>> 0);
  return function mulberry32() {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

/**
 * Validity- and difficulty-preserving transform: digit relabelling, band/stack
 * permutation, row/column permutation within bands/stacks, optional transpose.
 */
export function transform(str, rand = Math.random) {
  const g = typeof str === 'string' ? parse(str) : str;
  const digits = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], rand);
  const bands = shuffle([0, 1, 2], rand), stacks = shuffle([0, 1, 2], rand);
  const rowMap = [], colMap = [];
  for (const b of bands) for (const r of shuffle([0, 1, 2], rand)) rowMap.push(b * 3 + r);
  for (const s of stacks) for (const c of shuffle([0, 1, 2], rand)) colMap.push(s * 3 + c);
  const transpose = rand() < 0.5;
  const out = new Array(81);
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      let src = rowMap[r] * 9 + colMap[c];
      if (transpose) src = colMap[c] * 9 + rowMap[r];
      const d = g[src];
      out[r * 9 + c] = d ? digits[d - 1] : 0;
    }
  }
  return stringify(out);
}

/**
 * Generate a random puzzle with a unique solution. Clues are removed in random
 * order (either in 180°-symmetric pairs or individually) while uniqueness holds,
 * giving a minimal (or near-minimal for symmetric) puzzle.
 * options: { symmetric?: boolean }  (default: random choice)
 */
export function generate(rand = Math.random, options = {}) {
  const solution = new Array(81).fill(0);
  search(new Array(81).fill(0), 1, solution, shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], rand));
  // search with a fixed digit order still yields varied grids because we also
  // relabel/permute randomly afterwards:
  const full = parse(transform(stringify(solution), rand));
  const symmetric = options.symmetric ?? rand() < 0.5;
  const puzzle = full.slice();
  const order = shuffle(Array.from({ length: 81 }, (_, i) => i), rand);
  const done = new Uint8Array(81);
  for (const i of order) {
    if (done[i]) continue;
    const j = 80 - i;
    done[i] = 1;
    if (symmetric) done[j] = 1;
    const a = puzzle[i], b = puzzle[j];
    puzzle[i] = 0;
    if (symmetric) puzzle[j] = 0;
    if (search(puzzle, 2, null) !== 1) {
      puzzle[i] = a;
      if (symmetric) puzzle[j] = b;
    }
  }
  return { puzzle: stringify(puzzle), solution: stringify(full) };
}
