# Sudoku Zen

A calm, clean Sudoku app for your phone — like the big Sudoku apps, minus the ads,
the tracking and the network. It is a Progressive Web App (PWA): plain HTML, CSS and
JavaScript, no build step, no dependencies. Install it once from GitHub Pages and it
works fully offline.

- **6 levels** — Beginner, Medium, Hard, Expert, Master, Extreme — graded by the hardest
  human solving technique each puzzle needs (not by counting clues).
- **Daily Challenge** with a month calendar, streaks and month trophies.
- **Hints that teach**: every hint names the technique (Naked Single, X-Wing, XY-Chain, …),
  explains it, highlights the cells and draws chains on the board. "Learn this technique"
  opens the matching lesson.
- **Learn Techniques**: step-by-step lessons with real board positions and a "Try it" exercise.
- Notes (pencil marks), auto-notes (Expert and up), undo, erase, mistake limit with second
  chance, sudoku.com-style scoring, statistics per level, light / dark / system theme,
  keyboard support on desktop.

## Privacy promise

**No ads. No tracking. Nothing leaves your phone.**

- No analytics, no cookies, no accounts, no fonts or scripts from CDNs.
- The app never contacts any server except the one it was installed from, and only to
  download its own files. After the first visit everything is served from the offline cache.
- Games, settings and statistics live only in your browser's `localStorage`.
  Uninstalling the app (or clearing site data) deletes them.
- A Content-Security-Policy in `index.html` blocks connections to any other origin, and
  `tests/app.test.mjs` fails if an external URL ever sneaks into the code.

## Run locally

```
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Any static file server works; there is nothing to build.

Run the unit tests (Node 20+, no `npm install` needed):

```
npm test          # = node --test "tests/*.test.mjs"
```

## Put it on GitHub Pages

1. Push this folder to a GitHub repository.
2. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
   branch **main**, folder **/ (root)**, then **Save**.
3. After a minute the app is live at `https://<your-user>.github.io/<repo>/`.

## Install on Android

1. Open the GitHub Pages URL in **Chrome** on your phone.
2. Tap the **⋮** menu → **Install app** (or **Add to Home screen**).
3. Launch *Sudoku Zen* from your home screen. It opens full-screen and works in airplane mode.
   The Android back button works inside the app (it follows the in-app screens).

## Updating

After changing any file, bump `VERSION` in `sw.js`. Installed apps pick up the new version
the next time they are opened with a connection (and use it from the following launch).

## Project layout

| Path | What |
|---|---|
| `index.html`, `manifest.webmanifest`, `sw.js` | app shell, install metadata, offline cache |
| `css/app.css` | all styles (light + dark) |
| `js/app.js` | hash router (`#home #game #daily #stats #settings #learn/<id>`), theme |
| `js/game.js`, `js/rules.js` | game screen; pure rules (scoring, undo, mistakes) |
| `js/board.js` | reusable board renderer (game, hints and lessons) |
| `js/home.js`, `js/daily.js`, `js/stats.js`, `js/settings.js`, `js/store.js` | screens and storage |
| `js/sudoku.js`, `js/techniques.js`, `js/puzzles.js` | engine: solver, human techniques, puzzle pool |
| `js/learn.js`, `data/lessons.json` | technique lessons |
| `data/puzzles.json`, `scripts/` | pre-generated graded puzzles and the generator |
| `tests/` | `node --test` unit tests |

See `SPEC.md` for the full specification.
