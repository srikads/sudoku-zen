// Learn section: lesson list (by chapter) + step-by-step lesson player + "Try it" practice.
//
//   renderLearn(container, { onExit, techniqueId }) -> cleanup()
//
// Lessons come from data/lessons.json (built by scripts/build_lessons.mjs from real solver
// positions). Boards are drawn with the shared board renderer (js/board.js), read-only,
// with the solver's notes and the step's highlights. Lesson-specific styles live in
// css/learn.css, injected once on first use. Completion is stored in the app's store
// (store.learn.done) so it lives in the same localStorage entry as everything else.

import { createBoard } from "./board.js";
import { h, icon } from "./ui.js";
import { store, save } from "./store.js";
import { parse, solve, bitCount, digitsOf, UNITS, CELL_UNITS, cellName } from "./sudoku.js";

const LEVEL_NAMES = ["Beginner", "Medium", "Hard", "Expert", "Master", "Extreme"];
const CHAINS = new Set(["x_chain", "xy_chain", "aic"]);

// ---------------------------------------------------------------- data / css

let dataPromise = null;
export function loadLessons() {
  if (!dataPromise) {
    dataPromise = fetch("data/lessons.json").then((r) => {
      if (!r.ok) throw new Error("lessons.json: HTTP " + r.status);
      return r.json();
    });
    dataPromise.catch(() => { dataPromise = null; });
  }
  return dataPromise;
}

function ensureCss() {
  if (typeof document === "undefined") return Promise.resolve();
  let link = document.querySelector("link[data-learn-css]");
  if (link) return link._ready || Promise.resolve();
  link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "css/learn.css";
  link.dataset.learnCss = "";
  link._ready = new Promise((res) => {
    link.onload = res; link.onerror = res; setTimeout(res, 1500);
  });
  document.head.append(link);
  return link._ready;
}

// ---------------------------------------------------------------- progress

function progress() {
  if (!store.learn || typeof store.learn !== "object") store.learn = { done: {} };
  store.learn.done ||= {};
  return store.learn;
}
export const isDone = (id) => !!progress().done[id];
function markDone(id) {
  if (isDone(id)) return;
  progress().done[id] = Date.now();
  save();
}

function go(hash, replace = false) {
  import("./app.js").then((m) => m.navigate(hash, { replace })).catch(() => { location.hash = hash; });
}

// ---------------------------------------------------------------- pure helpers (unit-tested)

/** *bold* markup -> DOM nodes (text is plain, never HTML). */
function rich(text) {
  const out = [];
  String(text).split(/(\*[^*]+\*)/).forEach((part) => {
    if (!part) return;
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) out.push(h("b", {}, part.slice(1, -1)));
    else out.push(document.createTextNode(part));
  });
  return out;
}

const fullHl = (hl) => ({ units: hl?.units || [], cells: hl?.cells || [], cands: hl?.cands || [], links: hl?.links || [] });

/** Board state (grid, notes) for showing a lesson step: step overrides, `apply` shows the result. */
export function stepBoard(pos, st) {
  const grid = st?.grid ? parse(st.grid) : parse(pos.grid);
  const notes = (st?.cands || pos.cands).slice();
  if (st?.apply) {
    for (const p of pos.step.placements || []) { grid[p.cell] = p.digit; notes[p.cell] = 0; }
  }
  return { grid, notes };
}

/** Is placing `digit` in `cell` a valid instance of the (single-type) technique in this position? */
export function validPlacement(technique, grid, cands, cell, digit) {
  if (grid[cell] || !(cands[cell] & (1 << (digit - 1)))) return false;
  if (technique === "naked_single") return bitCount(cands[cell]) === 1;
  if (technique === "full_house") {
    return CELL_UNITS[cell].some((u) => UNITS[u].filter((i) => !grid[i]).length === 1);
  }
  if (technique === "hidden_single") {
    return CELL_UNITS[cell].some((u) => UNITS[u].filter((i) => !grid[i] && (cands[i] & (1 << (digit - 1)))).length === 1);
  }
  return false;
}

/**
 * Check a "Try it" answer. marks: [{cell, digit}] (eliminations) or one placement.
 * Returns { ok, wrong: [{cell,digit,why}], missing: [{cell,digit}], found, total, message }.
 */
export function checkPractice(lesson, marks) {
  const pr = lesson.practice;
  const grid = parse(pr.grid), cands = pr.cands;
  const sol = solve(parse(pr.grid)) || [];
  const name = pr.step.name || lesson.title;
  if (lesson.mode === "place") {
    const m = marks[0];
    if (!m) return { ok: false, wrong: [], missing: [], found: 0, total: 1, message: "Tap a cell, then choose the digit to place." };
    const target = pr.step.placements[0];
    const ok = (m.cell === target.cell && m.digit === target.digit) || (sol[m.cell] === m.digit && validPlacement(pr.step.technique, grid, cands, m.cell, m.digit));
    if (ok) return { ok: true, wrong: [], missing: [], found: 1, total: 1, message: `Correct! ${cellName(m.cell)} = ${m.digit}.` };
    const why = sol[m.cell] !== m.digit ? `${cellName(m.cell)} is not ${m.digit} — that digit would lead to a dead end.` : `${cellName(m.cell)} is ${m.digit} indeed, but that is not a ${name.toLowerCase()} yet. Look for the pattern from the lesson.`;
    return { ok: false, wrong: [{ ...m, why }], missing: [target], found: 0, total: 1, message: why };
  }
  const exp = pr.step.eliminations;
  const key = (x) => x.cell * 10 + x.digit;
  const E = new Set(exp.map(key)), M = new Set(marks.map(key));
  const wrong = marks.filter((m) => !E.has(key(m))).map((m) => ({
    ...m,
    why: sol[m.cell] === m.digit ? "solution" : "other",
  }));
  const missing = exp.filter((e) => !M.has(key(e)));
  const found = exp.length - missing.length;
  if (!marks.length) return { ok: false, wrong, missing, found, total: exp.length, message: "Tap a cell, then choose the candidates to remove." };
  if (!wrong.length && !missing.length) {
    return { ok: true, wrong, missing, found, total: exp.length, message: `Correct! The ${name} removes ${exp.map((e) => `${e.digit} from ${cellName(e.cell)}`).join(", ")}.` };
  }
  const parts = [];
  const sw = wrong.filter((w) => w.why === "solution"), ow = wrong.filter((w) => w.why === "other");
  if (sw.length) parts.push(`${sw.map((w) => `${w.digit} in ${cellName(w.cell)}`).join(", ")} ${sw.length > 1 ? "are" : "is"} actually the solution — ${sw.length > 1 ? "they" : "it"} can't be removed.`);
  if (ow.length) parts.push(`${ow.map((w) => `${w.digit} in ${cellName(w.cell)}`).join(", ")} ${ow.length > 1 ? "don't" : "doesn't"} follow from this ${name}.`);
  if (missing.length) {
    parts.push(found
      ? `You found ${found} of ${exp.length}; ${missing.length} more ${missing.length > 1 ? "candidates" : "candidate"} can go.`
      : `The ${name} removes ${exp.length} ${exp.length > 1 ? "candidates" : "candidate"} you haven't marked yet.`);
  }
  return { ok: false, wrong, missing, found, total: exp.length, message: parts.join(" ") };
}

// ---------------------------------------------------------------- entry

export function renderLearn(container, opts = {}) {
  const onExit = opts.onExit || (() => history.back());
  const id = opts.techniqueId || opts.id;
  let disposed = false;
  const cleanups = [];
  container.append(h("div", { class: "loading" }, "Loading lessons…"));

  Promise.all([loadLessons(), ensureCss()]).then(([data]) => {
    if (disposed) return;
    container.textContent = "";
    const lesson = id && data.lessons.find((l) => l.id === id);
    if (lesson) cleanups.push(renderLesson(container, data, lesson, onExit));
    else renderList(container, data, onExit);
  }).catch((e) => {
    if (disposed) return;
    console.warn("lessons failed to load", e);
    container.textContent = "";
    container.append(h("div", { class: "empty" },
      h("h2", {}, "Lessons unavailable"),
      h("p", {}, "The lesson data could not be loaded. Please try again."),
      h("button", { class: "btn primary", onclick: onExit }, "Back")));
  });

  return () => { disposed = true; cleanups.forEach((f) => { try { f?.(); } catch {} }); };
}

// ---------------------------------------------------------------- list

function tierTag(l) {
  return h("span", { class: `tag l-tier l-tier-${l.tier}` }, l.id === "intro" ? "Start" : LEVEL_NAMES[l.level]);
}

function renderList(container, data, onExit) {
  const lessons = data.lessons;
  const doneN = lessons.filter((l) => isDone(l.id)).length;
  const root = h("div", { class: "learn l-list" });
  root.append(
    h("div", { class: "page-head" },
      h("button", { class: "icon-btn", "aria-label": "Back", onclick: onExit }, icon("back")),
      h("h1", { class: "page-title" }, "Learn techniques")),
    h("div", { class: "l-progress card" },
      h("div", { class: "l-progress-text" },
        h("b", {}, `${doneN} of ${lessons.length} lessons done`),
        h("span", { class: "muted small" }, "Every example is a real position from a real puzzle.")),
      h("div", { class: "l-bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(lessons.length), "aria-valuenow": String(doneN) },
        h("i", { style: `width:${(100 * doneN / lessons.length).toFixed(1)}%` }))));
  const next = lessons.find((l) => !isDone(l.id));
  for (const ch of data.chapters) {
    const ls = lessons.filter((l) => l.chapter === ch.id);
    const chDone = ls.filter((l) => isDone(l.id)).length;
    root.append(
      h("div", { class: "l-chapter" },
        h("h2", { class: "section" }, `Chapter ${ch.id} · ${ch.title}`, h("span", { class: "l-ch-count" }, `${chDone}/${ls.length}`)),
        h("p", { class: "l-blurb muted small" }, ch.blurb)),
      h("div", { class: "card l-rows" },
        ls.map((l) => h("button", {
          class: "l-row" + (isDone(l.id) ? " done" : "") + (l === next ? " next" : ""),
          "data-id": l.id,
          onclick: () => go("#learn/" + l.id),
        },
          h("span", { class: "l-mark", "aria-hidden": "true" }, isDone(l.id) ? icon("check") : String(lessons.indexOf(l) + 1)),
          h("span", { class: "l-row-main" },
            h("span", { class: "l-row-title" }, l.title),
            h("span", { class: "l-row-sum" }, l.summary)),
          tierTag(l)))));
  }
  container.append(root);
}

// ---------------------------------------------------------------- lesson player

function legendFor(hl, technique) {
  const items = [];
  const has = (arr, role) => (arr || []).some((x) => x.role === role);
  const chain = CHAINS.has(technique);
  const colorA = chain ? "true" : technique === "simple_coloring" ? "colour A" : "one is true";
  const colorB = chain ? "false" : technique === "simple_coloring" ? "colour B" : "colour B";
  const cand = [["key", technique === "intro" ? "candidates" : "pattern", "c-key"], ["place", "place", "c-place"], ["elim", "remove", "c-elim"], ["colorA", colorA, "c-a"], ["colorB", colorB, "c-b"]];
  for (const [role, label, cls] of cand) if (has(hl.cands, role)) items.push(h("span", { class: "l-lg" }, h("i", { class: "sw sw-" + cls }), label));
  const cells = [["base", technique === "forcing_chain" ? "forced moves" : null, "r-base"], ["pivot", "pivot", "r-pivot"], ["pincer", chain ? "chain ends" : "pincers", "r-pincer"], ["fin", "fin", "r-fin"], ["cover", "blocks", "r-cover"], ["target", "target", "r-target"]];
  for (const [role, label, cls] of cells) if (label && has(hl.cells, role)) items.push(h("span", { class: "l-lg" }, h("i", { class: "sw sq sw-" + cls }), label));
  const links = hl.links || [];
  if (links.some((l) => l.strong)) items.push(h("span", { class: "l-lg" }, h("i", { class: "ln ln-strong" }), "strong link"));
  if (links.some((l) => !l.strong)) items.push(h("span", { class: "l-lg" }, h("i", { class: "ln ln-weak" }), "weak link"));
  return items;
}

function renderLesson(container, data, lesson, onExit) {
  const lessons = data.lessons;
  const idx = lessons.indexOf(lesson);
  const nextLesson = lessons[idx + 1] || null;
  const hasPractice = !!lesson.practice;
  const S = { phase: "intro", step: 0, marks: [], sel: -1, result: null, hint: -1, solution: -1 };

  const root = h("div", { class: "learn l-lesson" });
  const doneBadge = h("span", { class: "l-done-badge", title: "Lesson done" }, icon("check"));
  const top = h("div", { class: "l-top" },
    h("button", { class: "icon-btn", "aria-label": "Back", onclick: onExit }, icon("back")),
    h("div", { class: "l-title" },
      h("span", { class: "l-name" }, lesson.title),
      h("span", { class: "l-sub" }, `Chapter ${lesson.chapter} · ${lesson.levelHint}`)),
    doneBadge);
  const tabBtns = {};
  const tabs = h("div", { class: "segmented l-tabs", role: "tablist" },
    [["intro", "Intro"], ["example", "Example"], ...(hasPractice ? [["practice", "Try it"]] : [])].map(([k, label]) =>
      (tabBtns[k] = h("button", { role: "tab", "data-phase": k, onclick: () => setPhase(k) }, label))));
  if (!hasPractice) tabs.classList.add("two");
  const body = h("div", { class: "l-body" });
  root.append(top, tabs, body);
  container.append(root);

  // one board instance, re-parented between phases
  const boardWrap = h("div", { class: "l-board" });
  const board = createBoard(boardWrap, { readOnly: true, onCandTap: (cell) => onPracticeTap(cell) });

  function refreshDone() { doneBadge.classList.toggle("on", isDone(lesson.id)); }
  refreshDone();

  function setPhase(p) {
    S.phase = p;
    if (p === "example") S.step = Math.min(S.step, lesson.example.steps.length - 1);
    for (const [k, b] of Object.entries(tabBtns)) {
      b.classList.toggle("active", k === p);
      b.setAttribute("aria-selected", String(k === p));
    }
    draw();
    window.scrollTo(0, 0);
    container.scrollTop = 0;
  }

  function draw() {
    body.textContent = "";
    if (S.phase === "intro") drawIntro();
    else if (S.phase === "example") drawExample();
    else drawPractice();
  }

  // ---- intro
  function drawIntro() {
    body.append(
      h("div", { class: "card l-intro" },
        h("p", { class: "l-summary" }, lesson.summary),
        lesson.intro.map((p) => h("p", {}, rich(p)))),
      h("button", { class: "btn primary big l-cta", onclick: () => setPhase("example") },
        "See it on a real board", icon("chevR")));
  }

  // ---- example: step-by-step
  function stepper(pos, steps, cur, onGo, { finalLabel, onFinal, technique }) {
    const st = steps[cur];
    const { grid, notes } = stepBoard(pos, st);
    const hl = fullHl(st.hl);
    board.el.classList.remove("l-practice", "mode-place");
    board.render({ grid, givens: givensOf(pos), notes, highlight: hl, settings: { hlArea: false, hlSame: false } });
    const dots = h("div", { class: "l-dots", role: "tablist", "aria-label": "Steps" },
      steps.map((_, k) => h("button", {
        class: "l-dot" + (k === cur ? " on" : k < cur ? " seen" : ""),
        "aria-label": `Step ${k + 1}`, onclick: () => onGo(k),
      })));
    const last = cur === steps.length - 1;
    return [
      boardWrap,
      h("div", { class: "l-legend" }, legendFor(hl, technique)),
      h("div", { class: "card l-stepcard" + (last ? " final" : "") },
        h("div", { class: "l-stepno" }, `Step ${cur + 1} of ${steps.length}`),
        h("p", { class: "l-steptext", "aria-live": "polite" }, rich(st.text))),
      h("div", { class: "l-nav" },
        h("button", { class: "btn secondary l-prev", disabled: cur === 0, "aria-label": "Previous step", onclick: () => onGo(cur - 1) }, icon("chevL")),
        dots,
        last && finalLabel
          ? h("button", { class: "btn primary l-next", onclick: onFinal }, finalLabel)
          : h("button", { class: "btn primary l-next", disabled: last, "aria-label": "Next step", onclick: () => onGo(cur + 1) }, "Next", icon("chevR"))),
    ];
  }

  function drawExample() {
    const ex = lesson.example;
    body.append(...stepper(ex, ex.steps, S.step, (k) => { S.step = Math.max(0, Math.min(ex.steps.length - 1, k)); draw(); }, {
      technique: lesson.id,
      finalLabel: hasPractice ? "Try it" : "Finish",
      onFinal: () => {
        if (hasPractice) setPhase("practice");
        else { markDone(lesson.id); refreshDone(); drawFinished(); }
      },
    }));
  }

  function drawFinished() {
    body.textContent = "";
    body.append(h("div", { class: "card l-feedback ok" },
      h("div", { class: "l-fb-head" }, icon("check"), "Lesson complete"),
      h("p", {}, "Nice. The next lessons show one technique each — every one on a real board."),
      nextButtons()));
  }

  function nextButtons() {
    return h("div", { class: "l-fb-buttons" },
      nextLesson ? h("button", { class: "btn primary", onclick: () => go("#learn/" + nextLesson.id, true) }, `Next: ${nextLesson.title}`, icon("chevR")) : null,
      h("button", { class: "btn ghost", onclick: onExit }, "All lessons"));
  }

  // ---- practice
  const pr = lesson.practice;
  const prGrid = pr ? parse(pr.grid) : null;

  function onPracticeTap(cell) {
    if (S.phase !== "practice" || S.solution >= 0 || S.result?.ok) return;
    if (prGrid[cell]) return;
    S.sel = S.sel === cell ? -1 : cell;
    drawPractice();
  }

  function toggleMark(cell, digit) {
    const i = S.marks.findIndex((m) => m.cell === cell && m.digit === digit);
    if (lesson.mode === "place") S.marks = i >= 0 ? [] : [{ cell, digit }];
    else if (i >= 0) S.marks.splice(i, 1);
    else S.marks.push({ cell, digit });
    S.result = null;
    drawPractice();
  }

  function drawPractice() {
    body.textContent = "";
    if (S.solution >= 0) return drawSolution();
    const hintSt = S.hint >= 0 ? pr.steps[S.hint] : null;
    board.el.classList.add("l-practice");
    board.el.classList.toggle("mode-place", lesson.mode === "place");
    const hl = hintSt ? fullHl(hintSt.hl) : null;
    const notes = pr.cands.slice();
    const grid = prGrid.slice();
    if (S.result?.ok && lesson.mode === "place") { const m = S.marks[0]; grid[m.cell] = m.digit; notes[m.cell] = 0; }
    board.render({
      grid, givens: givensOf(pr), notes,
      selected: S.sel, highlight: hl, marked: S.marks,
      errors: new Set(),
      settings: { hlArea: !hl, hlSame: false },
    });
    // wrong marks get an extra class after render
    if (S.result && !S.result.ok) {
      for (const w of S.result.wrong) board.cellEl(w.cell).querySelector(`[data-d="${w.digit}"]`)?.classList.add("l-wrong");
    }

    const picker = S.sel >= 0 && !S.result?.ok ? h("div", { class: "l-picker" },
      h("span", { class: "l-picker-cell" }, cellName(S.sel)),
      digitsOf(pr.cands[S.sel]).map((d) => {
        const on = S.marks.some((m) => m.cell === S.sel && m.digit === d);
        return h("button", {
          class: "l-pick" + (on ? " on" : "") + (lesson.mode === "place" ? " place" : ""), "aria-pressed": String(on),
          "aria-label": `${lesson.mode === "place" ? "Place" : "Remove"} ${d} in ${cellName(S.sel)}`,
          onclick: () => toggleMark(S.sel, d),
        }, String(d));
      }),
      h("span", { class: "l-picker-help" }, lesson.mode === "place" ? "tap to place" : "tap to remove")) : null;

    const count = lesson.mode === "place"
      ? (S.marks[0] ? `Placing ${S.marks[0].digit} in ${cellName(S.marks[0].cell)}` : "Nothing placed yet")
      : `${S.marks.length} ${S.marks.length === 1 ? "candidate" : "candidates"} marked`;

    const fb = S.result ? h("div", { class: "card l-feedback " + (S.result.ok ? "ok" : "bad"), "aria-live": "polite" },
      h("div", { class: "l-fb-head" }, S.result.ok ? icon("check") : icon("close"), S.result.ok ? "Well done!" : "Not quite"),
      h("p", {}, S.result.message),
      S.result.ok ? nextButtons() : h("div", { class: "l-fb-buttons" },
        h("button", { class: "btn secondary", onclick: () => { S.result = null; drawPractice(); } }, "Keep trying"),
        h("button", { class: "btn ghost", onclick: () => { S.solution = 0; S.sel = -1; drawPractice(); } }, "Show solution"))) : null;

    body.append(
      h("div", { class: "card l-task" },
        h("div", { class: "l-stepno" }, "Try it"),
        h("p", {}, rich(pr.task)),
        hintSt ? h("p", { class: "l-hinttext" }, rich(hintSt.text)) : null),
      boardWrap,
      picker || h("div", { class: "l-picker empty muted small" },
        S.result?.ok ? "" : S.marks.length ? count + " · tap a cell to change" : lesson.mode === "place" ? "Tap an empty cell, then pick the digit to place." : "Tap a cell, then pick the candidates to remove."),
      fb || h("div", { class: "l-actions" },
        h("div", { class: "l-act-btns" },
          h("button", {
            class: "btn ghost", disabled: S.hint >= pr.steps.length - 2,
            onclick: () => { S.hint = Math.min(pr.steps.length - 2, S.hint + 1); drawPractice(); },
          }, icon("hint"), S.hint < 0 ? "Hint" : "More"),
          h("button", { class: "btn ghost", disabled: !S.marks.length, onclick: () => { S.marks = []; S.result = null; drawPractice(); } }, "Reset"),
          h("button", { class: "btn primary", onclick: check }, "Check"))));
  }

  function check() {
    S.result = checkPractice(lesson, S.marks);
    if (S.result.ok) { markDone(lesson.id); refreshDone(); S.sel = -1; S.hint = -1; }
    drawPractice();
    const fb = body.querySelector(".l-feedback");
    if (fb?.scrollIntoView) requestAnimationFrame(() => fb.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }

  function drawSolution() {
    body.textContent = "";
    board.el.classList.remove("l-practice", "mode-place");
    body.append(
      h("div", { class: "l-sol-head" },
        h("span", { class: "l-stepno" }, "Solution"),
        h("button", { class: "btn ghost small-btn", onclick: () => { S.solution = -1; S.result = null; S.marks = []; S.hint = -1; drawPractice(); } }, "Try again")),
      ...stepper(pr, pr.steps, S.solution, (k) => { S.solution = Math.max(0, Math.min(pr.steps.length - 1, k)); drawSolution(); }, {
        technique: lesson.id,
        finalLabel: nextLesson ? "Next lesson" : "All lessons",
        onFinal: () => (nextLesson ? go("#learn/" + nextLesson.id, true) : onExit()),
      }));
  }

  // keyboard: ← → through steps
  const onKey = (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (S.phase === "example" && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      const n = lesson.example.steps.length;
      S.step = Math.max(0, Math.min(n - 1, S.step + (e.key === "ArrowRight" ? 1 : -1)));
      draw();
    }
  };
  addEventListener("keydown", onKey);

  setPhase("intro");
  return () => removeEventListener("keydown", onKey);
}

function givensOf(pos) {
  const p = pos.puzzle || pos.grid;
  return Array.from({ length: 81 }, (_, i) => p[i] >= "1" && p[i] <= "9");
}
