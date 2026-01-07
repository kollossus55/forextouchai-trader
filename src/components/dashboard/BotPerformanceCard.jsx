import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Bot, TrendingUp, Target, Activity, DollarSign } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';

export default function BotPerformanceCard() {
  const { data: bots } = useQuery({
    queryKey: ['bots-performance'],
    queryFn: () => base44.entities.BotConfig.list(),
    refetchInterval: 5000,
    initialData: []
  });

  const { data: allTrades } = useQuery({
    queryKey: ['trades-performance'],
    queryFn: () => base44.entities.Trade.list(),
    refetchInterval: 5000,
    initialData: []
  });

  const calculateBotMetrics = (botId) => {
    const botTrades = allTrades.filter(t => t.bot_id === botId && t.is_auto === true);
    const closedTrades = botTrades.filter(t => t.status === 'CLOSED');
    const openTrades = botTrades.filter(t => t.status === 'OPEN');
    
    // Calculate P/L including open trades
    const closedPnL = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const openPnL = openTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const totalPnL = closedPnL + openPnL;
    
    // Win rate based on closed trades only
    const wins = closedTrades.filter(t => (t.pnl || 0) > 0).length;
    const winRate = closedTrades.length > 0 ? (wins / closedTrades.length) * 100 : 0;
    
    // Average P/L for closed trades
    const avgPnL = closedTrades.length > 0 ? closedPnL / closedTrades.length : 0;

    return {
      totalPnL,
      winRate,
      avgPnL,
      totalTrades: closedTrades.length,
      openTrades: openTrades.length
    };
  };

  const activeBots = bots.filter(b => b.status === 'RUNNING');

  if (activeBots.length === 0) {
    return (
      <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Bot className="w-5 h-5 text-blue-400" /> Bot Performance
          </CardTitle>
          <CardDescription className="text-slate-400">Automated trading metrics</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-slate-500 text-sm">
            No active bots running
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Bot className="w-5 h-5 text-blue-400" /> Bot Performance
        </CardTitle>
        <CardDescription className="text-slate-400">
          Real-time metrics for {activeBots.length} active bot{activeBots.length > 1 ? 's' : ''}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {activeBots.map((bot) => {
            const metrics = calculateBotMetrics(bot.id);
            return (
              <div 
                key={bot.id} 
                className="p-4 bg-slate-950/50 rounded-lg border border-slate-800/50 hover:border-slate-700 transition-colors"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                      <Bot className="w-4 h-4 text-blue-400" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-slate-200">{bot.name}</h4>
                      <p className="text-xs text-slate-500">{bot.strategy_type.replace(/_/g, ' ')}</p>
                    </div>
                  </div>
                  <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                    Active
                  </Badge>
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="bg-slate-900/50 p-2.5 rounded border border-slate-800/50">
                    <div className="flex items-center gap-1 text-[10px] text-slate-500 mb-1">
                      <DollarSign className="w-3 h-3" /> Total P/L
                    </div>
                    <div className={`font-bold text-sm ${
                      metrics.totalPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}>
                      {metrics.totalPnL >= 0 ? '+' : ''}${metrics.totalPnL.toFixed(2)}
                    </div>
                  </div>

                  <div className="bg-slate-900/50 p-2.5 rounded border border-slate-800/50">
                    <div className="flex items-center gap-1 text-[10px] text-slate-500 mb-1">
                      <Target className="w-3 h-3" /> Win Rate
                    </div>
                    <div className={`font-bold text-sm ${
                      metrics.winRate >= 50 ? 'text-emerald-400' : 'text-amber-400'
                    }`}>
                      {metrics.winRate.toFixed(1)}%
                    </div>
                  </div>

                  <div className="bg-slate-900/50 p-2.5 rounded border border-slate-800/50">
                    <div className="flex items-center gap-1 text-[10px] text-slate-500 mb-1">
                      <TrendingUp className="w-3 h-3" /> Avg P/L
                    </div>
                    <div className={`font-bold text-sm ${
                      metrics.avgPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}>
                      {metrics.avgPnL >= 0 ? '+' : ''}${metrics.avgPnL.toFixed(2)}
                    </div>
                  </div>

                  <div className="bg-slate-900/50 p-2.5 rounded border border-slate-800/50">
                    <div className="flex items-center gap-1 text-[10px] text-slate-500 mb-1">
                      <Activity className="w-3 h-3" /> Trades
                    </div>
                    <div className="font-bold text-sm text-slate-200">
                      {metrics.totalTrades}
                      {metrics.openTrades > 0 && (
                        <span className="text-blue-400 ml-1">+{metrics.openTrades}</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}