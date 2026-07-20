import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, TrendingUp, TrendingDown, Zap, X, ArrowRight } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { MarketDataService } from '@/components/services/MarketDataService';
import { computeSignal } from '@/components/services/SignalEngine';
import { useSignalSettings } from '@/components/services/signalSettings';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { createPageUrl } from '@/utils';

const MAJOR = ['EURUSD','GBPUSD','USDJPY','USDCHF','AUDUSD','USDCAD','NZDUSD','XAUUSD'];
const MINOR = ['EURGBP','EURJPY','GBPJPY','EURCHF','AUDJPY','GBPCHF','EURAUD','EURCAD','EURNZD','GBPAUD','GBPCAD','GBPNZD','AUDCAD','AUDCHF','AUDNZD','CADCHF','CADJPY','CHFJPY','NZDCAD','NZDCHF','NZDJPY'];
const isForex = (sym) => {
  const s = (sym || '').replace('/', '').toUpperCase();
  return MAJOR.includes(s) || MINOR.includes(s);
};

export default function TopPickWatcher() {
  const navigate = useNavigate();
  const { settings } = useSignalSettings();
  const [topPick, setTopPick] = useState(null);
  const [visible, setVisible] = useState(false);
  const lastShown = useRef(null);
  const timeframe = 'H1';

  // Shared query cache with the Pairs page → navigating to Pairs is instant
  const { data: pairs } = useQuery({
    queryKey: ['pairs'],
    queryFn: () => base44.entities.CurrencyPair.list(),
    staleTime: 30000,
    refetchInterval: 60000,
    initialData: [],
  });

  useEffect(() => {
    if (!pairs || pairs.length === 0) return;
    let active = true;
    let timer, interval;
    MarketDataService.initialize();

    const compute = async () => {
      await MarketDataService.fetchAll();
      let best = null;
      pairs.forEach(pair => {
        if (!isForex(pair.symbol)) return;
        const price = MarketDataService.getPrice(pair.symbol) || pair.current_price || 1;
        const result = computeSignal(pair.symbol, timeframe, price);
        const conf = result.confidence || 0;
        if (conf > 70 && (!best || conf > best.ai_confidence)) {
          best = { ...pair, current_price: price, ai_signal: result.signal, ai_confidence: conf, change_24h: pair.change_24h };
        }
      });
      if (!active) return;
      setTopPick(best);
      if (best) {
        const key = `${best.id}-${best.ai_signal}`;
        if (lastShown.current !== key) {
          lastShown.current = key;
          setVisible(true);
        }
      }
    };

    timer = setTimeout(compute, 1500);
    interval = setInterval(compute, (settings.recalcInterval || 30) * 1000);
    return () => { active = false; clearTimeout(timer); clearInterval(interval); };
  }, [pairs, settings.recalcInterval]);

  const dismiss = () => setVisible(false);

  return (
    <AnimatePresence>
      {visible && topPick && (
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.95 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="fixed bottom-4 right-4 z-[100] w-[320px] max-w-[calc(100vw-2rem)]"
        >
          <div className="rounded-xl border-2 border-amber-400/50 bg-slate-900/95 backdrop-blur-md shadow-[0_0_30px_-6px_rgba(251,191,36,0.45)] overflow-hidden">
            <div className="h-1.5 w-full bg-gradient-to-r from-amber-300 via-amber-500 to-amber-300" />
            <div className="p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-6 w-6">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-60" />
                    <span className="relative inline-flex rounded-full h-6 w-6 bg-amber-500 items-center justify-center">
                      <Activity className="h-3.5 w-3.5 text-amber-950" />
                    </span>
                  </span>
                  <span className="text-sm font-bold text-amber-300">Top Pick Alert</span>
                </div>
                <button onClick={dismiss} className="text-slate-500 hover:text-slate-300 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-500/20 to-amber-700/20 border border-amber-500/40 flex items-center justify-center font-bold text-amber-200 text-sm">
                    {topPick.symbol.substring(0, 3)}
                  </div>
                  <div>
                    <h3 className="font-bold text-lg text-white leading-none">{topPick.symbol}</h3>
                    <Badge className="mt-1 bg-amber-500/20 text-amber-300 border-0 text-[10px] px-1.5 py-0 h-4">Top Pick</Badge>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold font-mono text-white leading-none">
                    {topPick.current_price != null ? topPick.current_price.toFixed(5) : '—'}
                  </p>
                  <div className={`flex items-center justify-end text-[11px] font-medium mt-1 ${topPick.change_24h >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {topPick.change_24h >= 0 ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                    {topPick.change_24h != null ? `${topPick.change_24h > 0 ? '+' : ''}${topPick.change_24h.toFixed(2)}%` : '—'}
                  </div>
                </div>
              </div>

              <div className="bg-slate-950/60 rounded-lg p-2.5 border border-slate-800 mb-3">
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                    <Zap className="w-3 h-3 text-amber-400" /> AI Signal
                  </span>
                  <Badge className={`text-[10px] font-bold ${topPick.ai_signal !== 'SELL' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                    {topPick.ai_signal !== 'SELL' ? 'BUY' : 'SELL'}
                  </Badge>
                </div>
                <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                  <span>Confidence</span>
                  <span className="text-amber-300 font-semibold">{topPick.ai_confidence}%</span>
                </div>
                <Progress
                  value={topPick.ai_confidence}
                  className="h-1.5 bg-slate-800"
                  indicatorClassName={topPick.ai_signal !== 'SELL' ? 'bg-emerald-500' : 'bg-rose-500'}
                />
              </div>

              <Button
                onClick={() => { dismiss(); navigate(createPageUrl('Pairs')); }}
                className="w-full bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold"
              >
                Open in Pairs <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}