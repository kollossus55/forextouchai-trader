import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';

export default function DailyPerformanceCard({ balance }) {
  const { data: trades } = useQuery({
    queryKey: ['daily-performance-trades'],
    queryFn: () => base44.entities.Trade.list('-updated_date', 200),
    initialData: [],
    refetchInterval: 30000
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const todayTrades = trades.filter(t => {
    const d = new Date(t.updated_date || t.created_date);
    return t.status === 'CLOSED' && d >= today;
  });

  const totalProfit = todayTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const wins = todayTrades.filter(t => (t.pnl || 0) > 0).length;
  const totalLots = todayTrades.reduce((sum, t) => sum + (t.lot_size || 0), 0);
  const profitPct = balance > 0 ? (totalProfit / balance) * 100 : 0;
  const winRate = todayTrades.length > 0 ? (wins / todayTrades.length) * 100 : 0;

  const largestWin = todayTrades.reduce((max, t) => ((t.pnl || 0) > (max.pnl || 0) ? t : max), { pnl: -Infinity });
  const largestLoss = todayTrades.reduce((min, t) => ((t.pnl || 0) < (min.pnl || 0) ? t : min), { pnl: Infinity });
  const hasLargestWin = largestWin?.pnl > 0;
  const hasLargestLoss = largestLoss?.pnl < 0;

  return (
    <Card className="bg-gradient-to-br from-emerald-900/20 to-slate-900 border-emerald-500/20 shadow-xl">
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold text-white">Daily Performance</h3>
          <Badge className={`border-0 text-sm px-3 ${totalProfit >= 0 ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'}`}>
            {totalProfit >= 0 ? '+' : ''}{profitPct.toFixed(2)}%
          </Badge>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div className="bg-slate-950/80 rounded-lg p-3 border border-slate-800/50">
            <p className="text-xs text-slate-500 mb-1">P&L Today</p>
            <p className={`text-xl font-bold font-mono ${totalProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)}
            </p>
          </div>

          <div className="bg-slate-950/80 rounded-lg p-3 border border-slate-800/50">
            <p className="text-xs text-slate-500 mb-1">Trades</p>
            <p className="text-xl font-bold text-white font-mono">{todayTrades.length}</p>
            <p className="text-xs text-slate-400">{wins} Wins · {todayTrades.length - wins} Losses</p>
          </div>

          <div className="bg-slate-950/80 rounded-lg p-3 border border-slate-800/50">
            <p className="text-xs text-slate-500 mb-1">Largest Win</p>
            {hasLargestWin ? (
              <>
                <p className="text-xl font-bold text-emerald-400 font-mono">+${largestWin.pnl.toFixed(2)}</p>
                <p className="text-xs text-slate-400">{largestWin.pair?.replace('/', '')} · {largestWin.lot_size} lots</p>
              </>
            ) : (
              <p className="text-xl font-bold text-slate-600 font-mono">--</p>
            )}
          </div>

          <div className="bg-slate-950/80 rounded-lg p-3 border border-slate-800/50">
            <p className="text-xs text-slate-500 mb-1">Largest Loss</p>
            {hasLargestLoss ? (
              <>
                <p className="text-xl font-bold text-rose-400 font-mono">${largestLoss.pnl.toFixed(2)}</p>
                <p className="text-xs text-slate-400">{largestLoss.pair?.replace('/', '')} · {largestLoss.lot_size} lots</p>
              </>
            ) : (
              <p className="text-xl font-bold text-slate-600 font-mono">--</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex-1">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-500">Win Rate</span>
              <span className="text-slate-300 font-mono">{winRate.toFixed(0)}%</span>
            </div>
            <Progress value={winRate} className="h-1.5 bg-slate-800" indicatorClassName={winRate >= 50 ? "bg-emerald-500" : "bg-rose-500"} />
          </div>
          <span className="text-xs text-slate-500 whitespace-nowrap">{totalLots.toFixed(2)} lots traded</span>
        </div>
      </CardContent>
    </Card>
  );
}