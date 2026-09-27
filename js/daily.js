// Daily Challenge: month calendar (◀ ▶), level per day, solved marks, month trophy,
// daily streak, play today / past days (future days disabled).

import { store, localISO, daysInMonth, dailyStreak, monthComplete } from "./store.js";
import { fmtTime } from "./rules.js";
import { LEVEL_NAMES, fmtDay } from "./game.js";
import { h, icon } from "./ui.js";
import { navigate, goBack, poolReady } from "./app.js";
import * as puzzles from "./puzzles.js";

const pad = (n) => String(n).padStart(2, "0");
const SHORT = ["Beg", "Med", "Hard", "Exp", "Mas", "Ext"];
let viewMonth = null;    // [year, month0] remembered while the app is open
let picked = null;

export function renderDaily(view) {
  const today = localISO();
  const [ty, tm] = today.split("-").map(Number);
  viewMonth ||= [ty, tm - 1];
  if (!picked || picked > today) picked = today;
  let alive = true;

  const root = h("div", { class: "daily" });
  view.append(
    h("header", { class: "page-head" },
      h("button", { class: "icon-btn", "aria-label": "Back", onclick: () => goBack("#home") }, icon("back")),
      h("h1", { class: "page-title" }, "Daily Challenge")),
    root);

  const levelCache = new Map();
  const levelOf = (iso) => {
    if (store.daily[iso]) return store.daily[iso].level;
    if (!levelCache.has(iso)) {
      try {
        levelCache.set(iso, puzzles.dailyLevel ? puzzles.dailyLevel(iso) : puzzles.dailyPuzzle(iso).level);
      } catch { levelCache.set(iso, null); }
    }
    return levelCache.get(iso);
  };

  let ready = false;
  poolReady.then(() => { ready = true; if (alive) draw(); }).catch(() => {});

  function draw() {
    const [y, m] = viewMonth;
    const streak = dailyStreak(store.daily, today);
    const full = monthComplete(store.daily, y, m);
    const title = new Date(y, m, 1).toLocaleDateString("en", { month: "long", year: "numeric" });
    const isCurMonth = y === ty && m === tm - 1;
    const solvedCount = Object.keys(store.daily).filter((d) => d.startsWith(`${y}-${pad(m + 1)}-`)).length;

    const grid = h("div", { class: "cal-grid" },
      ["M", "T", "W", "T", "F", "S", "S"].map((d) => h("div", { class: "cal-dow" }, d)));
    const offset = (new Date(y, m, 1).getDay() + 6) % 7;   // Monday first
    for (let k = 0; k < offset; k++) grid.append(h("div", { class: "cal-pad" }));
    for (let d = 1; d <= daysInMonth(y, m); d++) {
      const iso = `${y}-${pad(m + 1)}-${pad(d)}`;
      const future = iso > today;
      const solved = !!store.daily[iso];
      const inProgress = !solved && !!store.dailySaved[iso];
      const lv = future || !ready ? null : levelOf(iso);
      grid.append(h("button", {
        class: "cal-day" + (iso === today ? " today" : "") + (solved ? " solved" : "") +
          (inProgress ? " progress" : "") + (iso === picked ? " picked" : "") + (future ? " future" : ""),
        disabled: future, "data-date": iso,
        "aria-label": `${fmtDay(iso, { month: "long", day: "numeric" })}${solved ? ", solved" : ""}`,
        onclick: () => { picked = iso; draw(); },
      },
      h("span", { class: "cal-num" }, String(d)),
      solved ? h("span", { class: "cal-mark" }, icon("check"))
        : h("span", { class: "cal-lv" }, lv != null ? SHORT[lv] : "")));
    }

    root.replaceChildren(
      h("div", { class: "daily-top" },
        h("div", { class: "daily-streak" }, icon("fire"), h("b", {}, String(streak)), h("span", {}, " day streak")),
        h("div", { class: "daily-count" + (full ? " full" : "") }, icon("trophy"),
          h("span", {}, full ? "Month complete!" : `${solvedCount}/${daysInMonth(y, m)}`))),
      h("div", { class: "card cal" },
        h("div", { class: "cal-head" },
          h("button", { class: "icon-btn", "aria-label": "Previous month", onclick: () => shift(-1) }, icon("chevL")),
          h("div", { class: "cal-title" }, title, full ? h("span", { class: "cal-trophy", title: "Every day solved" }, icon("trophy")) : null),
          h("button", { class: "icon-btn", "aria-label": "Next month", disabled: isCurMonth, onclick: () => shift(1) }, icon("chevR"))),
        grid),
      dayCard());
  }

  function dayCard() {
    const iso = picked;
    const res = store.daily[iso];
    const saved = store.dailySaved[iso];
    const lv = res ? res.level : ready ? levelOf(iso) : null;
    const when = iso === localISO() ? "Today" : fmtDay(iso, { weekday: "short", month: "short", day: "numeric" });
    return h("div", { class: "card day-card" },
      h("div", { class: "day-info" },
        h("div", { class: "day-when" }, when),
        h("div", { class: "day-level" }, lv != null ? LEVEL_NAMES[lv] : "…"),
        res ? h("div", { class: "day-res" }, icon("check"), `Solved in ${fmtTime(res.time)} · ${res.score.toLocaleString("en")} pts`) : null),
      h("button", {
        class: "btn primary", id: "daily-play", disabled: !ready && !saved,
        onclick: () => navigate("#daily/" + iso),
      }, res ? "Play again" : saved ? "Continue" : "Play"));
  }

  function shift(k) {
    let [y, m] = viewMonth;
    m += k;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    viewMonth = [y, m];
    const last = `${y}-${pad(m + 1)}-${pad(daysInMonth(y, m))}`;
    picked = last < today ? last : today;
    draw();
  }

  draw();
  return () => { alive = false; };
}
