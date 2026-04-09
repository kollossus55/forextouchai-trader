import React, { useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowUpRight, ArrowDownRight, Target, Shield, Play, CheckCircle2, Clock, BarChart2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import IndicatorPanel from '@/components/market/IndicatorPanel';

export default function SignalCard({ signal, onExecute }) {
  const isBuy = signal.type === 'BUY';
  const isPending = signal.status === 'PENDING';
  const isActive = signal.status === 'ACTIVE';
  const [lotSize, setLotSize] = useState(signal.lot_size || 0.01);
  const [slTpMode, setSlTpMode] = useState('FIXED'); // 'FIXED' | 'ATR'
  const [atrMultiplierSL, setAtrMultiplierSL] = useState(1.5);
  const [atrMultiplierTP, setAtrMultiplierTP] = useState(3.0);

  // Calculate ATR-based SL/TP using a simple price-volatility estimate
  const atrSlTp = useMemo(() => {
    const price = signal.entry_price || 0;
    if (!price) return { sl: signal.stop_loss, tp: signal.take_profit };
    // Approximate ATR as ~0.15% of price (typical H1 ATR)
    const atr = price * 0.0015;
    const pipSize = price > 50 ? 0.01 : 0.0001;
    const sl = isBuy ? price - atr * atrMultiplierSL : price + atr * atrMultiplierSL;
    const tp = isBuy ? price + atr * atrMultiplierTP : price - atr * atrMultiplierTP;
    return { sl: parseFloat(sl.toFixed(5)), tp: parseFloat(tp.toFixed(5)) };
  }, [signal.entry_price, isBuy, atrMultiplierSL, atrMultiplierTP]);

  const activeSL = slTpMode === 'ATR' ? atrSlTp.sl : (signal.stop_loss || 0);
  const activeTP = slTpMode === 'ATR' ? atrSlTp.tp : (signal.take_profit || 0);
  
  return (
    <Card className="bg-slate-900/40 border-slate-800 hover:border-slate-700 transition-all group">
      <CardContent className="p-4">
        <div className="flex justify-between items-start mb-3">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center border ${
              isBuy 
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' 
                : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
            }`}>
              {isBuy ? <ArrowUpRight className="w-5 h-5" /> : <ArrowDownRight className="w-5 h-5" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-200">{signal.pair}</span>
                <Badge variant="outline" className={`text-[10px] h-5 ${
                  isBuy ? 'text-emerald-400 border-emerald-500/30' : 'text-rose-400 border-rose-500/30'
                }`}>
                  {signal.type}
                </Badge>
              </div>
              <span className="text-xs text-slate-500">{new Date(signal.created_date || Date.now()).toLocaleTimeString()}</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-400 mb-0.5">Confidence</div>
            <span className={`font-bold ${signal.confidence > 80 ? 'text-emerald-400' : 'text-amber-400'}`}>
              {signal.confidence}%
            </span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="bg-slate-950/50 p-2 rounded border border-slate-800/50">
            <div className="text-[10px] text-slate-500 mb-0.5">Entry</div>
            <div className="font-mono text-sm text-slate-300">{signal.entry_price}</div>
          </div>
          <div className={`bg-slate-950/50 p-2 rounded border ${slTpMode === 'ATR' ? 'border-amber-500/40' : 'border-slate-800/50'}`}>
            <div className="flex items-center gap-1 text-[10px] text-rose-400/70 mb-0.5">
              <Shield className="w-3 h-3" /> SL
            </div>
            <div className="font-mono text-sm text-slate-300">{activeSL}</div>
          </div>
          <div className={`bg-slate-950/50 p-2 rounded border ${slTpMode === 'ATR' ? 'border-amber-500/40' : 'border-slate-800/50'}`}>
            <div className="flex items-center gap-1 text-[10px] text-emerald-400/70 mb-0.5">
              <Target className="w-3 h-3" /> TP
            </div>
            <div className="font-mono text-sm text-slate-300">{activeTP}</div>
          </div>
        </div>

        {signal.status === 'ANALYSIS' ? (
            <div className="space-y-2">
                {/* SL/TP Mode Toggle */}
                <div className="flex items-center gap-1 bg-slate-950/60 rounded-lg p-1">
                    {['FIXED', 'ATR'].map(mode => (
                        <button
                            key={mode}
                            onClick={() => setSlTpMode(mode)}
                            className={`flex-1 text-[10px] font-semibold py-1 rounded transition-all ${
                                slTpMode === mode
                                    ? mode === 'ATR' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-slate-700 text-white'
                                    : 'text-slate-500 hover:text-slate-300'
                            }`}
                        >
                            {mode === 'FIXED' ? 'Fixed Pips' : 'ATR Based'}
                        </button>
                    ))}
                </div>

                {/* ATR Multiplier inputs */}
                {slTpMode === 'ATR' && (
                    <div className="flex gap-2">
                        <div className="flex-1">
                            <label className="text-[10px] text-slate-400 mb-1 block">ATR × SL</label>
                            <Input
                                type="number" step="0.1" min="0.5" max="5"
                                value={atrMultiplierSL}
                                onChange={e => setAtrMultiplierSL(parseFloat(e.target.value) || 1.5)}
                                className="h-8 text-xs bg-slate-950 border-amber-500/30 text-amber-300 font-mono focus:border-amber-500"
                            />
                        </div>
                        <div className="flex-1">
                            <label className="text-[10px] text-slate-400 mb-1 block">ATR × TP</label>
                            <Input
                                type="number" step="0.1" min="0.5" max="10"
                                value={atrMultiplierTP}
                                onChange={e => setAtrMultiplierTP(parseFloat(e.target.value) || 3.0)}
                                className="h-8 text-xs bg-slate-950 border-amber-500/30 text-amber-300 font-mono focus:border-amber-500"
                            />
                        </div>
                    </div>
                )}

                <div className="flex items-center gap-2">
                    <div className="flex-1">
                        <label className="text-[10px] text-slate-400 mb-1 block">Lot Size</label>
                        <Input 
                            type="number" 
                            step="0.01" 
                            min="0.01"
                            max="10"
                            value={lotSize} 
                            onChange={(e) => setLotSize(e.target.value)}
                            className="h-9 text-sm bg-slate-950 border-slate-700 text-white font-mono focus:border-emerald-500"
                        />
                    </div>
                    <div className="flex-1">
                        <label className="text-[10px] text-slate-400 mb-1 block">Potential P&L</label>
                        <div className="h-9 px-3 rounded-md bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                            <span className="text-sm font-bold text-emerald-400">
                                ${((activeTP - signal.entry_price) * lotSize * 100000).toFixed(2)}
                            </span>
                        </div>
                    </div>
                </div>
                <div className="flex gap-2">
                  {signal.calculated_indicators && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button 
                          variant="outline"
                          className="flex-1 h-9 text-xs bg-slate-800/50 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white"
                        >
                          <BarChart2 className="w-3.5 h-3.5 mr-1" /> Indicators
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-96 bg-slate-900 border-slate-800 text-slate-200 p-4 max-h-[80vh] overflow-y-auto">
                        <div className="space-y-2 mb-3">
                          <h4 className="font-semibold text-white">Calculated Indicators</h4>
                          <p className="text-xs text-slate-400">Technical values used for this signal</p>
                        </div>
                        <IndicatorPanel 
                          indicators={signal.calculated_indicators} 
                          currentPrice={signal.entry_price}
                        />
                      </PopoverContent>
                    </Popover>
                  )}
                  <Button 
                    className={`${signal.calculated_indicators ? 'flex-1' : 'w-full'} h-9 text-sm bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-900/20`}
                    onClick={() => onExecute && onExecute({ ...signal, lot_size: parseFloat(lotSize), stop_loss: activeSL, take_profit: activeTP, bot_id: signal.bot_id })}
                  >
                    <Play className="w-4 h-4 mr-2" /> Execute
                  </Button>
                </div>
            </div>
        ) : (
            <Button 
              variant="secondary" 
              disabled
              className={`w-full h-8 text-xs ${isPending ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400'}`}
            >
              {isPending ? <><Clock className="w-3 h-3 mr-2" /> Sending to MT4...</> : <><CheckCircle2 className="w-3 h-3 mr-2" /> Active on Terminal</>}
            </Button>
        )}
      </CardContent>
    </Card>
  );
}