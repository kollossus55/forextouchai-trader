import React from 'react';
import { Crown, TrendingUp, TrendingDown, Activity } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';

export default function TopPicksStrip({ picks, onTrade }) {
  const hasPicks = picks && picks.length > 0;

  return (
    <div className="rounded-xl border border-amber-500/30 bg-gradient-to-br from-amber-500/5 via-slate-900/40 to-slate-900/40 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Crown className="w-4 h-4 text-amber-400" />
        <h2 className="text-sm font-bold text-amber-300">Top Picks</h2>
        <span className="text-xs text-slate-500">Highest AI confidence right now</span>
      </div>

      {hasPicks ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {picks.map((p, i) => {
            const isBuy = p.ai_signal !== 'SELL';
            return (
              <button
                key={p.id}
                onClick={() => onTrade(p, p.ai_signal === 'SELL' ? 'SELL' : 'BUY')}
                className="text-left rounded-lg border border-slate-800 bg-slate-950/60 p-3 hover:border-amber-500/40 hover:bg-slate-900 transition-all"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    {i === 0 && <Crown className="w-3.5 h-3.5 text-amber-400" />}
                    <span className="font-bold text-white text-sm">{p.symbol}</span>
                  </div>
                  <Badge className={`text-[10px] h-4 px-1.5 ${isBuy ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                    {isBuy ? <TrendingUp className="w-3 h-3 mr-0.5" /> : <TrendingDown className="w-3 h-3 mr-0.5" />}
                    {isBuy ? 'BUY' : 'SELL'}
                  </Badge>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1.5">
                  <span className="font-mono">{p.current_price != null ? p.current_price.toFixed(5) : '—'}</span>
                  <span className={p.change_24h >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                    {p.change_24h != null ? `${p.change_24h > 0 ? '+' : ''}${p.change_24h.toFixed(2)}%` : ''}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Progress
                    value={p.ai_confidence || 0}
                    className="h-1.5 bg-slate-800"
                    indicatorClassName={isBuy ? 'bg-emerald-500' : 'bg-rose-500'}
                  />
                  <span className="text-[10px] text-amber-300 font-semibold whitespace-nowrap">
                    {Math.round(p.ai_confidence || 0)}%
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-xs text-slate-500 py-3">
          <Activity className="w-3.5 h-3.5 animate-pulse text-amber-400" />
          Scanning markets for high-confidence setups…
        </div>
      )}
    </div>
  );
}