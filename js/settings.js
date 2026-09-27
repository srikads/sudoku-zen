// Settings tab: theme, assists/toggles, reset statistics, about.

import { store, save, resetStats } from "./store.js";
import { h, confirmDialog, toast } from "./ui.js";
import { applyTheme, APP_VERSION } from "./app.js";

const TOGGLES = [
  ["mistakeLimit", "Mistake limit", "Game over after 3 mistakes"],
  ["hlArea", "Highlight areas", "Shade row, column and box of the selected cell"],
  ["hlSame", "Highlight identical numbers", "Shade every cell with the selected digit"],
  ["autoRemoveNotes", "Auto-remove notes", "Placing a digit removes it from notes in the same row, column and box"],
  ["hideFinished", "Hide finished digits", "Hide a number on the pad once all nine are placed"],
  ["showTimer", "Show timer", "Time is still recorded when hidden"],
  ["vibration", "Vibration", "Vibrate on mistakes"],
  ["animations", "Animations", "Completion sweep and confetti"],
];

export function renderSettings(view) {
  const s = store.settings;
  view.append(h("h1", { class: "page-title" }, "Settings"));

  const seg = h("div", { class: "segmented", role: "radiogroup", "aria-label": "Theme" });
  const drawSeg = () => seg.replaceChildren(...[["system", "System"], ["light", "Light"], ["dark", "Dark"]].map(([v, label]) =>
    h("button", {
      class: s.theme === v ? "active" : "", role: "radio", "aria-checked": String(s.theme === v), "data-theme-opt": v,
      onclick: () => { s.theme = v; save(); applyTheme(); drawSeg(); },
    }, label)));
  drawSeg();
  view.append(h("div", { class: "card settings-card" },
    h("div", { class: "set-row col" }, h("div", { class: "set-name" }, "Theme"), seg)));

  const card = h("div", { class: "card settings-card" });
  for (const [key, name, desc] of TOGGLES) {
    const input = h("input", { type: "checkbox", role: "switch", id: "set-" + key });
    input.checked = s[key] !== false;
    input.addEventListener("change", () => { s[key] = input.checked; save(); });
    card.append(h("label", { class: "set-row", for: "set-" + key },
      h("div", { class: "set-text" }, h("div", { class: "set-name" }, name), h("div", { class: "set-desc" }, desc)),
      h("span", { class: "switch" }, input, h("span", { class: "slider" }))));
  }
  view.append(h("h2", { class: "section" }, "Game"), card);

  view.append(h("h2", { class: "section" }, "Data"),
    h("div", { class: "card settings-card" },
      h("button", {
        class: "set-row danger", id: "reset-stats",
        onclick: async () => {
          const ok = await confirmDialog("Reset statistics?",
            "All game statistics and history will be deleted. Your current game, settings and daily calendar are kept.",
            "Reset", "Cancel");
          if (ok) { resetStats(); toast("Statistics reset"); }
        },
      }, h("div", { class: "set-name" }, "Reset statistics"))));

  view.append(h("h2", { class: "section" }, "About"),
    h("div", { class: "card about" },
      h("p", { class: "about-promise" }, "No ads. No tracking. Nothing leaves your phone."),
      h("p", { class: "muted" }, "Sudoku Zen works fully offline. Your games, settings and statistics are stored only on this device."),
      h("p", { class: "muted small" }, `Version ${APP_VERSION}`)));
}
