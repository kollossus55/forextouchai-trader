import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { 
  Bot, 
  Play, 
  Pause, 
  Plus, 
  Settings2, 
  Trash2,
  Cpu,
  Zap,
  ShieldAlert,
  Clock,
  BrainCircuit,
  Target,
  BarChart
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import BotConfigDialog from '@/components/autotrade/BotConfigDialog';
import StrategyBuilder from '@/components/autotrade/StrategyBuilder';
import BacktestPanel from '@/components/autotrade/BacktestPanel';
import RiskManagementPanel from '@/components/autotrade/RiskManagementPanel';
import { MarketDataService } from '@/components/services/MarketDataService';

export default function AutoTrade() {
  const queryClient = useQueryClient();
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [selectedBot, setSelectedBot] = useState(null);
  const [backtestBot, setBacktestBot] = useState(null);
  const [activeTab, setActiveTab] = useState("bots");
  const [user, setUser] = useState(null);
  
  // Fetch current user
  useEffect(() => {
    const fetchUser = async () => {
      try {
        const userData = await base44.auth.me();
        console.log('[AutoTrade] Current user:', userData);
        setUser(userData);
      } catch (e) {
        console.error("Failed to fetch user", e);
      }
    };
    fetchUser();
  }, []);

  // Fetch bots with role-based filtering
  const { data: allBots } = useQuery({
    queryKey: ['bots'],
    queryFn: async () => {
      const bots = await base44.entities.BotConfig.list('-created_date', 100);
      console.log('[AutoTrade] Fetched bots:', bots.length, bots.map(b => ({name: b.name, owner: b.owner_email, creator: b.created_by})));
      return bots;
    },
    initialData: [],
    refetchInterval: 10000, // Refetch every 10 seconds for reliability
    staleTime: 0, // Always check for fresh data
    enabled: !!user // Only fetch when user is loaded
  });

  // Filter bots based on user role
  const bots = React.useMemo(() => {
    if (!user) {
      console.log('[AutoTrade] No user yet, returning empty bots');
      return [];
    }
    
    console.log('[AutoTrade] Filtering bots for user:', user.email, 'role:', user.role);
    
    if (user.role === 'admin') {
      console.log('[AutoTrade] Admin user - showing all bots:', allBots.length);
      return allBots;
    }
    
    // Traders see bots they own or created (backward compatibility for bots without owner_email)
    const filtered = allBots.filter(bot => 
      bot.owner_email === user.email || 
      bot.created_by === user.email ||
      (!bot.owner_email && bot.created_by === user.email) // Fallback for old bots
    );
    
    console.log('[AutoTrade] Filtered bots for trader:', filtered.length, 'out of', allBots.length);
    return filtered;
  }, [allBots, user]);

  // Fetch all trades to calculate bot performance
  const { data: allTrades } = useQuery({
    queryKey: ['all-trades'],
    queryFn: () => base44.entities.Trade.list(),
    initialData: [],
    refetchInterval: 30000, // Refetch every 30 seconds
    refetchIntervalInBackground: true
  });

  // Calculate performance for each bot
  const botPerformance = React.useMemo(() => {
    const performance = {};
    bots.forEach(bot => {
      const botTrades = allTrades.filter(t => t.bot_id === bot.id && t.status === 'CLOSED');
      if (botTrades.length > 0) {
        const totalPnL = botTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
        performance[bot.id] = totalPnL;
      } else {
        performance[bot.id] = 0;
      }
    });
    return performance;
  }, [bots, allTrades]);

  // Fetch open trades to compute per-bot capacity status
  const { data: openTrades } = useQuery({
    queryKey: ['open-trades'],
    queryFn: () => base44.entities.Trade.filter({ status: 'OPEN' }, '-created_date', 200),
    initialData: [],
    refetchInterval: 15000,
  });

  // Compute capacity status for each bot
  const botCapacityStatus = React.useMemo(() => {
    const status = {};

    bots.forEach(bot => {
      if (bot.status !== 'RUNNING') return;
      const maxOpen = bot.max_open_trades || 5;
      const botPairs = new Set((bot.pairs || []).map(p => p.replace('/', '')));

      // Only count trades on pairs this bot is configured for
      const botTrades = openTrades.filter(t => botPairs.has((t.pair || '').replace('/', '')));

      // Group those trades by account
      const tradesByAccount = {};
      botTrades.forEach(t => {
        const acct = t.owner_email || 'unknown';
        tradesByAccount[acct] = (tradesByAccount[acct] || 0) + 1;
      });
      const accountNumbers = Object.keys(tradesByAccount);

      // Blocked only if ALL accounts are at/above maxOpen for this bot's pairs
      const allAtCapacity = accountNumbers.length > 0 && accountNumbers.every(acct => (tradesByAccount[acct] || 0) >= maxOpen);
      if (allAtCapacity) {
        const detail = accountNumbers.map(a => `${a}:${tradesByAccount[a]}`).join(', ');
        status[bot.id] = { blocked: true, reason: `All accounts at max open trades (${maxOpen}) — [${detail}]` };
        return;
      }

      // Check if all configured pairs are already occupied
      const openPairSet = new Set(botTrades.map(t => (t.pair || '').replace('/', '')));
      const pairs = (bot.pairs || []);
      const availablePairs = pairs.filter(p => !openPairSet.has(p.replace('/', '')));
      if (pairs.length > 0 && availablePairs.length === 0) {
        status[bot.id] = { blocked: true, reason: `All ${pairs.length} configured pair(s) already have open trades` };
        return;
      }

      status[bot.id] = { blocked: false, availablePairs: availablePairs.length, openCount: botTrades.length };
    });
    return status;
  }, [bots, openTrades]);

  // Fetch recent signals to show in bot terminals (backend is the authoritative signal source)
  const { data: recentSignals } = useQuery({
    queryKey: ['recent-signals'],
    queryFn: () => base44.entities.Signal.list('-created_date', 50),
    initialData: [],
    refetchInterval: 15000,
  });

  const createBot = useMutation({
    mutationFn: (data) => {
      // Automatically assign owner_email on creation
      const botData = { ...data, owner_email: user?.email };
      return base44.entities.BotConfig.create(botData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['bots']);
      setIsConfigOpen(false);
    }
  });

  const updateBot = useMutation({
    mutationFn: ({id, data}) => base44.entities.BotConfig.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['bots']);
      setIsConfigOpen(false);
      setSelectedBot(null);
    }
  });

  const deleteBot = useMutation({
      mutationFn: (bot) => {
        // Check permissions before deleting
        if (user?.role !== 'admin' && bot.owner_email !== user?.email && bot.created_by !== user?.email) {
          throw new Error('You do not have permission to delete this bot.');
        }
        return base44.entities.BotConfig.delete(bot.id);
      },
      onSuccess: () => {
          queryClient.invalidateQueries(['bots']);
      },
      onError: (error) => {
        alert(error.message);
      }
  });

  const toggleBot = useMutation({
    mutationFn: (bot) => {
      // Check permissions before toggling
      if (user?.role !== 'admin' && bot.owner_email !== user?.email && bot.created_by !== user?.email) {
        throw new Error('You do not have permission to control this bot.');
      }
      return base44.entities.BotConfig.update(bot.id, { 
        status: bot.status === 'RUNNING' ? 'STOPPED' : 'RUNNING' 
      });
    },
    onSuccess: () => queryClient.invalidateQueries(['bots']),
    onError: (error) => {
      alert(error.message);
    }
  });

  const handleSave = (data) => {
      if (selectedBot) {
          updateBot.mutate({ id: selectedBot.id, data });
      } else {
          createBot.mutate(data);
      }
  };

  const handleEdit = (bot) => {
      // Check if user can edit this bot
      if (user?.role !== 'admin' && bot.owner_email !== user?.email && bot.created_by !== user?.email) {
        alert('You do not have permission to edit this bot.');
        return;
      }
      setSelectedBot(bot);
      setIsConfigOpen(true);
  };

  const handleCreate = () => {
      setSelectedBot(null);
      setIsConfigOpen(true);
  };

  // Helper: check if a bot is within its trading hours (browser local time)
  const isWithinTradingHours = (bot) => {
    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes();
    const [startH, startM] = (bot.trading_start_time || "00:00").split(':').map(Number);
    const [endH, endM] = (bot.trading_end_time || "23:59").split(':').map(Number);
    const startTime = startH * 60 + startM;
    const endTime = endH * 60 + endM;
    return currentTime >= startTime && currentTime <= endTime;
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Bot className="w-8 h-8 text-emerald-500" /> Auto Trading Bots
            {user?.role === 'admin' && (
              <Badge variant="outline" className="text-xs border-amber-500/30 text-amber-400 bg-amber-500/10">
                Admin View - All Bots
              </Badge>
            )}
          </h1>
          <p className="text-slate-400 mt-1">
            {user?.role === 'admin' ? 'Manage all trading bots across the platform' : 'Manage your AI automated trading strategies'}
          </p>
        </div>
        
        <Button onClick={handleCreate} className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-900/20">
            <Plus className="w-4 h-4 mr-2" /> Create New Bot
        </Button>
        <BotConfigDialog 
            open={isConfigOpen} 
            onOpenChange={setIsConfigOpen} 
            onSubmit={handleSave}
            initialData={selectedBot}
        />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="bg-slate-900 border border-slate-800 mb-6 w-full justify-start h-auto p-1">
          <TabsTrigger value="bots" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white py-2 px-4">
            Active Bots
          </TabsTrigger>
          <TabsTrigger value="risk" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white py-2 px-4">
            Risk Management
          </TabsTrigger>
          <TabsTrigger value="builder" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white py-2 px-4">
            Strategy Builder
          </TabsTrigger>
          <TabsTrigger value="backtest" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white py-2 px-4">
            Backtesting Engine
          </TabsTrigger>
        </TabsList>

        <TabsContent value="bots" className="mt-0">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {bots.map((bot) => (
              <Card key={bot.id} className={`bg-slate-900/50 backdrop-blur-sm border transition-all ${
                bot.status === 'RUNNING' && isWithinTradingHours(bot)
                  ? 'border-emerald-500/30 shadow-[0_0_20px_-5px_rgba(16,185,129,0.1)]'
                  : bot.status === 'RUNNING'
                  ? 'border-amber-500/30 shadow-[0_0_20px_-5px_rgba(245,158,11,0.1)]'
                  : 'border-slate-800'
              }`}>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <div className="space-y-1">
                    <CardTitle className="text-xl text-white flex items-center gap-2">
                      {bot.name}
                      <Badge variant="outline" className={`ml-2 text-xs font-normal ${
                        bot.status === 'RUNNING' ? 'border-emerald-500/50 text-emerald-400 bg-emerald-500/10' : 'border-slate-700 text-slate-500'
                      }`}>
                        {bot.status}
                      </Badge>
                      {bot.status === 'RUNNING' && !isWithinTradingHours(bot) && (
                        <Badge variant="outline" className="ml-1 text-xs font-normal border-amber-500/50 text-amber-400 bg-amber-500/10">
                          ⏰ Outside Hours
                        </Badge>
                      )}
                      {user?.role === 'admin' && bot.owner_email && (
                        <Badge variant="outline" className="text-[10px] border-blue-500/30 text-blue-400 bg-blue-500/10">
                          Owner: {bot.owner_email}
                        </Badge>
                      )}
                    </CardTitle>
                    <CardDescription className="text-slate-400">
                      {bot.strategy_type.replace('_', ' ')}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button 
                      variant="outline" 
                      size="icon"
                      className={`rounded-full w-10 h-10 border-2 transition-all ${
                        bot.status === 'RUNNING' 
                        ? 'border-emerald-500 bg-emerald-500/30 text-emerald-300 hover:bg-emerald-500/40 hover:text-emerald-200 shadow-[0_0_20px_rgba(16,185,129,0.5)]' 
                        : 'border-rose-500/30 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 hover:text-rose-300'
                      }`}
                      onClick={() => toggleBot.mutate(bot)}
                    >
                      {bot.status === 'RUNNING' ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4 mt-2 mb-4">
                    <div className="bg-slate-950/50 p-3 rounded-lg border border-slate-800/50">
                      <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
                        <ShieldAlert className="w-3 h-3" /> Risk Level
                      </div>
                      <div className={`font-semibold ${
                        bot.risk_level === 'HIGH' ? 'text-rose-400' : 
                        bot.risk_level === 'MEDIUM' ? 'text-amber-400' : 'text-emerald-400'
                      }`}>
                        {bot.risk_level}
                      </div>
                    </div>
                    <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800/50">
                      <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
                        <Zap className="w-3 h-3" /> Performance
                      </div>
                      <div className={`font-semibold ${botPerformance[bot.id] >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {botPerformance[bot.id] >= 0 ? '+' : ''}${botPerformance[bot.id].toFixed(2)} <span className="text-slate-500 text-xs font-normal">total P&L</span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-2 mb-6">
                    <div className="bg-slate-950/30 p-2 rounded border border-slate-800/30 flex flex-col justify-center">
                       <div className="flex items-center gap-1.5 text-slate-500 text-[10px] mb-0.5">
                         <BarChart className="w-3 h-3" />
                         <span>Timeframe</span>
                       </div>
                       <span className="text-cyan-400 font-mono text-sm font-bold">{bot.timeframe || 'H1'}</span>
                    </div>
                    <div className="bg-slate-950/30 p-2 rounded border border-slate-800/30 flex flex-col justify-center">
                       <div className="flex items-center gap-1.5 text-slate-500 text-[10px] mb-0.5">
                         <Target className="w-3 h-3" />
                         <span>Lot Size</span>
                       </div>
                       <span className="text-slate-200 font-mono text-sm">{bot.lot_size || 0.1}</span>
                    </div>
                    <div className="bg-emerald-500/10 p-2 rounded border border-emerald-500/30 flex flex-col justify-center relative overflow-hidden group">
                       <div className="absolute top-0 right-0 w-8 h-8 bg-emerald-500/10 rounded-bl-full -mr-1 -mt-1 transition-all group-hover:bg-emerald-500/20"></div>
                       <div className="flex items-center gap-1.5 text-emerald-300/80 text-[10px] mb-0.5 font-medium z-10">
                         <BrainCircuit className="w-3.5 h-3.5" />
                         <span>AI Confidence</span>
                       </div>
                       <div className="flex items-end gap-1 z-10">
                          <span className="text-emerald-400 font-bold text-xl tracking-tight">{bot.min_confidence || 80}</span>
                          <span className="text-emerald-500/70 text-xs mb-1 font-medium">%</span>
                       </div>
                    </div>
                    <div className="bg-slate-950/30 p-2 rounded border border-slate-800/30 flex flex-col justify-center">
                       <div className="flex items-center gap-1.5 text-slate-500 text-[10px] mb-0.5">
                         <Clock className="w-3 h-3" />
                         <span>Schedule</span>
                       </div>
                       <span className="text-slate-200 font-mono text-[10px]">{bot.trading_start_time || '08:00'} - {bot.trading_end_time || '17:00'}</span>
                    </div>
                  </div>

                  {/* Capacity Status Banner */}
                  {bot.status === 'RUNNING' && botCapacityStatus[bot.id]?.blocked && (
                    <div className="flex items-start gap-2 mb-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
                      <ShieldAlert className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-amber-400 text-xs font-semibold">No New Trades — Bot at Capacity</p>
                        <p className="text-amber-300/70 text-[11px] mt-0.5">{botCapacityStatus[bot.id].reason}. New signals will resume when trades close.</p>
                      </div>
                    </div>
                  )}
                  {bot.status === 'RUNNING' && botCapacityStatus[bot.id] && !botCapacityStatus[bot.id].blocked && (
                    <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                      <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                      <p className="text-emerald-400/80 text-[11px]">
                        {botCapacityStatus[bot.id].availablePairs} pair(s) available · {botCapacityStatus[bot.id].openCount} trade(s) open
                      </p>
                    </div>
                  )}

                  {/* Live Signal Feed from Backend */}
                  {(() => {
                    const botSignals = recentSignals.filter(s => s.bot_id === bot.id && s.status !== 'EXPIRED' && s.status !== 'SKIPPED').slice(0, 8);
                    return (
                      <div className="bg-black/40 rounded-lg p-3 font-mono text-xs h-32 overflow-y-auto relative border border-slate-800">
                        <div className="absolute top-2 right-2 flex gap-1.5 z-10">
                          <div className={`w-2 h-2 rounded-full ${bot.status === 'RUNNING' ? 'bg-red-500' : 'bg-red-500/20'}`}></div>
                          <div className={`w-2 h-2 rounded-full ${bot.status === 'RUNNING' ? 'bg-yellow-500' : 'bg-yellow-500/20'}`}></div>
                          <div className={`w-2 h-2 rounded-full ${bot.status === 'RUNNING' ? 'bg-green-500 animate-pulse' : 'bg-green-500/20'}`}></div>
                        </div>
                        <div className="space-y-1 pt-1">
                          {botSignals.length > 0 ? botSignals.map((sig, i) => (
                            <p key={i} className={`${
                              sig.status === 'PENDING' ? 'text-amber-400' :
                              sig.status === 'ACTIVE' ? 'text-emerald-400' :
                              sig.status === 'EXPIRED' || sig.status === 'SKIPPED' ? 'text-slate-500' :
                              'text-slate-400'
                            }`}>
                              <span className="text-blue-500/70">[{new Date(sig.created_date).toLocaleTimeString()}]</span>{' '}
                              {sig.type} {sig.pair} @ {sig.entry_price?.toFixed(5)} ({sig.confidence}%) — {sig.status}
                            </p>
                          )) : (
                            <p className="text-slate-500 italic">{bot.status === 'RUNNING' ? 'Waiting for next signal cycle (every 5 min)...' : 'Bot stopped.'}</p>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </CardContent>
                <CardFooter className="flex justify-between border-t border-slate-800 pt-4">
                   <Button variant="ghost" size="sm" onClick={() => handleEdit(bot)} className="text-slate-400 hover:text-white text-xs">
                     <Settings2 className="w-3 h-3 mr-2" /> Configuration
                   </Button>
                   <Button variant="ghost" size="sm" onClick={() => {
                       setBacktestBot(bot);
                       setActiveTab("backtest");
                   }} className="text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 text-xs">
                     <Clock className="w-3 h-3 mr-2" /> Backtest
                   </Button>
                   <Button 
                     variant="ghost" 
                     size="sm" 
                     onClick={() => deleteBot.mutate(bot)} 
                     className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 text-xs"
                   >
                     <Trash2 className="w-3 h-3 mr-2" /> Delete
                   </Button>
                </CardFooter>
              </Card>
            ))}

            {bots.length === 0 && (
              <div className="col-span-full flex flex-col items-center justify-center py-16 text-slate-500 border-2 border-dashed border-slate-800 rounded-xl bg-slate-900/20">
                <Cpu className="w-12 h-12 mb-4 opacity-50" />
                <p className="text-lg font-medium">No bots configured</p>
                <p className="text-sm">Create your first AI trading bot to get started.</p>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="risk" className="mt-0">
          <RiskManagementPanel />
        </TabsContent>

        <TabsContent value="builder" className="mt-0">
          <StrategyBuilder />
        </TabsContent>

        <TabsContent value="backtest" className="mt-0">
          <BacktestPanel preselectedBot={backtestBot} />
        </TabsContent>
      </Tabs>
    </div>
  );
}