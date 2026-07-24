import React, { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, BarChart2, Activity, Clock, BrainCircuit } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import TickChart from '@/components/market/TickChart';
import IndicatorChips from '@/components/market/IndicatorChips';
import { useSignalSettings } from '@/components/services/signalSettings';

/**
 * Stable, memoized pair card. Hoisted out of Pairs.jsx so the 1-second
 * live-price ticks no longer recreate the component (which was forcing
 * every card + its Recharts TickChart to unmount/remount each tick and
 * freezing the tab).
 */
function PairCardInner({ pair, maxConfidence, factors, onViewDetails, onTrade }) {
  const isTopPick = (pair.ai_confidence || 0) === maxConfidence && maxConfidence > 70;
  const { settings: signalSettings } = useSignalSettings();

  const [signalAge, setSignalAge] = useState('');

  useEffect(() => {
    if (!pair.signal_timestamp) {
      setSignalAge('');
      return;
    }
    const updateAge = () => {
      const now = Date.now();
      const ageSeconds = Math.floor((now - pair.signal_timestamp) / 1000);
      if (ageSeconds < 60) setSignalAge(`${ageSeconds}s`);
      else if (ageSeconds < 3600) setSignalAge(`${Math.floor(ageSeconds / 60)}m`);
      else if (ageSeconds < 86400) setSignalAge(`${Math.floor(ageSeconds / 3600)}h`);
      else setSignalAge(`${Math.floor(ageSeconds / 86400)}d`);
    };
    updateAge();
    const interval = setInterval(updateAge, 1000);
    return () => clearInterval(interval);
  }, [pair.signal_timestamp]);

  return (
    <Card className={`bg-slate-900/50 backdrop-blur-sm transition-all group overflow-hidden ${
        isTopPick
          ? 'border-2 border-amber-400/50 shadow-[0_0_20px_-5px_rgba(251,191,36,0.2)]'
          : 'border border-slate-800 hover:border-emerald-500/30'
      }`}>
      <div className={`h-1 w-full ${
        isTopPick ? 'bg-gradient-to-r from-amber-300 via-amber-500 to-amber-300' :
        pair.ai_signal === 'BUY' ? 'bg-emerald-500' :
        pair.ai_signal === 'SELL' ? 'bg-rose-500' : 'bg-slate-700'
      }`} />
      <CardContent className="p-5 relative">
        {isTopPick && (
          <div className="absolute -top-3 -right-3">
             <span className="relative flex h-6 w-6">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-6 w-6 bg-amber-500 items-center justify-center">
                   <Activity className="h-3 w-3 text-amber-950" />
                </span>
             </span>
          </div>
        )}
        <div className="flex justify-between items-start mb-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 flex items-center justify-center font-bold text-slate-200 shadow-inner">
              {pair.symbol.substring(0,3)}
            </div>
            <div>
              <h3 className="font-bold text-lg text-white leading-none flex items-center gap-2">
                {pair.symbol}
                {isTopPick && <Badge className="bg-amber-500/20 text-amber-300 border-0 text-[10px] px-1 py-0 h-4">Top Pick</Badge>}
              </h3>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline" className="text-[10px] h-5 border-slate-700 text-slate-400">
                  {pair.spread != null ? `${pair.spread} pips` : '—'}
                </Badge>
              </div>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xl font-bold tracking-tight font-mono transition-colors duration-300 text-white">
              {pair.current_price != null ? pair.current_price.toFixed(5) : '—'}
            </p>
            <div className={`flex items-center justify-end text-xs font-medium ${(pair.change_24h ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {(pair.change_24h ?? 0) >= 0 ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
              {pair.change_24h != null ? `${pair.change_24h > 0 ? '+' : ''}${pair.change_24h.toFixed(2)}%` : '—'}
            </div>
          </div>
        </div>

        {/* Tick Chart */}
        <div className="mb-4">
           <TickChart
              data={pair.history}
              color={(pair.change_24h ?? 0) >= 0 ? '#10b981' : '#f43f5e'}
           />
        </div>

        {/* Signal Section */}
        <div className="bg-slate-950/50 rounded-lg p-3 border border-slate-800/50 mb-4">
          <div className="flex justify-between items-center mb-2">
            <div className="flex items-center gap-1.5">
              <BrainCircuit className="w-3.5 h-3.5 text-purple-400" />
              <span className="text-xs font-semibold text-slate-300">Technical Signal</span>
            </div>
            <div className="flex items-center gap-1.5">
              {signalAge && (
                <div className="flex items-center gap-1 text-[10px] text-slate-500 font-mono">
                  <Clock className="w-3 h-3" />
                  <span>{signalAge}</span>
                </div>
              )}
              <Badge className={`text-[10px] h-5 px-2 font-bold ${
                pair.ai_signal === 'BUY'  ? 'bg-emerald-500/20 text-emerald-400' :
                pair.ai_signal === 'SELL' ? 'bg-rose-500/20 text-rose-400' :
                'bg-slate-700/20 text-slate-400'
              }`}>
                {pair.ai_signal || 'NEUTRAL'}
              </Badge>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between text-[10px] text-slate-400">
              <span>Indicator Confidence</span>
              <span className={pair.ai_confidence > 80 ? 'text-emerald-400' : pair.ai_confidence > 65 ? 'text-amber-400' : 'text-slate-300'}>
                {pair.ai_confidence || 0}%
              </span>
            </div>
            <Progress
              value={pair.ai_confidence || 0}
              className="h-1 bg-slate-800"
              indicatorClassName={pair.ai_signal === 'SELL' ? 'bg-rose-500' : pair.ai_signal === 'BUY' ? 'bg-emerald-500' : 'bg-slate-600'}
            />
            {/* Indicator chips — colour by direction, faded if disabled */}
            <IndicatorChips factors={factors} settings={signalSettings} variant="card" />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Button
            variant="outline"
            className="bg-slate-800/30 hover:bg-slate-700 text-slate-300 hover:text-white border-slate-700 transition-all text-xs"
            onClick={() => onViewDetails(pair)}
          >
            <BarChart2 className="w-3.5 h-3.5 mr-1" /> Indicators
          </Button>
          <Button
            className="bg-emerald-600/10 hover:bg-emerald-600 text-emerald-500 hover:text-white border border-emerald-600/20 transition-all"
            onClick={() => onTrade(pair, 'BUY')}
          >
            Buy
          </Button>
          <Button
            className="bg-rose-600/10 hover:bg-rose-600 text-rose-500 hover:text-white border border-rose-600/20 transition-all"
            onClick={() => onTrade(pair, 'SELL')}
          >
            Sell
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Memoize so a card only re-renders when its own props change. Combined with
// stable callbacks from Pairs.jsx, unchanged cards skip rendering entirely.
const PairCard = React.memo(PairCardInner);
export default PairCard;