// Service worker: precache the whole app for full offline use, serve cache-first.
// Bump VERSION whenever any app file changes so installed apps pick up the update.
const VERSION = "v1";
const CACHE = "sudoku-zen-" + VERSION;

const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/app.css",
  "./js/app.js",
  "./js/board.js",
  "./js/daily.js",
  "./js/fx.js",
  "./js/game.js",
  "./js/home.js",
  "./js/learn.js",
  "./js/puzzles.js",
  "./js/rules.js",
  "./js/settings.js",
  "./js/stats.js",
  "./js/store.js",
  "./js/sudoku.js",
  "./js/techniques.js",
  "./js/ui.js",
  "./data/puzzles.json",
  "./data/lessons.json",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("sudoku-zen-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;   // the app never requests other origins

  // cache-first for the same-origin app shell; navigations fall back to index.html
  e.respondWith(
    caches.open(CACHE).then(async (c) => {
      const hit = await c.match(e.request, { ignoreSearch: e.request.mode === "navigate" });
      if (hit) return hit;
      try {
        const res = await fetch(e.request);
        if (res.ok) c.put(e.request, res.clone());
        return res;
      } catch (err) {
        if (e.request.mode === "navigate") {
          const shell = await c.match("./index.html");
          if (shell) return shell;
        }
        throw err;
      }
    })
  );
});
