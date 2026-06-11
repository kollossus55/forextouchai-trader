import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

export default function IndicatorPanel({ indicators, currentPrice }) {
  if (!indicators) return null;

  const getRSIStatus = (rsi) => {
    if (rsi < 30) return { label: 'Oversold', color: 'text-emerald-400', bg: 'bg-emerald-500/20' };
    if (rsi > 70) return { label: 'Overbought', color: 'text-rose-400', bg: 'bg-rose-500/20' };
    return { label: 'Neutral', color: 'text-slate-400', bg: 'bg-slate-500/20' };
  };

  const getMACDSignal = (histogram) => {
    if (histogram > 0) return { label: 'Bullish', color: 'text-emerald-400', icon: TrendingUp };
    if (histogram < 0) return { label: 'Bearish', color: 'text-rose-400', icon: TrendingDown };
    return { label: 'Neutral', color: 'text-slate-400', icon: Minus };
  };

  const getBBPosition = (percentB) => {
    if (percentB < 0) return { label: 'Below Band', color: 'text-emerald-400' };
    if (percentB > 100) return { label: 'Above Band', color: 'text-rose-400' };
    return { label: 'Within Bands', color: 'text-slate-400' };
  };

  const getStochasticStatus = (k) => {
    if (k < 20) return { label: 'Oversold', color: 'text-emerald-400' };
    if (k > 80) return { label: 'Overbought', color: 'text-rose-400' };
    return { label: 'Neutral', color: 'text-slate-400' };
  };

  const rsiStatus = getRSIStatus(indicators.rsi);
  const macdSignal = getMACDSignal(indicators.macd?.histogram || 0);
  const bbPosition = getBBPosition(indicators.bollingerBands?.percentB || 50);
  const stochStatus = getStochasticStatus(indicators.stochastic?.k || 50);
  const ema200Val = typeof indicators.ema200 === 'object' ? indicators.ema200?.value : indicators.ema200;
  const priceVsEMA = currentPrice > ema200Val ? 'Above' : 'Below';

  return (
    <div className="space-y-3">
      {/* RSI */}
      <div className="bg-slate-950/50 rounded-lg p-3 border border-slate-800/50">
        <div className="flex justify-between items-center mb-2">
          <span className="text-xs font-medium text-slate-400">RSI (14)</span>
          <Badge className={`text-[10px] h-5 ${rsiStatus.bg} ${rsiStatus.color} border-0`}>
            {rsiStatus.label}
          </Badge>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-white font-mono">{indicators.rsi?.toFixed(1) || 50}</span>
          <Progress 
            value={indicators.rsi || 50} 
            className="h-1.5 flex-1 bg-slate-800" 
            indicatorClassName={indicators.rsi < 30 ? 'bg-emerald-500' : indicators.rsi > 70 ? 'bg-rose-500' : 'bg-blue-500'} 
          />
        </div>
      </div>

      {/* MACD */}
      <div className="bg-slate-950/50 rounded-lg p-3 border border-slate-800/50">
        <div className="flex justify-between items-center mb-2">
          <span className="text-xs font-medium text-slate-400">MACD (12,26,9)</span>
          <Badge className={`text-[10px] h-5 flex items-center gap-1 ${macdSignal.color} bg-slate-800 border-slate-700`}>
            {React.createElement(macdSignal.icon, { className: 'w-3 h-3' })}
            {macdSignal.label}
          </Badge>
        </div>
        <div className="grid grid-cols-3 gap-2 text-[10px]">
          <div>
            <span className="text-slate-500 block">MACD</span>
            <span className="text-slate-300 font-mono">{indicators.macd?.value?.toFixed(4) || 0}</span>
          </div>
          <div>
            <span className="text-slate-500 block">Signal</span>
            <span className="text-slate-300 font-mono">{indicators.macd?.signal?.toFixed(4) || 0}</span>
          </div>
          <div>
            <span className="text-slate-500 block">Histogram</span>
            <span className={`font-mono font-bold ${indicators.macd?.histogram > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {indicators.macd?.histogram?.toFixed(4) || 0}
            </span>
          </div>
        </div>
      </div>

      {/* Bollinger Bands */}
      <div className="bg-slate-950/50 rounded-lg p-3 border border-slate-800/50">
        <div className="flex justify-between items-center mb-2">
          <span className="text-xs font-medium text-slate-400">Bollinger Bands</span>
          <Badge className={`text-[10px] h-5 ${bbPosition.color} bg-slate-800 border-slate-700`}>
            {bbPosition.label}
          </Badge>
        </div>
        <div className="space-y-1 text-[10px]">
          <div className="flex justify-between">
            <span className="text-slate-500">Upper</span>
            <span className="text-slate-300 font-mono">{indicators.bollingerBands?.upper?.toFixed(5) || 0}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Middle</span>
            <span className="text-slate-300 font-mono">{indicators.bollingerBands?.middle?.toFixed(5) || 0}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Lower</span>
            <span className="text-slate-300 font-mono">{indicators.bollingerBands?.lower?.toFixed(5) || 0}</span>
          </div>
          <div className="flex justify-between pt-1 border-t border-slate-800">
            <span className="text-slate-500">%B</span>
            <span className="text-white font-mono font-bold">{indicators.bollingerBands?.percentB?.toFixed(1) || 0}%</span>
          </div>
        </div>
      </div>

      {/* Stochastic & EMA */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-slate-950/50 rounded-lg p-3 border border-slate-800/50">
          <div className="text-xs font-medium text-slate-400 mb-2">Stochastic</div>
          <Badge className={`text-[10px] h-5 mb-2 ${stochStatus.color} bg-slate-800 border-slate-700`}>
            {stochStatus.label}
          </Badge>
          <div className="space-y-1 text-[10px]">
            <div className="flex justify-between">
              <span className="text-slate-500">%K</span>
              <span className="text-white font-mono">{indicators.stochastic?.k?.toFixed(1) || 50}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">%D</span>
              <span className="text-white font-mono">{indicators.stochastic?.d?.toFixed(1) || 50}</span>
            </div>
          </div>
        </div>

        <div className="bg-slate-950/50 rounded-lg p-3 border border-slate-800/50">
          <div className="text-xs font-medium text-slate-400 mb-2">EMA (200)</div>
          <Badge className={`text-[10px] h-5 mb-2 ${currentPrice > ema200Val ? 'text-emerald-400' : 'text-rose-400'} bg-slate-800 border-slate-700`}>
            Price {priceVsEMA}
          </Badge>
          <div className="text-[10px]">
            <div className="flex justify-between">
              <span className="text-slate-500">Value</span>
              <span className="text-white font-mono">{ema200Val ? Number(ema200Val).toFixed(5) : '—'}</span>
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-slate-500">Distance</span>
              <span className={`font-mono font-bold ${currentPrice > ema200Val ? 'text-emerald-400' : 'text-rose-400'}`}>
                {ema200Val ? (((currentPrice - ema200Val) / ema200Val) * 100).toFixed(2) + '%' : '—'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}