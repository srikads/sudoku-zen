// Sudoku Zen — human-style logical solver, hints and difficulty grader.
// Every technique returns a Step (see SPEC.md) or null. All techniques are sound:
// they never remove the true solution digit nor place a wrong digit, provided the
// puzzle has a unique solution and the candidate state still contains the solution
// (unique_rectangle and bug_plus_one rely on uniqueness).

import {
  ROW, COL, BOX, UNITS, CELL_UNITS, PEERS, bitCount, digitsOf, cellName,
  computeCandidates, parse,
} from './sudoku.js';

// ---------------------------------------------------------------------------
// Small helpers

const BIT = (d) => 1 << (d - 1);
const ONE = (m) => m !== 0 && (m & (m - 1)) === 0;
const lowDigit = (m) => 32 - Math.clz32(m & -m); // lowest set digit (1-based)

const SEES = new Uint8Array(81 * 81);
for (let i = 0; i < 81; i++) for (const j of PEERS[i]) SEES[i * 81 + j] = 1;
const sees = (a, b) => SEES[a * 81 + b] === 1;

const unitName = (u) => (u < 9 ? `row ${u + 1}` : u < 18 ? `column ${u - 8}` : `box ${u - 17}`);
const unitKind = (u) => (u < 9 ? 'row' : u < 18 ? 'column' : 'box');
const cellList = (cells) => cells.map(cellName).join(', ');
const joinAnd = (items) => (items.length <= 1 ? items.join('') : items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1]);
const digitList = (ds) => joinAnd(ds.map(String));

function forCombos(arr, k, fn, start = 0, acc = []) {
  if (acc.length === k) return fn(acc);
  for (let i = start; i <= arr.length - (k - acc.length); i++) {
    acc.push(arr[i]);
    const r = forCombos(arr, k, fn, i + 1, acc);
    acc.pop();
    if (r) return r;
  }
  return null;
}

function sortCD(list) {
  return list.sort((a, b) => a.cell - b.cell || a.digit - b.digit);
}

function dedupeCD(list) {
  const seen = new Set();
  const out = [];
  for (const x of list) {
    const k = x.cell * 10 + x.digit;
    if (!seen.has(k)) { seen.add(k); out.push(x); }
  }
  return sortCD(out);
}

/** Cells (not in `cells`) that see every cell in `cells` and have candidate d. */
function commonPeersWith(state, cells, d) {
  const bit = BIT(d);
  const out = [];
  for (const j of PEERS[cells[0]]) {
    if (!(state.cands[j] & bit)) continue;
    let ok = true;
    for (let t = 1; t < cells.length; t++) {
      if (j === cells[t] || !sees(j, cells[t])) { ok = false; break; }
    }
    if (ok && !cells.includes(j)) out.push(j);
  }
  return out;
}

function elimText(d, cells) {
  return `${d} can be removed from ${cellList(cells)}`;
}

const META = {};
function step(id, placements, eliminations, highlight, text) {
  const m = META[id];
  return {
    technique: id, name: m.name, tier: m.tier,
    placements: sortCD(placements || []),
    eliminations: dedupeCD(eliminations || []),
    highlight: {
      units: highlight.units || [],
      cells: highlight.cells || [],
      cands: highlight.cands || [],
      links: highlight.links || [],
    },
    text,
  };
}

function makeState(grid, cands) {
  // pos[u*9 + d-1] : 9-bit mask of positions k in UNITS[u] holding candidate d
  const pos = new Uint16Array(27 * 9);
  for (let u = 0; u < 27; u++) {
    const cells = UNITS[u];
    for (let k = 0; k < 9; k++) {
      let m = cands[cells[k]];
      while (m) {
        const b = m & -m; m &= m - 1;
        pos[u * 9 + (31 - Math.clz32(b))] |= 1 << k;
      }
    }
  }
  return { grid, cands, pos };
}

const posCells = (u, mask) => {
  const out = [];
  for (let k = 0; k < 9; k++) if (mask & (1 << k)) out.push(UNITS[u][k]);
  return out;
};

const keyCands = (cells, d, role = 'key') => cells.map((cell) => ({ cell, digit: d, role }));
const elimCands = (elims) => elims.map((e) => ({ cell: e.cell, digit: e.digit, role: 'elim' }));

// ---------------------------------------------------------------------------
// Tier 1

function fullHouse(state) {
  const { grid } = state;
  for (let u = 0; u < 27; u++) {
    let empty = -1, n = 0, used = 0;
    for (const i of UNITS[u]) {
      if (grid[i]) used |= BIT(grid[i]);
      else { n++; empty = i; }
    }
    if (n === 1) {
      const d = lowDigit(511 & ~used);
      return step('full_house', [{ cell: empty, digit: d }], [], {
        units: [u], cells: [{ cell: empty, role: 'target' }], cands: [{ cell: empty, digit: d, role: 'place' }],
      }, `Full house: ${cellName(empty)} is the last empty cell in ${unitName(u)}, so it must be ${d}.`);
    }
  }
  return null;
}

function nakedSingle(state) {
  const { grid, cands } = state;
  for (let i = 0; i < 81; i++) {
    if (!grid[i] && ONE(cands[i])) {
      const d = lowDigit(cands[i]);
      return step('naked_single', [{ cell: i, digit: d }], [], {
        units: [], cells: [{ cell: i, role: 'target' }], cands: [{ cell: i, digit: d, role: 'place' }],
      }, `Naked single: ${cellName(i)} has only one candidate left, so it must be ${d}.`);
    }
  }
  return null;
}

const UNIT_ORDER_BOX_FIRST = [...Array(9).keys()].map((b) => 18 + b)
  .concat([...Array(9).keys()], [...Array(9).keys()].map((c) => 9 + c));

function hiddenSingle(state) {
  const { pos } = state;
  for (const u of UNIT_ORDER_BOX_FIRST) {
    for (let d = 1; d <= 9; d++) {
      const m = pos[u * 9 + d - 1];
      if (ONE(m)) {
        const cell = posCells(u, m)[0];
        return step('hidden_single', [{ cell, digit: d }], [], {
          units: [u], cells: [{ cell, role: 'target' }], cands: [{ cell, digit: d, role: 'place' }],
        }, `Hidden single: in ${unitName(u)}, ${d} can only go in ${cellName(cell)}.`);
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tier 2: locked candidates

function pointing(state) {
  const { pos, cands } = state;
  for (let b = 0; b < 9; b++) {
    const u = 18 + b;
    for (let d = 1; d <= 9; d++) {
      const m = pos[u * 9 + d - 1];
      if (bitCount(m) < 2) continue;
      const cells = posCells(u, m);
      for (const [lineOf, off] of [[ROW, 0], [COL, 9]]) {
        const l = lineOf(cells[0]);
        if (!cells.every((c) => lineOf(c) === l)) continue;
        const line = off + l;
        const elims = UNITS[line].filter((j) => BOX(j) !== b && (cands[j] & BIT(d))).map((cell) => ({ cell, digit: d }));
        if (elims.length) {
          return step('pointing', [], elims, {
            units: [u, line], cells: cells.map((cell) => ({ cell, role: 'base' })),
            cands: [...keyCands(cells, d), ...elimCands(elims)],
          }, `Pointing: in ${unitName(u)}, ${d} is confined to ${unitName(line)}, so ${elimText(d, elims.map((e) => e.cell))}.`);
        }
      }
    }
  }
  return null;
}

function claiming(state) {
  const { pos, cands } = state;
  for (let line = 0; line < 18; line++) {
    for (let d = 1; d <= 9; d++) {
      const m = pos[line * 9 + d - 1];
      if (bitCount(m) < 2) continue;
      const cells = posCells(line, m);
      const b = BOX(cells[0]);
      if (!cells.every((c) => BOX(c) === b)) continue;
      const u = 18 + b;
      const elims = UNITS[u].filter((j) => !cells.includes(j) && !CELL_UNITS[j].includes(line) && (cands[j] & BIT(d)))
        .map((cell) => ({ cell, digit: d }));
      if (elims.length) {
        return step('claiming', [], elims, {
          units: [line, u], cells: cells.map((cell) => ({ cell, role: 'base' })),
          cands: [...keyCands(cells, d), ...elimCands(elims)],
        }, `Claiming: in ${unitName(line)}, ${d} is confined to ${unitName(u)}, so ${elimText(d, elims.map((e) => e.cell))}.`);
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tiers 2-3: naked / hidden subsets

const SUBSET_WORD = { 2: 'pair', 3: 'triple', 4: 'quad' };
const UNIT_ORDER = [...Array(27).keys()];

function nakedSubset(n, id) {
  return (state) => {
    const { grid, cands } = state;
    for (const u of UNIT_ORDER) {
      const empties = UNITS[u].filter((i) => !grid[i]);
      if (empties.length <= n) continue;
      const pool = empties.filter((i) => bitCount(cands[i]) >= 2 && bitCount(cands[i]) <= n);
      const res = forCombos(pool, n, (set) => {
        let m = 0;
        for (const i of set) m |= cands[i];
        if (bitCount(m) !== n) return null;
        const elims = [];
        for (const j of empties) {
          if (set.includes(j)) continue;
          for (const d of digitsOf(cands[j] & m)) elims.push({ cell: j, digit: d });
        }
        if (!elims.length) return null;
        const ds = digitsOf(m);
        const keys = [];
        for (const i of set) for (const d of digitsOf(cands[i])) keys.push({ cell: i, digit: d, role: 'key' });
        const cellsSorted = [...set].sort((a, b) => a - b);
        return step(id, [], elims, {
          units: [u], cells: cellsSorted.map((cell) => ({ cell, role: 'base' })),
          cands: [...keys, ...elimCands(elims)],
        }, `Naked ${SUBSET_WORD[n]}: in ${unitName(u)}, cells ${cellList(cellsSorted)} can only hold ${digitList(ds)}, so these digits can be removed from the other cells of the ${unitKind(u)} (${cellList([...new Set(elims.map((e) => e.cell))])}).`);
      });
      if (res) return res;
    }
    return null;
  };
}

function hiddenSubset(n, id) {
  return (state) => {
    const { grid, cands, pos } = state;
    for (const u of UNIT_ORDER) {
      const empties = UNITS[u].filter((i) => !grid[i]);
      if (empties.length <= n) continue;
      const ds = [];
      for (let d = 1; d <= 9; d++) {
        const c = bitCount(pos[u * 9 + d - 1]);
        if (c >= 2 && c <= n) ds.push(d);
      }
      const res = forCombos(ds, n, (set) => {
        let m = 0, dm = 0;
        for (const d of set) { m |= pos[u * 9 + d - 1]; dm |= BIT(d); }
        if (bitCount(m) !== n) return null;
        const cells = posCells(u, m);
        const elims = [];
        for (const c of cells) for (const d of digitsOf(cands[c] & ~dm)) elims.push({ cell: c, digit: d });
        if (!elims.length) return null;
        const keys = [];
        for (const c of cells) for (const d of digitsOf(cands[c] & dm)) keys.push({ cell: c, digit: d, role: 'key' });
        return step(id, [], elims, {
          units: [u], cells: cells.map((cell) => ({ cell, role: 'base' })),
          cands: [...keys, ...elimCands(elims)],
        }, `Hidden ${SUBSET_WORD[n]}: in ${unitName(u)}, ${digitList(set)} can only go in ${cellList(cells)}, so all other candidates can be removed from these cells.`);
      });
      if (res) return res;
    }
    return null;
  };
}

// ---------------------------------------------------------------------------
// Fish (basic and finned)

const FISH_NAME = { 2: 'X-Wing', 3: 'Swordfish', 4: 'Jellyfish' };
const lineCell = (orient, base, cover) => (orient === 0 ? base * 9 + cover : cover * 9 + base);
const lineWord = (orient, plural) => (orient === 0 ? (plural ? 'rows' : 'row') : (plural ? 'columns' : 'column'));

function basicFish(n, id) {
  return (state) => {
    const { pos, cands } = state;
    for (let d = 1; d <= 9; d++) {
      const bit = BIT(d);
      for (const orient of [0, 1]) {
        const off = orient * 9, coff = 9 - off;
        const lines = [];
        for (let l = 0; l < 9; l++) {
          const c = bitCount(pos[(off + l) * 9 + d - 1]);
          if (c >= 2 && c <= n) lines.push(l);
        }
        const res = forCombos(lines, n, (base) => {
          let U = 0;
          for (const l of base) U |= pos[(off + l) * 9 + d - 1];
          if (bitCount(U) !== n) return null;
          const covers = digitsOf(U).map((x) => x - 1);
          const elims = [];
          for (const k of covers) for (let j = 0; j < 9; j++) {
            if (base.includes(j)) continue;
            const cell = lineCell(orient, j, k);
            if (cands[cell] & bit) elims.push({ cell, digit: d });
          }
          if (!elims.length) return null;
          const keyCells = [];
          for (const l of base) for (const k of covers) { const c = lineCell(orient, l, k); if (cands[c] & bit) keyCells.push(c); }
          return step(id, [], elims, {
            units: [...base.map((l) => off + l), ...covers.map((k) => coff + k)],
            cells: keyCells.map((cell) => ({ cell, role: 'base' })),
            cands: [...keyCands(keyCells, d), ...elimCands(elims)],
          }, `${FISH_NAME[n]} on ${d} in ${lineWord(orient, true)} ${joinAnd(base.map((l) => l + 1))} (${lineWord(1 - orient, true)} ${joinAnd(covers.map((k) => k + 1))}): ${elimText(d, elims.map((e) => e.cell))}.`);
        });
        if (res) return res;
      }
    }
    return null;
  };
}

function finnedFish(n, id) {
  return (state) => {
    const { pos, cands } = state;
    for (let d = 1; d <= 9; d++) {
      const bit = BIT(d);
      for (const orient of [0, 1]) {
        const off = orient * 9, coff = 9 - off;
        const lines = [];
        for (let l = 0; l < 9; l++) {
          const c = bitCount(pos[(off + l) * 9 + d - 1]);
          if (c >= 1 && c <= n + 2) lines.push(l);
        }
        const res = forCombos(lines, n, (base) => {
          let U = 0;
          for (const l of base) U |= pos[(off + l) * 9 + d - 1];
          if (bitCount(U) <= n) return null;
          const uIdx = digitsOf(U).map((x) => x - 1);
          return forCombos(uIdx, n, (covers) => {
            let C = 0;
            for (const k of covers) C |= 1 << k;
            const fins = [];
            for (const l of base) {
              const m = pos[(off + l) * 9 + d - 1];
              if (!(m & C)) return null; // each base line needs a cover candidate
              for (let k = 0; k < 9; k++) if ((m & ~C) & (1 << k)) fins.push(lineCell(orient, l, k));
            }
            if (!fins.length) return null;
            const fb = BOX(fins[0]);
            if (!fins.every((f) => BOX(f) === fb)) return null;
            const elims = [];
            for (const k of covers) for (let j = 0; j < 9; j++) {
              if (base.includes(j)) continue;
              const cell = lineCell(orient, j, k);
              if (BOX(cell) === fb && (cands[cell] & bit)) elims.push({ cell, digit: d });
            }
            if (!elims.length) return null;
            const keyCells = [];
            for (const l of base) for (const k of covers) { const c = lineCell(orient, l, k); if (cands[c] & bit) keyCells.push(c); }
            return step(id, [], elims, {
              units: [...base.map((l) => off + l), ...covers.map((k) => coff + k)],
              cells: [...keyCells.map((cell) => ({ cell, role: 'base' })), ...fins.map((cell) => ({ cell, role: 'fin' }))],
              cands: [...keyCands(keyCells, d), ...keyCands(fins, d), ...elimCands(elims)],
            }, `Finned ${FISH_NAME[n]} on ${d} in ${lineWord(orient, true)} ${joinAnd(base.map((l) => l + 1))} (${lineWord(1 - orient, true)} ${joinAnd(covers.map((k) => k + 1))}, fin${fins.length > 1 ? "s" : ""} ${cellList(fins)}): either the ${FISH_NAME[n]} holds or a fin is ${d}; both remove ${d} from ${cellList(elims.map((e) => e.cell))}.`);
          });
        });
        if (res) return res;
      }
    }
    return null;
  };
}

// ---------------------------------------------------------------------------
// Single-digit patterns

/** Conjugate pairs for digit d: [{a, b, u}] (a < b), unit order rows, cols, boxes. */
function conjugates(state, d, units = UNIT_ORDER) {
  const out = [];
  for (const u of units) {
    const m = state.pos[u * 9 + d - 1];
    if (bitCount(m) === 2) {
      const [a, b] = posCells(u, m);
      out.push({ a, b, u });
    }
  }
  return out;
}

function skyscraper(state) {
  for (let d = 1; d <= 9; d++) {
    for (const orient of [0, 1]) {
      const units = orient === 0 ? [...Array(9).keys()] : [...Array(9).keys()].map((x) => 9 + x);
      const pairs = conjugates(state, d, units);
      const other = orient === 0 ? COL : ROW;
      for (let x = 0; x < pairs.length; x++) for (let y = x + 1; y < pairs.length; y++) {
        const P = pairs[x], Q = pairs[y];
        for (const [p1, p2] of [[P.a, P.b], [P.b, P.a]]) for (const [q1, q2] of [[Q.a, Q.b], [Q.b, Q.a]]) {
          if (other(p1) !== other(q1) || other(p2) === other(q2)) continue;
          const elimCells = commonPeersWith(state, [p2, q2], d).filter((c) => c !== p1 && c !== q1);
          if (!elimCells.length) continue;
          const elims = elimCells.map((cell) => ({ cell, digit: d }));
          return step('skyscraper', [], elims, {
            units: [P.u, Q.u],
            cells: [{ cell: p1, role: 'base' }, { cell: q1, role: 'base' }, { cell: p2, role: 'pincer' }, { cell: q2, role: 'pincer' }],
            cands: [...keyCands([p1, q1, p2, q2], d), ...elimCands(elims)],
            links: [
              { from: { cell: p2, digit: d }, to: { cell: p1, digit: d }, strong: true },
              { from: { cell: p1, digit: d }, to: { cell: q1, digit: d }, strong: false },
              { from: { cell: q1, digit: d }, to: { cell: q2, digit: d }, strong: true },
            ],
          }, `Skyscraper on ${d}: in ${unitName(P.u)} and ${unitName(Q.u)}, ${d} has only two places each, and ${cellName(p1)} and ${cellName(q1)} share a ${orient === 0 ? 'column' : 'row'}. So ${cellName(p2)} or ${cellName(q2)} must be ${d}, and ${elimText(d, elimCells)}.`);
        }
      }
    }
  }
  return null;
}

function twoStringKite(state) {
  const rowUnits = [...Array(9).keys()], colUnits = rowUnits.map((x) => 9 + x);
  for (let d = 1; d <= 9; d++) {
    const bit = BIT(d);
    const rp = conjugates(state, d, rowUnits), cp = conjugates(state, d, colUnits);
    for (const R of rp) for (const C of cp) {
      for (const [x, x2] of [[R.a, R.b], [R.b, R.a]]) for (const [y, y2] of [[C.a, C.b], [C.b, C.a]]) {
        if (x === y || BOX(x) !== BOX(y)) continue;
        if (BOX(x2) === BOX(x) || BOX(y2) === BOX(x) || x2 === y2 || x2 === y || y2 === x) continue;
        const t = ROW(y2) * 9 + COL(x2);
        if (!(state.cands[t] & bit) || t === x || t === y) continue;
        const elims = [{ cell: t, digit: d }];
        return step('two_string_kite', [], elims, {
          units: [R.u, C.u, 18 + BOX(x)],
          cells: [{ cell: x, role: 'base' }, { cell: y, role: 'base' }, { cell: x2, role: 'pincer' }, { cell: y2, role: 'pincer' }, { cell: t, role: 'target' }],
          cands: [...keyCands([x, y, x2, y2], d), ...elimCands(elims)],
          links: [
            { from: { cell: x2, digit: d }, to: { cell: x, digit: d }, strong: true },
            { from: { cell: x, digit: d }, to: { cell: y, digit: d }, strong: false },
            { from: { cell: y, digit: d }, to: { cell: y2, digit: d }, strong: true },
          ],
        }, `2-String Kite on ${d}: ${d} has only two places in ${unitName(R.u)} and in ${unitName(C.u)}; ${cellName(x)} and ${cellName(y)} share box ${BOX(x) + 1}, so ${cellName(x2)} or ${cellName(y2)} must be ${d}. ${cellName(t)} sees both, so ${d} can be removed from it.`);
      }
    }
  }
  return null;
}

function emptyRectangle(state) {
  const { pos, cands } = state;
  for (let d = 1; d <= 9; d++) {
    const bit = BIT(d);
    for (let b = 0; b < 9; b++) {
      const u = 18 + b;
      const m = pos[u * 9 + d - 1];
      if (bitCount(m) < 2) continue;
      const cells = posCells(u, m);
      const r0 = 3 * ((b / 3) | 0), c0 = 3 * (b % 3);
      for (let R = r0; R < r0 + 3; R++) for (let C = c0; C < c0 + 3; C++) {
        if (!cells.every((c) => ROW(c) === R || COL(c) === C)) continue;
        if (!cells.some((c) => ROW(c) === R && COL(c) !== C) || !cells.some((c) => COL(c) === C && ROW(c) !== R)) continue;
        // conjugate pair in a column outside the box stack, one end in row R
        for (let X = 0; X < 9; X++) {
          if (X >= c0 && X < c0 + 3) continue;
          const pm = pos[(9 + X) * 9 + d - 1];
          if (bitCount(pm) !== 2) continue;
          const [p, q] = posCells(9 + X, pm);
          for (const [e1, e2] of [[p, q], [q, p]]) {
            if (ROW(e1) !== R || (ROW(e2) >= r0 && ROW(e2) < r0 + 3)) continue;
            const t = ROW(e2) * 9 + C;
            if (!(cands[t] & bit)) continue;
            return erStep(d, u, cells, R, C, 9 + X, e1, e2, t);
          }
        }
        // conjugate pair in a row outside the box band, one end in column C
        for (let Y = 0; Y < 9; Y++) {
          if (Y >= r0 && Y < r0 + 3) continue;
          const pm = pos[Y * 9 + d - 1];
          if (bitCount(pm) !== 2) continue;
          const [p, q] = posCells(Y, pm);
          for (const [e1, e2] of [[p, q], [q, p]]) {
            if (COL(e1) !== C || (COL(e2) >= c0 && COL(e2) < c0 + 3)) continue;
            const t = R * 9 + COL(e2);
            if (!(cands[t] & bit)) continue;
            return erStep(d, u, cells, R, C, Y, e1, e2, t);
          }
        }
      }
    }
  }
  return null;
}

function erStep(d, u, cells, R, C, line, e1, e2, t) {
  const elims = [{ cell: t, digit: d }];
  return step('empty_rectangle', [], elims, {
    units: [u, line],
    cells: [...cells.map((cell) => ({ cell, role: 'base' })), { cell: e1, role: 'pincer' }, { cell: e2, role: 'pincer' }, { cell: t, role: 'target' }],
    cands: [...keyCands([...cells, e1, e2], d), ...elimCands(elims)],
    links: [{ from: { cell: e2, digit: d }, to: { cell: e1, digit: d }, strong: true }],
  }, `Empty rectangle on ${d}: in ${unitName(u)}, ${d} lies only in row ${R + 1} or column ${C + 1}. ${d} has only two places in ${unitName(line)} (${cellName(e1)}, ${cellName(e2)}). If ${cellName(t)} were ${d}, ${cellName(e1)} would be ${d} too and box ${u - 17} would have no place for ${d}. So ${d} can be removed from ${cellName(t)}.`);
}

function simpleColoring(state) {
  const { cands } = state;
  for (let d = 1; d <= 9; d++) {
    const bit = BIT(d);
    const pairs = conjugates(state, d);
    if (pairs.length < 2) continue;
    const adj = new Map();
    const addEdge = (a, b) => {
      if (!adj.has(a)) adj.set(a, new Set());
      if (!adj.has(b)) adj.set(b, new Set());
      adj.get(a).add(b); adj.get(b).add(a);
    };
    for (const p of pairs) addEdge(p.a, p.b);
    const color = new Map();
    const nodes = [...adj.keys()].sort((a, b) => a - b);
    for (const s of nodes) {
      if (color.has(s)) continue;
      const comp = [s];
      color.set(s, 0);
      const links = [];
      for (let qi = 0; qi < comp.length; qi++) {
        const x = comp[qi];
        for (const y of [...adj.get(x)].sort((a, b) => a - b)) {
          if (!color.has(y)) { color.set(y, 1 - color.get(x)); comp.push(y); links.push({ from: { cell: x, digit: d }, to: { cell: y, digit: d }, strong: true }); }
        }
      }
      if (comp.length < 3) continue;
      const A = comp.filter((c) => color.get(c) === 0).sort((a, b) => a - b);
      const B = comp.filter((c) => color.get(c) === 1).sort((a, b) => a - b);
      const hl = (elims) => ({
        units: [],
        cells: [],
        cands: [...keyCands(A, d, 'colorA'), ...keyCands(B, d, 'colorB'), ...elimCands(elims)].filter((x, i, arr) => x.role === 'elim' || !arr.some((y) => y.role === 'elim' && y.cell === x.cell)),
        links,
      });
      // Color wrap: two cells of one color see each other -> that color is false.
      for (const [S, name] of [[A, 'A'], [B, 'B']]) {
        let clash = null;
        for (let i = 0; i < S.length && !clash; i++) for (let j = i + 1; j < S.length; j++) if (sees(S[i], S[j])) { clash = [S[i], S[j]]; break; }
        if (clash) {
          const elims = S.map((cell) => ({ cell, digit: d }));
          return step('simple_coloring', [], elims, hl(elims),
            `Simple coloring on ${d} (color wrap): following the strong links for ${d}, ${cellName(clash[0])} and ${cellName(clash[1])} get the same color ${name} but see each other, so color ${name} is false and ${elimText(d, S)}.`);
        }
      }
      // Color trap: an uncolored cell seeing both colors.
      const elimCells = [];
      for (let i = 0; i < 81; i++) {
        if (!(cands[i] & bit) || color.has(i)) continue;
        if (A.some((a) => sees(a, i)) && B.some((b) => sees(b, i))) elimCells.push(i);
      }
      if (elimCells.length) {
        const elims = elimCells.map((cell) => ({ cell, digit: d }));
        return step('simple_coloring', [], elims, hl(elims),
          `Simple coloring on ${d} (color trap): following the strong links for ${d}, one of the two colors must be true. ${cellList(elimCells)} ${elimCells.length > 1 ? 'see' : 'sees'} both colors, so ${elimText(d, elimCells)}.`);
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Wings

function xyWing(state) {
  const { grid, cands } = state;
  for (let p = 0; p < 81; p++) {
    if (grid[p] || bitCount(cands[p]) !== 2) continue;
    const pm = cands[p];
    const [x, y] = digitsOf(pm);
    const peers = PEERS[p].filter((j) => bitCount(cands[j]) === 2 && cands[j] !== pm && bitCount(cands[j] & pm) === 1);
    for (const a of peers) {
      if (!(cands[a] & BIT(x))) continue;
      const z = lowDigit(cands[a] & ~pm);
      for (const b of peers) {
        if (b === a || cands[b] !== (BIT(y) | BIT(z))) continue;
        const elimCells = commonPeersWith(state, [a, b], z).filter((c) => c !== p);
        if (!elimCells.length) continue;
        const elims = elimCells.map((cell) => ({ cell, digit: z }));
        return step('xy_wing', [], elims, {
          units: [],
          cells: [{ cell: p, role: 'pivot' }, { cell: a, role: 'pincer' }, { cell: b, role: 'pincer' }],
          cands: [{ cell: p, digit: x, role: 'key' }, { cell: p, digit: y, role: 'key' }, { cell: a, digit: x, role: 'key' }, { cell: a, digit: z, role: 'key' },
            { cell: b, digit: y, role: 'key' }, { cell: b, digit: z, role: 'key' }, ...elimCands(elims)],
          links: [
            { from: { cell: p, digit: x }, to: { cell: a, digit: x }, strong: false },
            { from: { cell: p, digit: y }, to: { cell: b, digit: y }, strong: false },
          ],
        }, `XY-Wing: pivot ${cellName(p)} {${x}${y}} with pincers ${cellName(a)} {${x}${z}} and ${cellName(b)} {${y}${z}}. Whatever the pivot is, one pincer must be ${z}, so ${elimText(z, elimCells)}.`);
      }
    }
  }
  return null;
}

function wWing(state) {
  const { grid, cands } = state;
  const biv = [];
  for (let i = 0; i < 81; i++) if (!grid[i] && bitCount(cands[i]) === 2) biv.push(i);
  const pairsByDigit = [];
  for (let d = 1; d <= 9; d++) pairsByDigit[d] = conjugates(state, d);
  for (let s = 0; s < biv.length; s++) for (let t = s + 1; t < biv.length; t++) {
    const A = biv[s], B = biv[t];
    if (cands[A] !== cands[B] || sees(A, B)) continue;
    const [d1, d2] = digitsOf(cands[A]);
    for (const [x, y] of [[d1, d2], [d2, d1]]) {
      const elimCells = commonPeersWith(state, [A, B], y);
      if (!elimCells.length) continue;
      for (const P of pairsByDigit[x]) {
        for (const [p, q] of [[P.a, P.b], [P.b, P.a]]) {
          if (p === A || p === B || q === A || q === B) continue;
          if (!sees(p, A) || !sees(q, B)) continue;
          const elims = elimCells.map((cell) => ({ cell, digit: y }));
          return step('w_wing', [], elims, {
            units: [P.u],
            cells: [{ cell: A, role: 'pincer' }, { cell: B, role: 'pincer' }, { cell: p, role: 'base' }, { cell: q, role: 'base' }],
            cands: [{ cell: A, digit: x, role: 'key' }, { cell: A, digit: y, role: 'key' }, { cell: B, digit: x, role: 'key' }, { cell: B, digit: y, role: 'key' },
              { cell: p, digit: x, role: 'key' }, { cell: q, digit: x, role: 'key' }, ...elimCands(elims)],
            links: [
              { from: { cell: A, digit: x }, to: { cell: p, digit: x }, strong: false },
              { from: { cell: p, digit: x }, to: { cell: q, digit: x }, strong: true },
              { from: { cell: q, digit: x }, to: { cell: B, digit: x }, strong: false },
            ],
          }, `W-Wing: ${cellName(A)} and ${cellName(B)} both hold {${x}${y}}, and ${x} in ${unitName(P.u)} must be in ${cellName(p)} or ${cellName(q)}. They cannot both be ${x}, so one of them is ${y}: ${elimText(y, elimCells)}.`);
        }
      }
    }
  }
  return null;
}

function xyzWing(state) {
  const { grid, cands } = state;
  for (let p = 0; p < 81; p++) {
    if (grid[p] || bitCount(cands[p]) !== 3) continue;
    const pm = cands[p];
    const peers = PEERS[p].filter((j) => bitCount(cands[j]) === 2 && (cands[j] & ~pm) === 0);
    for (let s = 0; s < peers.length; s++) for (let t = s + 1; t < peers.length; t++) {
      const a = peers[s], b = peers[t];
      if (cands[a] === cands[b] || (cands[a] | cands[b]) !== pm) continue;
      const z = lowDigit(cands[a] & cands[b]);
      const elimCells = commonPeersWith(state, [p, a, b], z);
      if (!elimCells.length) continue;
      const elims = elimCells.map((cell) => ({ cell, digit: z }));
      const keys = [];
      for (const c of [p, a, b]) for (const d of digitsOf(cands[c])) keys.push({ cell: c, digit: d, role: 'key' });
      return step('xyz_wing', [], elims, {
        units: [],
        cells: [{ cell: p, role: 'pivot' }, { cell: a, role: 'pincer' }, { cell: b, role: 'pincer' }],
        cands: [...keys, ...elimCands(elims)],
      }, `XYZ-Wing: pivot ${cellName(p)} {${digitsOf(pm).join('')}} with pincers ${cellName(a)} {${digitsOf(cands[a]).join('')}} and ${cellName(b)} {${digitsOf(cands[b]).join('')}}. One of the three must be ${z}, so ${elimText(z, elimCells)}.`);
    }
  }
  return null;
}

function wxyzWing(state) {
  const { grid, cands } = state;
  for (let p = 0; p < 81; p++) {
    if (grid[p]) continue;
    const pm = cands[p];
    const pc = bitCount(pm);
    if (pc < 2 || pc > 4) continue;
    const pool = PEERS[p].filter((j) => !grid[j] && bitCount(cands[j]) >= 2 && bitCount(cands[j] | pm) <= 4);
    const res = forCombos(pool, 3, (trip) => {
      let U = pm;
      for (const c of trip) U |= cands[c];
      if (bitCount(U) !== 4) return null;
      const set = [p, ...trip];
      let z = 0, zCells = null;
      for (const d of digitsOf(U)) {
        const withD = set.filter((c) => cands[c] & BIT(d));
        let restricted = true;
        for (let i = 0; i < withD.length && restricted; i++) for (let j = i + 1; j < withD.length; j++) if (!sees(withD[i], withD[j])) { restricted = false; break; }
        if (!restricted) {
          if (z) return null; // more than one non-restricted digit
          z = d; zCells = withD;
        }
      }
      if (!z) return null;
      const elimCells = commonPeersWith(state, zCells, z).filter((c) => !set.includes(c));
      if (!elimCells.length) return null;
      const elims = elimCells.map((cell) => ({ cell, digit: z }));
      const keys = [];
      for (const c of set) for (const d of digitsOf(cands[c])) keys.push({ cell: c, digit: d, role: 'key' });
      return step('wxyz_wing', [], elims, {
        units: [],
        cells: [{ cell: p, role: 'pivot' }, ...trip.map((cell) => ({ cell, role: 'pincer' }))],
        cands: [...keys, ...elimCands(elims)],
      }, `WXYZ-Wing: the four cells ${cellList(set)} hold only the digits ${digitList(digitsOf(U))}. Every digit except ${z} can appear at most once among them, so at least one of ${cellList(zCells)} must be ${z}: ${elimText(z, elimCells)}.`);
    });
    if (res) return res;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Uniqueness

function uniqueRectangle(state) {
  const { grid, cands, pos } = state;
  for (let r1 = 0; r1 < 9; r1++) for (let r2 = r1 + 1; r2 < 9; r2++) {
    for (let c1 = 0; c1 < 9; c1++) for (let c2 = c1 + 1; c2 < 9; c2++) {
      const sameBand = ((r1 / 3) | 0) === ((r2 / 3) | 0);
      const sameStack = ((c1 / 3) | 0) === ((c2 / 3) | 0);
      if (sameBand === sameStack) continue; // must span exactly two boxes
      const cells = [r1 * 9 + c1, r1 * 9 + c2, r2 * 9 + c1, r2 * 9 + c2];
      if (cells.some((c) => grid[c])) continue;
      const common = cands[cells[0]] & cands[cells[1]] & cands[cells[2]] & cands[cells[3]];
      if (bitCount(common) < 2) continue;
      const cds = digitsOf(common);
      for (let x = 0; x < cds.length; x++) for (let y = x + 1; y < cds.length; y++) {
        const a = cds[x], b = cds[y], ab = BIT(a) | BIT(b);
        const floor = cells.filter((c) => cands[c] === ab);
        const roof = cells.filter((c) => cands[c] !== ab);
        const keys = [];
        for (const c of cells) keys.push({ cell: c, digit: a, role: 'key' }, { cell: c, digit: b, role: 'key' });
        const baseHl = (elims, extra = []) => ({
          units: [],
          cells: [...floor.map((cell) => ({ cell, role: 'base' })), ...roof.map((cell) => ({ cell, role: 'target' }))],
          cands: [...keys.filter((k) => !elims.some((e) => e.cell === k.cell && e.digit === k.digit)), ...extra, ...elimCands(elims)],
        });
        const intro = `Unique rectangle ${cellList(cells)} on {${a}${b}}`;
        if (floor.length === 3) {
          const t = roof[0];
          const elims = [{ cell: t, digit: a }, { cell: t, digit: b }];
          return step('unique_rectangle', [], elims, baseHl(elims),
            `${intro} (type 1): if ${cellName(t)} were ${a} or ${b}, the four cells could swap ${a} and ${b} and the puzzle would have two solutions. So ${a} and ${b} can be removed from ${cellName(t)}.`);
        }
        if (floor.length !== 2) continue;
        const [f1, f2] = floor, [g1, g2] = roof;
        if (ROW(f1) !== ROW(f2) && COL(f1) !== COL(f2)) continue; // diagonal floor: not type 2/4
        // Type 2: both roof cells have exactly one same extra candidate c.
        const e1 = cands[g1] & ~ab, e2 = cands[g2] & ~ab;
        if (e1 === e2 && ONE(e1)) {
          const c = lowDigit(e1);
          const elimCells = commonPeersWith(state, [g1, g2], c);
          if (elimCells.length) {
            const elims = elimCells.map((cell) => ({ cell, digit: c }));
            return step('unique_rectangle', [], elims, baseHl(elims, [{ cell: g1, digit: c, role: 'key' }, { cell: g2, digit: c, role: 'key' }]),
              `${intro} (type 2): to avoid two solutions, ${cellName(g1)} or ${cellName(g2)} must be ${c}, so ${elimText(c, elimCells)}.`);
          }
        }
        // Type 4: in a unit shared by both roof cells, one of a/b appears only in the roof.
        const shared = CELL_UNITS[g1].filter((u) => CELL_UNITS[g2].includes(u));
        for (const u of shared) {
          for (const [k, o] of [[a, b], [b, a]]) {
            const m = pos[u * 9 + k - 1];
            const inUnit = posCells(u, m);
            if (inUnit.length !== 2 || !inUnit.includes(g1) || !inUnit.includes(g2)) continue;
            const elims = [{ cell: g1, digit: o }, { cell: g2, digit: o }];
            return step('unique_rectangle', [], elims, { ...baseHl(elims), units: [u] },
              `${intro} (type 4): ${k} must be in ${cellName(g1)} or ${cellName(g2)} (the only places in ${unitName(u)}). If either also were ${o}, the rectangle could swap ${a}/${b}; so ${o} can be removed from both.`);
          }
        }
      }
    }
  }
  return null;
}

function bugPlusOne(state) {
  const { grid, cands, pos } = state;
  let special = -1;
  for (let i = 0; i < 81; i++) {
    if (grid[i]) continue;
    const n = bitCount(cands[i]);
    if (n === 2) continue;
    if (n === 3 && special < 0) { special = i; continue; }
    return null;
  }
  if (special < 0) return null;
  const rowU = ROW(special);
  let d = 0;
  for (const x of digitsOf(cands[special])) if (bitCount(pos[rowU * 9 + x - 1]) === 3) d = x;
  if (!d) return null;
  for (let u = 0; u < 27; u++) {
    const has = CELL_UNITS[special].includes(u);
    for (let x = 1; x <= 9; x++) {
      const c = bitCount(pos[u * 9 + x - 1]);
      const expect = has && x === d ? 3 : null;
      if (expect ? c !== 3 : (c !== 0 && c !== 2)) return null;
    }
  }
  return step('bug_plus_one', [{ cell: special, digit: d }], [], {
    units: CELL_UNITS[special],
    cells: [{ cell: special, role: 'target' }],
    cands: [...digitsOf(cands[special]).filter((x) => x !== d).map((x) => ({ cell: special, digit: x, role: 'key' })), { cell: special, digit: d, role: 'place' }],
  }, `BUG+1: every unsolved cell has two candidates except ${cellName(special)}. Without ${d} there, the grid would be a deadly pattern with two solutions, so ${cellName(special)} must be ${d}.`);
}

// ---------------------------------------------------------------------------
// Chains (X-chain, XY-chain, AIC) via breadth-first search over
// (cell, digit, on/off) states. A chain starts with "start is OFF" and every
// strong link goes OFF -> ON, every weak link ON -> OFF. Reaching "end is ON"
// proves: start ON or end ON.

const NODE = (cell, d) => cell * 9 + d - 1;
const NCELL = (n) => (n / 9) | 0;
const NDIG = (n) => (n % 9) + 1;
const nodeName = (n) => `(${NDIG(n)})${cellName(NCELL(n))}`;

function chainFind(state, mode, maxLen) {
  const { grid, cands, pos } = state;
  const useUnit = mode !== 'xy', useCell = mode !== 'x';
  const parent = new Int32Array(81 * 9 * 2);
  const depth = new Int16Array(81 * 9 * 2);
  let best = null;

  const starts = [];
  for (let i = 0; i < 81; i++) {
    if (grid[i]) continue;
    if (mode === 'xy' && bitCount(cands[i]) !== 2) continue;
    for (const d of digitsOf(cands[i])) starts.push(NODE(i, d));
  }
  // x-chains: one digit at a time, in digit order
  if (mode === 'x') starts.sort((a, b) => NDIG(a) - NDIG(b) || a - b);

  for (const s of starts) {
    parent.fill(-1);
    const queue = [s * 2]; // state = node*2 + on
    parent[s * 2] = s * 2;
    depth[s * 2] = 0;
    const limit = best ? Math.min(maxLen, best.len - 1) : maxLen;
    for (let qi = 0; qi < queue.length; qi++) {
      const st = queue[qi];
      const n = st >> 1, on = st & 1, dep = depth[st];
      if (on && dep >= 3) {
        const concl = chainConclusion(state, mode, s, n);
        if (concl && (!best || dep < best.len)) {
          const path = [];
          for (let x = st; ; x = parent[x]) { path.push(x); if (x === s * 2) break; }
          path.reverse();
          const nodes = path.map((x) => x >> 1);
          const inner = n === s ? nodes.slice(0, -1) : nodes;
          if (new Set(inner).size === inner.length) { best = { len: dep, path, concl, s }; break; }
        }
      }
      if (dep >= limit) continue;
      const cell = NCELL(n), d = NDIG(n), bit = BIT(d);
      const push = (nn, nOn) => {
        const ns = nn * 2 + nOn;
        if (parent[ns] !== -1) return;
        parent[ns] = st; depth[ns] = dep + 1; queue.push(ns);
      };
      if (!on) {
        // strong links OFF -> ON
        if (useUnit) for (const u of CELL_UNITS[cell]) {
          const m = pos[u * 9 + d - 1];
          if (bitCount(m) === 2) for (const o of posCells(u, m)) if (o !== cell) push(NODE(o, d), 1);
        }
        if (useCell && bitCount(cands[cell]) === 2) push(NODE(cell, lowDigit(cands[cell] & ~bit)), 1);
      } else {
        // weak links ON -> OFF
        for (const j of PEERS[cell]) {
          if (!(cands[j] & bit)) continue;
          if (mode === 'xy' && bitCount(cands[j]) !== 2) continue;
          push(NODE(j, d), 0);
        }
        if (mode === 'aic') for (const e of digitsOf(cands[cell] & ~bit)) push(NODE(cell, e), 0);
      }
    }
  }
  if (!best) return null;
  return chainStep(state, mode, best);
}

/** Given start node s (assumed OFF) and end node e (proved ON), what follows? */
function chainConclusion(state, mode, s, e) {
  const { cands } = state;
  const sc = NCELL(s), sd = NDIG(s), ec = NCELL(e), ed = NDIG(e);
  if (e === s) return mode === 'aic' ? { placements: [{ cell: sc, digit: sd }], eliminations: [] } : null;
  if (sd === ed && sc !== ec) {
    const cells = commonPeersWith(state, [sc, ec], sd);
    return cells.length ? { placements: [], eliminations: cells.map((cell) => ({ cell, digit: sd })) } : null;
  }
  if (mode !== 'aic') return null;
  if (sc === ec) {
    const elims = digitsOf(cands[sc] & ~(BIT(sd) | BIT(ed))).map((digit) => ({ cell: sc, digit }));
    return elims.length ? { placements: [], eliminations: elims } : null;
  }
  if (sees(sc, ec)) {
    const elims = [];
    if (cands[sc] & BIT(ed)) elims.push({ cell: sc, digit: ed });
    if (cands[ec] & BIT(sd)) elims.push({ cell: ec, digit: sd });
    return elims.length ? { placements: [], eliminations: elims } : null;
  }
  return null;
}

const CHAIN_ID = { x: 'x_chain', xy: 'xy_chain', aic: 'aic' };

function chainStep(state, mode, best) {
  const { path, concl, s } = best;
  const nodes = path.map((x) => x >> 1);
  const e = nodes[nodes.length - 1];
  const links = [];
  let txt = nodeName(nodes[0]);
  for (let k = 1; k < path.length; k++) {
    const strong = (path[k] & 1) === 1;
    links.push({ from: { cell: NCELL(nodes[k - 1]), digit: NDIG(nodes[k - 1]) }, to: { cell: NCELL(nodes[k]), digit: NDIG(nodes[k]) }, strong });
    txt += (strong ? ' = ' : ' - ') + nodeName(nodes[k]);
  }
  const cands = path.map((x) => ({ cell: NCELL(x >> 1), digit: NDIG(x >> 1), role: (x & 1) ? 'colorA' : 'colorB' }));
  const elimC = elimCands(concl.eliminations);
  const placeC = concl.placements.map((p) => ({ ...p, role: 'place' }));
  const cellsSeen = [...new Set(nodes.map(NCELL))];
  const id = CHAIN_ID[mode];
  const lead = mode === 'x' ? `X-Chain on ${NDIG(s)}` : mode === 'xy' ? 'XY-Chain' : 'Alternating inference chain';
  let result;
  if (concl.placements.length) {
    result = `If ${nodeName(s)} were false, the chain would force it to be true, so ${cellName(NCELL(s))} must be ${NDIG(s)}.`;
  } else {
    const byDigit = new Map();
    for (const el of concl.eliminations) { if (!byDigit.has(el.digit)) byDigit.set(el.digit, []); byDigit.get(el.digit).push(el.cell); }
    const parts = [...byDigit].map(([d, cs]) => elimText(d, cs));
    result = `Either ${nodeName(s)} or ${nodeName(e)} is true, so ${joinAnd(parts)}.`;
  }
  return step(id, concl.placements, concl.eliminations, {
    units: [],
    cells: cellsSeen.map((cell, k) => ({ cell, role: k === 0 || cell === NCELL(e) ? 'pincer' : 'base' })),
    cands: [...cands.filter((c) => !concl.eliminations.some((x) => x.cell === c.cell && x.digit === c.digit)), ...elimC, ...placeC],
    links,
  }, `${lead}: ${txt}. ${result}`);
}

// ---------------------------------------------------------------------------
// Forcing chains (last resort). Each branch assumes a placement and propagates
// with singles (and, at the deeper level, locked candidates / pairs). A branch
// that ends in a contradiction eliminates its assumption; consequences common to
// every branch of a cell or of a digit in a unit are applied.

function propagate(grid0, cands0, cell, digit, deep) {
  const g = grid0.slice(), c = cands0.slice();
  let contradiction = null;
  const place = (i, d) => {
    const b = BIT(d);
    if (!(c[i] & b)) { contradiction = { cell: i }; return; }
    g[i] = d; c[i] = 0;
    for (const j of PEERS[i]) {
      if (g[j] === d) { contradiction = { cell: j }; return; }
      c[j] &= ~b;
    }
  };
  place(cell, digit);
  let guard = 0;
  while (!contradiction && guard++ < 200) {
    let changed = false;
    for (let i = 0; i < 81 && !contradiction; i++) {
      if (g[i]) continue;
      if (!c[i]) { contradiction = { cell: i }; break; }
      if (ONE(c[i])) { place(i, lowDigit(c[i])); changed = true; }
    }
    if (contradiction) break;
    for (let u = 0; u < 27 && !contradiction; u++) {
      let placed = 0;
      for (const i of UNITS[u]) if (g[i]) placed |= BIT(g[i]);
      for (let d = 1; d <= 9 && !contradiction; d++) {
        if (placed & BIT(d)) continue;
        let where = -1, n = 0;
        for (const i of UNITS[u]) if (c[i] & BIT(d)) { n++; where = i; }
        if (n === 0) { contradiction = { unit: u, digit: d }; break; }
        if (n === 1) { place(where, d); placed |= BIT(d); changed = true; }
      }
    }
    if (!changed && !contradiction && deep) {
      const st = makeState(g, c);
      for (const t of DEEP_TECHS) {
        const s = t(st);
        if (s) { applyStep(g, c, s); changed = true; break; }
      }
    }
    if (!changed) break;
  }
  return { g, c, contradiction };
}

function forcingChain(state) {
  const { grid, cands, pos } = state;
  for (const deep of [false, true]) {
    for (const maxN of [2, 3, 9]) {
      // cell forcing
      for (let i = 0; i < 81; i++) {
        if (grid[i]) continue;
        const n = bitCount(cands[i]);
        if (n > maxN || (maxN > 2 && n <= (maxN === 3 ? 2 : 3))) continue;
        const branches = digitsOf(cands[i]).map((d) => ({ cell: i, digit: d, r: propagate(grid, cands, i, d, deep) }));
        const s = forcingConclusion(state, branches, { kind: 'cell', cell: i });
        if (s) return s;
      }
      if (maxN === 9) continue;
      // digit (unit) forcing
      for (let u = 0; u < 27; u++) for (let d = 1; d <= 9; d++) {
        const m = pos[u * 9 + d - 1];
        const n = bitCount(m);
        if (n !== maxN) continue;
        const branches = posCells(u, m).map((cell) => ({ cell, digit: d, r: propagate(grid, cands, cell, d, deep) }));
        const s = forcingConclusion(state, branches, { kind: 'unit', unit: u, digit: d });
        if (s) return s;
      }
    }
  }
  return null;
}

function contradictionText(ct) {
  if (ct.cell !== undefined) return `${cellName(ct.cell)} would be left without a valid digit`;
  return `${unitName(ct.unit)} would have no place for ${ct.digit}`;
}

function forcingConclusion(state, branches, src) {
  const { grid, cands } = state;
  const bad = branches.find((b) => b.r.contradiction);
  if (bad) {
    const ct = bad.r.contradiction;
    const elims = [{ cell: bad.cell, digit: bad.digit }];
    const targetCells = ct.cell !== undefined ? [{ cell: ct.cell, role: 'target' }] : [];
    return step('forcing_chain', [], elims, {
      units: ct.unit !== undefined ? [ct.unit] : [],
      cells: [{ cell: bad.cell, role: 'pivot' }, ...targetCells.filter((t) => t.cell !== bad.cell)],
      cands: elimCands(elims),
    }, `Forcing chain: if ${cellName(bad.cell)} were ${bad.digit}, following the forced moves ${contradictionText(ct)}. So ${bad.digit} can be removed from ${cellName(bad.cell)}.`);
  }
  const srcText = src.kind === 'cell'
    ? `${cellName(src.cell)} must be ${digitList(branches.map((b) => b.digit)).replace(/ and /, ' or ')}`
    : `${src.digit} in ${unitName(src.unit)} must go in ${cellList(branches.map((b) => b.cell)).replace(/, ([^,]*)$/, ' or $1')}`;
  const pivotHl = {
    units: src.kind === 'unit' ? [src.unit] : [],
    cells: branches.map((b) => ({ cell: b.cell, role: 'pivot' })).filter((x, k, arr) => arr.findIndex((y) => y.cell === x.cell) === k),
    keys: branches.map((b) => ({ cell: b.cell, digit: b.digit, role: 'key' })),
  };
  // common placements
  for (let i = 0; i < 81; i++) {
    if (grid[i]) continue;
    const d = branches[0].r.g[i];
    if (!d || branches.some((b) => b.r.g[i] !== d)) continue;
    if (src.kind === 'cell' && i === src.cell) continue;
    const pl = [{ cell: i, digit: d }];
    return step('forcing_chain', pl, [], {
      units: pivotHl.units,
      cells: [...pivotHl.cells, { cell: i, role: 'target' }],
      cands: [...pivotHl.keys, { cell: i, digit: d, role: 'place' }],
    }, `${src.kind === 'cell' ? 'Cell' : 'Digit'} forcing chain: ${srcText}; following the forced moves in every case, ${cellName(i)} becomes ${d}. So ${cellName(i)} must be ${d}.`);
  }
  // common eliminations
  const elims = [];
  for (let i = 0; i < 81; i++) {
    if (grid[i]) continue;
    let removed = cands[i];
    for (const b of branches) {
      const kept = b.r.g[i] ? BIT(b.r.g[i]) : b.r.c[i];
      removed &= ~kept;
      if (!removed) break;
    }
    for (const d of digitsOf(removed)) elims.push({ cell: i, digit: d });
  }
  if (elims.length) {
    return step('forcing_chain', [], elims, {
      units: pivotHl.units,
      cells: pivotHl.cells,
      cands: [...pivotHl.keys.filter((k) => !elims.some((e) => e.cell === k.cell && e.digit === k.digit)), ...elimCands(elims)],
    }, `${src.kind === 'cell' ? 'Cell' : 'Digit'} forcing chain: ${srcText}; in every case the forced moves remove ${joinAnd(elims.map((e) => `${e.digit} from ${cellName(e.cell)}`))}.`);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Technique table (tier ascending, roughly easiest first within a tier)

export const TECHNIQUES = [
  { id: 'full_house', name: 'Full House', tier: 1, find: fullHouse },
  { id: 'naked_single', name: 'Naked Single', tier: 1, find: nakedSingle },
  { id: 'hidden_single', name: 'Hidden Single', tier: 1, find: hiddenSingle },
  { id: 'pointing', name: 'Pointing', tier: 2, find: pointing },
  { id: 'claiming', name: 'Claiming', tier: 2, find: claiming },
  { id: 'naked_pair', name: 'Naked Pair', tier: 2, find: nakedSubset(2, 'naked_pair') },
  { id: 'hidden_pair', name: 'Hidden Pair', tier: 2, find: hiddenSubset(2, 'hidden_pair') },
  { id: 'naked_triple', name: 'Naked Triple', tier: 3, find: nakedSubset(3, 'naked_triple') },
  { id: 'hidden_triple', name: 'Hidden Triple', tier: 3, find: hiddenSubset(3, 'hidden_triple') },
  { id: 'naked_quad', name: 'Naked Quad', tier: 3, find: nakedSubset(4, 'naked_quad') },
  { id: 'hidden_quad', name: 'Hidden Quad', tier: 3, find: hiddenSubset(4, 'hidden_quad') },
  { id: 'x_wing', name: 'X-Wing', tier: 4, find: basicFish(2, 'x_wing') },
  { id: 'skyscraper', name: 'Skyscraper', tier: 4, find: skyscraper },
  { id: 'two_string_kite', name: '2-String Kite', tier: 4, find: twoStringKite },
  { id: 'empty_rectangle', name: 'Empty Rectangle', tier: 4, find: emptyRectangle },
  { id: 'xy_wing', name: 'XY-Wing', tier: 4, find: xyWing },
  { id: 'w_wing', name: 'W-Wing', tier: 4, find: wWing },
  { id: 'simple_coloring', name: 'Simple Coloring', tier: 4, find: simpleColoring },
  { id: 'swordfish', name: 'Swordfish', tier: 5, find: basicFish(3, 'swordfish') },
  { id: 'finned_x_wing', name: 'Finned X-Wing', tier: 5, find: finnedFish(2, 'finned_x_wing') },
  { id: 'xyz_wing', name: 'XYZ-Wing', tier: 5, find: xyzWing },
  { id: 'unique_rectangle', name: 'Unique Rectangle', tier: 5, find: uniqueRectangle },
  { id: 'bug_plus_one', name: 'BUG+1', tier: 5, find: bugPlusOne },
  { id: 'jellyfish', name: 'Jellyfish', tier: 5, find: basicFish(4, 'jellyfish') },
  { id: 'finned_swordfish', name: 'Finned Swordfish', tier: 5, find: finnedFish(3, 'finned_swordfish') },
  { id: 'x_chain', name: 'X-Chain', tier: 5, find: (s) => chainFind(s, 'x', 12) },
  { id: 'wxyz_wing', name: 'WXYZ-Wing', tier: 6, find: wxyzWing },
  { id: 'xy_chain', name: 'XY-Chain', tier: 6, find: (s) => chainFind(s, 'xy', 16) },
  { id: 'aic', name: 'Alternating Inference Chain', tier: 6, find: (s) => chainFind(s, 'aic', 16) },
  { id: 'forcing_chain', name: 'Forcing Chain', tier: 6, find: forcingChain },
];
for (const t of TECHNIQUES) META[t.id] = t;
META.reveal = { name: 'Reveal', tier: 0 };

const DEEP_TECHS = [pointing, claiming, nakedSubset(2, 'naked_pair'), hiddenSubset(2, 'hidden_pair')];

// ---------------------------------------------------------------------------
// Public API

export function nextStep(grid, cands) {
  const state = makeState(grid, cands);
  for (const t of TECHNIQUES) {
    const s = t.find(state);
    if (s) return s;
  }
  return null;
}

/** Run one technique (by id) on a position; returns its Step or null. */
export function findStep(id, grid, cands) {
  const t = META[id];
  return t && t.find ? t.find(makeState(grid, cands)) : null;
}

export function applyStep(grid, cands, step) {
  for (const { cell, digit } of step.placements || []) {
    const b = BIT(digit);
    grid[cell] = digit;
    cands[cell] = 0;
    for (const j of PEERS[cell]) cands[j] &= ~b;
  }
  for (const { cell, digit } of step.eliminations || []) cands[cell] &= ~BIT(digit);
}

export function solveLogically(grid) {
  const g = typeof grid === 'string' ? parse(grid) : grid.slice();
  const cands = computeCandidates(g);
  const steps = [];
  for (let guard = 0; guard < 1000; guard++) {
    if (g.every((d) => d)) break;
    const s = nextStep(g, cands);
    if (!s) break;
    steps.push(s);
    applyStep(g, cands, s);
  }
  return { steps, solved: g.every((d) => d), grid: g };
}

/**
 * Difficulty grading. Thresholds:
 *   unsolvable by solveLogically              -> -1
 *   max tier 1, givens >= 36                  -> 0 Beginner
 *   max tier 1, givens <= 35                  -> 1 Medium
 *   max tier 2 with <= 3 tier-2 steps         -> 1 Medium
 *   max tier 2 with >= 4 tier-2 steps, or 3   -> 2 Hard
 *   max tier 4                                -> 3 Expert
 *   max tier 5                                -> 4 Master
 *   max tier 6                                -> 5 Extreme
 */
export function rate(puzzleStr) {
  const g = typeof puzzleStr === 'string' ? parse(puzzleStr) : puzzleStr.slice();
  const givens = g.filter((d) => d).length;
  const res = solveLogically(g);
  const counts = {};
  let maxTier = 0, tier2 = 0;
  for (const s of res.steps) {
    counts[s.technique] = (counts[s.technique] || 0) + 1;
    if (s.tier > maxTier) maxTier = s.tier;
    if (s.tier === 2) tier2++;
  }
  let level;
  if (!res.solved) level = -1;
  else if (maxTier <= 1) level = givens >= 36 ? 0 : 1;
  else if (maxTier === 2) level = tier2 <= 3 ? 1 : 2;
  else if (maxTier === 3) level = 2;
  else level = maxTier - 1; // 4 -> 3, 5 -> 4, 6 -> 5
  return { level, maxTier, counts, givens, solved: res.solved };
}

/**
 * Hint: candidates are the computed candidates, intersected with the player's
 * notes wherever those notes still contain the solution digit. Wrong entries are
 * ignored (treated as empty). Falls back to revealing the cell with fewest candidates.
 */
export function hint(grid, notes, solution) {
  const sol = solution ? (typeof solution === 'string' ? parse(solution) : solution) : null;
  const g = grid.slice();
  if (sol) for (let i = 0; i < 81; i++) if (g[i] && g[i] !== sol[i]) g[i] = 0;
  const cands = computeCandidates(g);
  if (notes) {
    for (let i = 0; i < 81; i++) {
      const n = notes[i] | 0;
      if (g[i] || !n || !sol) continue;
      if (n & BIT(sol[i])) cands[i] &= n;
    }
  }
  if (g.every((d) => d)) return null;
  let s = nextStep(g, cands);
  if (s && sol) {
    const ok = s.placements.every((p) => sol[p.cell] === p.digit) && s.eliminations.every((e) => sol[e.cell] !== e.digit);
    if (!ok) s = null;
  }
  if (s || !sol) return s;
  let best = -1, bc = 10;
  for (let i = 0; i < 81; i++) {
    if (g[i]) continue;
    const c = bitCount(cands[i]);
    if (c < bc) { bc = c; best = i; }
  }
  const d = sol[best];
  return step('reveal', [{ cell: best, digit: d }], [], {
    units: [], cells: [{ cell: best, role: 'target' }], cands: [{ cell: best, digit: d, role: 'place' }],
  }, `Reveal: ${cellName(best)} is ${d}.`);
}
