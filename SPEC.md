# Sudoku Zen — Build Spec (shared contract for all contributors)

Ad-free, tracker-free, fully offline Sudoku PWA, installable on Android via GitHub Pages.
**No data ever leaves the phone**: no analytics, no fonts/CDNs, no fetch to any other origin.
Everything is stored in `localStorage`.

Style follows the sister project Deutsch Kompass: vanilla ES modules, **no build step, no npm
dependencies**, `node --test "tests/*.test.mjs"` for tests, service worker precaches everything.

## File layout

```
index.html  manifest.webmanifest  sw.js  package.json  README.md
css/app.css
js/sudoku.js       core grid helpers, brute-force solver, generator, transforms, RNG      (ENGINE)
js/techniques.js   human-style logical solver: ~30 techniques, hint, grader              (ENGINE)
js/board.js        reusable board renderer (game + lessons)                              (UI)
js/app.js          router, tab bar, theme                                                (UI)
js/store.js        persisted state: settings, stats, saved game, daily results           (UI)
js/game.js         game screen: input, undo, notes, timer, pause, scoring, mistakes      (UI)
js/home.js, js/stats.js, js/settings.js, js/daily.js                                     (UI)
js/learn.js        lesson list + step-by-step lesson player + "Try it" practice           (LESSONS)
js/puzzles.js      loads data/puzzles.json, picks + transforms puzzles, daily puzzle      (ENGINE)
data/puzzles.json  pre-generated, graded puzzle pool                                      (ENGINE)
data/lessons.json  lesson content incl. example positions                                (LESSONS)
scripts/generate_puzzles.mjs, scripts/build_lessons.mjs                                  (node scripts)
tests/*.test.mjs
```

## Conventions (ENGINE)

- Cell index `i = r*9 + c`, r,c in 0..8. Human notation in text: `r1c1`..`r9c9` (1-based).
- Grid: plain `Array(81)` of numbers, `0` = empty.
- Candidates: `Array(81)` of 9-bit masks, bit `(d-1)` set ⇔ digit d is a candidate. Filled cells → 0.
- Units: `UNITS[0..8]` rows, `UNITS[9..17]` cols, `UNITS[18..26]` boxes (box b = 3*(r/3|0)+(c/3|0)).
  Unit names in text: "row 4", "column 7", "box 5" (1-based).
- Puzzle strings: 81 chars, digits `1-9`, `.` or `0` for empty.

### js/sudoku.js exports
```
ROW(i), COL(i), BOX(i), UNITS, CELL_UNITS[i] -> [rowUnit, colUnit, boxUnit], PEERS[i] (20 cells)
parse(str) -> grid ; stringify(grid) -> str
computeCandidates(grid) -> cands
isValidPlacement(grid, i, d) -> bool       (no conflict with peers)
conflicts(grid) -> Set of cell indices that clash with a peer
solve(grid) -> solution grid | null         (fast bitmask backtracking)
countSolutions(grid, limit = 2) -> n
rng(seed:number|string) -> () => float in [0,1)   (mulberry32; strings hashed)
transform(str, rand) -> equivalent puzzle string (digit relabel, band/stack/row/col perms, transpose)
generate(rand) -> { puzzle, solution }      (unique solution, minimal-ish)
bitCount(mask), digitsOf(mask) -> [d...], cellName(i) -> "r4c7"
```

### js/techniques.js exports
```
TECHNIQUES: [{ id, name, tier, find(state) -> Step | null }]   ordered easiest-first
nextStep(grid, cands) -> Step | null         first technique (in order) that makes progress
solveLogically(grid) -> { steps: Step[], solved: bool, grid }
rate(puzzleStr) -> { level: 0..5 | -1, maxTier, counts: {techniqueId: n}, givens, solved }
hint(grid, notes, solution) -> Step | null   see "Hints" below
applyStep(grid, cands, step)                 mutates: placements + eliminations (+ peer cleanup)
```

**Step** object (also used verbatim by lessons and hints):
```js
{
  technique: "x_wing", name: "X-Wing", tier: 4,
  placements:   [{ cell, digit }],
  eliminations: [{ cell, digit }],
  highlight: {
    units: [unitIndex],                       // shaded rows/cols/boxes
    cells: [{ cell, role }],                  // role: "base"|"cover"|"pivot"|"pincer"|"fin"|"target"
    cands: [{ cell, digit, role }],           // role: "key"|"elim"|"place"|"colorA"|"colorB"
    links: [{ from:{cell,digit}, to:{cell,digit}, strong:true|false }]   // chains, drawn as lines
  },
  text: "X-Wing on 7 in rows 2 and 6 (columns 3 and 8): 7 can be removed from r4c3, r9c8."
}
```

### Techniques & tiers (ids are fixed — lessons reference them)

| tier | ids |
|---|---|
| 1 | `full_house`, `naked_single`, `hidden_single` |
| 2 | `pointing`, `claiming`, `naked_pair`, `hidden_pair` |
| 3 | `naked_triple`, `hidden_triple`, `naked_quad`, `hidden_quad` |
| 4 | `x_wing`, `skyscraper`, `two_string_kite`, `empty_rectangle`, `xy_wing`, `w_wing`, `simple_coloring` |
| 5 | `swordfish`, `jellyfish`, `finned_x_wing`, `finned_swordfish`, `xyz_wing`, `unique_rectangle` (types 1,2,4), `bug_plus_one`, `x_chain` |
| 6 | `xy_chain`, `wxyz_wing`, `aic` (alternating inference chain, incl. grouped-free), `forcing_chain` (last resort; digit/cell forcing) |

### Levels (index → name)
`0 Beginner, 1 Medium, 2 Hard, 3 Expert, 4 Master, 5 Extreme`

Grading by the hardest technique the logical solver needs (monotonic, human-meaningful):
- Beginner: only tier 1, ≥ 36 givens
- Medium: max tier 1 with ≤ 35 givens, or max tier 2 (few steps)
- Hard: max tier 2 with several tier-2 steps, or max tier 3
- Expert: max tier 4
- Master: max tier 5
- Extreme: max tier 6 (must still be solved by `solveLogically`, so hints always work)

Puzzles `solveLogically` cannot finish are discarded.

### Hints
`hint(grid, notes, solution)`: candidates = computed candidates; where the player has notes in a cell
**and** those notes contain the solution digit, intersect with them (respect the player's valid
eliminations). Return the first `nextStep`. If none, fall back to a `{technique:"reveal", ...}`
placement of the solution in the cell with fewest candidates.

### js/puzzles.js exports
```
LEVELS = ["Beginner","Medium","Hard","Expert","Master","Extreme"]
loadPool() -> Promise<void>                    fetch("data/puzzles.json")
randomPuzzle(level) -> { puzzle, solution }    random pool entry + random transform
dailyPuzzle(dateISO) -> { puzzle, solution, level }  deterministic from date; level cycles
                                               Hard, Expert, Master, Extreme by day number
```
`data/puzzles.json`: `{ "version": 1, "levels": [[puzzleStr, ...] x6] }` (solutions computed on load).

## Game rules / UX (UI)

- Home: app title, "Continue game" card (level + elapsed) when a game is saved, then three big
  buttons: **New Game** (→ level picker sheet with 6 levels), **Daily Challenge**, **Learn Techniques**.
  Bottom tab bar: Home · Stats · Settings. The game and lesson screens are full-screen (no tab bar).
- Game screen top bar: back, level name, Mistakes `n/3`, Score, timer (mm:ss) + pause button.
  Board. Controls under the board: **Undo, Erase, Notes (on/off badge), Hint (remaining badge)**,
  plus **Auto-notes** only for Expert/Master/Extreme. Then number pad 1-9 with remaining counts;
  a digit fully placed (9×) fades out.
- Every entry is checked against the solution. Wrong → red digit, mistake +1, vibrate (setting).
  3 mistakes → "Game over" dialog: Second chance (continue, marks game as not perfect) / New game / Restart.
- Assists (settings, default on): highlight row/col/box of selected cell, highlight same digits,
  auto-remove notes in peers when placing, hide finished digits on the pad.
- Pause button + auto-pause when the app is hidden; pause overlay hides the board.
- Auto-save after every move; one saved game (+ daily game saved separately).
- Animations: short sweep when a row/column/box completes; confetti on win.

### Scoring (sudoku.com-style)
```
BASE = [10, 20, 30, 45, 60, 80]            per correct placement, by level
unit completion bonus: +2*BASE per completed row / column / box
win time bonus: round(BASE*20 * max(0, 1 - seconds/PAR)),  PAR minutes = [6,10,15,25,40,60]
hint used: -3*BASE (score floor 0), hinted placement earns 0; max 3 hints per game
mistakes earn 0; nothing else deducted
```

### Stats (Stats tab), per level and "All"
games started, games won, win rate, best time, average time (wins), best score, total score,
perfect wins (0 mistakes, no hints), current win streak, best win streak. Also daily-challenge
streak and a list of the last 50 finished games.

### Daily challenge
Month calendar with ◀ ▶, solved days marked (✓/trophy), today highlighted, past days playable,
future days disabled. Level shown per day. Daily streak. Month trophy when every day of a month is solved.

### Settings
Theme: System / Light / Dark. Toggles: mistake limit (3), highlight areas, highlight same numbers,
auto-remove notes, hide finished digits, show timer, vibration, animations. Reset statistics
(with confirm). About: "No ads. No tracking. Nothing leaves your phone."

## Learn (LESSONS)
~30 lessons in 6 chapters (by tier). Each lesson: intro text, **step-by-step example** on a real
board state with notes shown and highlights (Next/Back), then **"Try it"**: a different position
where the user taps candidates to eliminate (or a cell+digit to place) and presses Check.
Example positions are real positions mined by `scripts/build_lessons.mjs` using `techniques.js`
(state just before that technique is the next step), so every example is verified.
