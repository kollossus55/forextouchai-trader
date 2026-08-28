import React from 'react';
import { Switch } from '@/components/ui/switch';
import { BarChart } from 'lucide-react';

// SP500_AI uses dedicated deterministic gates (sp500_use_* fields).
const SP500_ITEMS = [
  ['sp500_use_ha', 'Heikin-Ashi', 'Candle direction gate'],
  ['sp500_use_ssl', 'SSL Channel', 'Trend direction gate'],
  ['sp500_use_ai_rsi', 'AI RSI', 'Momentum RSI gate'],
  ['sp500_use_tmo', 'TMO Momentum', 'Trend momentum oscillator gate'],
  ['sp500_use_sd', 'Supply/Demand Zone', 'Only trade in the direction of a confirmed institutional zone'],
];

// AI-driven strategies: tailored indicator sets per strategy (ind_use_* fields).
const AI_STRATEGY_ITEMS = {
  SCALPING: [
    ['ind_use_rsi', 'RSI', 'Overbought / oversold extremes'],
    ['ind_use_macd', 'MACD', 'M5 histogram direction'],
    ['ind_use_bollinger', 'Bollinger Bands', 'Touches & squeezes'],
    ['ind_use_stochastic', 'Stochastic', 'Short-term entry timing'],
    ['ind_use_ema', 'EMA', 'Micro-trend direction'],
  ],
  SWING: [
    ['ind_use_ema', 'EMA Stack', 'D1/H4 trend bias'],
    ['ind_use_rsi', 'RSI & Divergence', 'Momentum & reversal'],
    ['ind_use_macd', 'MACD', 'D1 momentum shifts'],
    ['ind_use_adx', 'ADX', 'Trending vs ranging regime'],
    ['ind_use_bollinger', 'Bollinger Bands', 'Squeeze / overextension'],
    ['ind_use_fibonacci', 'Fibonacci', 'Retracement confluence'],
    ['ind_use_structure', 'Market Structure', 'BOS / CHoCH / OB / FVG / S&D'],
    ['ind_use_chart_patterns', 'Chart Patterns', 'Reversal & continuation'],
    ['ind_use_candlestick', 'Candlestick', 'D1/H4 confirmation'],
    ['ind_use_session_timing', 'Session Timing', 'London / NY windows'],
  ],
  DAY_TRADING: [
    ['ind_use_ema', 'EMA Stack', 'H1 intraday trend'],
    ['ind_use_vwap', 'VWAP', 'Intraday value bias'],
    ['ind_use_rsi', 'RSI', 'H1 / M30 momentum'],
    ['ind_use_macd', 'MACD', 'H1 momentum confirm'],
    ['ind_use_stochastic', 'Stochastic', 'M30 entry timing'],
    ['ind_use_bollinger', 'Bollinger Bands', 'Squeeze / bands'],
    ['ind_use_atr', 'ATR', 'Volatility / reach TP'],
    ['ind_use_structure', 'Market Structure', 'H1 BOS / CHoCH / OB / FVG'],
    ['ind_use_candlestick', 'Candlestick', 'H1 / M30 confirmation'],
    ['ind_use_session_timing', 'Session Timing', 'London / NY windows'],
  ],
  PRICE_ACTION: [
    ['ind_use_structure', 'Market Structure', 'BOS / CHoCH'],
    ['ind_use_liquidity', 'Liquidity Sweeps', 'Stop hunts / equal H-L'],
    ['ind_use_candlestick', 'Candlestick Triggers', 'Pin bar / engulfing / inside'],
    ['ind_use_fibonacci', 'Fibonacci', '50% / 61.8% confluence'],
    ['ind_use_session_timing', 'Session Timing', 'London / NY windows'],
  ],
  PATTERN_TRADING: [
    ['ind_use_chart_patterns', 'Chart Patterns', 'Reversal & continuation'],
    ['ind_use_candlestick', 'Candlestick', 'Breakout confirmation'],
    ['ind_use_fibonacci', 'Fibonacci', 'Measured move / confluence'],
    ['ind_use_structure', 'Market Structure', 'D1 bias / key levels'],
    ['ind_use_session_timing', 'Session Timing', 'London / NY windows'],
  ],
  CANDLESTICK: [
    ['ind_use_candlestick', 'Candlestick Patterns', 'Single & multi-candle'],
    ['ind_use_structure', 'Market Structure', 'D1/H4 bias & key levels'],
    ['ind_use_fibonacci', 'Fibonacci', 'Retracement confluence'],
    ['ind_use_ema', 'EMA', 'D1 trend bias'],
    ['ind_use_session_timing', 'Session Timing', 'London / NY windows'],
  ],
  HYBRID_ALL: [
    ['ind_use_ema', 'EMA Stack', 'H1 trend alignment'],
    ['ind_use_rsi', 'RSI', 'Zones & divergence'],
    ['ind_use_macd', 'MACD', 'Histogram / crossover'],
    ['ind_use_stochastic', 'Stochastic', 'Entry timing'],
    ['ind_use_cci', 'CCI', 'Momentum extremes'],
    ['ind_use_bollinger', 'Bollinger Bands', 'Squeeze / bands'],
    ['ind_use_atr', 'ATR', 'Volatility filter'],
    ['ind_use_chart_patterns', 'Chart Patterns', 'Reversal & continuation'],
    ['ind_use_candlestick', 'Candlestick', 'Key-level confirmation'],
    ['ind_use_fibonacci', 'Fibonacci', 'Confluence zones'],
    ['ind_use_structure', 'Market Structure', 'BOS / CHoCH / OB / FVG / S&D'],
    ['ind_use_liquidity', 'Liquidity', 'Sweeps / stop hunts'],
    ['ind_use_session_timing', 'Session Timing', 'London / NY windows'],
  ],
  AI_PREDICTIVE: [
    ['ind_use_ema', 'EMA Stack', 'H1 / H4 alignment'],
    ['ind_use_rsi', 'RSI', 'Zones & divergence'],
    ['ind_use_macd', 'MACD', 'Histogram / crossover'],
    ['ind_use_stochastic', 'Stochastic', 'Entry timing'],
    ['ind_use_bollinger', 'Bollinger Bands', 'Squeeze / bands'],
    ['ind_use_atr', 'ATR', 'Volatility context'],
    ['ind_use_chart_patterns', 'Chart Patterns', 'Reversal & continuation'],
    ['ind_use_candlestick', 'Candlestick', 'Key-level confirmation'],
    ['ind_use_fibonacci', 'Fibonacci', 'Confluence zones'],
    ['ind_use_structure', 'Market Structure', 'BOS / CHoCH / OB / FVG / S&D'],
    ['ind_use_liquidity', 'Liquidity', 'Sweeps / stop hunts'],
    ['ind_use_session_timing', 'Session Timing', 'London / NY overlap'],
  ],
  GOLD_XAUUSD: [
    ['ind_use_ema', 'EMA', 'H1 trend alignment'],
    ['ind_use_rsi', 'RSI', 'M15 / H1 momentum'],
    ['ind_use_macd', 'MACD', 'H1 histogram'],
    ['ind_use_stochastic', 'Stochastic', 'M15 entry timing'],
    ['ind_use_cci', 'CCI', 'Momentum extremes'],
    ['ind_use_bollinger', 'Bollinger Bands', 'Gold squeeze / bands'],
    ['ind_use_atr', 'ATR', 'Gold volatility sizing'],
    ['ind_use_structure', 'Market Structure', 'Structure & key levels'],
    ['ind_use_candlestick', 'Candlestick', 'M15 / H1 confirmation'],
    ['ind_use_session_timing', 'Session Timing', 'London / NY gold windows'],
  ],
  SILVER_XAGUSD: [
    ['ind_use_ema', 'EMA', 'H1 trend alignment'],
    ['ind_use_rsi', 'RSI', 'M15 / H1 momentum'],
    ['ind_use_macd', 'MACD', 'H1 histogram'],
    ['ind_use_stochastic', 'Stochastic', 'M15 entry timing'],
    ['ind_use_cci', 'CCI', 'Momentum extremes'],
    ['ind_use_bollinger', 'Bollinger Bands', 'Silver squeeze / bands'],
    ['ind_use_atr', 'ATR', 'Silver volatility sizing'],
    ['ind_use_structure', 'Market Structure', 'Structure & key levels'],
    ['ind_use_candlestick', 'Candlestick', 'M15 / H1 confirmation'],
    ['ind_use_session_timing', 'Session Timing', 'London / NY silver windows'],
  ],
};

export default function IndicatorToggles({ strategy, formData, setFormData }) {
  if (strategy === 'SP500_AI') {
    return (
      <div className="p-4 rounded border border-cyan-800/40 bg-cyan-950/20 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <BarChart className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-medium text-cyan-300">SP500 Indicator Confluence</span>
        </div>
        <p className="text-[11px] text-slate-400">Toggle which indicators must confirm a signal. Keep all ON for the strict confluence, or turn some OFF to trade on fewer confirmations. <span className="text-cyan-400">Supply/Demand</span> is a hard directional gate — when ON, the bot only trades in the direction of a confirmed institutional zone.</p>
        <div className="grid grid-cols-2 gap-3 pt-1">
          {SP500_ITEMS.map(([key, label, desc]) => (
            <div key={key} className="flex items-center justify-between p-2 rounded bg-slate-950/50 border border-slate-800">
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-medium text-slate-200">{label}</span>
                <span className="text-[10px] text-slate-500">{desc}</span>
              </div>
              <Switch checked={formData[key] !== false} onCheckedChange={v => setFormData({ ...formData, [key]: v })} className="data-[state=checked]:bg-cyan-600 ml-2 shrink-0" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const items = AI_STRATEGY_ITEMS[strategy];
  if (!items || !items.length) return null;

  return (
    <div className="p-4 rounded border border-emerald-800/40 bg-emerald-950/10 space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <BarChart className="w-4 h-4 text-emerald-400" />
        <span className="text-sm font-medium text-emerald-300">Required Indicators</span>
      </div>
      <p className="text-[11px] text-slate-400">Toggle which indicators the AI must require and weight. Turn OFF any you don't want blocking signals — the AI will only require confluence from the enabled ones.</p>
      <div className="grid grid-cols-2 gap-3 pt-1">
        {items.map(([key, label, desc]) => (
          <div key={key} className="flex items-center justify-between p-2 rounded bg-slate-950/50 border border-slate-800">
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-medium text-slate-200">{label}</span>
              <span className="text-[10px] text-slate-500">{desc}</span>
            </div>
            <Switch checked={formData[key] !== false} onCheckedChange={v => setFormData({ ...formData, [key]: v })} className="data-[state=checked]:bg-emerald-600 ml-2 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}