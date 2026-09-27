// Small DOM helpers shared by all screens: element builder, bottom sheet,
// modal dialog, confirm and toast.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v;
    else if (k === "text") el.textContent = v;
    else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

export function toast(msg, ms = 1800) {
  let t = document.querySelector(".toast");
  if (!t) document.body.append((t = h("div", { class: "toast", role: "status" })));
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), ms);
}

// ---- bottom sheet ---------------------------------------------------------------

let sheetClose = null;
export function openSheet(content, { title, onClose } = {}) {
  closeSheet();
  const backdrop = h("div", { class: "backdrop", onclick: () => closeSheet() });
  const sheet = h("div", { class: "sheet", role: "dialog", "aria-modal": "true" },
    h("div", { class: "sheet-grip" }),
    title ? h("h2", { class: "sheet-title" }, title) : null,
    content);
  document.body.append(backdrop, sheet);
  requestAnimationFrame(() => { backdrop.classList.add("show"); sheet.classList.add("show"); });
  sheetClose = () => {
    sheetClose = null;
    backdrop.classList.remove("show");
    sheet.classList.remove("show");
    setTimeout(() => { backdrop.remove(); sheet.remove(); }, 220);
    onClose?.();
  };
  return closeSheet;
}
export function closeSheet() { sheetClose?.(); }

// ---- modal dialog ---------------------------------------------------------------

/**
 * dialog({ title, body, icon, buttons: [{ label, primary, onClick }], dismissable })
 * Buttons close the dialog before running onClick. Returns a close function.
 */
export function dialog({ title, body, icon, buttons = [], dismissable = false, className = "" }) {
  const close = () => { wrap.classList.remove("show"); setTimeout(() => wrap.remove(), 200); };
  const wrap = h("div", { class: "modal-wrap", onclick: (e) => { if (dismissable && e.target === wrap) close(); } },
    h("div", { class: "modal " + className, role: "alertdialog", "aria-modal": "true" },
      icon ? h("div", { class: "modal-icon" }, icon) : null,
      title ? h("h2", { class: "modal-title" }, title) : null,
      body ? (typeof body === "string" ? h("p", { class: "modal-body" }, body) : body) : null,
      h("div", { class: "modal-buttons" },
        buttons.map((b) => h("button", {
          class: "btn " + (b.primary ? "primary" : "ghost"),
          onclick: () => { close(); b.onClick?.(); },
        }, b.label)))));
  document.body.append(wrap);
  requestAnimationFrame(() => wrap.classList.add("show"));
  return close;
}

export function confirmDialog(title, body, okLabel = "OK", cancelLabel = "Cancel") {
  return new Promise((resolve) => dialog({
    title, body, dismissable: true,
    buttons: [
      { label: okLabel, primary: true, onClick: () => resolve(true) },
      { label: cancelLabel, onClick: () => resolve(false) },
    ],
  }));
}

/** Remove every open sheet / dialog (used on route changes). */
export function closeOverlays() {
  closeSheet();
  document.querySelectorAll(".modal-wrap").forEach((m) => m.remove());
}

export const icon = (name) => h("span", { class: "i", "aria-hidden": "true", html: ICONS[name] || "" });

// Inline SVG icons (stroke = currentColor) — no icon fonts, no network.
const S = (d, extra = "") =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
export const ICONS = {
  back: S('<path d="M15 18l-6-6 6-6"/>'),
  pause: S('<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>'),
  play: S('<path d="M7 5l12 7-12 7z"/>'),
  undo: S('<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/>'),
  erase: S('<path d="M20 20H9L4 15a2 2 0 010-2.8l8.6-8.6a2 2 0 012.8 0l4.6 4.6a2 2 0 010 2.8L12 19"/><path d="M8.5 9.5l6 6"/>'),
  notes: S('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>'),
  hint: S('<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 00-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0012 2z"/>'),
  auto: S('<path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/>'),
  home: S('<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>'),
  stats: S('<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>'),
  settings: S('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>'),
  calendar: S('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
  learn: S('<path d="M2 7l10-4 10 4-10 4z"/><path d="M6 9v5c0 1.7 2.7 3 6 3s6-1.3 6-3V9"/>'),
  plus: S('<path d="M12 5v14M5 12h14"/>'),
  chevL: S('<path d="M15 18l-6-6 6-6"/>'),
  chevR: S('<path d="M9 18l6-6-6-6"/>'),
  close: S('<path d="M18 6L6 18M6 6l12 12"/>'),
  trophy: S('<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0z"/><path d="M17 5h3v2a3 3 0 01-3 3M7 5H4v2a3 3 0 003 3"/>'),
  fire: S('<path d="M12 22c4 0 7-3 7-7 0-5-5-7-5-12-3 2-4 5-4 7-1-1-2-2-2-4-2 2-3 5-3 9 0 4 3 7 7 7z"/>'),
  check: S('<path d="M5 12l5 5L20 7"/>'),
  lock: S('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>'),
};
