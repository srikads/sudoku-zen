// Classic (non-module) script run in <head> before first paint: applies the saved theme
// so there is no light/dark flash. External file because the CSP forbids inline scripts.
try {
  var t = JSON.parse(localStorage.getItem("sudoku_zen_v1") || "{}").settings.theme;
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
} catch (e) {}
