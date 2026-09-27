// Reusable 9x9 board renderer — used by the game screen, hints and lessons (learn.js).
//
//   const board = createBoard(container, {
//     onCellTap(i),            // cell tapped (not called when readOnly)
//     onCandTap(cell, digit),  // optional: tap on an empty cell -> the tapped ninth (notes layout) picks
//                              // the digit; for lesson "Try it" practice (works with readOnly too)
//     readOnly: false,         // no selection / cell taps (lesson examples)
//   });
//   board.render({ grid, givens, notes, selected, errors, highlight, settings });
//     grid: number[81] (0 empty) · givens: bool[81] · notes: 9-bit masks[81]
//     selected: cell index or -1/null · errors: Set of wrong cells
//     highlight: Step.highlight {units, cells:[{cell,role}], cands:[{cell,digit,role}], links} or null
//     settings: { hlArea, hlSame } (both default true)
//     marked (optional): [{cell, digit}] candidates the user selected in practice mode
//   board.sweep(cells, origin)  // completion animation
//
// Role -> CSS class maps are exported so lessons render highlights identically.

export const CELL_ROLE_CLASS = {
  base: "role-base",
  cover: "role-cover",
  pivot: "role-pivot",
  pincer: "role-pincer",
  fin: "role-fin",
  target: "role-target",
};
export const CAND_ROLE_CLASS = {
  key: "cand-key",
  elim: "cand-elim",
  place: "cand-place",
  colorA: "cand-a",
  colorB: "cand-b",
};
/** Human legend for roles (lessons may show it). */
export const ROLE_LABELS = {
  base: "Base", cover: "Cover", pivot: "Pivot", pincer: "Pincer", fin: "Fin", target: "Target",
  key: "Key candidate", elim: "Eliminated", place: "Placement", colorA: "Colour A", colorB: "Colour B",
};

const SVGNS = "http://www.w3.org/2000/svg";
const R = (i) => (i / 9) | 0, C = (i) => i % 9;
const boxOf = (i) => 3 * ((R(i) / 3) | 0) + ((C(i) / 3) | 0);
const unitHas = (u, i) => (u < 9 ? R(i) === u : u < 18 ? C(i) === u - 9 : boxOf(i) === u - 18);

export function createBoard(container, opts = {}) {
  const el = document.createElement("div");
  el.className = "board" + (opts.readOnly ? " readonly" : "");
  el.setAttribute("role", "grid");
  el.setAttribute("aria-label", "Sudoku board");
  const cells = [], vals = [], noteEls = [];
  for (let i = 0; i < 81; i++) {
    const c = document.createElement("div");
    c.dataset.i = i;
    c.setAttribute("role", "gridcell");
    const v = document.createElement("span");
    v.className = "val";
    const n = document.createElement("div");
    n.className = "notes";
    const ns = [];
    for (let d = 1; d <= 9; d++) {
      const s = document.createElement("span");
      s.dataset.d = d;
      n.append(s);
      ns.push(s);
    }
    c.append(v, n);
    el.append(c);
    cells.push(c); vals.push(v); noteEls.push(ns);
  }
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("class", "links");
  svg.setAttribute("viewBox", "0 0 900 900");
  svg.setAttribute("aria-hidden", "true");
  el.append(svg);
  container.append(el);

  el.addEventListener("pointerdown", (e) => {
    if (e.button > 0) return;
    const cellEl = e.target.closest("[data-i]");
    if (!cellEl) return;
    const i = +cellEl.dataset.i;
    if (opts.onCandTap && !lastGrid[i]) {
      // candidate practice: the tapped third of the cell picks the digit (notes layout 1-9)
      e.preventDefault();
      const r = cellEl.getBoundingClientRect();
      const col = Math.min(2, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * 3)));
      const row = Math.min(2, Math.max(0, Math.floor(((e.clientY - r.top) / r.height) * 3)));
      opts.onCandTap(i, row * 3 + col + 1);
      return;
    }
    if (!opts.readOnly && opts.onCellTap) {
      e.preventDefault();
      opts.onCellTap(i);
    }
  });

  let lastGrid = [];
  let last = [];   // last className per cell, to avoid needless DOM writes
  let lastLinks = "";

  function render(st) {
    const grid = st.grid, notes = st.notes || [], givens = st.givens || [];
    lastGrid = grid.slice();
    const set = st.settings || {};
    const hlArea = set.hlArea !== false, hlSame = set.hlSame !== false;
    const sel = st.selected ?? -1;
    const selVal = sel >= 0 ? grid[sel] : 0;
    const errors = st.errors || new Set();
    const hl = st.highlight || null;

    const cellRole = new Map(), candRole = new Map();
    if (hl) {
      for (const c of hl.cells || []) cellRole.set(c.cell, c.role);
      for (const c of hl.cands || []) candRole.set(c.cell * 10 + c.digit, c.role);
    }
    const marked = new Set((st.marked || []).map((m) => m.cell * 10 + m.digit));
    const units = hl?.units || [];

    for (let i = 0; i < 81; i++) {
      const v = grid[i];
      let cls = "cell";
      if (C(i) === 2 || C(i) === 5) cls += " bx";
      if (R(i) === 2 || R(i) === 5) cls += " by";
      if (v) cls += givens[i] ? " given" : " entered";
      if (errors.has(i)) cls += " wrong";
      if (units.length && units.some((u) => unitHas(u, i))) cls += " unit";
      const role = cellRole.get(i);
      if (role) cls += " " + (CELL_ROLE_CLASS[role] || "");
      if (sel >= 0) {
        if (i === sel) cls += " sel";
        else if (hlArea && !hl && (R(i) === R(sel) || C(i) === C(sel) || boxOf(i) === boxOf(sel))) cls += " area";
        if (i !== sel && hlSame && selVal && v === selVal) cls += " same";
      }
      if (last[i] !== cls) { cells[i].className = cls; last[i] = cls; }
      const txt = v ? String(v) : "";
      if (vals[i].textContent !== txt) vals[i].textContent = txt;
      const m = v ? 0 : notes[i] || 0;
      const ns = noteEls[i];
      for (let d = 1; d <= 9; d++) {
        const k = i * 10 + d;
        const cr = v ? null : candRole.get(k);
        const on = (m >> (d - 1)) & 1 || cr;
        let ncls = "";
        if (on) {
          ncls = "on";
          if (cr) ncls += " " + (CAND_ROLE_CLASS[cr] || "");
          else if (hlSame && selVal === d && !hl) ncls += " nsame";
          if (marked.has(k)) ncls += " marked";
        }
        if (ns[d - 1].className !== ncls) {
          ns[d - 1].className = ncls;
          ns[d - 1].textContent = on ? String(d) : "";
        }
      }
      cells[i].setAttribute("aria-label", `r${R(i) + 1}c${C(i) + 1} ${v || "empty"}`);
    }
    drawLinks(hl?.links || []);
  }

  function drawLinks(links) {
    const key = JSON.stringify(links);
    if (key === lastLinks) return;
    lastLinks = key;
    svg.textContent = "";
    if (!links.length) return;
    const defs = document.createElementNS(SVGNS, "defs");
    defs.innerHTML = '<marker id="lk-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="lk-head"/></marker>';
    svg.append(defs);
    const pos = (p) => {
      const d = p.digit || 5;
      return [C(p.cell) * 100 + ((d - 1) % 3) * 33.3 + 16.7, R(p.cell) * 100 + (((d - 1) / 3) | 0) * 33.3 + 16.7];
    };
    for (const l of links) {
      const [x1, y1] = pos(l.from), [x2, y2] = pos(l.to);
      // shorten so the line ends at the candidate's edge, and bow it a little
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
      const s = 13 / len;
      const ax = x1 + dx * s, ay = y1 + dy * s, bx = x2 - dx * s, by = y2 - dy * s;
      const bow = Math.min(40, len * 0.15);
      const mx = (ax + bx) / 2 - (dy / len) * bow, my = (ay + by) / 2 + (dx / len) * bow;
      const path = document.createElementNS(SVGNS, "path");
      path.setAttribute("d", `M${ax.toFixed(1)} ${ay.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)}`);
      path.setAttribute("class", "lk " + (l.strong ? "lk-strong" : "lk-weak"));
      path.setAttribute("marker-end", "url(#lk-arrow)");
      svg.append(path);
    }
  }

  /** Staggered sweep across `list` of cells, starting from `origin`. */
  function sweep(list, origin = list[0]) {
    for (const i of list) {
      const dist = Math.abs(R(i) - R(origin)) + Math.abs(C(i) - C(origin));
      const c = cells[i];
      c.style.setProperty("--sd", dist * 45 + "ms");
      c.classList.remove("sweep");
      void c.offsetWidth;
      c.classList.add("sweep");
      setTimeout(() => { c.classList.remove("sweep"); last[i] = null; }, 700 + dist * 45);
    }
  }

  return { el, render, sweep, cellEl: (i) => cells[i], destroy: () => el.remove() };
}
