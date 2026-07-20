import React, { useState, useEffect, useRef } from 'react';
import { Activity, TrendingUp, TrendingDown, Zap } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';

export default function TopPickModal({ topPick, onTrade }) {
  const [open, setOpen] = useState(false);
  const lastShown = useRef(null);

  // Auto-open once per top-pick identity (pair + direction) so it isn't noisy
  useEffect(() => {
    if (!topPick) return;
    const key = `${topPick.id}-${topPick.ai_signal}`;
    if (lastShown.current === key) return;
    lastShown.current = key;
    setOpen(true);
  }, [topPick]);

  if (!topPick) return null;

  const signal = topPick.ai_signal === 'SELL' ? 'SELL' : 'BUY';
  const isBuy = signal === 'BUY';
  const confidence = topPick.ai_confidence || 0;
  const price = topPick.current_price;
  const change = topPick.change_24h;

  return (
    <Dialog open={open} onOpenChange={(o) => setOpen(o)}>
      <DialogContent className="bg-slate-900 border-amber-500/40 text-white sm:max-w-[420px] shadow-[0_0_40px_-10px_rgba(251,191,36,0.45)]">
        <div className="h-1.5 w-full rounded-t-lg bg-gradient-to-r from-amber-300 via-amber-500 to-amber-300 -mt-[1px]" />
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-300">
            <span className="relative flex h-7 w-7">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-60" />
              <span className="relative inline-flex rounded-full h-7 w-7 bg-amber-500 items-center justify-center">
                <Activity className="h-4 w-4 text-amber-950" />
              </span>
            </span>
            Top Pick Alert
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Highest-confidence setup right now
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-amber-500/20 to-amber-700/20 border border-amber-500/40 flex items-center justify-center font-bold text-amber-200">
                {topPick.symbol.substring(0, 3)}
              </div>
              <div>
                <h3 className="font-bold text-xl text-white leading-none">{topPick.symbol}</h3>
                <Badge className="mt-1 bg-amber-500/20 text-amber-300 border-0 text-[10px]">Top Pick</Badge>
              </div>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold font-mono text-white">
                {price != null ? price.toFixed(5) : '—'}
              </p>
              <div className={`flex items-center justify-end text-xs font-medium ${change >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {change >= 0 ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                {change != null ? `${change > 0 ? '+' : ''}${change.toFixed(2)}%` : '—'}
              </div>
            </div>
          </div>

          <div className="bg-slate-950/60 rounded-lg p-3 border border-slate-800">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-amber-400" /> AI Signal
              </span>
              <Badge className={`text-xs font-bold ${isBuy ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                {signal}
              </Badge>
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between text-[11px] text-slate-400">
                <span>Confidence</span>
                <span className="text-amber-300 font-semibold">{confidence}%</span>
              </div>
              <Progress
                value={confidence}
                className="h-1.5 bg-slate-800"
                indicatorClassName={isBuy ? 'bg-emerald-500' : 'bg-rose-500'}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white">
            Maybe Later
          </Button>
          <Button
            onClick={() => {
              setOpen(false);
              onTrade?.(topPick, signal);
            }}
            className={isBuy ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'}
          >
            Trade {signal} Now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}