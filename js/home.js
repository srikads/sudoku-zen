// Home tab: title, "Continue game" card, New Game (level sheet), Daily Challenge, Learn.

import { store, localISO, dailyStreak } from "./store.js";
import { h, icon, openSheet, closeSheet, confirmDialog } from "./ui.js";
import { navigate } from "./app.js";
import { LEVEL_NAMES, startNewGame } from "./game.js";
import { fmtTime } from "./rules.js";

export function renderHome(view) {
  const g = store.saved && !store.saved.won ? store.saved : null;
  const streak = dailyStreak(store.daily, localISO());
  view.append(
    h("header", { class: "home-head" },
      h("div", { class: "logo", html: LOGO }),
      h("h1", { class: "home-title" }, "Sudoku Zen"),
      h("p", { class: "home-sub" }, "Calm puzzles. No ads. No tracking.")),
    g ? h("button", { class: "card continue", onclick: () => navigate("#game") },
      h("div", { class: "continue-text" },
        h("div", { class: "continue-label" }, "Continue game"),
        h("div", { class: "continue-meta" },
          `${LEVEL_NAMES[g.level]} · ${fmtTime(g.elapsed)}${g.over ? " · game over" : ""}`)),
      h("span", { class: "continue-play" }, icon("play"))) : null,
    h("div", { class: "home-actions" },
      h("button", { class: "btn primary big", id: "btn-new", onclick: () => newGameFlow() },
        icon("plus"), "New Game"),
      h("button", { class: "btn secondary big", id: "btn-daily", onclick: () => navigate("#daily") },
        icon("calendar"), h("span", {}, "Daily Challenge"),
        streak ? h("span", { class: "chip-fire", title: "Daily streak" }, icon("fire"), String(streak)) : null),
      h("button", { class: "btn secondary big", id: "btn-learn", onclick: () => navigate("#learn") },
        icon("learn"), "Learn Techniques")));
}

/** Bottom sheet with the six levels; resolves with the chosen index or null. */
export function pickLevel() {
  return new Promise((resolve) => {
    let picked = null;
    const list = h("div", { class: "level-list" },
      LEVEL_NAMES.map((name, i) => h("button", {
        class: "level-btn", "data-level": i,
        onclick: () => { picked = i; closeSheet(); },
      },
      h("span", { class: "level-name" }, name),
      h("span", { class: "level-dots", "aria-hidden": "true" },
        [0, 1, 2, 3, 4, 5].map((k) => h("i", { class: k <= i ? "on" : "" }))))));
    openSheet(list, { title: "New Game", onClose: () => resolve(picked) });
  });
}

/** New Game button flow: choose level, confirm replacing a saved game, start. */
export async function newGameFlow() {
  const level = await pickLevel();
  if (level == null) return false;
  const g = store.saved;
  if (g && !g.won && !g.over) {
    const ok = await confirmDialog("Start a new game?",
      `Your current ${LEVEL_NAMES[g.level]} game will be lost.`, "New game", "Cancel");
    if (!ok) return false;
  }
  await startNewGame(level);
  return true;
}

const LOGO = `<svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
<rect x="2" y="2" width="60" height="60" rx="14" fill="var(--accent)"/>
<g stroke="#fff" stroke-opacity=".35" stroke-width="1.5"><path d="M12 25.3h40M12 38.6h40M25.3 12v40M38.6 12v40"/></g>
<rect x="12" y="12" width="40" height="40" rx="3" fill="none" stroke="#fff" stroke-width="3"/>
<text x="32" y="42" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="700" font-size="26" fill="#fff">9</text></svg>`;
