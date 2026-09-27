// Persisted state (localStorage only — nothing ever leaves the device):
// settings, statistics, the saved regular game, saved daily games and daily results.
// The stats helpers below are pure functions (unit-tested in tests/game.test.mjs).

const KEY = "sudoku_zen_v1";
const RECORDS_CAP = 1000;       // finished games kept for statistics
const DAILY_SAVES_CAP = 8;      // in-progress daily games kept

export const DEFAULT_SETTINGS = {
  theme: "system",        // "system" | "light" | "dark"
  mistakeLimit: true,
  hlArea: true,
  hlSame: true,
  autoRemoveNotes: true,
  hideFinished: true,
  showTimer: true,
  vibration: true,
  animations: true,
};

export function freshState() {
  return {
    settings: { ...DEFAULT_SETTINGS },
    stats: { started: [0, 0, 0, 0, 0, 0], records: [] },
    saved: null,          // regular game in progress (see rules.js)
    dailySaved: {},       // dateISO -> game in progress
    daily: {},            // dateISO -> { time, score, level } solved dailies
  };
}

const hasLS = () => { try { return typeof localStorage !== "undefined"; } catch { return false; } };

function load() {
  const st = freshState();
  if (!hasLS()) return st;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    if (raw && typeof raw === "object") {
      Object.assign(st, raw);
      st.settings = { ...DEFAULT_SETTINGS, ...(raw.settings || {}) };
      st.stats = { started: [0, 0, 0, 0, 0, 0], records: [], ...(raw.stats || {}) };
      st.dailySaved ||= {};
      st.daily ||= {};
    }
  } catch {}
  return st;
}

export const store = load();

export function save() {
  if (!hasLS()) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // quota: drop undo histories (the bulkiest part) and retry once
    try {
      if (store.saved) store.saved.history = [];
      for (const g of Object.values(store.dailySaved)) g.history = [];
      localStorage.setItem(KEY, JSON.stringify(store));
    } catch {}
  }
}

export const settings = () => store.settings;

// ---- dates (local calendar days, not UTC) ---------------------------------------

export function localISO(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  return localISO(new Date(y, m - 1, d + n));
}
export const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();   // m: 0-based

// ---- saved games -----------------------------------------------------------------

export function savedGame(daily) {
  return daily ? store.dailySaved[daily] || null : store.saved;
}
export function setSavedGame(g, daily) {
  if (daily) {
    if (g) store.dailySaved[daily] = g;
    else delete store.dailySaved[daily];
    const keys = Object.keys(store.dailySaved).sort();
    while (keys.length > DAILY_SAVES_CAP) delete store.dailySaved[keys.shift()];
  } else store.saved = g;
  save();
}

// ---- statistics (pure) --------------------------------------------------------------

/** Append a finished-game record to a stats object (mutates, returns it). */
export function addRecord(stats, rec) {
  stats.records.push(rec);
  if (stats.records.length > RECORDS_CAP) stats.records.splice(0, stats.records.length - RECORDS_CAP);
  return stats;
}

/**
 * Aggregate stats for one level (0..5) or all levels (level == null).
 * records: [{ at, level, daily, won, time, score, mistakes, hints, perfect }] oldest first.
 */
export function aggregate(stats, level = null) {
  const recs = stats.records.filter((r) => level == null || r.level === level);
  const started = level == null
    ? stats.started.reduce((a, b) => a + b, 0)
    : stats.started[level] || 0;
  const wins = recs.filter((r) => r.won);
  let cur = 0, best = 0;
  for (const r of recs) {
    cur = r.won ? cur + 1 : 0;
    best = Math.max(best, cur);
  }
  const finished = recs.length;
  return {
    started: Math.max(started, finished),
    won: wins.length,
    lost: finished - wins.length,
    winRate: Math.max(started, finished) ? wins.length / Math.max(started, finished) : 0,
    bestTime: wins.length ? Math.min(...wins.map((r) => r.time)) : null,
    avgTime: wins.length ? Math.round(wins.reduce((a, r) => a + r.time, 0) / wins.length) : null,
    bestScore: wins.length ? Math.max(...wins.map((r) => r.score)) : null,
    totalScore: wins.reduce((a, r) => a + r.score, 0),
    perfect: wins.filter((r) => r.perfect).length,
    streak: cur,
    bestStreak: best,
  };
}

/** Which personal bests a new winning record beats (compared to stats before adding it). */
export function newBests(stats, rec) {
  if (!rec.won) return [];
  const before = aggregate(stats, rec.level);
  const out = [];
  if (before.bestTime == null || rec.time < before.bestTime) out.push("time");
  if (before.bestScore == null || rec.score > before.bestScore) out.push("score");
  return out;
}

/** Consecutive solved daily challenges ending today (or yesterday if today is still open). */
export function dailyStreak(dailyMap, todayISO) {
  let d = dailyMap[todayISO] ? todayISO : addDays(todayISO, -1);
  let n = 0;
  while (dailyMap[d]) { n++; d = addDays(d, -1); }
  return n;
}

/** Longest ever run of consecutive solved dailies. */
export function bestDailyStreak(dailyMap) {
  const days = Object.keys(dailyMap).sort();
  let best = 0, cur = 0, prev = null;
  for (const d of days) {
    cur = prev && addDays(prev, 1) === d ? cur + 1 : 1;
    best = Math.max(best, cur);
    prev = d;
  }
  return best;
}

/** Every day of month m (0-based) in year y solved? */
export function monthComplete(dailyMap, y, m) {
  const p = (n) => String(n).padStart(2, "0");
  for (let d = 1; d <= daysInMonth(y, m); d++) if (!dailyMap[`${y}-${p(m + 1)}-${p(d)}`]) return false;
  return true;
}

// ---- mutations used by the UI --------------------------------------------------------

export function noteStarted(level) {
  store.stats.started[level] = (store.stats.started[level] || 0) + 1;
  save();
}

export function resetStats() {
  // the daily-challenge calendar (solved days) is kept on purpose
  store.stats = { started: [0, 0, 0, 0, 0, 0], records: [] };
  save();
}
