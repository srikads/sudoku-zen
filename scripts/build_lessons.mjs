// Builds data/lessons.json — the Learn section's lessons with REAL example positions.
//
//   node scripts/build_lessons.mjs
//
// For every technique we replay the logical solver (js/techniques.js) on many puzzles
// (the shipped pool in data/puzzles.json plus deterministic, seeded generated puzzles)
// and record the positions where that technique is the solver's next step — with the
// solver's own candidate state, so the notes shown in the lesson are realistic.
// The cleanest position becomes the lesson example; the cleanest position from a
// DIFFERENT puzzle becomes the "Try it" practice. The step-by-step narration is
// generated from the Step's own data, so the text always matches the board.
// Hand-written teaching text (summary + intro) lives in LESSON_TEXT below.
//
// Deterministic: same inputs -> byte-identical output.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  parse, stringify, computeCandidates, solve, generate, rng, bitCount, digitsOf, cellName,
  ROW, COL, BOX, UNITS, CELL_UNITS, PEERS,
} from '../js/sudoku.js';
import { TECHNIQUES, nextStep, findStep, applyStep } from '../js/techniques.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = ROOT + 'data/lessons.json';

// ---------------------------------------------------------------------------
// Chapters and hand-written text

export const CHAPTERS = [
  { id: 1, title: 'Basics', blurb: 'The rules, notes, and the three kinds of single.' },
  { id: 2, title: 'Intersections & pairs', blurb: 'Where boxes meet lines, and two cells lock two digits.' },
  { id: 3, title: 'Subsets', blurb: 'Triples and quads: the same idea with more cells.' },
  { id: 4, title: 'Basic fish & wings', blurb: 'Patterns that reach across the whole grid.' },
  { id: 5, title: 'Advanced', blurb: 'Bigger fish, fins, uniqueness and your first chains.' },
  { id: 6, title: 'Expert chains', blurb: 'Long chains of logic for the hardest puzzles.' },
];

export const ORDER = [
  ['intro', 1], ['full_house', 1], ['naked_single', 1], ['hidden_single', 1],
  ['pointing', 2], ['claiming', 2], ['naked_pair', 2], ['hidden_pair', 2],
  ['naked_triple', 3], ['hidden_triple', 3], ['naked_quad', 3], ['hidden_quad', 3],
  ['x_wing', 4], ['skyscraper', 4], ['two_string_kite', 4], ['empty_rectangle', 4], ['xy_wing', 4], ['w_wing', 4], ['simple_coloring', 4],
  ['swordfish', 5], ['jellyfish', 5], ['finned_x_wing', 5], ['finned_swordfish', 5], ['xyz_wing', 5], ['unique_rectangle', 5], ['bug_plus_one', 5], ['x_chain', 5],
  ['xy_chain', 6], ['wxyz_wing', 6], ['aic', 6], ['forcing_chain', 6],
];

const LEVEL_NAMES = ['Beginner', 'Medium', 'Hard', 'Expert', 'Master', 'Extreme'];
const TIER_LEVEL = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5 };

// *text* renders bold in the app. Keep paragraphs short: they are read on a phone.
export const LESSON_TEXT = {
  intro: {
    title: 'Notes & candidates',
    summary: 'The rules of sudoku and how notes help you think.',
    intro: [
      'Fill the grid so that every *row*, every *column* and every 3×3 *box* contains each digit 1–9 exactly once. That single rule is all there is — every technique in these lessons is just a clever consequence of it.',
      'A *candidate* is a digit that could still go in an empty cell: it is not already in that cell\'s row, column or box. Writing candidates as small *notes* turns the puzzle into something you can reason about on paper.',
      'Techniques do one of two things: they *place* a digit (shown in green) or they *remove* candidates (shown crossed out in red). Removing candidates is progress too — sooner or later a cell or a unit is left with just one option.',
    ],
  },
  full_house: {
    summary: 'The last empty cell in a row, column or box.',
    intro: [
      'When a row, column or box has only *one empty cell* left, that cell must hold the one digit the unit is still missing.',
      'It works because each unit needs all nine digits: eight are already there, so the ninth has exactly one place to go.',
      'How to spot it: scan for units that are almost full. It is the easiest move in sudoku — always check for it first, especially late in a puzzle.',
    ],
    task: 'One row, column or box has a single empty cell. Tap the candidate that belongs there.',
  },
  naked_single: {
    summary: 'A cell with only one candidate left.',
    intro: [
      'A *naked single* is a cell that has only one candidate left. Every other digit already appears in its row, its column or its box.',
      'Since the cell must hold *some* digit and all others are ruled out, the remaining one is the answer.',
      'How to spot it: with notes, look for a cell showing a single small digit. Without notes, pick a busy cell and count which digits its row, column and box already use.',
    ],
    task: 'Find a cell whose notes show only one candidate, and tap that candidate.',
  },
  hidden_single: {
    summary: 'A digit with only one possible place in a unit.',
    intro: [
      'A *hidden single* looks at it from the digit\'s side: inside one row, column or box, a digit can go in *only one cell*. That cell may still show other notes — the single is "hidden" among them.',
      'Every unit needs each digit exactly once. If all other cells of the unit are blocked for that digit (because they see the same digit elsewhere), the one remaining cell must take it.',
      'How to spot it: pick a digit, follow where it already sits, and check each box, row and column for a lone free spot. This is the workhorse technique of easy and medium puzzles.',
    ],
    task: 'Find a digit that fits in only one cell of some row, column or box, and tap that candidate.',
  },
  pointing: {
    summary: 'A digit locked to one line inside a box clears that line.',
    intro: [
      'Sometimes, inside a box, all candidates for a digit lie on *one row or one column*. The box must contain the digit somewhere, so it will end up on that line — the candidates "point" along it.',
      'Because a row or column holds each digit only once, the digit cannot appear anywhere else on that line *outside the box*. Those candidates can be removed.',
      'How to spot it: for each box, look at one digit\'s notes. If they form a short straight segment of two or three cells, follow the line out of the box and clear the digit.',
    ],
    task: 'Find the pointing candidates and tap every candidate they remove, then press Check.',
  },
  claiming: {
    summary: 'A digit locked to one box inside a line clears that box.',
    intro: [
      '*Claiming* (also called box/line reduction) is pointing turned around. In a row or column, all candidates for a digit lie inside *one box*.',
      'The row needs that digit, and it can only get it inside this box — so the box\'s copy of the digit is used up by the row. Every other cell of the box loses that candidate.',
      'How to spot it: look along a row or column for a digit whose notes are all in the same three-cell segment, then clear the digit from the rest of that box.',
    ],
    task: 'Find where a line claims a digit for one box, and tap every candidate that is removed.',
  },
  naked_pair: {
    summary: 'Two cells with the same two candidates.',
    intro: [
      'A *naked pair* is two cells in one unit that both contain exactly the same *two candidates*, for example {3,8} and {3,8}.',
      'Those two cells must take those two digits between them — one gets 3, the other 8, we don\'t yet know which. Either way, both digits are used up, so no other cell in that unit can be 3 or 8.',
      'How to spot it: look for twin two-digit notes in the same row, column or box. If the pair also shares a box, it clears both units.',
    ],
    task: 'Find the naked pair and tap every candidate it removes, then press Check.',
  },
  hidden_pair: {
    summary: 'Two digits that fit in only the same two cells.',
    intro: [
      'A *hidden pair* is two digits that, within one unit, can only go in the *same two cells*. The cells may show other notes too — the pair is hidden among them.',
      'Those two cells must hold those two digits (each digit needs a home, and there are only two homes). So any *other* candidate in the two cells is impossible and can be removed.',
      'How to spot it: in a unit, look for two digits that each appear exactly twice, in the same two cells. After the clean-up, the cells become a naked pair.',
    ],
    task: 'Find the hidden pair and tap every other candidate in its two cells, then press Check.',
  },
  naked_triple: {
    summary: 'Three cells that use only three digits.',
    intro: [
      'A *naked triple* is three cells in one unit whose candidates, together, contain only *three digits*. Not every cell needs all three: {1,4}, {4,7}, {1,7} is a perfect triple.',
      'Three cells need three different digits, and only three are available to them — so these three digits are used up by these cells. Remove them from every other cell of the unit.',
      'How to spot it: look for cells with two or three candidates drawn from the same small set of digits. It is the naked pair idea with one more cell.',
    ],
    task: 'Find the naked triple and tap every candidate it removes, then press Check.',
  },
  hidden_triple: {
    summary: 'Three digits squeezed into the same three cells.',
    intro: [
      'A *hidden triple* is three digits that, within one unit, can only go in the *same three cells* (each digit in two or three of them).',
      'Three digits need three homes and have exactly three — so those cells are reserved for them. Every other candidate in those three cells can be removed.',
      'How to spot it: count, per digit, how many cells of the unit can take it. Digits with only two or three spots are the ones to test. Hidden triples are hard to see; notes make them visible.',
    ],
    task: 'Find the hidden triple and tap every other candidate in its three cells, then press Check.',
  },
  naked_quad: {
    summary: 'Four cells that use only four digits.',
    intro: [
      'A *naked quad* is four cells in one unit whose candidates together contain only *four digits*.',
      'The logic is the same as for pairs and triples: four cells, four digits, so the digits are used up by these cells and can be removed from the rest of the unit.',
      'How to spot it: it usually shows up in a unit with many empty cells. If a unit has N empty cells and a naked quad, the other N−4 cells form a hidden subset — sometimes that is the easier way to see it.',
    ],
    task: 'Find the naked quad and tap every candidate it removes, then press Check.',
  },
  hidden_quad: {
    summary: 'Four digits squeezed into the same four cells.',
    intro: [
      'A *hidden quad* is four digits that, within one unit, can only go in the *same four cells*.',
      'Those four cells are therefore reserved for those four digits, and every other candidate in them can go.',
      'How to spot it: it is rare and almost always appears in a unit with many empty cells. The trick is to look for digits with few positions in the unit and check whether four of them share the same cells.',
    ],
    task: 'Find the hidden quad and tap every other candidate in its four cells, then press Check.',
  },
  x_wing: {
    summary: 'Two rows, two columns, one digit: a rectangle.',
    intro: [
      'Pick one digit. If in *two rows* that digit can only go in the *same two columns*, the four spots form the corners of a rectangle: an *X-Wing*.',
      'Each of the two rows needs the digit once, and both must use those two columns. So one copy goes in each column — they fill the two columns between them. No other cell in those two columns can hold the digit.',
      'The same works with rows and columns swapped. How to spot it: for one digit, look for rows (or columns) where it has exactly two spots, and check whether two of them line up.',
    ],
    task: 'Find the X-Wing and tap every candidate it removes, then press Check.',
  },
  skyscraper: {
    summary: 'Two strong links on one digit with a shared base.',
    intro: [
      'A *skyscraper* uses two rows (or two columns) where a digit has *exactly two places*. One end of each lines up in the same column — the base — while the other two ends (the tops) do not.',
      'The two base cells see each other, so at most one of them holds the digit. In the row whose base is empty, the digit must sit at the top. So *at least one top* holds the digit.',
      'Any cell that sees *both tops* can therefore not hold the digit. Think of it as an X-Wing with one leg bent.',
    ],
    task: 'Find the skyscraper and tap every candidate it removes, then press Check.',
  },
  two_string_kite: {
    summary: 'A row and a column joined through a box.',
    intro: [
      'A *2-String Kite* combines a row and a column where one digit has *exactly two places* each. One end of the row\'s pair and one end of the column\'s pair sit in the *same box*.',
      'Those two box cells see each other, so at most one holds the digit. If the row\'s box cell is empty, the row\'s other end has the digit; likewise for the column. So *at least one of the two far ends* holds the digit.',
      'The cell at the crossing of the far ends\' row and column sees both of them, so it cannot hold the digit.',
    ],
    task: 'Find the 2-String Kite and tap the candidate it removes, then press Check.',
  },
  empty_rectangle: {
    summary: 'A box whose candidates form a cross.',
    intro: [
      'Inside one box, look at one digit. If all its candidates lie on *one row plus one column* of the box (a cross, leaving an "empty rectangle" of cells without the digit), the box\'s copy must be on that row or on that column.',
      'Now find a line outside the box where the digit has *exactly two places*, one of them on the cross\'s row (or column). If a target cell would make the box\'s cross impossible from both sides, it cannot hold the digit.',
      'It sounds tricky, but on the board it is a small picture: a box cross, one strong link, and one cell that would break both arms.',
    ],
    task: 'Find the empty rectangle and tap the candidate it removes, then press Check.',
  },
  xy_wing: {
    summary: 'A pivot with two candidates and two pincers.',
    intro: [
      'An *XY-Wing* uses three cells with exactly two candidates each: a *pivot* {X,Y} and two *pincers* it can see, {X,Z} and {Y,Z}.',
      'If the pivot is X, the first pincer cannot be X, so it is Z. If the pivot is Y, the second pincer becomes Z. Either way, *one of the pincers is Z*.',
      'So any cell that sees *both pincers* cannot be Z. How to spot it: look at two-candidate cells, and search for a pivot whose two digits each continue into a pincer with a shared third digit.',
    ],
    task: 'Find the XY-Wing and tap every candidate it removes, then press Check.',
  },
  w_wing: {
    summary: 'Two identical pairs connected by a strong link.',
    intro: [
      'A *W-Wing* starts with two cells that hold the *same two candidates* {X,Y} but do not see each other.',
      'Now find a unit where X has *only two places*, one seeing each of the two cells. If both cells were X, neither of those places could be X — but the unit needs its X. So *at least one of the two cells is Y*.',
      'Any cell that sees both {X,Y} cells can therefore not be Y.',
    ],
    task: 'Find the W-Wing and tap every candidate it removes, then press Check.',
  },
  simple_coloring: {
    summary: 'Follow one digit\'s strong links in two colours.',
    intro: [
      'Take one digit and find its *strong links*: units where it has exactly two places, so exactly one of them is true. Connected strong links form a chain of cells.',
      'Colour the chain alternately A, B, A, B… Within the chain, either all A cells hold the digit or all B cells do — one colour is true, the other false.',
      'Two rules follow. *Trap*: a cell that sees one A cell and one B cell cannot hold the digit. *Wrap*: if two cells of the same colour see each other, that colour is false everywhere.',
    ],
    task: 'Colour the strong links of one digit and tap every candidate that is removed, then press Check.',
  },
  swordfish: {
    summary: 'An X-Wing with three rows and three columns.',
    intro: [
      'A *swordfish* is the X-Wing idea with three lines. In *three rows*, one digit fits only within the *same three columns* (each row having two or three spots).',
      'The three rows each need the digit once, and all of them must use those three columns — so the three copies fill the three columns, one per column. Every other candidate in those columns can go.',
      'How to spot it: for one digit, list the rows where it has two or three spots and look for three of them that together touch only three columns. Rows and columns can be swapped.',
    ],
    task: 'Find the swordfish and tap every candidate it removes, then press Check.',
  },
  jellyfish: {
    summary: 'The fish pattern with four rows and four columns.',
    intro: [
      'A *jellyfish* is the four-line fish: in *four rows*, one digit fits only within the *same four columns*.',
      'Four rows, four copies of the digit, all confined to four columns — so they fill those columns, one each. The digit can be removed from every other cell of those four columns.',
      'Jellyfish are rare. If you already know the X-Wing and swordfish, you know everything: base lines, cover lines, and eliminations in the cover lines outside the base.',
    ],
    task: 'Find the jellyfish and tap every candidate it removes, then press Check.',
  },
  finned_x_wing: {
    summary: 'An X-Wing with an extra candidate in one corner box.',
    intro: [
      'A *finned X-Wing* is an X-Wing that is almost perfect: one row has one or two extra candidates, the *fin*, sitting in the same box as one of the X-Wing corners.',
      'Either the fin holds the digit, or it does not — and then the X-Wing is real. In the first case the fin removes the digit from its box; in the second the X-Wing removes it from its columns.',
      'Only cells hit by *both* cases are safe to clear: cells in the X-Wing\'s columns that are also in the fin\'s box.',
    ],
    task: 'Find the finned X-Wing and tap every candidate it removes, then press Check.',
  },
  finned_swordfish: {
    summary: 'A swordfish with a fin.',
    intro: [
      'A *finned swordfish* is a swordfish with one or two extra candidates (the fin) in a single box.',
      'Either one of the fin cells holds the digit, or the swordfish is real. Cells that would lose the digit in both cases — in a cover column and in the fin\'s box — can be cleared.',
      'The pattern is identical to the finned X-Wing, just with three lines instead of two.',
    ],
    task: 'Find the finned swordfish and tap every candidate it removes, then press Check.',
  },
  xyz_wing: {
    summary: 'An XY-Wing whose pivot also holds Z.',
    intro: [
      'An *XYZ-Wing* is like an XY-Wing, but the *pivot has three candidates* {X,Y,Z}, and the pincers are {X,Z} and {Y,Z}.',
      'If the pivot is X, the {X,Z} pincer becomes Z; if it is Y, the {Y,Z} pincer becomes Z; and if it is Z itself, fine. In every case *one of the three cells is Z*.',
      'So Z can be removed from any cell that sees *all three* — which means it must share the pivot\'s box and a line with a pincer.',
    ],
    task: 'Find the XYZ-Wing and tap every candidate it removes, then press Check.',
  },
  unique_rectangle: {
    summary: 'Avoid a rectangle that would allow two solutions.',
    intro: [
      'A proper sudoku has *exactly one solution*. Four cells forming a rectangle across *two boxes* that could all be just {A,B} are a "deadly pattern": you could swap A and B and get a second solution.',
      'So the puzzle must prevent that. If three corners hold only {A,B}, the fourth corner cannot be A or B (*type 1*). If two corners have one shared extra digit, one of them must take it (*type 2*). If a digit is locked into the two extra corners, the other rectangle digit goes (*type 4*).',
      'Use this only with puzzles that have a unique solution — which all puzzles in this app do.',
    ],
    task: 'Find the unique rectangle and tap every candidate it removes, then press Check.',
  },
  bug_plus_one: {
    summary: 'All cells bivalue except one: that one is decided.',
    intro: [
      'A *BUG* (Bivalue Universal Grave) is a state where every empty cell has exactly two candidates and every digit appears exactly twice in each unit. Such a grid can never have a unique solution.',
      'In *BUG+1*, all cells are bivalue except one cell with three candidates. To avoid the deadly BUG, that cell must take the candidate that would otherwise appear *three* times in its units.',
      'How to spot it: late in a hard puzzle, when nearly every note has two digits, find the lone three-candidate cell and place the digit that is "too many" in its row, column and box.',
    ],
    task: 'Every cell but one has two candidates. Tap the digit that must go in the odd cell.',
  },
  x_chain: {
    summary: 'A single-digit chain of strong and weak links.',
    intro: [
      'An *X-Chain* follows one digit through alternating *strong links* (a unit with only two places: if one is false, the other is true) and *weak links* (two cells that see each other: if one is true, the other is false).',
      'Start by assuming the first cell is *not* the digit, and follow the links: false → true → false → … → true at the end. So either the first cell or the last cell holds the digit.',
      'Any cell that sees *both ends* of the chain cannot hold the digit. Skyscrapers and kites are just short X-Chains.',
    ],
    task: 'Find the X-Chain and tap every candidate it removes, then press Check.',
  },
  xy_chain: {
    summary: 'A chain through two-candidate cells.',
    intro: [
      'An *XY-Chain* hops through cells with exactly *two candidates*. Inside a cell the link is strong (if it is not one digit, it is the other); between cells that see each other it is weak (they cannot share a digit).',
      'Assume the first cell is *not* Z. Then it is its other digit, which forces the next cell, and so on, until the last cell is forced to be *Z*. So either the start or the end is Z.',
      'Cells that see both ends lose Z. An XY-Wing is simply an XY-Chain of three cells.',
    ],
    task: 'Find the XY-Chain and tap every candidate it removes, then press Check.',
  },
  wxyz_wing: {
    summary: 'Four cells, four digits, one non-restricted digit.',
    intro: [
      'A *WXYZ-Wing* is four cells, all within reach of a pivot, whose candidates use only *four digits* together.',
      'For three of the digits, all cells holding them see each other, so each can be used at most once. That covers at most three of the four cells — the fourth must be *Z*, the one digit whose cells do not all see each other.',
      'So one of the Z cells is Z, and any cell that sees *all* of them loses Z. It is the XYZ-Wing idea grown by one cell.',
    ],
    task: 'Find the WXYZ-Wing and tap every candidate it removes, then press Check.',
  },
  aic: {
    summary: 'Chains that mix digits and cells freely.',
    intro: [
      'An *alternating inference chain* (AIC) combines everything: strong links inside units and inside two-candidate cells, weak links between peers and between digits of one cell.',
      'The rule never changes: assume the start is false, and follow strong (false → true) and weak (true → false) links alternately. You end on something true, so *the start or the end must be true*.',
      'What that removes depends on the ends: the same digit in two cells clears common peers; two digits in one cell clear the cell\'s other candidates; different digits in cells that see each other remove one from the other.',
    ],
    task: 'Find the chain and tap every candidate it removes, then press Check.',
  },
  forcing_chain: {
    summary: 'Try every option; whatever they agree on is true.',
    intro: [
      'A *forcing chain* is the last resort before guessing — and it is still pure logic. Take a cell with few candidates (or a digit with few places in a unit) and try *each option in turn*, following only the obvious forced moves.',
      'If one option leads to a contradiction (a cell with no candidates, or a unit with no place for a digit), that option is false. If *every* option leads to the same placement or removal, that result is true no matter what.',
      'Forcing chains are powerful but long. Use them when nothing else works, and keep the branches short.',
    ],
    task: 'Try each option of the highlighted cell (tap Hint) and tap what they force, then press Check.',
  },
};

// ---------------------------------------------------------------------------
// Text helpers

const cn = cellName;
const unitName = (u) => (u < 9 ? `row ${u + 1}` : u < 18 ? `column ${u - 8}` : `box ${u - 17}`);
const unitKind = (u) => (u < 9 ? 'row' : u < 18 ? 'column' : 'box');
const joinAnd = (a) => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
const joinOr = (a) => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' or ' + a[a.length - 1]);
const cells = (arr) => joinAnd(arr.map(cn));
const set = (ds) => '{' + ds.join(',') + '}';
const plural = (n, one, many) => (n === 1 ? one : many);
const uniq = (a) => [...new Set(a)];
const BIT = (d) => 1 << (d - 1);
const sees = (a, b) => a !== b && PEERS[a].includes(b);
const lineWord = (u) => (u < 9 ? 'row' : 'column');
const linesName = (us) => {
  const rows = us[0] < 9;
  return `${rows ? 'rows' : 'columns'} ${joinAnd(us.map((u) => (rows ? u + 1 : u - 8)))}`;
};
const sharedUnits = (a, b) => CELL_UNITS[a].filter((u) => CELL_UNITS[b].includes(u));
const posIn = (cands, u, d) => UNITS[u].filter((i) => cands[i] & BIT(d));

const NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const aDigit = (d) => (d === 8 ? 'an 8' : `a ${d}`);
const cap = (t) => t[0].toUpperCase() + t.slice(1);

function elimSentence(elims) {
  const cellsAll = uniq(elims.map((e) => e.cell));
  if (cellsAll.length === 1 && elims.length > 1) return `${joinAnd(elims.map((e) => `*${e.digit}*`))} from ${cn(cellsAll[0])}`;
  const by = new Map();
  for (const e of elims) { if (!by.has(e.digit)) by.set(e.digit, []); by.get(e.digit).push(e.cell); }
  return joinAnd([...by].map(([d, cs]) => `*${d}* from ${cells(cs)}`));
}

// highlight builders
const H = (o = {}) => {
  const out = {};
  for (const k of ['units', 'cells', 'cands', 'links']) if (o[k] && o[k].length) out[k] = o[k];
  return out;
};
const key = (cellsArr, d, role = 'key') => cellsArr.map((cell) => ({ cell, digit: d, role }));
const roleCells = (arr, role) => arr.map((cell) => ({ cell, role }));
const elimC = (elims) => elims.map((e) => ({ cell: e.cell, digit: e.digit, role: 'elim' }));
const full = (s) => {
  const hl = s.highlight;
  const has = new Set((hl.cells || []).map((c) => c.cell));
  const extra = uniq(s.eliminations.map((e) => e.cell)).filter((c) => !has.has(c)).map((cell) => ({ cell, role: 'target' }));
  return H({ ...hl, cells: [...(hl.cells || []), ...extra] });
};
const hlCellsOf = (s, role) => s.highlight.cells.filter((c) => c.role === role).map((c) => c.cell);

// ---------------------------------------------------------------------------
// Narration: technique id -> (step, grid, cands) -> [{ text, hl, apply? }]

function blockersFor(grid, u, target, d) {
  // placed d's (outside u) that block every other empty cell of u, chosen greedily
  const need = UNITS[u].filter((j) => j !== target && !grid[j]);
  const src = [];
  for (let i = 0; i < 81; i++) if (grid[i] === d && !UNITS[u].includes(i)) src.push(i);
  const chosen = [];
  let left = need.filter((j) => src.some((b) => sees(b, j)));
  const unblocked = need.filter((j) => !src.some((b) => sees(b, j)));
  while (left.length) {
    let best = null, bn = 0;
    for (const b of src) { const n = left.filter((j) => sees(b, j)).length; if (n > bn) { bn = n; best = b; } }
    if (!best && best !== 0) break;
    chosen.push(best);
    left = left.filter((j) => !sees(best, j));
  }
  return { chosen: chosen.sort((a, b) => a - b), unblocked };
}

function linkReason(l, cands) {
  const a = l.from, b = l.to;
  if (a.cell === b.cell) {
    return l.strong ? `${cn(a.cell)} holds only ${a.digit} and ${b.digit}` : `a cell holds only one digit`;
  }
  const us = sharedUnits(a.cell, b.cell);
  if (l.strong) {
    const u = us.find((x) => posIn(cands, x, a.digit).length === 2) ?? us[0];
    return `${a.digit} has only two places in ${unitName(u)}`;
  }
  return `they share ${unitName(us[0])}`;
}
const stateText = (n, on) => `${cn(n.cell)} ${on ? 'is' : 'is not'} ${n.digit}`;

function chainNodes(links) { return [links[0].from, ...links.map((l) => l.to)]; }

function chainHl(links, upto, nodeRole = true) {
  const ls = links.slice(0, upto);
  const nodes = chainNodes(links).slice(0, upto + 1);
  const cands = [];
  nodes.forEach((n, k) => {
    const on = k === 0 ? false : links[k - 1].strong;
    if (nodeRole) cands.push({ cell: n.cell, digit: n.digit, role: on ? 'colorA' : 'colorB' });
  });
  const cs = uniq(nodes.map((n) => n.cell));
  const endCell = nodes[nodes.length - 1].cell;
  const complete = upto >= links.length;
  return H({ cells: roleCells(cs, 'base').map((c, k) => (k === 0 || (complete && c.cell === endCell) ? { ...c, role: 'pincer' } : c)), cands, links: ls });
}

function walkText(links, from, to, cands) {
  const nodes = chainNodes(links);
  const parts = [];
  for (let k = from; k < to; k++) {
    const l = links[k];
    const on = l.strong;
    parts.push(`${on ? 'then' : 'so'} *${stateText(nodes[k + 1], on)}* (${linkReason(l, cands)})`);
  }
  return parts.join(', ');
}

function chainSteps(s, grid, cands, kind) {
  const links = s.highlight.links;
  const nodes = chainNodes(links);
  const start = nodes[0], end = nodes[nodes.length - 1];
  const n = links.length;
  const out = [];
  const what = kind === 'x' ? `Look only at digit *${start.digit}*.` : kind === 'xy' ? 'Look at the cells with exactly two candidates.' : 'Chains can mix digits and cells.';
  out.push({
    text: `${what} Start the chain at ${cn(start.cell)}: *suppose ${cn(start.cell)} is not ${start.digit}* (shown in orange: "false").`,
    hl: chainHl(links, 0),
  });
  const half = n > 5 ? Math.ceil(n / 2) : n;
  out.push({
    text: `Follow the links. Solid lines are strong links (if one end is false, the other is true); dashed lines are weak links (if one end is true, the other is false). If ${cn(start.cell)} is not ${start.digit}, ${walkText(links, 0, half, cands)}.`,
    hl: chainHl(links, half),
  });
  if (half < n) {
    out.push({
      text: `Keep going: ${walkText(links, half, n, cands)}. Teal means "true", orange "false".`,
      hl: chainHl(links, n),
    });
  }
  const res = s.placements.length
    ? `The chain started with "${cn(start.cell)} is not ${start.digit}" and ended with "${cn(end.cell)} is ${end.digit}" — a contradiction. So *${cn(start.cell)} must be ${start.digit}*.`
    : start.digit === end.digit && start.cell !== end.cell
      ? `So if the start is not ${start.digit}, the end is. *Either ${cn(start.cell)} or ${cn(end.cell)} is ${start.digit}*, and any cell that sees both cannot be ${start.digit}: remove ${elimSentence(s.eliminations)}.`
      : start.cell === end.cell
        ? `So *${cn(start.cell)} is ${start.digit} or ${end.digit}* — its other candidates can go: remove ${elimSentence(s.eliminations)}.`
        : `So *${cn(start.cell)} is ${start.digit} or ${cn(end.cell)} is ${end.digit}* (at least one). The two cells see each other: ${s.eliminations.map((e) => e.cell === start.cell
          ? `if ${cn(start.cell)} were ${end.digit}, it would not be ${start.digit}, and ${cn(end.cell)} could not be ${end.digit} either`
          : `if ${cn(end.cell)} were ${start.digit}, it would not be ${end.digit}, and ${cn(start.cell)} could not be ${start.digit} either`).join('; ')} — both ends false, which is impossible. Remove ${elimSentence(s.eliminations)}.`;
  out.push({ text: res, hl: full(s), apply: s.placements.length > 0 });
  return out;
}

function subsetKeys(s) { return s.highlight.cands.filter((c) => c.role === 'key'); }

/** Singles-only propagation from an assumed placement (mirrors the engine's shallow forcing). */
function propagateSingles(grid0, cands0, cell, digit) {
  const g = grid0.slice(), c = cands0.slice(), moves = [];
  let bad = null;
  const place = (i, d) => {
    if (!(c[i] & BIT(d))) { bad = { cell: i }; return; }
    g[i] = d; c[i] = 0; moves.push({ cell: i, digit: d });
    for (const j of PEERS[i]) { if (g[j] === d) { bad = { cell: j }; return; } c[j] &= ~BIT(d); }
  };
  place(cell, digit);
  for (let guard = 0; !bad && guard < 200; guard++) {
    let changed = false;
    for (let i = 0; i < 81 && !bad; i++) {
      if (g[i]) continue;
      if (!c[i]) { bad = { cell: i }; break; }
      if (bitCount(c[i]) === 1) { place(i, digitsOf(c[i])[0]); changed = true; }
    }
    if (bad) break;
    for (let u = 0; u < 27 && !bad; u++) {
      let placed = 0;
      for (const i of UNITS[u]) if (g[i]) placed |= BIT(g[i]);
      for (let d = 1; d <= 9 && !bad; d++) {
        if (placed & BIT(d)) continue;
        const where = UNITS[u].filter((i) => c[i] & BIT(d));
        if (!where.length) { bad = { unit: u, digit: d }; break; }
        if (where.length === 1) { place(where[0], d); placed |= BIT(d); changed = true; }
      }
    }
    if (!changed) break;
  }
  return { g, c, moves, bad };
}

const NARRATE = {
  full_house(s, grid) {
    const u = s.highlight.units[0], { cell, digit: d } = s.placements[0];
    const have = UNITS[u].filter((i) => grid[i]).map((i) => grid[i]).sort();
    return [
      { text: `Look at *${unitName(u)}*. Only one of its cells is still empty: ${cn(cell)}.`, hl: H({ units: [u], cells: roleCells([cell], 'target') }) },
      { text: `${cap(unitName(u))} already holds ${joinAnd(have.map(String))}. The only digit missing is *${d}*.`, hl: H({ units: [u], cells: roleCells([cell], 'target'), cands: key([cell], d) }) },
      { text: `So *${cn(cell)} must be ${d}*. A full house is the easiest move there is — always check nearly full units first.`, hl: full(s), apply: true },
    ];
  },
  naked_single(s, grid, cands) {
    const { cell, digit: d } = s.placements[0];
    const us = CELL_UNITS[cell];
    const seen = uniq(PEERS[cell].filter((j) => grid[j]).map((j) => grid[j])).sort();
    const pure = seen.length === 8;
    return [
      { text: `Look at *${cn(cell)}*. Its notes show just one candidate: ${d}.`, hl: H({ cells: roleCells([cell], 'target'), cands: key([cell], d) }) },
      {
        text: pure
          ? `Why? Its ${unitName(us[0])}, ${unitName(us[1])} and ${unitName(us[2])} together already contain ${joinAnd(seen.map(String))} — every digit except ${d}.`
          : `Its ${unitName(us[0])}, ${unitName(us[1])} and ${unitName(us[2])} already contain ${joinAnd(seen.map(String))}, and the other candidates were removed by earlier steps. Only ${d} is left.`,
        hl: H({ units: us, cells: roleCells([cell], 'target'), cands: key([cell], d) }),
      },
      { text: `A cell must hold some digit, and ${d} is the only one left. So *${cn(cell)} must be ${d}*.`, hl: full(s), apply: true },
    ];
  },
  hidden_single(s, grid, cands) {
    const u = s.highlight.units[0], { cell, digit: d } = s.placements[0];
    const { chosen, unblocked } = blockersFor(grid, u, cell, d);
    const empties = UNITS[u].filter((j) => !grid[j]);
    const others = digitsOf(cands[cell]).filter((x) => x !== d);
    // the row / column / box through each blocker that crosses the unit's blocked cells
    const blocked = empties.filter((j) => j !== cell);
    const rays = uniq(chosen.flatMap((b) => CELL_UNITS[b].filter((x) => x !== u && blocked.some((j) => UNITS[x].includes(j)))));
    return [
      { text: `Focus on digit *${d}* in *${unitName(u)}*. It has ${empties.length} empty cells — where can ${aDigit(d)} go?`, hl: H({ units: [u] }) },
      {
        text: `The ${d}${chosen.length > 1 ? 's' : ''} already placed at ${cells(chosen)} (yellow) rule${chosen.length > 1 ? '' : 's'} out ${d} along the shaded ${joinAnd(uniq(rays.map(unitKind)).map((k) => k + 's'))}.` +
          (unblocked.length ? ` In ${cells(unblocked)} the ${d} was removed by earlier steps.` : '') +
          ` Every empty cell of ${unitName(u)} is blocked — except one.`,
        hl: H({ units: rays, cells: [...roleCells(chosen, 'cover'), { cell, role: 'target' }] }),
      },
      {
        text: `So ${d} fits only in *${cn(cell)}*` + (others.length ? ` — even though its notes also show ${joinAnd(others.map(String))}, the ${unitKind(u)} needs its ${d} and has no other place for it.` : '.') + ` *${cn(cell)} = ${d}*.`,
        hl: H({ units: [u], cells: [...roleCells(chosen, 'cover'), { cell, role: 'target' }], cands: [{ cell, digit: d, role: 'place' }] }),
        apply: true,
      },
    ];
  },
  pointing(s) {
    const [bx, line] = s.highlight.units, base = hlCellsOf(s, 'base'), d = s.eliminations[0].digit;
    return [
      { text: `Look at digit *${d}* in *${unitName(bx)}*. Its notes show ${d} only in ${cells(base)}.`, hl: H({ units: [bx], cands: key(base, d) }) },
      { text: `These cells all lie in *${unitName(line)}*. Box ${bx - 17} needs ${aDigit(d)}, so whichever cell it is, that ${d} will be in ${unitName(line)}.`, hl: H({ units: [bx, line], cells: roleCells(base, 'base'), cands: key(base, d) }) },
      { text: `${cap(unitName(line))} can hold only one ${d}, so the rest of the ${lineWord(line)} outside box ${bx - 17} cannot be ${d}: remove ${elimSentence(s.eliminations)}.`, hl: full(s) },
    ];
  },
  claiming(s) {
    const [line, bx] = s.highlight.units, base = hlCellsOf(s, 'base'), d = s.eliminations[0].digit;
    return [
      { text: `Look at digit *${d}* in *${unitName(line)}*. Its notes show ${d} only in ${cells(base)}.`, hl: H({ units: [line], cands: key(base, d) }) },
      { text: `All of them are inside *${unitName(bx)}*. ${cap(unitName(line))} needs ${aDigit(d)}, so it will take box ${bx - 17}'s ${d} — the box's ${d} is on this ${lineWord(line)}.`, hl: H({ units: [line, bx], cells: roleCells(base, 'base'), cands: key(base, d) }) },
      { text: `So no other cell of box ${bx - 17} can be ${d}: remove ${elimSentence(s.eliminations)}.`, hl: full(s) },
    ];
  },
  naked_subset(s, grid, cands, n) {
    const u = s.highlight.units[0], base = hlCellsOf(s, 'base');
    const ds = uniq(subsetKeys(s).map((k) => k.digit)).sort();
    const word = { 2: 'pair', 3: 'triple', 4: 'quad' }[n];
    const per = base.map((c) => `${cn(c)} ${set(digitsOf(cands[c]))}`).join(', ');
    return [
      { text: `Look at *${unitName(u)}* and the cells with ${['', '', 'only two candidates', 'two or three candidates', 'two to four candidates'][n]}.`, hl: H({ units: [u] }) },
      { text: `These ${NUM[n]} cells contain only the digits *${joinAnd(ds.map(String))}*: ${per}.`, hl: H({ units: [u], cells: roleCells(base, 'base'), cands: subsetKeys(s) }) },
      { text: `${cap(NUM[n])} cells need ${NUM[n]} different digits, and only these ${NUM[n]} are available to them. So the cells will take exactly ${joinAnd(ds.map(String))} between them — we don't know the order yet, but the digits are used up. That's a naked ${word}.`, hl: H({ units: [u], cells: roleCells(base, 'base'), cands: subsetKeys(s) }) },
      { text: `So ${joinAnd(ds.map(String))} can be removed from every other cell of the ${unitKind(u)}: remove ${elimSentence(s.eliminations)}.`, hl: full(s) },
    ];
  },
  hidden_subset(s, grid, cands, n) {
    const u = s.highlight.units[0], base = hlCellsOf(s, 'base');
    const ds = uniq(subsetKeys(s).map((k) => k.digit)).sort();
    const word = { 2: 'pair', 3: 'triple', 4: 'quad' }[n];
    const where = ds.map((d) => `${d} in ${cells(posIn(cands, u, d))}`).join('; ');
    return [
      { text: `Look at digits *${joinAnd(ds.map(String))}* in *${unitName(u)}*. Where can each of them go?`, hl: H({ units: [u], cands: subsetKeys(s) }) },
      { text: `${where}. Together they fit only in the same ${NUM[n]} cells: ${cells(base)}.`, hl: H({ units: [u], cells: roleCells(base, 'base'), cands: subsetKeys(s) }) },
      { text: `${cap(NUM[n])} digits need ${NUM[n]} homes and have exactly ${NUM[n]}, so these cells are reserved for ${joinAnd(ds.map(String))} — a hidden ${word}. Any other candidate in them is impossible.`, hl: H({ units: [u], cells: roleCells(base, 'base'), cands: subsetKeys(s) }) },
      { text: `Remove the other candidates: ${elimSentence(s.eliminations)}. Now the ${NUM[n]} cells form a naked ${word}.`, hl: full(s) },
    ];
  },
  fish(s, grid, cands, n) {
    const d = s.eliminations[0].digit;
    const base = s.highlight.units.slice(0, n), cover = s.highlight.units.slice(n);
    const kc = hlCellsOf(s, 'base');
    const bw = base[0] < 9 ? 'row' : 'column', cw = bw === 'row' ? 'column' : 'row';
    const counts = base.map((u) => `${unitName(u)}: ${cells(posIn(cands, u, d))}`).join('; ');
    const name = { 2: 'X-Wing', 3: 'Swordfish', 4: 'Jellyfish' }[n];
    return [
      { text: `Look only at digit *${d}* in ${linesName(base)}. In each of these ${bw}s, ${d} has just ${n === 2 ? 'two places' : `${n === 3 ? 'two or three' : 'two to four'} places`}: ${counts}.`, hl: H({ units: base, cands: key(kc, d) }) },
      { text: `All of these candidates lie in only ${NUM[n]} ${cw}s: *${linesName(cover)}*.` + (n === 2 ? ' The four cells are the corners of a rectangle.' : ''), hl: H({ units: [...base, ...cover], cells: roleCells(kc, 'base'), cands: key(kc, d) }) },
      { text: `Each of the ${NUM[n]} ${bw}s needs one ${d}, and each must take it in one of these ${NUM[n]} ${cw}s. ${cap(NUM[n])} ${d}s in ${NUM[n]} ${cw}s, at most one per ${cw}: they fill the ${cw}s completely. That's a${n === 2 ? 'n' : ''} ${name}.`, hl: H({ units: [...base, ...cover], cells: roleCells(kc, 'base'), cands: key(kc, d) }) },
      { text: `So no other cell in ${linesName(cover)} can be ${d}: remove ${elimSentence(s.eliminations)}.`, hl: full(s) },
    ];
  },
  finned(s, grid, cands, n) {
    const d = s.eliminations[0].digit;
    const base = s.highlight.units.slice(0, n), cover = s.highlight.units.slice(n);
    const kc = hlCellsOf(s, 'base'), fins = hlCellsOf(s, 'fin');
    const fb = BOX(fins[0]);
    const bw = base[0] < 9 ? 'row' : 'column', cw = bw === 'row' ? 'column' : 'row';
    const name = n === 2 ? 'X-Wing' : 'Swordfish';
    return [
      { text: `Look only at digit *${d}* in ${linesName(base)}. Its candidates there are ${cells([...kc, ...fins].sort((a, b) => a - b))}.`, hl: H({ units: base, cands: key([...kc, ...fins], d) }) },
      { text: `Ignore ${cells(fins)} for a moment: the rest lie in only ${NUM[n]} ${cw}s, ${linesName(cover)} — that would be a${n === 2 ? 'n' : ''} ${name}.`, hl: H({ units: [...base, ...cover], cells: roleCells(kc, 'base'), cands: key(kc, d) }) },
      { text: `The extra ${plural(fins.length, 'candidate', 'candidates')} ${cells(fins)} ${plural(fins.length, 'is', 'are')} the *fin*, all in box ${fb + 1}. Either a fin is ${d}, or the ${name} is real — one of the two must hold.`, hl: H({ units: [...base, ...cover, 18 + fb], cells: [...roleCells(kc, 'base'), ...roleCells(fins, 'fin')], cands: key([...kc, ...fins], d) }) },
      { text: `If the ${name} is real, ${d} leaves the rest of its ${cw}s. If a fin is ${d}, ${d} leaves box ${fb + 1}. Cells in both — a cover ${cw} *and* box ${fb + 1} — lose ${d} either way: remove ${elimSentence(s.eliminations)}.`, hl: full(s) },
    ];
  },
  skyscraper(s) {
    const [pu, qu] = s.highlight.units, d = s.eliminations[0].digit;
    const [p1, q1] = hlCellsOf(s, 'base'), [p2, q2] = hlCellsOf(s, 'pincer');
    const L = s.highlight.links;
    const baseKind = pu < 9 ? 'column' : 'row';
    return [
      { text: `Look only at digit *${d}*. In ${unitName(pu)} it has only two places (${cells([p1, p2].sort((a, b) => a - b))}), and in ${unitName(qu)} too (${cells([q1, q2].sort((a, b) => a - b))}). Each pair is a *strong link*: one of the two must be ${d}.`, hl: H({ units: [pu, qu], cands: key([p1, p2, q1, q2], d), links: [L[0], L[2]] }) },
      { text: `${cn(p1)} and ${cn(q1)} share a ${baseKind} — the base of the skyscraper. They see each other, so at most one of them is ${d}.`, hl: H({ units: [pu, qu], cells: roleCells([p1, q1], 'base'), cands: key([p1, p2, q1, q2], d), links: L }) },
      { text: `If ${cn(p1)} is not ${d}, then ${cn(p2)} is. If ${cn(q1)} is not ${d}, then ${cn(q2)} is. One of the base cells is not ${d}, so *${cn(p2)} or ${cn(q2)} is ${d}*.`, hl: H({ units: [pu, qu], cells: [...roleCells([p1, q1], 'base'), ...roleCells([p2, q2], 'pincer')], cands: key([p1, p2, q1, q2], d), links: L }) },
      { text: `A cell that sees both tops can't be ${d}: remove ${elimSentence(s.eliminations)}.`, hl: full(s) },
    ];
  },
  two_string_kite(s) {
    const [ru, cu, bu] = s.highlight.units, d = s.eliminations[0].digit;
    const [x, y] = hlCellsOf(s, 'base'), [x2, y2] = hlCellsOf(s, 'pincer'), [t] = hlCellsOf(s, 'target');
    const L = s.highlight.links;
    return [
      { text: `Look only at digit *${d}*. In ${unitName(ru)} it has only two places (${cells([x, x2].sort((a, b) => a - b))}), and in ${unitName(cu)} only two (${cells([y, y2].sort((a, b) => a - b))}). These are two strings (strong links).`, hl: H({ units: [ru, cu], cands: key([x, x2, y, y2], d), links: [L[0], L[2]] }) },
      { text: `${cn(x)} and ${cn(y)} are in the same box (${unitName(bu)}), so at most one of them is ${d}.`, hl: H({ units: [ru, cu, bu], cells: roleCells([x, y], 'base'), cands: key([x, x2, y, y2], d), links: L }) },
      { text: `If ${cn(x)} is not ${d}, ${cn(x2)} is; if ${cn(y)} is not ${d}, ${cn(y2)} is. So *${cn(x2)} or ${cn(y2)} is ${d}*.`, hl: H({ units: [ru, cu, bu], cells: [...roleCells([x, y], 'base'), ...roleCells([x2, y2], 'pincer')], cands: key([x, x2, y, y2], d), links: L }) },
      { text: `${cn(t)} sits in ${cn(x2)}'s ${sharedUnits(t, x2).map(unitKind)[0]} and ${cn(y2)}'s ${sharedUnits(t, y2).map(unitKind)[0]}, so it sees both ends: remove ${elimSentence(s.eliminations)}.`, hl: full(s) },
    ];
  },
  empty_rectangle(s, grid, cands) {
    const [bu, line] = s.highlight.units, d = s.eliminations[0].digit;
    const boxCells = hlCellsOf(s, 'base'), [e1, e2] = hlCellsOf(s, 'pincer'), [t] = hlCellsOf(s, 'target');
    const b = bu - 18, r0 = 3 * ((b / 3) | 0), c0 = 3 * (b % 3);
    let R = -1, C = -1;
    for (let r = r0; r < r0 + 3 && R < 0; r++) for (let c = c0; c < c0 + 3; c++) {
      if (!boxCells.every((x) => ROW(x) === r || COL(x) === c)) continue;
      if (!boxCells.some((x) => ROW(x) === r && COL(x) !== c) || !boxCells.some((x) => COL(x) === c && ROW(x) !== r)) continue;
      R = r; C = c; break;
    }
    const colLine = line >= 9;
    const crossHl = [bu, R, 9 + C];
    return [
      { text: `Look only at digit *${d}* in *${unitName(bu)}*: its candidates are ${cells(boxCells)}. They all lie in row ${R + 1} or column ${C + 1} — a cross. The other cells of the box (the "empty rectangle") have no ${d}.`, hl: H({ units: crossHl, cells: roleCells(boxCells, 'base'), cands: key(boxCells, d) }) },
      { text: `So the ${d} of box ${b + 1} is in row ${R + 1} or in column ${C + 1}. Now look at ${unitName(line)}: ${d} has only two places there, ${cn(e1)} and ${cn(e2)} — a strong link, and ${cn(e1)} is on the cross's ${colLine ? `row ${R + 1}` : `column ${C + 1}`}.`, hl: H({ units: [bu, line], cells: [...roleCells(boxCells, 'base'), ...roleCells([e1, e2], 'pincer')], cands: key([...boxCells, e1, e2], d), links: s.highlight.links }) },
      { text: `Suppose ${cn(t)} were ${d}. It shares a ${colLine ? 'row' : 'column'} with ${cn(e2)}, so ${cn(e2)} is not ${d} and ${cn(e1)} must be. ${cn(e1)} blocks ${colLine ? `row ${R + 1}` : `column ${C + 1}`} of the box, and ${cn(t)} blocks ${colLine ? `column ${C + 1}` : `row ${R + 1}`} — box ${b + 1} would have no place left for ${d}.`, hl: H({ units: [bu, line], cells: [...roleCells(boxCells, 'base'), ...roleCells([e1, e2], 'pincer'), { cell: t, role: 'target' }], cands: key([...boxCells, e1, e2], d), links: s.highlight.links }) },
      { text: `That's impossible, so remove ${elimSentence(s.eliminations)}.`, hl: full(s) },
    ];
  },
  xy_wing(s, grid, cands) {
    const [p] = hlCellsOf(s, 'pivot'), [a, b] = hlCellsOf(s, 'pincer');
    const z = s.eliminations[0].digit;
    const [x, y] = digitsOf(cands[p]);
    const xa = (cands[a] & BIT(x)) ? x : y, yb = xa === x ? y : x;
    return [
      { text: `Look at *${cn(p)}*: it has exactly two candidates, *${x}* and *${y}*. This is the pivot.`, hl: H({ cells: roleCells([p], 'pivot'), cands: key([p], x).concat(key([p], y)) }) },
      { text: `The pivot sees two pincers with two candidates each: ${cn(a)} ${set(digitsOf(cands[a]))} shares ${xa} with it, and ${cn(b)} ${set(digitsOf(cands[b]))} shares ${yb}. Both pincers also contain *${z}*.`, hl: H({ cells: [...roleCells([p], 'pivot'), ...roleCells([a, b], 'pincer')], cands: subsetKeys(s), links: s.highlight.links }) },
      { text: `If ${cn(p)} is ${xa}, then ${cn(a)} can't be ${xa}, so it is ${z}. If ${cn(p)} is ${yb}, then ${cn(b)} is ${z}. Either way, *one of the pincers is ${z}*.`, hl: H({ cells: [...roleCells([p], 'pivot'), ...roleCells([a, b], 'pincer')], cands: [...subsetKeys(s).filter((c) => c.digit !== z), ...key([a, b], z, 'colorA')], links: s.highlight.links }) },
      { text: `Any cell that sees both pincers can't be ${z}: remove ${elimSentence(s.eliminations)}.`, hl: full(s) },
    ];
  },
  w_wing(s, grid, cands) {
    const [A, B] = hlCellsOf(s, 'pincer'), [p, q] = hlCellsOf(s, 'base');
    const u = s.highlight.units[0], y = s.eliminations[0].digit;
    const x = digitsOf(cands[A]).find((d) => d !== y);
    const L = s.highlight.links;
    return [
      { text: `${cn(A)} and ${cn(B)} both hold exactly *${set([x, y].sort())}*, and they don't see each other.`, hl: H({ cells: roleCells([A, B], 'pincer'), cands: [...key([A, B], x), ...key([A, B], y)] }) },
      { text: `In *${unitName(u)}*, ${x} has only two places: ${cn(p)} and ${cn(q)} (a strong link). ${cn(p)} sees ${cn(A)}, and ${cn(q)} sees ${cn(B)}.`, hl: H({ units: [u], cells: [...roleCells([A, B], 'pincer'), ...roleCells([p, q], 'base')], cands: [...key([A, B], x), ...key([A, B], y), ...key([p, q], x)], links: L }) },
      { text: `If both ${cn(A)} and ${cn(B)} were ${x}, neither ${cn(p)} nor ${cn(q)} could be ${x} — and ${unitName(u)} would have no ${x}. So *at least one of them is ${y}*.`, hl: H({ units: [u], cells: [...roleCells([A, B], 'pincer'), ...roleCells([p, q], 'base')], cands: [...key([A, B], x), ...key([A, B], y, 'colorA'), ...key([p, q], x)], links: L }) },
      { text: `Any cell that sees both ${cn(A)} and ${cn(B)} can't be ${y}: remove ${elimSentence(s.eliminations)}.`, hl: full(s) },
    ];
  },
  simple_coloring(s) {
    const d = s.eliminations[0].digit;
    const A = s.highlight.cands.filter((c) => c.role === 'colorA').map((c) => c.cell);
    const B = s.highlight.cands.filter((c) => c.role === 'colorB').map((c) => c.cell);
    const elimCells = s.eliminations.map((e) => e.cell);
    const wrap = /wrap/.test(s.text);
    // for a wrap, the eliminated cells are one colour: restore them for the colouring steps
    let colA = A, colB = B;
    if (wrap) { if (!A.length) colA = elimCells; else if (!B.length) colB = elimCells; }
    const all = [...colA, ...colB];
    const links = s.highlight.links;
    const colouring = H({ cands: [...key(colA, d, 'colorA'), ...key(colB, d, 'colorB')], links });
    const out = [
      { text: `Look only at digit *${d}* and its *strong links* — units where ${d} has exactly two places. Connected, they form a chain through ${all.length} cells.`, hl: H({ cands: key(all, d), links }) },
      { text: `Colour the chain alternately: teal and orange. Along a strong link exactly one end is ${d}, so either *every teal* cell is ${d}, or *every orange* cell is.`, hl: colouring },
    ];
    if (wrap) {
      const S = elimCells;
      let clash = null;
      for (let i = 0; i < S.length && !clash; i++) for (let j = i + 1; j < S.length; j++) if (sees(S[i], S[j])) { clash = [S[i], S[j]]; break; }
      out.push({ text: `But ${clash ? `${cn(clash[0])} and ${cn(clash[1])}` : 'two cells'} have the same colour *and* see each other — they can't both be ${d}. So that colour is false.`, hl: H({ ...colouring, cells: clash ? roleCells(clash, 'target') : [] }) });
      out.push({ text: `Remove ${d} from every cell of the false colour: ${elimSentence(s.eliminations)}.`, hl: full(s) });
    } else {
      out.push({ text: `${cells(elimCells)} ${plural(elimCells.length, 'sees', 'see')} a teal cell *and* an orange cell. Whichever colour is true, ${plural(elimCells.length, 'it', 'they')} would see a ${d}.`, hl: H({ ...colouring, cells: roleCells(elimCells, 'target') }) });
      out.push({ text: `So remove ${elimSentence(s.eliminations)}.`, hl: full(s) });
    }
    return out;
  },
  xyz_wing(s, grid, cands) {
    const [p] = hlCellsOf(s, 'pivot'), [a, b] = hlCellsOf(s, 'pincer');
    const z = s.eliminations[0].digit;
    const xa = digitsOf(cands[a]).find((d) => d !== z), yb = digitsOf(cands[b]).find((d) => d !== z);
    const keys = subsetKeys(s);
    return [
      { text: `The pivot *${cn(p)}* has three candidates: ${set(digitsOf(cands[p]))}.`, hl: H({ cells: roleCells([p], 'pivot'), cands: keys.filter((k) => k.cell === p) }) },
      { text: `It sees two pincers: ${cn(a)} ${set(digitsOf(cands[a]))} and ${cn(b)} ${set(digitsOf(cands[b]))}. All three cells contain *${z}*.`, hl: H({ cells: [...roleCells([p], 'pivot'), ...roleCells([a, b], 'pincer')], cands: keys }) },
      { text: `If the pivot is ${xa}, ${cn(a)} must be ${z}. If it is ${yb}, ${cn(b)} must be ${z}. If it is ${z}, the pivot itself is. So *one of the three cells is ${z}*.`, hl: H({ cells: [...roleCells([p], 'pivot'), ...roleCells([a, b], 'pincer')], cands: [...keys.filter((k) => k.digit !== z), ...key([p, a, b], z, 'colorA')] }) },
      { text: `A cell that sees all three can't be ${z}: remove ${elimSentence(s.eliminations)}.`, hl: full(s) },
    ];
  },
  wxyz_wing(s, grid, cands) {
    const [p] = hlCellsOf(s, 'pivot'), trip = hlCellsOf(s, 'pincer');
    const all = [p, ...trip];
    const z = s.eliminations[0].digit;
    let U = 0; for (const c of all) U |= cands[c];
    const ds = digitsOf(U);
    const zCells = all.filter((c) => cands[c] & BIT(z));
    const keys = subsetKeys(s);
    return [
      { text: `Look at the four cells ${cells(all)}: ${all.map((c) => `${cn(c)} ${set(digitsOf(cands[c]))}`).join(', ')}. Together they use only *${joinAnd(ds.map(String))}*.`, hl: H({ cells: [...roleCells([p], 'pivot'), ...roleCells(trip, 'pincer')], cands: keys }) },
      { text: `For every digit except ${z}, the cells holding it all see each other, so each of those digits can be used at most once here. Three digits can fill at most three of the four cells.`, hl: H({ cells: [...roleCells([p], 'pivot'), ...roleCells(trip, 'pincer')], cands: [...keys.filter((k) => k.digit !== z), ...key(zCells, z, 'colorA')] }) },
      { text: `So the remaining cell must be *${z}*: at least one of ${cells(zCells)} is ${z}.`, hl: H({ cells: [...roleCells([p], 'pivot'), ...roleCells(trip, 'pincer')], cands: [...keys.filter((k) => k.digit !== z), ...key(zCells, z, 'colorA')] }) },
      { text: `Any cell that sees all of them can't be ${z}: remove ${elimSentence(s.eliminations)}.`, hl: full(s) },
    ];
  },
  unique_rectangle(s, grid, cands) {
    const floor = hlCellsOf(s, 'base'), roof = hlCellsOf(s, 'target');
    const corners = [...floor, ...roof].sort((a, b) => a - b);
    const common = corners.reduce((m, c) => m & cands[c], 511);
    const type = +(/type (\d)/.exec(s.text) || [0, 1])[1];
    // the rectangle digits are the key digits present in all four corners
    const keyDs = uniq(s.highlight.cands.filter((c) => c.role === 'key' && corners.includes(c.cell)).map((c) => c.digit));
    const ab = keyDs.filter((d) => common & BIT(d)).slice(0, 2);
    const [a, b] = ab.length === 2 ? ab : digitsOf(common).slice(0, 2);
    const rectKeys = [...key(corners, a), ...key(corners, b)];
    const out = [
      { text: `Look at the four cells ${cells(corners)}. They form a rectangle that spans exactly two boxes, and all four contain *${a}* and *${b}*.`, hl: H({ cells: roleCells(corners, 'base'), cands: rectKeys }) },
      { text: `If all four ended up as just ${a}/${b}, you could swap the ${a}s and ${b}s and get a second solution — a "deadly pattern". This puzzle has exactly one solution, so that cannot happen.`, hl: H({ cells: roleCells(corners, 'base'), cands: rectKeys }) },
    ];
    if (type === 1) {
      const t = roof[0];
      out.push({ text: `${cells(floor)} hold only ${a} and ${b}. So the fourth corner *${cn(t)}* must be something else — it is the only thing that can break the pattern.`, hl: H({ cells: [...roleCells(floor, 'base'), { cell: t, role: 'target' }], cands: rectKeys }) });
    } else if (type === 2) {
      const c = s.eliminations[0].digit;
      out.push({ text: `${cells(floor)} hold only ${a} and ${b}. The other two corners, ${cells(roof)}, both have one extra candidate, *${c}*. To break the pattern, *one of them must be ${c}*.`, hl: H({ cells: [...roleCells(floor, 'base'), ...roleCells(roof, 'target')], cands: [...rectKeys, ...key(roof, c, 'colorA')] }) });
    } else {
      const u = s.highlight.units[0];
      const o = s.eliminations[0].digit, k = o === a ? b : a;
      out.push({ text: `${cells(floor)} hold only ${a} and ${b}. In ${unitName(u)}, ${k} can only go in ${cells(roof)}, so one of them is ${k}. If either were ${o} as well, the pattern would be complete — so neither can be ${o}.`, hl: H({ units: [u], cells: [...roleCells(floor, 'base'), ...roleCells(roof, 'target')], cands: [...rectKeys.filter((x) => !(roof.includes(x.cell) && x.digit === k)), ...key(roof, k, 'colorA')] }) });
    }
    out.push({ text: `So remove ${elimSentence(s.eliminations)}.`, hl: full(s) });
    return out;
  },
  bug_plus_one(s, grid, cands) {
    const { cell, digit: d } = s.placements[0];
    const others = digitsOf(cands[cell]).filter((x) => x !== d);
    return [
      { text: `Every unsolved cell has exactly two candidates — except *${cn(cell)}*, which has three: ${set(digitsOf(cands[cell]))}.`, hl: H({ cells: roleCells([cell], 'target'), cands: digitsOf(cands[cell]).map((x) => ({ cell, digit: x, role: 'key' })) }) },
      { text: `If ${cn(cell)} were ${joinOr(others.map(String))}, every cell would be bivalue with each digit twice per unit: a "BUG", which can never have a unique solution.`, hl: H({ units: CELL_UNITS[cell], cells: roleCells([cell], 'target'), cands: digitsOf(cands[cell]).map((x) => ({ cell, digit: x, role: 'key' })) }) },
      { text: `In its row, column and box, ${d} appears three times — one too many for a BUG. So *${cn(cell)} must be ${d}*.`, hl: full(s), apply: true },
    ];
  },
  forcing_chain(s, grid, cands) {
    const pivots = hlCellsOf(s, 'pivot');
    const contradiction = /^Forcing chain: if/.test(s.text);
    if (contradiction) {
      const e = s.eliminations[0];
      const tgt = hlCellsOf(s, 'target');
      const msg = s.text.replace(/^.*following the forced moves /, '').replace(/\. So .*$/, '');
      const pr = propagateSingles(grid, cands, e.cell, e.digit);
      if (pr.bad) {
        const forced = pr.moves.slice(1);
        const shown = forced.slice(0, 4).map((m) => `${cn(m.cell)} = ${m.digit}`);
        const dead = [];
        for (let i = 0; i < 81; i++) if (!pr.g[i] && !pr.c[i]) dead.push(i);
        const badCells = pr.bad.cell !== undefined ? uniq([pr.bad.cell, ...dead]) : dead;
        const alsoDead = badCells.filter((c) => c !== pr.bad.cell);
        const badUnits = pr.bad.unit !== undefined ? [pr.bad.unit] : [];
        const badText = pr.bad.cell !== undefined
          ? `${cn(pr.bad.cell)} is left with no candidate at all${alsoDead.length ? ` (and so ${plural(alsoDead.length, 'is', 'are')} ${cells(alsoDead)})` : ''}`
          : `${unitName(pr.bad.unit)} has no place left for ${pr.bad.digit}`;
        return [
          { text: `Nothing simpler works here, so we test an option. Suppose *${cn(e.cell)} is ${e.digit}*.`, hl: H({ cells: roleCells([e.cell], 'pivot'), cands: [{ cell: e.cell, digit: e.digit, role: 'colorA' }] }) },
          { text: `Follow only the forced moves (singles): ${shown.join(', ')}${forced.length > 4 ? ` and ${forced.length - 4} more` : ''}. The shaded cells show this imagined line of play.`, hl: H({ cells: [...roleCells([e.cell], 'pivot'), ...roleCells(forced.map((m) => m.cell), 'base')] }), grid: stringify(pr.g), cands: Array.from(pr.c) },
          { text: `Now *${badText}* — a contradiction. The assumption "${cn(e.cell)} is ${e.digit}" must be false.`, hl: H({ units: badUnits, cells: [...roleCells([e.cell], 'pivot'), ...roleCells(forced.map((m) => m.cell), 'base'), ...roleCells(badCells, 'target')] }), grid: stringify(pr.g), cands: Array.from(pr.c) },
          { text: `Back on the real board: remove ${elimSentence(s.eliminations)}.`, hl: full(s) },
        ];
      }
      return [
        { text: `Nothing simpler works here, so we test an option. Suppose *${cn(e.cell)} is ${e.digit}*.`, hl: H({ cells: roleCells(pivots, 'pivot'), cands: [{ cell: e.cell, digit: e.digit, role: 'colorA' }] }) },
        { text: `Follow only the forced moves from there — each placement leaves some cell or unit with a single option, which forces the next. Eventually *${msg}*. That is a contradiction.`, hl: H({ units: s.highlight.units, cells: [...roleCells(pivots, 'pivot'), ...roleCells(tgt, 'target')], cands: [{ cell: e.cell, digit: e.digit, role: 'colorA' }] }) },
        { text: `So the assumption was wrong: remove ${elimSentence(s.eliminations)}.`, hl: full(s) },
      ];
    }
    const keys = s.highlight.cands.filter((c) => c.role === 'key');
    const m = /^(Cell|Digit) forcing chain: ([^;]*);/.exec(s.text);
    const src = m ? m[2] : '';
    const res = s.placements.length ? `${cn(s.placements[0].cell)} becomes ${s.placements[0].digit}` : `the same candidates disappear: ${elimSentence(s.eliminations)}`;
    return [
      { text: `Nothing simpler works here, so we try every option. ${src ? src[0].toUpperCase() + src.slice(1) : ''} — one of these must be true.`, hl: H({ units: s.highlight.units, cells: roleCells(pivots, 'pivot'), cands: keys }) },
      { text: `Try each option in turn and follow only the forced moves (singles). Write down what every branch leads to.`, hl: H({ units: s.highlight.units, cells: roleCells(pivots, 'pivot'), cands: keys.map((k) => ({ ...k, role: 'colorA' })) }) },
      { text: `In every branch, ${res}. Since one branch must be the truth, that result is certain.`, hl: full(s), apply: s.placements.length > 0 },
    ];
  },
};

function taskFor(s, grid, cands) {
  if (s.technique === 'forcing_chain' && /^Forcing chain: if/.test(s.text)) {
    const e = s.eliminations[0];
    return `Suppose ${cn(e.cell)} were ${e.digit}, and follow the forced singles. Is that possible? Tap the candidate you can remove, then press Check.`;
  }
  return LESSON_TEXT[s.technique].task;
}

function narrate(s, grid, cands) {
  const id = s.technique;
  const n = { naked_pair: 2, naked_triple: 3, naked_quad: 4, hidden_pair: 2, hidden_triple: 3, hidden_quad: 4, x_wing: 2, swordfish: 3, jellyfish: 4, finned_x_wing: 2, finned_swordfish: 3 }[id];
  if (id.startsWith('naked_') && n) return NARRATE.naked_subset(s, grid, cands, n);
  if (id.startsWith('hidden_') && n) return NARRATE.hidden_subset(s, grid, cands, n);
  if (id === 'x_wing' || id === 'swordfish' || id === 'jellyfish') return NARRATE.fish(s, grid, cands, n);
  if (id.startsWith('finned_')) return NARRATE.finned(s, grid, cands, n);
  if (id === 'x_chain') return chainSteps(s, grid, cands, 'x');
  if (id === 'xy_chain') return chainSteps(s, grid, cands, 'xy');
  if (id === 'aic') return chainSteps(s, grid, cands, 'aic');
  return NARRATE[id](s, grid, cands);
}

// ---------------------------------------------------------------------------
// Mining

const IDS = TECHNIQUES.map((t) => t.id);
const PLACE_IDS = new Set(['full_house', 'naked_single', 'hidden_single', 'bug_plus_one']);
const RELAXED = new Set(['jellyfish', 'hidden_quad']);   // too rare as "next step": also mine findStep positions

function pureSingle(s, grid) {
  const base = computeCandidates(grid);
  const { cell, digit } = s.placements[0];
  if (s.technique === 'naked_single') return base[cell] === BIT(digit);
  if (s.technique === 'hidden_single') return posIn(base, s.highlight.units[0], digit).length === 1;
  return true;
}

/** Lower is cleaner. */
function score(s, grid, cands, ctx) {
  const id = s.technique;
  const empties = grid.filter((d) => !d).length;
  const E = s.eliminations.length, L = s.highlight.links.length;
  let sc = 0;
  if (id === 'full_house' || id === 'naked_single' || id === 'hidden_single') {
    if (!pureSingle(s, grid)) sc += 100;
    sc += ctx.k * 0.4 + Math.abs(empties - 42) * 0.3;
    if (id === 'hidden_single') {
      const { cell } = s.placements[0];
      sc += bitCount(cands[cell]) >= 3 ? 0 : 6;
      sc += s.highlight.units[0] >= 18 ? 0 : 3;   // box singles read best
    }
    if (id === 'naked_single') sc += bitCount(computeCandidates(grid)[s.placements[0].cell]) === 1 ? 0 : 10;
    return sc;
  }
  sc += empties * 0.12;                       // fewer notes = calmer board
  sc += Math.max(0, E - 2) * 2.5;             // few eliminations
  sc += L * 3;                                // short chains
  if (ctx.relaxed) sc += 40;
  const keys = s.highlight.cands.filter((c) => c.role === 'key').length;
  switch (id) {
    case 'x_wing': case 'swordfish': case 'jellyfish': {
      const n = { x_wing: 2, swordfish: 3, jellyfish: 4 }[id];
      sc += (keys - 2 * n) * 2; break;
    }
    case 'finned_x_wing': case 'finned_swordfish':
      sc += hlCellsOf(s, 'fin').length * 2 + keys; break;
    case 'naked_pair': case 'naked_triple': case 'naked_quad': case 'hidden_pair': case 'hidden_triple': case 'hidden_quad':
      sc += keys * 0.8; break;
    case 'simple_coloring':
      sc += s.highlight.cands.length * 1.5 + (/wrap/.test(s.text) ? 4 : 0); break;
    case 'unique_rectangle':
      sc += ({ 1: 0, 2: 6, 4: 8 })[+(/type (\d)/.exec(s.text) || [0, 1])[1]]; break;
    case 'aic':
      if (L > 8) sc += 30; break;
    case 'forcing_chain':
      sc += /^Forcing chain: if/.test(s.text) ? 0 : /^Cell/.test(s.text) ? 8 : 12;
      sc += s.text.length / 25; break;
    case 'wxyz_wing':
      sc += keys; break;
  }
  return sc;
}

/** How many distinct instances of the technique the position holds (up to 4). */
function instances(id, grid, cands) {
  if (PLACE_IDS.has(id)) return 1;
  const c = cands.slice();
  let n = 0;
  for (; n < 4; n++) {
    const s = findStep(id, grid, c);
    if (!s || (!s.eliminations.length)) break;
    for (const e of s.eliminations) c[e.cell] &= ~BIT(e.digit);
  }
  return n;
}

function* sources() {
  const pool = JSON.parse(readFileSync(ROOT + 'data/puzzles.json', 'utf8'));
  for (let L = 0; L < pool.levels.length; L++) {
    for (let k = 0; k < pool.levels[L].length; k++) yield { id: `pool${L}-${k}`, puzzle: pool.levels[L][k] };
  }
  const rand = rng('sudoku-zen-lessons-v1');
  for (let k = 0; k < GEN_MAX; k++) yield { id: `gen${k}`, puzzle: generate(rand).puzzle, gen: true };
}
const GEN_MAX = 30000;
const KEEP = 24;           // candidates kept per technique

function mine() {
  const found = Object.fromEntries(IDS.map((id) => [id, []]));
  const add = (id, rec) => {
    const list = found[id];
    if (list.some((r) => r.src === rec.src && r.score <= rec.score)) return;
    const i = list.findIndex((r) => r.src === rec.src);
    if (i >= 0) list.splice(i, 1);
    list.push(rec);
    list.sort((a, b) => a.score - b.score || (a.order - b.order));
    if (list.length > KEEP) list.length = KEEP;
  };
  const enough = () => IDS.every((id) => new Set(found[id].filter((r) => !r.relaxed || RELAXED.has(id)).map((r) => r.src)).size >= 6);
  let order = 0, nGen = 0;
  for (const src of sources()) {
    if (src.gen) {
      nGen++;
      if (enough() && nGen > 3000) break;
    }
    const grid = parse(src.puzzle), cands = computeCandidates(grid);
    const sol = solve(parse(src.puzzle));
    for (let k = 0; k < 400; k++) {
      if (grid.every((d) => d)) break;
      const s = nextStep(grid, cands);
      if (!s) break;
      const rec = (step, relaxed) => {
        const ok = step.placements.every((p) => sol[p.cell] === p.digit) && step.eliminations.every((e) => sol[e.cell] !== e.digit);
        if (!ok) return;
        const ctx = { k, relaxed };
        add(step.technique, {
          src: src.id, order: order++, relaxed, puzzle: src.puzzle, k,
          grid: grid.slice(), cands: cands.slice(), step, score: score(step, grid, cands, ctx),
        });
      };
      rec(s, false);
      if (s.tier >= 3) {
        for (const id of RELAXED) {
          if (id === s.technique || found[id].filter((r) => !r.relaxed).length >= 6) continue;
          const r = findStep(id, grid, cands);
          if (!r) continue;
          if (id === 'hidden_quad' && UNITS[r.highlight.units[0]].filter((i) => !grid[i]).length < 7) continue;
          rec(r, true);
        }
      }
      applyStep(grid, cands, s);
    }
  }
  return { found, nGen };
}

// ---------------------------------------------------------------------------
// Assemble

const packCands = (c) => Array.from(c);

function buildIntro() {
  // A calm beginner position from the pool, with full pencil marks.
  const pool = JSON.parse(readFileSync(ROOT + 'data/puzzles.json', 'utf8'));
  const puzzle = pool.levels[0][0];
  const grid = parse(puzzle), cands = computeCandidates(grid);
  // a cell with 3 candidates in a busy spot
  let cell = -1;
  for (let i = 0; i < 81 && cell < 0; i++) if (!grid[i] && bitCount(cands[i]) === 3) cell = i;
  const us = CELL_UNITS[cell];
  const r = ROW(cell), c = COL(cell);
  const peersFilled = PEERS[cell].filter((j) => grid[j]);
  const ds = digitsOf(cands[cell]);
  const used = uniq(peersFilled.map((j) => grid[j])).sort();
  // a single-candidate-removal demonstration: a digit placed in a peer
  const steps = [
    { text: `A sudoku has 9 *rows*, 9 *columns* and 9 *boxes* (the 3×3 blocks with thick borders). Here row ${r + 1}, column ${c + 1} and box ${BOX(cell) + 1} are shaded: each must end up with all digits 1–9, once each.`, hl: H({ units: us }) },
    { text: `Cells are named by row and column: the highlighted cell is *${cn(cell)}* (row ${r + 1}, column ${c + 1}). Its row, column and box already contain ${joinAnd(used.map(String))} (yellow).`, hl: H({ units: us, cells: [...roleCells(peersFilled, 'cover'), { cell, role: 'target' }] }) },
    { text: `So only ${joinAnd(ds.map(String))} can still go there. These are its *candidates*, written as small notes in the cell — each digit always in the same spot (1 top-left … 9 bottom-right).`, hl: H({ units: us, cells: [{ cell, role: 'target' }], cands: key([cell], ds[0]).concat(key([cell], ds[1]), key([cell], ds[2])) }) },
    { text: `The whole board with notes filled in looks like this. Every technique in these lessons reads these notes and finds a reason to *remove* a candidate (red, crossed out) or *place* a digit (green).`, hl: H({}) },
    { text: `When a digit is placed, it removes that candidate from every cell in its row, column and box. Keeping notes tidy this way is what makes the patterns visible. Ready? Start with the full house.`, hl: H({}) },
  ];
  return { puzzle, grid: stringify(grid), cands: packCands(cands), steps };
}

function lessonFor(id, chapter, found) {
  const tech = TECHNIQUES.find((t) => t.id === id);
  const T = LESSON_TEXT[id];
  const list = found[id];
  if (!list.length) throw new Error(`no example found for ${id}`);
  const strict = list.filter((r) => !r.relaxed);
  const pickFrom = strict.length >= 2 ? strict : list;
  // example: best score, with a small bonus for a unique instance
  const ranked = (arr, uniqWeight) => arr.map((r) => ({ r, s: r.score + (instances(id, r.grid, r.cands) > 1 ? uniqWeight : 0) }))
    .sort((a, b) => a.s - b.s || a.r.order - b.r.order).map((x) => x.r);
  const ex = ranked(pickFrom.slice(0, 12), 4)[0];
  const others = list.filter((r) => r.src !== ex.src);
  if (!others.length) throw new Error(`no practice position (different puzzle) for ${id}`);
  const pr = ranked((others.filter((r) => !r.relaxed).length ? others.filter((r) => !r.relaxed) : others).slice(0, 12), 30)[0];
  const pack = (r) => ({
    puzzle: r.puzzle,
    grid: stringify(r.grid),
    cands: packCands(r.cands),
    step: { technique: r.step.technique, name: r.step.name, tier: r.step.tier, placements: r.step.placements, eliminations: r.step.eliminations, highlight: H(r.step.highlight), text: r.step.text },
    steps: narrate(r.step, r.grid, r.cands).map((x) => Object.fromEntries(Object.entries(x).filter(([, v]) => v !== false && v !== undefined))),
    task: taskFor(r.step, r.grid, r.cands),
    ...(r.relaxed ? { relaxed: true } : {}),
  });
  const level = TIER_LEVEL[tech.tier];
  return {
    id, chapter, title: tech.name, tier: tech.tier, level,
    levelHint: tech.tier === 1 ? 'Every level' : `Appears from ${LEVEL_NAMES[level]}`,
    summary: T.summary, intro: T.intro,
    mode: PLACE_IDS.has(id) ? 'place' : 'elim',
    example: pack(ex),
    practice: { ...pack(pr), unique: instances(id, pr.grid, pr.cands) <= 1 },
  };
}

export function build() {
  const t0 = Date.now();
  const { found, nGen } = mine();
  const lessons = [];
  for (const [id, chapter] of ORDER) {
    if (id === 'intro') {
      const T = LESSON_TEXT.intro;
      lessons.push({ id, chapter, title: T.title, tier: 1, level: 0, levelHint: 'Start here', summary: T.summary, intro: T.intro, mode: 'none', example: buildIntro() });
    } else lessons.push(lessonFor(id, chapter, found));
  }
  const missing = IDS.filter((id) => !lessons.some((l) => l.id === id));
  if (missing.length) throw new Error('techniques without a lesson: ' + missing.join(', '));
  const data = { version: 1, chapters: CHAPTERS, lessons };
  return { data, stats: { nGen, ms: Date.now() - t0 } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { data, stats } = build();
  const json = JSON.stringify(data);
  writeFileSync(OUT, json + '\n');
  console.log(`wrote ${OUT}: ${data.lessons.length} lessons, ${(json.length / 1024).toFixed(1)} KB, ${stats.nGen} generated puzzles, ${stats.ms} ms`);
  for (const l of data.lessons) {
    if (!l.practice) continue;
    const e = l.example, p = l.practice;
    console.log(`${l.id.padEnd(18)} ex ${e.step.eliminations.length}e/${e.step.placements.length}p links ${(e.step.highlight.links || []).length}${e.relaxed ? ' RELAXED' : ''} | pr ${p.step.eliminations.length}e${p.unique ? '' : ' multi'}${p.relaxed ? ' RELAXED' : ''}`);
  }
}
