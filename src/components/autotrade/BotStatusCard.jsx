import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Play, Pause, Settings, Zap, TrendingUp, Target, Shield } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

export default function BotStatusCard({ bot, onToggle, onConfigure, trades = [] }) {
  const isRunning = bot.status === 'RUNNING';
  const isPaused = bot.status === 'PAUSED';
  
  const botTrades = trades.filter(t => t.bot_id === String(bot.id) && t.status === 'OPEN');
  const botPnL = botTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const utilizationPercent = bot.max_open_trades ? (botTrades.length / bot.max_open_trades) * 100 : 0;

  return (
    <Card className={`bg-slate-900/50 border-slate-800 transition-all ${isRunning ? 'border-emerald-500/30 shadow-[0_0_15px_-3px_rgba(16,185,129,0.2)]' : ''}`}>
      <div className={`h-1 w-full ${
        isRunning ? 'bg-emerald-500 animate-pulse' :
        isPaused ? 'bg-amber-500' : 'bg-slate-700'
      }`} />
      
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <CardTitle className="text-lg text-white">{bot.name}</CardTitle>
              <Badge variant="outline" className={`text-[10px] h-5 ${
                isRunning ? 'border-emerald-500/50 text-emerald-400 bg-emerald-500/10' :
                isPaused ? 'border-amber-500/50 text-amber-400 bg-amber-500/10' :
                'border-slate-600 text-slate-400'
              }`}>
                {bot.status}
              </Badge>
            </div>
            <p className="text-xs text-slate-400">
              {bot.strategy_type.replace(/_/g, ' ')} • {bot.pairs?.length || 0} pairs • {bot.lot_size} lots
            </p>
          </div>
          
          <div className="flex items-center gap-2">
            <div className="relative">
              <div className={`w-3 h-3 rounded-full absolute -left-5 top-1/2 -translate-y-1/2 ${
                isRunning ? 'bg-emerald-500 shadow-[0_0_12px_3px_rgba(16,185,129,0.6)] animate-pulse' :
                isPaused ? 'bg-amber-500 shadow-[0_0_12px_3px_rgba(251,191,36,0.6)]' :
                'bg-rose-500 shadow-[0_0_8px_2px_rgba(244,63,94,0.4)]'
              }`} />
              <Switch 
                checked={isRunning}
                onCheckedChange={() => onToggle(bot)}
                className="data-[state=checked]:bg-emerald-600"
              />
            </div>
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => onConfigure(bot)}
              className="h-8 w-8 text-slate-400 hover:text-white"
            >
              <Settings className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Active Trades & P&L */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-slate-950/50 p-2 rounded border border-slate-800/50">
            <div className="text-[10px] text-slate-500 mb-0.5">Open Trades</div>
            <div className="font-bold text-sm text-slate-200">{botTrades.length}/{bot.max_open_trades || '∞'}</div>
          </div>
          <div className="bg-slate-950/50 p-2 rounded border border-slate-800/50">
            <div className="text-[10px] text-slate-500 mb-0.5">P&L</div>
            <div className={`font-bold text-sm ${botPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {botPnL >= 0 ? '+' : ''}${botPnL.toFixed(2)}
            </div>
          </div>
          <div className="bg-slate-950/50 p-2 rounded border border-slate-800/50">
            <div className="text-[10px] text-slate-500 mb-0.5">Risk</div>
            <div className="font-bold text-sm text-slate-200">{bot.risk_level}</div>
          </div>
        </div>

        {/* Trade Capacity Progress */}
        {bot.max_open_trades && (
          <div>
            <div className="flex justify-between text-[10px] text-slate-400 mb-1">
              <span>Trade Capacity</span>
              <span>{utilizationPercent.toFixed(0)}%</span>
            </div>
            <Progress 
              value={utilizationPercent} 
              className="h-1.5 bg-slate-800"
              indicatorClassName={utilizationPercent > 80 ? 'bg-amber-500' : 'bg-emerald-500'}
            />
          </div>
        )}

        {/* Strategy Params */}
        <div className="flex gap-2 text-[10px] text-slate-500">
          <div className="flex items-center gap-1">
            <Target className="w-3 h-3" />
            <span>TP: {bot.take_profit_pips}p</span>
          </div>
          <div className="flex items-center gap-1">
            <Shield className="w-3 h-3" />
            <span>SL: {bot.stop_loss_pips}p</span>
          </div>
          <div className="flex items-center gap-1">
            <TrendingUp className="w-3 h-3" />
            <span>Min Conf: {bot.min_confidence}%</span>
          </div>
        </div>

        {/* Auto-Trading Status */}
        {isRunning && (
          <div className="flex items-center justify-center gap-2 pt-2 border-t border-slate-800">
            <Zap className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
            <span className="text-xs text-emerald-400 font-medium">Auto-Trading Active</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}