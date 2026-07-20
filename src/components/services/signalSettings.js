/**
 * signalSettings — user-tunable configuration for the Pairs-tab signal engine.
 * Persists to localStorage and is read live by SignalEngine.computeSignal().
 */
import { useState, useEffect } from 'react';

export const DEFAULT_SIGNAL_SETTINGS = {
  sensitivity: 'MEDIUM',          // LOW | MEDIUM | HIGH → directional threshold
  lockMinutes: 15,               // 0 = lock disabled
  minLockConfidence: 55,         // confidence needed to lock a signal
  recalcInterval: 30,            // seconds between signal recalculations
  factors: {
    rsi:        { weight: 20, enabled: true },
    macd:       { weight: 20, enabled: true },
    bollinger:  { weight: 15, enabled: true },
    emaCross:   { weight: 20, enabled: true },
    ema200:     { weight: 15, enabled: true },
    stochastic: { weight: 10, enabled: true },
  },
};

// Maps a sensitivity level to the minimum buy%/sell% required to emit a signal.
export const SENSITIVITY_THRESHOLDS = { LOW: 50, MEDIUM: 35, HIGH: 22 };

const STORAGE_KEY = 'forextouchai_signal_settings_v1';

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_SIGNAL_SETTINGS,
        ...parsed,
        factors: { ...DEFAULT_SIGNAL_SETTINGS.factors, ...(parsed.factors || {}) },
      };
    }
  } catch (_) {}
  return JSON.parse(JSON.stringify(DEFAULT_SIGNAL_SETTINGS));
}

let current = loadSettings();
const listeners = new Set();

export function getSignalSettings() {
  return current;
}

export function getDirectionalThreshold() {
  return SENSITIVITY_THRESHOLDS[current.sensitivity] ?? SENSITIVITY_THRESHOLDS.MEDIUM;
}

export function getLockMs() {
  return (current.lockMinutes || 0) * 60 * 1000;
}

export function getMinLockConfidence() {
  return current.minLockConfidence ?? 55;
}

export function getRecalcIntervalMs() {
  return Math.max(5, current.recalcInterval || 30) * 1000;
}

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(current)); } catch (_) {}
}

export function updateSignalSettings(partial) {
  current = {
    ...current,
    ...partial,
    factors: partial.factors
      ? { ...current.factors, ...partial.factors }
      : current.factors,
  };
  persist();
  listeners.forEach((l) => l(current));
}

export function resetSignalSettings() {
  current = JSON.parse(JSON.stringify(DEFAULT_SIGNAL_SETTINGS));
  persist();
  listeners.forEach((l) => l(current));
}

export function subscribeSignalSettings(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// React hook: re-renders the component whenever settings change.
export function useSignalSettings() {
  const [settings, setSettings] = useState(getSignalSettings());
  useEffect(() => {
    const unsub = subscribeSignalSettings(setSettings);
    return unsub;
  }, []);
  return { settings, update: updateSignalSettings, reset: resetSignalSettings };
}