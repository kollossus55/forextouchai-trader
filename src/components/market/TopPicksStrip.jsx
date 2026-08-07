import React, { useState, useEffect } from 'react';
import { Crown, TrendingUp, TrendingDown, Activity, Sparkles, Lock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';

export default function TopPicksStrip({ picks, onTrade, threshold = 75, frozenAt = 0, holdMs = 120000 }) {
  // Hard guard: never render a pick below the threshold, no matter what the
  // parent passes. This is the single source of truth for what the strip shows.
  const safePicks = (picks || []).filter(p => p && p.ai_signal && p.ai_signal !== 'NEUTRAL' && (p.ai_confidence || 0) >= threshold);
  const hasPicks = safePicks.length > 0;

  // Countdown for the 2-minute composition hold. Shows the user that the
  // displayed set is a frozen snapshot and how long until it can refresh.
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (!frozenAt || !hasPicks) { setRemaining(0); return; }
    const tick = () => {
      const ms = Math.max(0, holdMs - (Date.now() - frozenAt));
      setRemaining(ms);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [frozenAt, holdMs, hasPicks]);

  const isLocked = remaining > 0 && hasPicks;
  const secs = Math.ceil(remaining / 1000);
  const mm = Math.floor(secs / 60);
  const ss = secs % 60;

  return (
    <div className={`relative rounded-2xl border-2 bg-gradient-to-br from-fuchsia-600/15 via-amber-500/15 to-cyan-500/15 p-4 shadow-[0_0_35px_-5px_rgba(245,158,11,0.35)] overflow-hidden transition-colors ${
      isLocked ? 'border-amber-400/70 animate-pulse' : 'border-amber-400/40'
    }`}>
      <div className="absolute -top-12 -right-12 w-40 h-40 bg-fuchsia-500/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-12 -left-12 w-40 h-40 bg-cyan-500/20 rounded-full blur-3xl pointer-events-none" />

      <div className="relative flex items-center gap-2 mb-3">
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-4 h-4 text-amber-300" />
          <h2 className="text-base font-extrabold bg-gradient-to-r from-amber-300 via-fuchsia-400 to-cyan-300 bg-clip-text text-transparent">
            Top Picks
          </h2>
        </div>
        <span className="text-xs text-slate-400">Highest AI confidence ≥ {threshold}%</span>
        <div className="ml-auto flex items-center gap-1.5">
          {hasPicks && (
            <span
              className="flex items-center gap-1.5 text-xs font-bold text-amber-100 bg-amber-500/30 border border-amber-400/60 rounded-full px-2.5 py-1 shadow-[0_0_12px_-2px_rgba(245,158,11,0.6)]"
              title="Composition is frozen for stability — confidence & price still update live"
            >
              <Lock className="w-3 h-3" />
              {isLocked ? `${mm}:${ss.toString().padStart(2, '0')}` : 'Refresh'}
            </span>
          )}
          <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-300 bg-emerald-500/15 border border-emerald-400/30 rounded-full px-2 py-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            LIVE
          </span>
        </div>
      </div>

      {hasPicks ? (
        <div className="relative grid grid-cols-2 md:grid-cols-4 gap-3">
          {safePicks.map((p, i) => {
            const sig = p.ai_signal;
            const isBuy = sig !== 'SELL';
            const isFirst = i === 0;
            return (
              <button
                key={p.id}
                onClick={() => onTrade(p, sig === 'SELL' ? 'SELL' : 'BUY')}
                className={`text-left rounded-xl p-3 transition-all hover:scale-[1.03] ${
                  isFirst
                    ? 'bg-gradient-to-br from-amber-500/25 to-yellow-500/10 border-2 border-amber-400/60 shadow-[0_0_20px_-3px_rgba(245,158,11,0.5)]'
                    : isBuy
                      ? 'bg-gradient-to-br from-emerald-500/20 to-teal-500/10 border border-emerald-400/40'
                      : 'bg-gradient-to-br from-rose-500/20 to-pink-500/10 border border-rose-400/40'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    {isFirst && <Crown className="w-4 h-4 text-amber-300" />}
                    <span className="font-extrabold text-white text-sm">{p.symbol}</span>
                  </div>
                  <Badge className={`text-[10px] h-5 px-1.5 ${
                    isBuy ? 'bg-emerald-500/30 text-emerald-200 border border-emerald-400/40'
                          : 'bg-rose-500/30 text-rose-200 border border-rose-400/40'
                  }`}>
                    {isBuy ? <TrendingUp className="w-3 h-3 mr-0.5" /> : <TrendingDown className="w-3 h-3 mr-0.5" />}
                    {isBuy ? 'BUY' : 'SELL'}
                  </Badge>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-300 mb-1.5">
                  <span className="font-mono">{p.current_price != null ? p.current_price.toFixed(5) : '—'}</span>
                  <span className={p.change_24h >= 0 ? 'text-emerald-300' : 'text-rose-300'}>
                    {p.change_24h != null ? `${p.change_24h > 0 ? '+' : ''}${p.change_24h.toFixed(2)}%` : ''}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Progress
                    value={p.ai_confidence || 0}
                    className="h-2 bg-slate-800"
                    indicatorClassName={isBuy ? 'bg-gradient-to-r from-emerald-400 to-teal-300' : 'bg-gradient-to-r from-rose-400 to-pink-300'}
                  />
                  <span className="text-xs font-extrabold text-amber-300 whitespace-nowrap drop-shadow">
                    {Math.round(p.ai_confidence || 0)}%
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="relative flex items-center gap-2 text-sm text-slate-300 py-4">
          <Activity className="w-4 h-4 animate-pulse text-fuchsia-400" />
          <span className="bg-gradient-to-r from-amber-300 to-fuchsia-300 bg-clip-text text-transparent font-semibold">
            Scanning markets for {threshold}%+ setups…
          </span>
        </div>
      )}
    </div>
  );
}