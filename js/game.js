// Game screen: board input, notes, undo, hints, timer/pause, mistakes, win / game over.
// All rule logic (scoring, undo stack, mistakes) lives in rules.js as pure functions;
// this module wires it to the DOM and to storage.

import {
  store, save, settings, savedGame, setSavedGame, noteStarted, addRecord, newBests, localISO,
} from "./store.js";
import {
  createGame, restartGame, placeDigit, toggleNote, erase, autoNotes, undo, chargeHint, applyStep,
  secondChance, finishWin, resultOf, errorsOf, givensOf, digitCounts, hintsLeft, hintNotes,
  cleanGrid, toGrid, fmtTime, isLocked, MAX_MISTAKES,
} from "./rules.js";
import { createBoard } from "./board.js";
import { vibrate, sweepUnits, confetti, animationsOn } from "./fx.js";
import { h, icon, toast, dialog } from "./ui.js";
import { navigate, goBack, poolReady, parseHash } from "./app.js";
import { randomPuzzle, dailyPuzzle } from "./puzzles.js";
import { hint as engineHint, TECHNIQUES } from "./techniques.js";
import { pickLevel } from "./home.js";

export const LEVEL_NAMES = ["Beginner", "Medium", "Hard", "Expert", "Master", "Extreme"];
const AUTO_NOTES_MIN_LEVEL = 3;   // Expert+

export function fmtDay(iso, opts = { month: "short", day: "numeric" }) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en", opts);
}

function recordLoss(g) {
  addRecord(store.stats, resultOf(g, false));
  save();
}

/** Create a fresh regular game at `level` and open the game screen. */
export async function startNewGame(level) {
  try {
    await poolReady;
  } catch {
    toast("Puzzles could not be loaded");
    return;
  }
  // an abandoned (or lost) regular game counts as a loss — it was counted as started
  const old = store.saved;
  if (old && !old.won) recordLoss(old);
  const { puzzle, solution } = randomPuzzle(level);
  setSavedGame(createGame({ puzzle, solution, level }), null);
  noteStarted(level);
  navigate("#game", { replace: parseHash().name === "game" });
}

/**
 * Render the game screen into `view`. opts.daily = "YYYY-MM-DD" for a daily challenge.
 * Returns a cleanup function (router calls it when leaving the screen).
 */
export function renderGame(view, { daily = null } = {}) {
  const S = {
    g: null, sel: -1, notesMode: false, paused: false, alive: true,
    hint: null,          // { kind: "step"|"mistake", step, notes }
    timer: null, board: null, els: {}, givens: null,
  };
  const root = h("div", { class: "game" });
  view.append(root);

  const redirect = (hash) => setTimeout(() => S.alive && navigate(hash, { replace: true }));

  (async () => {
    let g = savedGame(daily);
    if (!g && daily) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(daily) || daily > localISO()) return redirect("#daily");
      root.append(h("div", { class: "loading" }, "Loading…"));
      try { await poolReady; } catch { toast("Puzzles could not be loaded"); return redirect("#daily"); }
      if (!S.alive) return;
      const p = dailyPuzzle(daily);
      g = createGame({ puzzle: p.puzzle, solution: p.solution, level: p.level, daily });
      setSavedGame(g, daily);
      noteStarted(g.level);
    }
    if (!g || g.won) return redirect(daily ? "#daily" : "#home");
    S.g = g;
    build();
  })();

  // ---------------------------------------------------------------- persistence
  function persist() {
    if (S.g && !S.g.won) {
      S.g.activeHint = S.hint ? { kind: S.hint.kind, step: S.hint.step } : null;
      setSavedGame(S.g, daily);
    }
  }

  // ---------------------------------------------------------------- layout
  function build() {
    const g = S.g;
    S.givens = givensOf(g);
    root.textContent = "";
    const E = S.els;
    const ctl = (name, label, onclick, badge) => {
      const b = h("button", { class: "ctl", id: "ctl-" + name, "aria-label": label, onclick },
        h("span", { class: "ctl-ico" }, icon(name), badge ? h("span", { class: "badge" }) : null),
        h("span", { class: "ctl-label" }, label));
      E[name] = b;
      return b;
    };

    E.time = h("b", { class: "g-time" });
    E.pauseBtn = h("button", { class: "icon-btn", "aria-label": "Pause", onclick: () => setPaused(!S.paused) }, icon("pause"));
    E.mistakes = h("b", {});
    E.score = h("b", {});
    const title = daily ? `Daily · ${fmtDay(daily)}` : LEVEL_NAMES[g.level];
    root.append(
      h("header", { class: "g-top" },
        h("button", { class: "icon-btn", "aria-label": "Back", onclick: () => goBack(daily ? "#daily" : "#home") }, icon("back")),
        h("div", { class: "g-title" }, title,
          daily ? h("span", { class: "g-sub" }, LEVEL_NAMES[g.level]) : null),
        E.pauseBtn),
      h("div", { class: "g-info" },
        h("div", { class: "g-stat" }, h("span", {}, "Mistakes"), E.mistakes),
        h("div", { class: "g-stat" }, h("span", {}, "Score"), E.score),
        h("div", { class: "g-stat g-stat-time" }, h("span", {}, "Time"), E.time)));

    E.boardWrap = h("div", { class: "board-wrap" });
    S.board = createBoard(E.boardWrap, { onCellTap: select });
    E.overlay = h("div", { class: "pause-overlay" },
      h("button", { class: "resume", "aria-label": "Resume", onclick: () => setPaused(false) }, icon("play")),
      h("div", { class: "pause-text" }, "Paused"),
      h("div", { class: "pause-meta" }));
    E.boardWrap.append(E.overlay);
    root.append(E.boardWrap);

    const controls = h("div", { class: "g-controls" },
      ctl("undo", "Undo", doUndo),
      ctl("erase", "Erase", doErase),
      ctl("notes", "Notes", toggleNotesMode, true),
      ctl("hint", "Hint", doHint, true));
    if (g.level >= AUTO_NOTES_MIN_LEVEL) controls.append(ctl("auto", "Auto-notes", doAutoNotes));
    E.controls = controls;

    E.nums = [];
    E.numpad = h("div", { class: "numpad" },
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => {
        const b = h("button", { class: "num", "data-d": d, "aria-label": "Digit " + d, onclick: () => input(d) },
          h("span", { class: "num-d" }, String(d)), h("span", { class: "num-c" }));
        E.nums[d] = b;
        return b;
      }));
    E.banner = h("div", { class: "hint-banner", role: "region", "aria-live": "polite" });
    root.append(h("div", { class: "g-bottom" }, controls, E.numpad, E.banner));

    // restore a hint that was open when the player left (e.g. to read the lesson)
    if (g.activeHint?.step) {
      S.hint = { ...g.activeHint, ...(g.activeHint.kind === "step" ? hintDisplay(g, g.activeHint.step) : { notes: g.notes }) };
      showBanner();
    }
    render();
    startTimer();
    document.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVisibility);
    if (g.over) setTimeout(showGameOver, 50);
  }

  // ---------------------------------------------------------------- render
  function render() {
    const g = S.g, set = settings(), E = S.els;
    if (!g || !S.board) return;
    S.board.render({
      grid: g.grid,
      givens: S.givens,
      notes: S.hint ? S.hint.notes : g.notes,
      selected: S.sel,
      errors: errorsOf(g),
      highlight: S.hint?.step?.highlight || null,
      settings: set,
    });
    E.mistakes.textContent = set.mistakeLimit ? `${g.mistakes}/${MAX_MISTAKES}` : String(g.mistakes);
    E.score.textContent = String(g.score);
    updateTime();
    E.undo.disabled = !g.history.length || g.won;
    E.notes.classList.toggle("on", S.notesMode);
    E.notes.querySelector(".badge").textContent = S.notesMode ? "ON" : "OFF";
    const left = hintsLeft(g);
    E.hint.querySelector(".badge").textContent = String(left);
    E.hint.classList.toggle("empty", left === 0);
    const counts = digitCounts(g);
    for (let d = 1; d <= 9; d++) {
      const b = E.nums[d];
      const rem = 9 - counts[d];
      b.querySelector(".num-c").textContent = rem > 0 ? String(rem) : "";
      b.classList.toggle("done", rem <= 0);
      b.classList.toggle("hide", rem <= 0 && set.hideFinished);
      b.disabled = rem <= 0 && set.hideFinished;
    }
    E.numpad.classList.toggle("notes-mode", S.notesMode);
    root.classList.toggle("paused", S.paused);
    root.classList.toggle("hinting", !!S.hint);
    root.classList.toggle("won", !!g.won);
  }

  function updateTime() {
    const g = S.g, E = S.els;
    if (!E.time) return;
    E.time.textContent = settings().showTimer ? fmtTime(g.elapsed) : "—";
    E.time.parentElement.classList.toggle("hidden-timer", !settings().showTimer);
  }

  // ---------------------------------------------------------------- timer / pause
  function startTimer() {
    clearInterval(S.timer);
    S.timer = setInterval(() => {
      const g = S.g;
      if (!S.alive || !g || S.paused || g.over || g.won || document.hidden) return;
      g.elapsed++;
      updateTime();
      if (g.elapsed % 5 === 0) persist();
    }, 1000);
  }

  function setPaused(p) {
    if (!S.g || S.g.won) return;
    S.paused = p;
    S.els.pauseBtn.replaceChildren(icon(p ? "play" : "pause"));
    S.els.pauseBtn.setAttribute("aria-label", p ? "Resume" : "Pause");
    S.els.overlay.querySelector(".pause-meta").textContent =
      `${LEVEL_NAMES[S.g.level]} · ${fmtTime(S.g.elapsed)}`;
    persist();
    render();
  }

  function onVisibility() {
    if (document.hidden) {
      if (!S.g.won && !S.g.over) setPaused(true);
      persist();
    }
  }

  // ---------------------------------------------------------------- input
  const blocked = () => !S.g || S.paused || S.g.won || S.g.over;

  function select(i) {
    if (!S.g || S.paused) return;
    S.sel = i;
    render();
  }

  function afterMove() {
    if (S.hint) closeHint(false);
    persist();
    render();
  }

  function input(d) {
    if (blocked()) return;
    const g = S.g;
    if (S.sel < 0) { toast("Select a cell first"); return; }
    if (S.notesMode) {
      if (toggleNote(g, S.sel, d)) afterMove();
      return;
    }
    const set = settings();
    const res = placeDigit(g, S.sel, d, { autoRemoveNotes: set.autoRemoveNotes, mistakeLimit: set.mistakeLimit });
    if (!res.changed) return;
    afterMove();
    if (res.mistake) {
      vibrate([70, 50, 70]);
      shake(S.sel);
    }
    if (res.units.length) sweepUnits(S.board, res.units, S.sel);
    if (res.won) onWin();
    else if (res.gameOver) setTimeout(showGameOver, 350);
  }

  function shake(i) {
    if (!animationsOn()) return;
    const c = S.board.cellEl(i);
    c.classList.remove("shake");
    void c.offsetWidth;
    c.classList.add("shake");
    setTimeout(() => c.classList.remove("shake"), 450);
  }

  function doErase() {
    if (blocked() || S.sel < 0) return;
    if (isLocked(S.g, S.sel)) return;
    if (erase(S.g, S.sel)) afterMove();
  }

  function doUndo() {
    if (blocked()) return;
    const cells = undo(S.g);
    if (!cells) return;
    S.sel = cells[0];
    afterMove();
  }

  function toggleNotesMode() {
    S.notesMode = !S.notesMode;
    render();
  }

  function doAutoNotes() {
    if (blocked()) return;
    if (autoNotes(S.g)) { afterMove(); toast("Notes filled in"); }
    else toast("Notes are already complete");
  }

  // ---------------------------------------------------------------- hints
  const lessonIds = new Set(TECHNIQUES.map((t) => t.id));

  function doHint() {
    if (blocked()) return;
    if (S.hint) { closeHint(); return; }
    const g = S.g;
    const wrong = [...errorsOf(g)];
    if (wrong.length) {
      // point out a mistake first — free, like sudoku.com
      const cell = wrong.includes(S.sel) ? S.sel : wrong[0];
      S.hint = {
        kind: "mistake",
        notes: g.notes,
        step: {
          technique: "mistake", name: "Mistake",
          placements: [], eliminations: [],
          highlight: { units: [], cells: [{ cell, role: "target" }], cands: [], links: [] },
          text: `The ${g.grid[cell]} in r${((cell / 9) | 0) + 1}c${(cell % 9) + 1} is wrong. Erase it first.`,
          cell,
        },
      };
      S.sel = cell;
      showBanner();
      render();
      return;
    }
    if (hintsLeft(g) <= 0) { toast("No hints left in this game"); return; }
    let step = null;
    try {
      step = engineHint(cleanGrid(g), g.notes.slice(), toGrid(g.solution));
    } catch (e) { console.error(e); }
    if (!step) { toast("No hint available"); return; }
    chargeHint(g);
    S.hint = { kind: "step", step, ...hintDisplay(g, step) };
    const first = step.placements?.[0]?.cell ?? step.highlight?.cells?.[0]?.cell;
    if (first != null) S.sel = first;
    showBanner();
    persist();
    render();
  }

  /**
   * Notes shown while a hint is open: the player's notes, except that every cell the hint
   * talks about shows the engine's candidates (see hintNotes), so the explanation matches.
   * `base` = full engine view of candidates, used when applying eliminations.
   */
  function hintDisplay(g, step) {
    const base = hintNotes(g);
    const notes = g.notes.slice();
    const hl = step.highlight || {};
    const cells = new Set([
      ...(hl.cands || []).map((c) => c.cell), ...(hl.cells || []).map((c) => c.cell),
      ...(step.eliminations || []).map((e) => e.cell), ...(step.placements || []).map((p) => p.cell),
    ]);
    // show what the engine reasons with (player notes cleaned of impossible digits)
    for (const i of cells) if (!g.grid[i]) notes[i] = base[i];
    return { notes, base };
  }

  function showBanner() {
    const { step, kind } = S.hint;
    const b = S.els.banner;
    const canLearn = kind === "step" && lessonIds.has(step.technique);
    const nothingToApply = !(step.placements?.length || step.eliminations?.length) && kind !== "mistake";
    b.replaceChildren(
      h("div", { class: "hint-head" },
        h("span", { class: "hint-ico" }, icon("hint")),
        h("span", { class: "hint-name" }, step.name || "Hint"),
        kind === "step" ? h("span", { class: "hint-left" }, `${hintsLeft(S.g)} left`) : null,
        h("button", { class: "icon-btn hint-x", id: "hint-close", "aria-label": "Close hint", onclick: () => closeHint() }, icon("close"))),
      h("p", { class: "hint-text" }, step.text || ""),
      h("div", { class: "hint-buttons" },
        nothingToApply ? null : h("button", { class: "btn primary", id: "hint-apply", onclick: applyHint },
          kind === "mistake" ? "Erase" : "Apply"),
        canLearn ? h("button", { class: "btn secondary", id: "hint-learn", onclick: learnHint }, "Learn this technique") : null,
        nothingToApply && !canLearn ? h("button", { class: "btn secondary", onclick: () => closeHint() }, "OK") : null));
  }

  function closeHint(doRender = true) {
    S.hint = null;
    S.els.banner.replaceChildren();
    if (doRender) { persist(); render(); }
  }

  function applyHint() {
    const g = S.g, { step, kind, base } = S.hint;
    if (kind === "mistake") {
      erase(g, step.cell);
      S.sel = step.cell;
      afterMove();
      return;
    }
    const res = applyStep(g, step, base, { autoRemoveNotes: settings().autoRemoveNotes });
    const placed = step.placements?.[0]?.cell;
    if (placed != null) S.sel = placed;
    afterMove();
    if (res.units.length && placed != null) sweepUnits(S.board, res.units, placed);
    if (res.won) onWin();
  }

  function learnHint() {
    const id = S.hint.step.technique;
    persist();
    navigate("#learn/" + id);
  }

  // ---------------------------------------------------------------- keyboard
  function onKey(e) {
    if (!S.g || document.querySelector(".modal-wrap, .sheet")) return;
    const k = e.key;
    if ((e.ctrlKey || e.metaKey) && (k === "z" || k === "Z")) { e.preventDefault(); doUndo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^[1-9]$/.test(k)) {
      e.preventDefault();
      if (e.shiftKey && !S.notesMode) { S.notesMode = true; input(+k); S.notesMode = false; render(); }
      else input(+k);
      return;
    }
    const code = e.code || "";
    const m = code.match(/^(?:Digit|Numpad)([1-9])$/);
    if (m && e.shiftKey) { e.preventDefault(); S.notesMode = true; input(+m[1]); S.notesMode = false; render(); return; }
    const moves = { ArrowUp: -9, ArrowDown: 9, ArrowLeft: -1, ArrowRight: 1 };
    if (k in moves) {
      e.preventDefault();
      if (S.paused) return;
      if (S.sel < 0) { select(40); return; }
      let r = (S.sel / 9) | 0, c = S.sel % 9;
      if (k === "ArrowUp") r = (r + 8) % 9;
      if (k === "ArrowDown") r = (r + 1) % 9;
      if (k === "ArrowLeft") c = (c + 8) % 9;
      if (k === "ArrowRight") c = (c + 1) % 9;
      select(r * 9 + c);
      return;
    }
    if (k === "Backspace" || k === "Delete" || k === "0") { e.preventDefault(); doErase(); return; }
    if (k === "n" || k === "N") { toggleNotesMode(); return; }
    if (k === "h" || k === "H") { doHint(); return; }
    if (k === "p" || k === "P" || k === " ") { e.preventDefault(); setPaused(!S.paused); return; }
    if (k === "Escape" && S.hint) { closeHint(); return; }
  }

  // ---------------------------------------------------------------- end of game
  function onWin() {
    const g = S.g;
    clearInterval(S.timer);
    S.paused = false;
    S.sel = -1;
    if (S.hint) closeHint(false);
    const bonus = finishWin(g);
    const rec = resultOf(g, true);
    const bests = newBests(store.stats, rec);
    addRecord(store.stats, rec);
    if (daily) {
      const prev = store.daily[daily];   // replaying a solved day keeps the better result
      if (!prev || rec.score > prev.score) store.daily[daily] = { time: rec.time, score: rec.score, level: g.level };
    }
    setSavedGame(null, daily);
    render();
    const delay = animationsOn() ? 650 : 0;
    setTimeout(() => {
      if (!S.alive) return;
      confetti();
      showWin(rec, bonus, bests);
    }, delay);
  }

  function showWin(rec, bonus, bests) {
    const row = (label, value, extra) => h("div", { class: "win-row" },
      h("span", {}, label), h("b", {}, value, extra || null));
    const badge = (t) => h("span", { class: "new-best" }, t);
    const body = h("div", { class: "win-body" },
      row("Level", LEVEL_NAMES[rec.level]),
      row("Time", fmtTime(rec.time), bests.includes("time") ? badge("New best") : null),
      row("Score", String(rec.score), bests.includes("score") ? badge("New best") : null),
      bonus ? h("div", { class: "win-note" }, `includes +${bonus} time bonus`) : null,
      rec.perfect ? h("div", { class: "win-perfect" }, "Perfect game · no mistakes, no hints") : null);
    dialog({
      icon: icon("trophy"),
      title: daily ? "Daily challenge solved!" : "Excellent!",
      body,
      className: "win",
      buttons: daily
        ? [{ label: "Calendar", primary: true, onClick: () => navigate("#daily", { replace: true }) },
           { label: "Home", onClick: () => navigate("#home", { replace: true }) }]
        : [{ label: "New game", primary: true, onClick: () => newGameFromHere() },
           { label: "Home", onClick: () => navigate("#home", { replace: true }) }],
    });
  }

  async function newGameFromHere() {
    const level = await pickLevel();
    if (level == null) { if (!S.g || S.g.won) navigate("#home", { replace: true }); else if (S.g.over) showGameOver(); return; }
    await startNewGame(level);
  }

  function showGameOver() {
    if (!S.alive || !S.g?.over) return;
    const g = S.g;
    dialog({
      icon: h("span", { class: "go-ico" }, "×"),
      title: "Game over",
      body: `You made ${g.mistakes} mistakes. Take a second chance to continue, or start again.`,
      className: "gameover",
      buttons: [
        { label: "Second chance", primary: true, onClick: () => {
          secondChance(g);
          S.paused = false;
          persist();
          render();
        } },
        daily
          ? { label: "Back to calendar", onClick: () => { recordLoss(g); setSavedGame(null, daily); navigate("#daily", { replace: true }); } }
          : { label: "New game", onClick: () => newGameFromHere() },
        { label: "Restart", onClick: () => {
          recordLoss(g);
          S.g = restartGame(g);
          noteStarted(S.g.level);
          S.sel = -1;
          S.hint = null;
          setSavedGame(S.g, daily);
          clearInterval(S.timer);
          build();
        } },
      ],
    });
  }

  // ---------------------------------------------------------------- cleanup
  return () => {
    S.alive = false;
    clearInterval(S.timer);
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("visibilitychange", onVisibility);
    persist();
  };
}
