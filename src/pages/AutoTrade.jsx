import React, { useState, useEffect } from 'react';
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
  Target
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import BotConfigDialog from '@/components/autotrade/BotConfigDialog';
import StrategyBuilder from '@/components/autotrade/StrategyBuilder';
import BacktestPanel from '@/components/autotrade/BacktestPanel';
import { MarketDataService } from '@/components/services/MarketDataService';

export default function AutoTrade() {
  const queryClient = useQueryClient();
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [selectedBot, setSelectedBot] = useState(null);
  const [backtestBot, setBacktestBot] = useState(null);
  const [activeTab, setActiveTab] = useState("bots");
  const [terminalLogs, setTerminalLogs] = useState([]);
  
  const { data: bots } = useQuery({
    queryKey: ['bots'],
    queryFn: () => base44.entities.BotConfig.list(),
    initialData: []
  });

  // Initialize Market Data Service
  useEffect(() => {
    MarketDataService.initialize();
  }, []);

  // AI Trading Engine Simulation
  useEffect(() => {
    const runningBots = bots.filter(b => b.status === 'RUNNING');
    if (runningBots.length === 0) return;

    const interval = setInterval(async () => {
        // Update market data periodically in background
        await MarketDataService.fetchAll();

        runningBots.forEach(bot => {
            // Simulate AI Signal Generation (5% chance per tick)
            if (Math.random() > 0.95) {
                const pairs = bot.pairs && bot.pairs.length > 0 ? bot.pairs : ['EUR/USD'];
                const pair = pairs[Math.floor(Math.random() * pairs.length)];
                
                // Get Real Market Price
                const realPrice = MarketDataService.getPrice(pair);
                
                // Determine action based on simple trend simulation (random for demo, but uses real price)
                const action = Math.random() > 0.5 ? 'BUY' : 'SELL';
                const confidence = Math.floor(Math.random() * (99 - 70) + 70); // 70-99%

                // Check strategy rules
                if (confidence >= (bot.min_confidence || 80)) {
                    // Calculate SL/TP based on pip value
                    const isJpy = pair.includes('JPY');
                    const isCrypto = pair.includes('BTC') || pair.includes('ETH') || pair.includes('SOL');
                    const isGold = pair.includes('XAU');

                    // Adjust pip multiplier for different asset classes
                    let pipMultiplier = 0.0001;
                    if (isJpy) pipMultiplier = 0.01;
                    if (isGold) pipMultiplier = 0.1;
                    if (isCrypto) pipMultiplier = 10.0; // Crypto "pips" are much larger

                    const sl = action === 'BUY' 
                        ? realPrice - (bot.stop_loss_pips * pipMultiplier) 
                        : realPrice + (bot.stop_loss_pips * pipMultiplier);

                    const tp = action === 'BUY' 
                        ? realPrice + (bot.take_profit_pips * pipMultiplier) 
                        : realPrice - (bot.take_profit_pips * pipMultiplier);

                    // Generate Signal for MT4
                    base44.entities.Signal.create({
                        pair,
                        type: action,
                        entry_price: parseFloat(realPrice.toFixed(5)),
                        stop_loss: parseFloat(sl.toFixed(5)),
                        take_profit: parseFloat(tp.toFixed(5)),
                        confidence: confidence,
                        strategy: bot.strategy_type,
                        status: 'PENDING',
                        result_pnl: 0
                    }).then(() => {
                        addLog(bot.name, `Signal Sent to MT4: ${action} ${pair} @ ${realPrice.toFixed(5)}`, 'success');
                        queryClient.invalidateQueries(['ai-signals']);
                    });
                } else {
                    addLog(bot.name, `Signal ignored: ${pair} confidence ${confidence}% < threshold`, 'info');
                }
            } else if (Math.random() > 0.8) {
                // Keep alive / analysis logs
                addLog(bot.name, `Analyzing ${bot.pairs?.join(', ')} market structure...`, 'default');
            }
        });
    }, 3000); // Check every 3 seconds

    return () => clearInterval(interval);
  }, [bots]);

  const addLog = (botName, message, type) => {
    const timestamp = new Date().toLocaleTimeString();
    setTerminalLogs(prev => [{ botName, message, type, timestamp }, ...prev].slice(0, 50));
  };

  const createBot = useMutation({
    mutationFn: (data) => base44.entities.BotConfig.create(data),
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
      mutationFn: (id) => base44.entities.BotConfig.delete(id),
      onSuccess: () => {
          queryClient.invalidateQueries(['bots']);
      }
  });

  const toggleBot = useMutation({
    mutationFn: (bot) => base44.entities.BotConfig.update(bot.id, { 
      status: bot.status === 'RUNNING' ? 'STOPPED' : 'RUNNING' 
    }),
    onSuccess: () => queryClient.invalidateQueries(['bots'])
  });

  const handleSave = (data) => {
      if (selectedBot) {
          updateBot.mutate({ id: selectedBot.id, data });
      } else {
          createBot.mutate(data);
      }
  };

  const handleEdit = (bot) => {
      setSelectedBot(bot);
      setIsConfigOpen(true);
  };

  const handleCreate = () => {
      setSelectedBot(null);
      setIsConfigOpen(true);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Bot className="w-8 h-8 text-emerald-500" /> Auto Trading Bots
          </h1>
          <p className="text-slate-400 mt-1">Manage your AI automated trading strategies</p>
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
              <Card key={bot.id} className={`bg-slate-900/50 backdrop-blur-sm border transition-all ${bot.status === 'RUNNING' ? 'border-emerald-500/30 shadow-[0_0_20px_-5px_rgba(16,185,129,0.1)]' : 'border-slate-800'}`}>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <div className="space-y-1">
                    <CardTitle className="text-xl text-white flex items-center gap-2">
                      {bot.name}
                      <Badge variant="outline" className={`ml-2 text-xs font-normal ${
                        bot.status === 'RUNNING' ? 'border-emerald-500/50 text-emerald-400 bg-emerald-500/10' : 'border-slate-700 text-slate-500'
                      }`}>
                        {bot.status}
                      </Badge>
                    </CardTitle>
                    <CardDescription className="text-slate-400">
                      {bot.strategy_type.replace('_', ' ')}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button 
                      variant="outline" 
                      size="icon"
                      className={`rounded-full w-10 h-10 border-2 ${
                        bot.status === 'RUNNING' 
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-300' 
                        : 'border-slate-700 bg-slate-800/50 text-slate-400 hover:bg-slate-800 hover:text-white'
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
                      <div className="font-semibold text-emerald-400">
                        +12.4% <span className="text-slate-500 text-xs font-normal">this week</span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 mb-6">
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
                       <span className="text-slate-200 font-mono text-xs">{bot.trading_start_time || '08:00'} - {bot.trading_end_time || '17:00'}</span>
                    </div>
                  </div>

                  {/* Live Terminal Output */}
                  <div className="bg-black/40 rounded-lg p-3 font-mono text-xs h-32 overflow-y-auto relative border border-slate-800 flex flex-col-reverse">
                    <div className="absolute top-2 right-2 flex gap-1.5 z-10">
                      <div className="w-2 h-2 rounded-full bg-red-500/20"></div>
                      <div className="w-2 h-2 rounded-full bg-yellow-500/20"></div>
                      <div className="w-2 h-2 rounded-full bg-green-500/20"></div>
                    </div>
                    <div className="space-y-1">
                      {terminalLogs.filter(log => log.botName === bot.name).length > 0 ? (
                        terminalLogs.filter(log => log.botName === bot.name).map((log, i) => (
                           <p key={i} className={`${
                               log.type === 'success' ? 'text-emerald-400' : 
                               log.type === 'info' ? 'text-amber-400' : 'text-slate-400'
                           }`}>
                             <span className="text-blue-500 opacity-70">[{log.timestamp}]</span> {log.message}
                           </p>
                        ))
                      ) : (
                        <p className="text-slate-500 italic">Waiting for market data...</p>
                      )}
                      {bot.status === 'RUNNING' && (
                        <p className="text-emerald-500/50 animate-pulse text-[10px]">_ AI Engine Active: Processing ticks</p>
                      )}
                    </div>
                  </div>
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
                   <Button variant="ghost" size="sm" onClick={() => deleteBot.mutate(bot.id)} className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 text-xs">
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