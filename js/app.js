// App shell: hash router (#home #game #daily #daily/<date> #stats #settings #learn #learn/<id>),
// bottom tab bar, theme, puzzle-pool loading and service-worker registration.
//
// Learn entry point (js/learn.js, written separately) — loaded lazily:
//   import("./learn.js").then((m) => m.renderLearn(container, { onExit, techniqueId }))
//   export function renderLearn(container, { onExit, techniqueId }) -> optional cleanup function
//   - container: the #view element (full-screen, tab bar hidden)
//   - onExit(): leave the lesson screen (goes back in history, e.g. to the game or home)
//   - techniqueId: technique id from the hash (#learn/x_wing, ids as in techniques.js) or
//     undefined for the lesson list. (`id` is passed too, as an alias.) learn.js may also
//     navigate between lessons itself by setting location.hash = "#learn/<id>".
//   If the module is missing or fails to load, a "Lessons coming soon" message is shown.
//   Lessons reuse the board renderer: import { createBoard, CELL_ROLE_CLASS, CAND_ROLE_CLASS } from "./board.js".

import { store, save } from "./store.js";
import { closeOverlays, h, icon } from "./ui.js";
import { loadPool } from "./puzzles.js";
import { renderHome } from "./home.js";
import { renderGame } from "./game.js";
import { renderStats } from "./stats.js";
import { renderSettings } from "./settings.js";
import { renderDaily } from "./daily.js";

export const APP_VERSION = "1.0.0";

/** Resolves when data/puzzles.json is loaded (everything that needs puzzles awaits it). */
export const poolReady = loadPool();
poolReady.catch((e) => console.error("puzzle pool failed to load", e));

const view = document.getElementById("view");
const tabs = [...document.querySelectorAll("#tabbar .tab")];

// ---- theme -------------------------------------------------------------------

const darkMQ = matchMedia("(prefers-color-scheme: dark)");
export function applyTheme() {
  const t = store.settings.theme;
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  const dark = t === "dark" || (t !== "light" && darkMQ.matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#12151c" : "#ffffff");
}
darkMQ.addEventListener?.("change", applyTheme);
applyTheme();

// ---- router --------------------------------------------------------------------

let cleanup = null;
let routed = null;

export function parseHash(hash = location.hash) {
  const [name, ...rest] = hash.replace(/^#\/?/, "").split("/");
  return { name: name || "home", arg: rest.join("/") || null };
}

function route(force = false) {
  if (!force && routed === location.hash) return;
  routed = location.hash;
  try { cleanup?.(); } catch (e) { console.error(e); }
  cleanup = null;
  closeOverlays();
  const { name, arg } = parseHash();
  const full = name === "game" || name === "learn" || (name === "daily" && !!arg);
  document.body.classList.toggle("fullscreen", full);
  tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  view.className = "view view-" + name;
  view.textContent = "";
  view.scrollTop = 0;
  window.scrollTo(0, 0);

  const token = routed;
  switch (name) {
    case "stats": cleanup = renderStats(view); break;
    case "settings": cleanup = renderSettings(view); break;
    case "daily": cleanup = arg ? renderGame(view, { daily: arg }) : renderDaily(view); break;
    case "game": cleanup = renderGame(view, {}); break;
    case "learn":
      view.append(h("div", { class: "loading" }, "Loading…"));
      import("./learn.js")
        .then((m) => {
          if (routed !== token) return;
          view.textContent = "";
          const techniqueId = arg ? decodeURIComponent(arg) : undefined;
          cleanup = m.renderLearn(view, { onExit: () => goBack("#home"), techniqueId, id: techniqueId }) || null;
        })
        .catch((e) => {
          console.warn("lessons unavailable", e);
          if (routed !== token) return;
          view.textContent = "";
          view.append(h("div", { class: "empty" },
            h("div", { class: "empty-ico" }, icon("learn")),
            h("h2", {}, "Lessons coming soon"),
            h("p", {}, "Step-by-step technique lessons will appear here in an update."),
            h("button", { class: "btn primary", onclick: () => goBack("#home") }, "Back")));
        });
      break;
    default: cleanup = renderHome(view);
  }
}

/** Go to a hash; pushes a history entry (Android back returns) unless replace. */
export function navigate(hash, { replace = false } = {}) {
  const depth = history.state?.depth || 0;
  if (replace) history.replaceState({ app: true, depth }, "", hash);
  else history.pushState({ app: true, depth: depth + 1 }, "", hash);
  route(true);
}

/** In-app back: history back when we pushed an entry, otherwise replace with fallback. */
export function goBack(fallback = "#home") {
  if ((history.state?.depth || 0) > 0) history.back();
  else navigate(fallback, { replace: true });
}

/** Re-render the current screen (e.g. after settings change). */
export const rerender = () => route(true);

window.addEventListener("popstate", () => route());
window.addEventListener("hashchange", () => route());

tabs.forEach((t) => t.addEventListener("click", () => {
  const cur = parseHash().name;
  if (cur === t.dataset.tab) return;
  navigate("#" + t.dataset.tab, { replace: cur !== "home" });
}));

history.replaceState({ app: true, depth: 0 }, "", location.hash || "#home");
route(true);

// ---- offline -------------------------------------------------------------------------

if ("serviceWorker" in navigator && !/[?&]nosw\b/.test(location.search)) {
  addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

// persist on the way out (timer state etc. is saved by the screens themselves)
addEventListener("pagehide", save);
