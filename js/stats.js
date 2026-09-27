// Stats tab: level chips (All + 6 levels), stat tiles, daily streak, last 50 finished games.

import { store, aggregate, dailyStreak, bestDailyStreak, localISO } from "./store.js";
import { fmtTime } from "./rules.js";
import { LEVEL_NAMES } from "./game.js";
import { h, icon } from "./ui.js";

let chosen = null;   // null = All (kept while the app is open)

export function renderStats(view) {
  view.append(h("h1", { class: "page-title" }, "Statistics"));
  const chips = h("div", { class: "chips", role: "tablist" });
  const body = h("div", {});
  view.append(chips, body);

  const draw = () => {
    chips.replaceChildren(...[null, 0, 1, 2, 3, 4, 5].map((lv) =>
      h("button", {
        class: "chip" + (lv === chosen ? " active" : ""), role: "tab",
        "aria-selected": String(lv === chosen),
        onclick: () => { chosen = lv; draw(); },
      }, lv == null ? "All" : LEVEL_NAMES[lv])));
    const a = aggregate(store.stats, chosen);
    const tile = (value, label, cls = "") => h("div", { class: "tile " + cls },
      h("div", { class: "tile-v" }, value), h("div", { class: "tile-l" }, label));
    const t = (s) => (s == null ? "—" : fmtTime(s));
    const n = (x) => (x == null ? "—" : x.toLocaleString("en"));
    const today = localISO();
    body.replaceChildren(
      h("h2", { class: "section" }, "Games"),
      h("div", { class: "tiles" },
        tile(n(a.started), "Games started"),
        tile(n(a.won), "Games won"),
        tile(Math.round(a.winRate * 100) + "%", "Win rate"),
        tile(n(a.perfect), "Perfect wins")),
      h("h2", { class: "section" }, "Time"),
      h("div", { class: "tiles" },
        tile(t(a.bestTime), "Best time"),
        tile(t(a.avgTime), "Average time")),
      h("h2", { class: "section" }, "Score"),
      h("div", { class: "tiles" },
        tile(n(a.bestScore), "Best score"),
        tile(n(a.totalScore), "Total score")),
      h("h2", { class: "section" }, "Streaks"),
      h("div", { class: "tiles" },
        tile(n(a.streak), "Current win streak"),
        tile(n(a.bestStreak), "Best win streak"),
        tile(h("span", { class: "fire" }, icon("fire"), String(dailyStreak(store.daily, today))), "Daily streak", "accent"),
        tile(n(bestDailyStreak(store.daily)), "Best daily streak")),
      history());
  };

  const history = () => {
    const recs = store.stats.records
      .filter((r) => chosen == null || r.level === chosen)
      .slice(-50).reverse();
    const wrap = h("div", { class: "history" }, h("h2", { class: "section" }, "Recent games"));
    if (!recs.length) {
      wrap.append(h("p", { class: "muted empty-note" }, "No finished games yet. Solve a puzzle and it shows up here."));
      return wrap;
    }
    const list = h("ul", { class: "hist-list" });
    for (const r of recs) {
      const d = new Date(r.at);
      list.append(h("li", { class: "hist-item " + (r.won ? "won" : "lost") },
        h("span", { class: "hist-res", title: r.won ? "Won" : "Lost" }, icon(r.won ? "check" : "close")),
        h("div", { class: "hist-main" },
          h("div", { class: "hist-level" }, LEVEL_NAMES[r.level],
            r.daily ? h("span", { class: "tag" }, "Daily") : null,
            r.perfect ? h("span", { class: "tag tag-gold" }, "Perfect") : null),
          h("div", { class: "hist-date" },
            d.toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" }))),
        h("div", { class: "hist-num" },
          h("div", {}, fmtTime(r.time)),
          h("div", { class: "muted" }, r.won ? `${r.score.toLocaleString("en")} pts` : "Lost"))));
    }
    wrap.append(list);
    return wrap;
  };

  draw();
}
