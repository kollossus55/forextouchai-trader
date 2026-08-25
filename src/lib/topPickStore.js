// Shared in-memory store for the Pairs page's #1 Top Pick.
// The Pairs page writes its strip's exact top pick here; the global
// TopPickWatcher popup subscribes so it mirrors the strip instead of
// recomputing independently (which diverged due to timing/history diffs).

let current = null;
let updatedAt = 0;
const listeners = new Set();

const sigOf = (p) => (p ? (p.ai_signal || p.liveSignal) : undefined);
const confOf = (p) => Math.round(p ? (p.liveConfidence ?? p.ai_confidence ?? 0) : 0);

const samePick = (a, b) => {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.id === b.id && sigOf(a) === sigOf(b) && confOf(a) === confOf(b);
};

// Called by the Pairs page (and by the popup's fallback when Pairs is absent).
// updatedAt is refreshed on EVERY call so "isStale" reflects whether the Pairs
// page is actively feeding — even when the pick itself hasn't changed.
export function setTopPick(pick) {
  updatedAt = Date.now();
  const next = pick || null;
  if (samePick(current, next)) return;
  current = next;
  listeners.forEach((fn) => fn(current));
}

export function getTopPick() {
  return current;
}

export function isStale(maxAgeMs = 60000) {
  return Date.now() - updatedAt > maxAgeMs;
}

export function subscribeTopPick(fn) {
  listeners.add(fn);
  fn(current);
  return () => listeners.delete(fn);
}