// Shared metadata for the six SignalEngine indicators, plus a mapper from a
// computed factor's display name back to its settings key. Used by the
// IndicatorChips component (pair cards + details modal) so both views agree on
// labels and enabled/disabled status.

export const INDICATORS = [
  { key: 'emaCross', label: 'EMA 20/50', short: 'EMA' },
  { key: 'macd', label: 'MACD', short: 'MACD' },
  { key: 'ema200', label: 'EMA 200', short: '200' },
  { key: 'rsi', label: 'RSI', short: 'RSI' },
  { key: 'bollinger', label: 'Bollinger', short: 'BB' },
  { key: 'stochastic', label: 'Stochastic', short: 'Stoch' },
];

const NAME_RULES = [
  [/^RSI/i, 'rsi'],
  [/MACD/i, 'macd'],
  [/(^BB|Bollinger)/i, 'bollinger'],
  [/EMA20/i, 'emaCross'],
  [/EMA200/i, 'ema200'],
  [/Stoch/i, 'stochastic'],
];

export function factorKey(name) {
  if (!name) return null;
  for (const [re, key] of NAME_RULES) if (re.test(name)) return key;
  return null;
}