import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowUpRight, ArrowDownRight, Target, Shield, Play, CheckCircle2, Clock } from 'lucide-react';

export default function SignalCard({ signal, onExecute }) {
  const isBuy = signal.type === 'BUY';
  const isPending = signal.status === 'PENDING';
  const isActive = signal.status === 'ACTIVE';
  
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

        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="bg-slate-950/50 p-2 rounded border border-slate-800/50">
            <div className="text-[10px] text-slate-500 mb-0.5">Entry</div>
            <div className="font-mono text-sm text-slate-300">{signal.entry_price}</div>
          </div>
          <div className="bg-slate-950/50 p-2 rounded border border-slate-800/50">
            <div className="flex items-center gap-1 text-[10px] text-rose-400/70 mb-0.5">
              <Shield className="w-3 h-3" /> SL
            </div>
            <div className="font-mono text-sm text-slate-300">{signal.stop_loss}</div>
          </div>
          <div className="bg-slate-950/50 p-2 rounded border border-slate-800/50">
             <div className="flex items-center gap-1 text-[10px] text-emerald-400/70 mb-0.5">
              <Target className="w-3 h-3" /> TP
            </div>
            <div className="font-mono text-sm text-slate-300">{signal.take_profit}</div>
          </div>
        </div>

        {signal.status === 'ANALYSIS' ? (
            <Button 
              className="w-full h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => onExecute && onExecute(signal)}
            >
              <Play className="w-3 h-3 mr-2" /> Execute on MT4
            </Button>
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