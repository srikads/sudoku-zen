// App-level wiring guards: offline cache list, manifest + icons, and the privacy promise
// (no code may reach any other origin — no CDNs, fonts, analytics or APIs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";

const url = (p) => new URL(`../${p}`, import.meta.url);
const read = (p) => readFileSync(url(p), "utf8");
const ls = (dir) => (existsSync(url(dir)) ? readdirSync(url(dir)).filter((f) => !f.startsWith(".")) : []);

function shellList() {
  const sw = read("sw.js");
  const m = sw.match(/const SHELL = \[([\s\S]*?)\];/);
  assert.ok(m, "sw.js defines const SHELL = [...]");
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

test("service worker precaches every file in js/, data/, css/ and icons/", () => {
  const shell = shellList();
  for (const dir of ["js", "data", "css", "icons"])
    for (const f of ls(dir)) assert.ok(shell.includes(`./${dir}/${f}`), `sw.js SHELL is missing ${dir}/${f}`);
  // files that are written by other contributors must be precached even before they exist
  for (const f of ["./js/learn.js", "./data/lessons.json", "./data/puzzles.json", "./index.html", "./manifest.webmanifest", "./"])
    assert.ok(shell.includes(f), `sw.js SHELL is missing ${f}`);
  assert.equal(new Set(shell).size, shell.length, "duplicate SHELL entries");
});

test("every SHELL entry is a same-origin relative path; existing ones point at real files", () => {
  const optional = new Set(["./js/learn.js", "./data/lessons.json", "./data/puzzles.json"]);
  for (const f of shellList()) {
    assert.match(f, /^\.\//, f);
    if (f === "./" || optional.has(f)) continue;
    assert.ok(existsSync(url(f.slice(2))), `SHELL entry ${f} does not exist`);
  }
});

test("sw.js caches with a versioned name and only handles same-origin GETs", () => {
  const sw = read("sw.js");
  assert.match(sw, /const VERSION = "v\d+/);
  assert.match(sw, /url\.origin !== location\.origin/);
});

test("manifest is installable (standalone, start_url, icons 192 + 512 + maskable)", () => {
  const m = JSON.parse(read("manifest.webmanifest"));
  assert.equal(m.name, "Sudoku Zen");
  assert.ok(m.short_name);
  assert.equal(m.display, "standalone");
  assert.match(m.start_url, /^\.\//);
  assert.equal(m.scope, "./");
  const sizes = m.icons.map((i) => i.sizes);
  assert.ok(sizes.includes("192x192") && sizes.includes("512x512"));
  assert.ok(m.icons.some((i) => (i.purpose || "").includes("maskable")));
  for (const i of m.icons) assert.ok(existsSync(url(i.src)), `icon ${i.src} missing`);
});

test("PNG icons are real PNGs of the declared size", () => {
  for (const [file, size] of [["icons/icon-192.png", 192], ["icons/icon-512.png", 512]]) {
    const b = readFileSync(url(file));
    assert.equal(b.subarray(1, 4).toString("latin1"), "PNG", file);
    assert.equal(b.readUInt32BE(16), size, `${file} width`);
    assert.equal(b.readUInt32BE(20), size, `${file} height`);
  }
});

test("index.html wires manifest, stylesheet, module entry and a strict same-origin CSP", () => {
  const html = read("index.html");
  assert.match(html, /<link rel="manifest" href="manifest.webmanifest">/);
  assert.match(html, /href="css\/app.css"/);
  assert.match(html, /<script type="module" src="js\/app.js">/);
  assert.match(html, /viewport-fit=cover/);
  const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)?.[1] || "";
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /connect-src 'self'/);
  assert.ok(!/https?:/.test(csp), "CSP must not allow other origins");
});

test("privacy: no external URLs or network APIs in any html/css/js/manifest", () => {
  const files = ["index.html", "manifest.webmanifest", "sw.js", "icons/icon.svg",
    ...ls("css").map((f) => "css/" + f), ...ls("js").map((f) => "js/" + f)];
  for (const f of files) {
    const src = read(f);
    const urls = (src.match(/(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}[^\s"'`)]*/gi) || [])
      .filter((u) => !/^(?:https?:)?\/\/www\.w3\.org\/(2000\/svg|1999\/xlink)/.test(u));
    assert.deepEqual(urls, [], `${f} references another origin`);
    assert.doesNotMatch(src, /navigator\.sendBeacon|new WebSocket|EventSource\(|XMLHttpRequest/, `${f} uses a network API`);
    assert.doesNotMatch(src, /@import\s+url\(|fonts\.googleapis|gstatic/i, f);
    // fetch() is only allowed for same-origin relative data files
    for (const m of src.matchAll(/fetch\(([^)]*)\)/g))
      assert.match(m[1], /^(url|e\.request|["']data\/[\w.-]+["'])$/, `${f}: unexpected fetch(${m[1]})`);
  }
});

test("every relative import in js/ resolves (learn.js may still be pending)", () => {
  for (const f of ls("js")) {
    const src = read("js/" + f);
    for (const m of src.matchAll(/(?:from\s+|import\()\s*["'](\.\/[\w.-]+)["']/g)) {
      if (m[1] === "./learn.js") continue;
      assert.ok(existsSync(url("js/" + m[1].slice(2))), `js/${f} imports missing ${m[1]}`);
    }
  }
});

test("app.js routes every screen via the hash and lazy-loads lessons with a fallback", () => {
  const app = read("js/app.js");
  for (const r of ["stats", "settings", "daily", "game", "learn"]) assert.ok(app.includes(`case "${r}"`), r);
  assert.match(app, /import\("\.\/learn\.js"\)/);
  assert.match(app, /renderLearn\(view, \{[^}]*onExit[^}]*techniqueId/);
  assert.match(app, /Lessons coming soon/);
});

test("board.js exposes the reusable renderer contract for lessons", () => {
  const src = read("js/board.js");
  for (const name of ["createBoard", "CELL_ROLE_CLASS", "CAND_ROLE_CLASS"])
    assert.match(src, new RegExp(`export (function|const) ${name}\\b`));
  for (const role of ["base", "cover", "pivot", "pincer", "fin", "target", "key", "elim", "place", "colorA", "colorB"])
    assert.ok(src.includes(`${role}:`), `role ${role} mapped`);
  assert.match(src, /onCandTap/);
  const css = read("css/app.css");
  for (const cls of src.matchAll(/:\s*"((?:role|cand)-[\w-]+)"/g)) assert.ok(css.includes("." + cls[1]), `css for .${cls[1]}`);
});
