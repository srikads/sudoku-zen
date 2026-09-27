// Feedback effects: vibration, row/column/box completion sweep, confetti.
// Everything respects the "animations" / "vibration" settings and reduced motion.

import { settings } from "./store.js";
import { UNIT_CELLS } from "./rules.js";

const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
export const animationsOn = () => settings().animations !== false && !reducedMotion();

export function vibrate(pattern = [60, 40, 60]) {
  if (settings().vibration === false) return;
  try { navigator.vibrate?.(pattern); } catch {}
}

/** Sweep animation over completed units (unit indices) starting at the placed cell. */
export function sweepUnits(board, units, origin) {
  if (!animationsOn() || !units?.length) return;
  const cells = new Set();
  for (const u of units) for (const i of UNIT_CELLS[u]) cells.add(i);
  board.sweep([...cells], origin);
}

const COLORS = ["#4a7dff", "#ffb020", "#27c28a", "#ff5d73", "#9b6bff", "#2ec5e6"];
export function confetti(n = 90) {
  if (!animationsOn()) return;
  const layer = document.createElement("div");
  layer.className = "confetti";
  for (let i = 0; i < n; i++) {
    const p = document.createElement("i");
    p.style.left = Math.random() * 100 + "vw";
    p.style.background = COLORS[i % COLORS.length];
    p.style.animationDelay = Math.random() * 0.5 + "s";
    p.style.animationDuration = 1.8 + Math.random() * 1.4 + "s";
    p.style.setProperty("--dx", (Math.random() * 2 - 1) * 140 + "px");
    p.style.setProperty("--rot", Math.random() * 900 + "deg");
    if (i % 3 === 0) p.style.borderRadius = "50%";
    layer.append(p);
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 4000);
}
