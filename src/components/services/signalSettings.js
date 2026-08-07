/**
 * signalSettings — user-tunable configuration for the Pairs-tab signal engine.
 * Persists to localStorage and is read live by SignalEngine.computeSignal().
 */
import { useState, useEffect } from 'react';

export const DEFAULT_SIGNAL_SETTINGS = {
  sensitivity: 'MEDIUM',          // LOW | MEDIUM | HIGH → directional threshold
  lockMinutes: 30,               // hold directional signals 30 min to ride trends
  minLockConfidence: 60,         // only lock confluence-backed signals
  recalcInterval: 15,            // recompute every 15s for responsiveness
  topPickConfidence: 75,         // min AI confidence for a pair to qualify as a Top Pick
  minIndicatorAgreement: 3,     // min number of indicators that must agree on direction to validate a manual trade
  factors: {
    // Trend confirmation is the strongest, most reliable driver for forex pairs.
    emaCross:   { weight: 25, enabled: true },   // primary EMA20/50 trend signal
    macd:       { weight: 22, enabled: true },   // momentum confirmation
    ema200:     { weight: 18, enabled: true },   // higher-timeframe trend bias
    rsi:        { weight: 15, enabled: true },   // momentum / exhaustion
    bollinger:  { weight: 12, enabled: true },   // mean-reversion / volatility
    stochastic: { weight: 8,  enabled: true },    // noisiest oscillator — lowest weight
  },
};

// Maps a sensitivity level to the minimum buy%/sell% required to emit a signal.
export const SENSITIVITY_THRESHOLDS = { LOW: 50, MEDIUM: 35, HIGH: 22 };

const STORAGE_KEY = 'forextouchai_signal_settings_v3';

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

export function getTopPickConfidence() {
  return Math.min(100, Math.max(0, current.topPickConfidence ?? 75));
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