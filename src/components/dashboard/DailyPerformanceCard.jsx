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

  return (
    <Card className="bg-gradient-to-br from-emerald-900/20 to-slate-900 border-emerald-500/20">
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-white">Daily Performance</h3>
          <Badge className={`border-0 ${totalProfit >= 0 ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'}`}>
            {totalProfit >= 0 ? '+' : ''}{profitPct.toFixed(2)}%
          </Badge>
        </div>
        <div className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">P&L Today</span>
            <span className={`font-mono ${totalProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">Trades</span>
            <span className="text-slate-200 font-mono">{todayTrades.length} ({wins} Wins)</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">Lots</span>
            <span className="text-slate-200 font-mono">{totalLots.toFixed(2)}</span>
          </div>
          <Progress value={winRate} className="h-1.5 mt-2 bg-slate-800" indicatorClassName={winRate >= 50 ? "bg-emerald-500" : "bg-rose-500"} />
          <p className="text-[10px] text-slate-500 text-right">{winRate.toFixed(0)}% win rate today</p>
        </div>
      </CardContent>
    </Card>
  );
}