import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { 
  Wifi, 
  WifiOff, 
  RefreshCw, 
  CalendarDays, 
  Newspaper, 
  Activity,
  DollarSign,
  PieChart,
  BarChart3,
  BrainCircuit,
  Zap,
  ExternalLink,
  SlidersHorizontal,
  TrendingUp,
  TrendingDown
  } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ColoredSlider } from '@/components/ui/colored-slider';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import SignalCard from '@/components/dashboard/SignalCard';
import DailyPerformanceCard from '@/components/dashboard/DailyPerformanceCard';


import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MarketDataService } from '@/components/services/MarketDataService';

export default function Overview() {
  const queryClient = useQueryClient();
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [isGenerating, setIsGenerating] = useState(false);

  // Scan Settings State with localStorage persistence
  const [scanSettings, setScanSettings] = useState(() => {
    try {
      const saved = localStorage.getItem('aiScanSettings');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error('Failed to load scan settings', e);
    }
    return {
      minConfidence: 80,
      lotSize: 0.01,
      riskLevel: 'MEDIUM',
      signalSensitivity: 'BALANCED',
      indicators: {
          rsi: true,
          macd: true,
          bollinger: false,
          ema: true,
          stochastic: false
      }
    };
  });

  // Save settings to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('aiScanSettings', JSON.stringify(scanSettings));
  }, [scanSettings]);

  const { data: connections } = useQuery({
    queryKey: ['broker-connections'],
    queryFn: async () => {
      const conns = await base44.entities.BrokerConnection.list('-updated_date');
      console.log('[Overview] Fetched connections:', conns.map(c => ({balance: c.balance, equity: c.equity})));
      return conns;
    },
    refetchInterval: 5000, // Poll every 5s
    staleTime: 0, // Always refetch
    cacheTime: 0, // No cache
    initialData: []
  });

  const activeConnection = connections?.[0] || null;
  const isConnected = activeConnection?.connection_status === 'CONNECTED';

  // Update last updated timestamp when connection data changes
  useEffect(() => {
    if (activeConnection) {
        setLastUpdated(new Date(activeConnection.updated_date || new Date()));
    }
  }, [activeConnection]);

  const { data: trades, refetch: refetchTrades } = useQuery({
    queryKey: ['trades-home'],
    queryFn: async () => {
      // Use function to bypass RLS and show ALL trades from MT4
      const result = await base44.functions.invoke('getAllTrades', {});
      console.log('[Overview] Fetched trades:', result.data.length, result.data);
      return result.data;
    },
    refetchInterval: 3000, // Poll every 3 seconds
    staleTime: 0, // Always consider stale
    gcTime: 0, // Don't cache at all (new React Query v5 syntax)
    initialData: []
  });

  const { data: events } = useQuery({
    queryKey: ['economic-events'],
    queryFn: () => base44.entities.EconomicEvent.list('time', 5),
    initialData: []
  });

  const { data: news } = useQuery({
    queryKey: ['market-news'],
    queryFn: () => base44.entities.NewsItem.list('-created_date', 5),
    initialData: []
  });

  const { data: signals } = useQuery({
    queryKey: ['ai-signals'],
    queryFn: () => base44.entities.Signal.list('-created_date', 3),
    initialData: []
  });

  const { data: pairsList } = useQuery({
    queryKey: ['pairs-overview'],
    queryFn: () => base44.entities.CurrencyPair.list(),
    initialData: []
  });

  const generateSignalMutation = useMutation({
    mutationFn: (signalData) => base44.entities.Signal.create(signalData),
    onSuccess: () => {
      queryClient.invalidateQueries(['ai-signals']);
    }
  });

  const executeSignalMutation = useMutation({
    mutationFn: async (signal) => {
      const allConnections = await base44.entities.BrokerConnection.list('-updated_date');
      const connectedAccounts = allConnections.filter(c => c.connection_status === 'CONNECTED');

      const signalBase = {
        pair: signal.pair,
        type: signal.type,
        entry_price: signal.entry_price,
        stop_loss: signal.stop_loss,
        take_profit: signal.take_profit,
        confidence: signal.confidence,
        lot_size: signal.lot_size || 0.01,
        bot_id: signal.bot_id || null,
        strategy: signal.strategy || 'MANUAL_EXECUTION',
        calculated_indicators: signal.calculated_indicators,
        status: 'PENDING',
        result_pnl: 0
      };

      if (connectedAccounts.length <= 1) {
        // Single account - just update the existing signal
        return base44.entities.Signal.update(signal.id, { 
          status: 'PENDING',
          lot_size: signalBase.lot_size,
          strategy: signalBase.strategy
        });
      }

      // Multiple accounts - mark original as SKIPPED and create one PENDING signal per account
      await base44.entities.Signal.update(signal.id, { status: 'SKIPPED' });
      await Promise.all(connectedAccounts.map(() => 
        base44.entities.Signal.create(signalBase)
      ));
    },
    onSuccess: (_, signal) => {
      queryClient.invalidateQueries(['ai-signals']);
      const count = connections?.filter(c => c.connection_status === 'CONNECTED').length || 1;
      toast.success("Signal sent to MT4", { 
        description: count > 1 ? `Sent to ${count} connected accounts` : "Waiting for execution..." 
      });
    }
  });

  useEffect(() => {
    MarketDataService.initialize();
  }, []);

  const handleGenerateSignals = async () => {
    setIsGenerating(true);
    try {
      // Refresh market data before generating
      await MarketDataService.fetchAll();

      const MAJOR_PAIRS = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF', 'AUD/USD', 'USD/CAD', 'NZD/USD', 'GBP/JPY', 'EUR/JPY', 'XAU/USD', 'BTC/USD', 'ETH/USD'];
      const userPairs = pairsList.map(p => p.symbol);
      // Combine user pairs with major pairs for a broader scan
      const pairs = Array.from(new Set([...userPairs, ...MAJOR_PAIRS]));

      // Prepare active indicators list
      const activeIndicators = Object.entries(scanSettings.indicators)
          .filter(([_, active]) => active)
          .map(([key]) => {
              const names = {
                  rsi: "RSI (14)",
                  macd: "MACD (12,26,9)",
                  bollinger: "Bollinger Bands",
                  ema: "200 EMA",
                  stochastic: "Stochastic Oscillator"
              };
              return names[key];
          });

      // Invoke Backend Function for Real AI Analysis with Enhanced Parameters
      // Only send prices for the pairs being analyzed (avoid oversized payload)
      const filteredMarketData = {};
      pairs.forEach(p => {
          if (MarketDataService.prices[p]) filteredMarketData[p] = MarketDataService.prices[p];
      });

      const response = await base44.functions.invoke('analyzeMarket', {
          pairs,
          marketData: filteredMarketData,
          minConfidence: scanSettings.minConfidence,
          riskLevel: scanSettings.riskLevel,
          signalSensitivity: scanSettings.signalSensitivity,
          indicators: activeIndicators,
          timeframe: 'H1', // Default to H1 for Overview page signals
          botId: null // Manual scan from Overview - no bot association
      });

      console.log("AI Analysis Response:", response);
      const aiSignal = response.data;

      if (aiSignal && aiSignal.pair && !aiSignal.error) {
          // Prevent duplicates - check both ANALYSIS and PENDING/ACTIVE signals
          const isDuplicate = signals.some(s => 
            s.pair === aiSignal.pair && 
            (s.status === 'ANALYSIS' || s.status === 'PENDING' || s.status === 'ACTIVE')
          );

          if (isDuplicate) {
             toast.info("Signal Already Exists", { description: `${aiSignal.pair} signal is already active or pending.` });
             return;
          }

          generateSignalMutation.mutate({
              pair: aiSignal.pair,
              type: aiSignal.type,
              entry_price: Number(aiSignal.entry_price),
              stop_loss: Number(aiSignal.stop_loss),
              take_profit: Number(aiSignal.take_profit),
              confidence: Number(aiSignal.confidence),
              lot_size: scanSettings.lotSize,
              strategy: aiSignal.strategy, // AI generated strategy name
              calculated_indicators: aiSignal.calculated_indicators,
              status: 'ANALYSIS',
              result_pnl: 0
          });
          toast.success("AI Analysis Complete", { description: `Found setup for ${aiSignal.pair}` });
      } else if (aiSignal && aiSignal.error) {
          toast.error("AI Analysis Failed", { description: aiSignal.error });
      } else {
          toast.warning("No Signals Found", { description: "No high-confidence setups detected" });
      }
    } catch (error) {
        console.error("AI Generation Failed:", error);
        const errorMsg = error.response?.data?.error || error.message || "Unknown error";
        toast.error("Failed to generate signal", { description: errorMsg });
    } finally {
        setIsGenerating(false);
    }
  };

  // MT4 Account Data
  const baseBalance = (activeConnection?.balance && activeConnection.balance > 0) ? activeConnection.balance : 10000;
  // Use real equity from broker connection, falling back to balance if not available
  const currentEquity = (activeConnection?.equity && activeConnection.equity > 0) ? activeConnection.equity : baseBalance;
  const currentMargin = activeConnection?.margin || 0;
  
  // Calculate derived values if not provided by broker
  const freeMargin = activeConnection?.free_margin || (currentEquity - currentMargin);
  const marginLevel = activeConnection?.margin_level || (currentMargin > 0 ? (currentEquity / currentMargin) * 100 : 0);
  
  const mt4Account = {
    broker: activeConnection?.server_name || "Demo Broker",
    server: activeConnection?.server_name || "Demo-Server",
    accountNumber: activeConnection?.account_number || "---",
    platform: activeConnection?.platform || "MT4",
    leverage: activeConnection?.leverage || "1:500",
    currency: activeConnection?.currency || "USD",
    balance: baseBalance,
    equity: currentEquity,
    margin: currentMargin,
    freeMargin: freeMargin,
    marginLevel: marginLevel,
    profit: currentEquity - baseBalance
  };

  const refreshConnection = async () => {
    try {
      await base44.functions.invoke('forceSync', {});
      queryClient.invalidateQueries(['broker-connections']);
      queryClient.invalidateQueries(['trades-home']);
      setLastUpdated(new Date());
      toast.success('Sync Complete', { description: 'Trade data synchronized with MT4' });
    } catch (e) {
      toast.error('Sync Failed', { description: e.message });
    }
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Enhanced Header & Connection Status */}
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/10 via-cyan-500/10 to-blue-500/10 rounded-2xl blur-3xl"></div>
        <div className="relative bg-slate-900/60 backdrop-blur-xl border border-slate-800/50 rounded-2xl p-6 shadow-2xl">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-white via-emerald-100 to-cyan-100 bg-clip-text text-transparent tracking-tight">
                Trading Dashboard
              </h1>
              <p className="text-slate-400 mt-2 text-lg">MT4 Account Status & Market Intelligence</p>
            </div>
            <div className="flex items-center gap-3 bg-slate-950/80 p-3 rounded-xl border border-slate-800/50 backdrop-blur-sm shadow-lg">
              <div className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold ${isConnected ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shadow-lg shadow-emerald-500/20' : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'}`}>
                {isConnected ? <Wifi className="w-4 h-4 animate-pulse" /> : <WifiOff className="w-4 h-4" />}
                {isConnected ? `Connected to ${activeConnection?.platform || 'MT4'}` : 'Disconnected'}
              </div>
              {activeConnection && (
                  <div className="hidden md:flex items-center gap-2 px-3 text-xs text-slate-400 border-l border-slate-700 pl-3">
                      <span className="font-mono text-slate-300">{activeConnection.server_name}</span>
                      <span className="opacity-50">#</span>
                      <span className="font-mono text-slate-300">{activeConnection.account_number}</span>
                  </div>
              )}
              <div className="h-6 w-[1px] bg-slate-700 mx-1"></div>
              <span className="text-xs text-slate-500 mr-2">
                Last update: {lastUpdated.toLocaleTimeString()}
              </span>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-emerald-400" onClick={refreshConnection}>
                <RefreshCw className={`w-4 h-4`} />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Enhanced MT4 Account Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="relative overflow-hidden bg-gradient-to-br from-slate-900/90 to-slate-900/50 border-slate-800/50 backdrop-blur-sm hover:border-emerald-500/30 transition-all duration-300 group shadow-xl hover:shadow-2xl hover:shadow-emerald-500/10">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <DollarSign className="w-20 h-20 text-emerald-500" />
          </div>
          <CardHeader className="pb-2 relative">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-slate-400 flex items-center gap-2">
                <div className="p-1.5 bg-emerald-500/20 rounded-lg">
                  <DollarSign className="w-4 h-4 text-emerald-400" />
                </div>
                Balance
              </CardTitle>
              <TrendingUp className="w-5 h-5 text-emerald-400" />
            </div>
          </CardHeader>
          <CardContent className="relative">
            <div className="text-4xl font-bold bg-gradient-to-br from-white to-emerald-100 bg-clip-text text-transparent mb-3 tracking-tight">
              ${mt4Account.balance.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-500">
                <span className="text-slate-300 font-medium">{mt4Account.broker}</span>
              </p>
              {activeConnection && <span className="text-emerald-400 text-[10px] border border-emerald-500/30 px-2 py-0.5 rounded-full bg-emerald-500/10 font-semibold">Live</span>}
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden bg-gradient-to-br from-slate-900/90 to-slate-900/50 border-slate-800/50 backdrop-blur-sm hover:border-cyan-500/30 transition-all duration-300 group shadow-xl hover:shadow-2xl hover:shadow-cyan-500/10">
          <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <Activity className="w-20 h-20 text-cyan-500" />
          </div>
          <CardHeader className="pb-2 relative">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-slate-400 flex items-center gap-2">
                <div className="p-1.5 bg-cyan-500/20 rounded-lg">
                  <Activity className="w-4 h-4 text-cyan-400" />
                </div>
                Equity
              </CardTitle>
              {mt4Account.profit >= 0 ? (
                <TrendingUp className="w-5 h-5 text-emerald-400" />
              ) : (
                <TrendingDown className="w-5 h-5 text-rose-400" />
              )}
            </div>
          </CardHeader>
          <CardContent className="relative">
            <div className="text-4xl font-bold bg-gradient-to-br from-white to-cyan-100 bg-clip-text text-transparent mb-3 tracking-tight">
              ${mt4Account.equity.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
            </div>
            <div className={`flex items-center gap-1.5 text-sm font-bold ${mt4Account.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {mt4Account.profit >= 0 ? (
                <TrendingUp className="w-4 h-4" />
              ) : (
                <TrendingDown className="w-4 h-4" />
              )}
              <span>{mt4Account.profit >= 0 ? '+' : ''}${Math.abs(mt4Account.profit).toFixed(2)}</span>
              <span className="text-xs text-slate-500 font-normal">floating</span>
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden bg-gradient-to-br from-slate-900/90 to-slate-900/50 border-slate-800/50 backdrop-blur-sm hover:border-purple-500/30 transition-all duration-300 group shadow-xl hover:shadow-2xl hover:shadow-purple-500/10">
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <PieChart className="w-20 h-20 text-purple-500" />
          </div>
          <CardHeader className="pb-2 relative">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-slate-400 flex items-center gap-2">
                <div className="p-1.5 bg-purple-500/20 rounded-lg">
                  <PieChart className="w-4 h-4 text-purple-400" />
                </div>
                Margin Level
              </CardTitle>
              {mt4Account.marginLevel >= 100 ? (
                <TrendingUp className="w-5 h-5 text-emerald-400" />
              ) : (
                <TrendingDown className="w-5 h-5 text-rose-400" />
              )}
            </div>
          </CardHeader>
          <CardContent className="relative">
            <div className={`text-4xl font-bold mb-3 tracking-tight ${mt4Account.marginLevel >= 100 ? 'bg-gradient-to-br from-white to-purple-100' : 'bg-gradient-to-br from-rose-100 to-rose-300'} bg-clip-text text-transparent`}>
              {mt4Account.marginLevel.toFixed(0)}%
            </div>
            <Progress value={Math.min(100, mt4Account.marginLevel/50)} className="h-2.5 mt-2 bg-slate-800/50 rounded-full shadow-inner" indicatorClassName={`rounded-full ${mt4Account.marginLevel >= 100 ? 'bg-gradient-to-r from-purple-500 to-purple-400' : 'bg-gradient-to-r from-rose-500 to-rose-400'}`} />
            <p className="text-xs text-slate-500 mt-2.5">Leverage: <span className="text-slate-300 font-medium">{mt4Account.leverage}</span></p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden bg-gradient-to-br from-slate-900/90 to-slate-900/50 border-slate-800/50 backdrop-blur-sm hover:border-amber-500/30 transition-all duration-300 group shadow-xl hover:shadow-2xl hover:shadow-amber-500/10">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <BarChart3 className="w-20 h-20 text-amber-500" />
          </div>
          <CardHeader className="pb-2 relative">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-slate-400 flex items-center gap-2">
                <div className="p-1.5 bg-amber-500/20 rounded-lg">
                  <BarChart3 className="w-4 h-4 text-amber-400" />
                </div>
                Free Margin
              </CardTitle>
              <TrendingUp className="w-5 h-5 text-emerald-400" />
            </div>
          </CardHeader>
          <CardContent className="relative">
            <div className="text-4xl font-bold bg-gradient-to-br from-white to-amber-100 bg-clip-text text-transparent mb-3 tracking-tight">
              ${mt4Account.freeMargin.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
            </div>
            <p className="text-xs text-slate-500">
              Used: <span className="text-slate-300 font-semibold">${mt4Account.margin.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Enhanced AI Signal Generator Banner */}
      <Card className="relative overflow-hidden bg-gradient-to-br from-slate-900/90 via-emerald-900/30 to-slate-900/90 border-emerald-500/30 backdrop-blur-xl shadow-2xl shadow-emerald-500/10">
        <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-br from-emerald-500/20 via-cyan-500/10 to-transparent rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-gradient-to-tr from-blue-500/10 to-transparent rounded-full blur-3xl -ml-16 -mb-16 pointer-events-none"></div>
        <CardHeader className="flex flex-row items-center justify-between pb-2 relative">
          <div>
            <CardTitle className="text-white flex items-center gap-3 text-xl">
              <div className="p-2.5 bg-emerald-500/20 rounded-xl border border-emerald-500/30 shadow-lg shadow-emerald-500/20">
                <BrainCircuit className="w-6 h-6 text-emerald-400" />
              </div>
              AI Signal Generator
            </CardTitle>
            <CardDescription className="text-emerald-200/70 mt-2 text-base">
              Real-time market analysis and setup detection
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Popover>
                <PopoverTrigger asChild>
                    <Button variant="outline" className="bg-slate-900/50 border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white hover:border-emerald-500/30 transition-all">
                        <SlidersHorizontal className="w-4 h-4 mr-2" />
                        <span className="hidden sm:inline">Settings</span>
                        <span className="text-[10px] ml-2 px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                            {scanSettings.lotSize} lots
                        </span>
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 bg-slate-900 border-slate-800 text-slate-200 p-4">
                    <div className="space-y-4">
                        <div className="pb-2 mb-2 border-b border-slate-800">
                            <h3 className="font-semibold text-white text-sm flex items-center gap-2">
                                <SlidersHorizontal className="w-4 h-4 text-emerald-400" />
                                AI Scan Configuration
                            </h3>
                            <p className="text-xs text-slate-500 mt-1">Adjust lot size, confidence threshold, and technical indicators</p>
                        </div>
                        <div className="space-y-2">
                            <h4 className="font-medium text-white flex justify-between">
                                Min Confidence
                                <span className="text-emerald-400">{scanSettings.minConfidence}%</span>
                            </h4>
                            <ColoredSlider 
                                value={[scanSettings.minConfidence]} 
                                min={50} 
                                max={99} 
                                step={1}
                                onValueChange={([v]) => setScanSettings(s => ({...s, minConfidence: v}))}
                                className="py-2"
                                rangeClassName="bg-emerald-500"
                                thumbClassName="border-emerald-500"
                            />
                        </div>
                        <div className="space-y-2 pt-2 border-t border-slate-800">
                            <h4 className="font-medium text-white flex justify-between">
                                Lot Size
                                <span className="text-emerald-400">{scanSettings.lotSize}</span>
                            </h4>
                            <ColoredSlider 
                                value={[scanSettings.lotSize * 100]} 
                                min={1} 
                                max={100} 
                                step={1}
                                onValueChange={([v]) => setScanSettings(s => ({...s, lotSize: v / 100}))}
                                className="py-2"
                                rangeClassName="bg-blue-500"
                                thumbClassName="border-blue-500"
                            />
                            <p className="text-xs text-slate-500">Adjust trade volume (0.01 - 1.00 lots)</p>
                        </div>
                        <div className="space-y-3 pt-2 border-t border-slate-800">
                            <h4 className="font-medium text-white text-xs uppercase tracking-wider text-slate-500">Risk Management</h4>

                            <div className="space-y-2">
                                <Label className="text-sm text-slate-300">Risk Level</Label>
                                <div className="grid grid-cols-3 gap-2">
                                    {['LOW', 'MEDIUM', 'HIGH'].map(level => (
                                        <button
                                            key={level}
                                            onClick={() => setScanSettings(s => ({...s, riskLevel: level}))}
                                            className={`px-3 py-2 rounded text-xs font-medium transition-all ${
                                                scanSettings.riskLevel === level
                                                    ? 'bg-emerald-600 text-white'
                                                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                                            }`}
                                        >
                                            {level}
                                        </button>
                                    ))}
                                </div>
                                <p className="text-xs text-slate-500">
                                    {scanSettings.riskLevel === 'LOW' && 'Conservative: Wider stops, 2:1 R/R'}
                                    {scanSettings.riskLevel === 'MEDIUM' && 'Balanced: Standard stops, 1.5:1 R/R'}
                                    {scanSettings.riskLevel === 'HIGH' && 'Aggressive: Tighter stops, 1.2:1 R/R'}
                                </p>
                            </div>

                            <div className="space-y-2">
                                <Label className="text-sm text-slate-300">Signal Sensitivity</Label>
                                <div className="grid grid-cols-3 gap-2">
                                    {['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE'].map(sens => (
                                        <button
                                            key={sens}
                                            onClick={() => setScanSettings(s => ({...s, signalSensitivity: sens}))}
                                            className={`px-3 py-2 rounded text-xs font-medium transition-all ${
                                                scanSettings.signalSensitivity === sens
                                                    ? 'bg-blue-600 text-white'
                                                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                                            }`}
                                        >
                                            {sens.charAt(0) + sens.slice(1).toLowerCase()}
                                        </button>
                                    ))}
                                </div>
                                <p className="text-xs text-slate-500">
                                    {scanSettings.signalSensitivity === 'CONSERVATIVE' && 'Strict: Multi-indicator confluence required'}
                                    {scanSettings.signalSensitivity === 'BALANCED' && 'Standard: 2-3 indicators alignment'}
                                    {scanSettings.signalSensitivity === 'AGGRESSIVE' && 'Opportunistic: Single strong indicator'}
                                </p>
                            </div>
                        </div>
                        <div className="space-y-3 pt-2 border-t border-slate-800">
                            <h4 className="font-medium text-white text-xs uppercase tracking-wider text-slate-500">Active Indicators</h4>
                            
                            <div className="flex items-center justify-between">
                                <Label htmlFor="rsi" className="text-sm">RSI (14)</Label>
                                <Switch 
                                    id="rsi" 
                                    checked={scanSettings.indicators.rsi}
                                    onCheckedChange={(c) => setScanSettings(s => ({...s, indicators: {...s.indicators, rsi: c}}))}
                                    className="data-[state=checked]:bg-emerald-600 scale-75" 
                                />
                            </div>
                            <div className="flex items-center justify-between">
                                <Label htmlFor="macd" className="text-sm">MACD</Label>
                                <Switch 
                                    id="macd" 
                                    checked={scanSettings.indicators.macd}
                                    onCheckedChange={(c) => setScanSettings(s => ({...s, indicators: {...s.indicators, macd: c}}))}
                                    className="data-[state=checked]:bg-emerald-600 scale-75" 
                                />
                            </div>
                            <div className="flex items-center justify-between">
                                <Label htmlFor="bb" className="text-sm">Bollinger Bands</Label>
                                <Switch 
                                    id="bb" 
                                    checked={scanSettings.indicators.bollinger}
                                    onCheckedChange={(c) => setScanSettings(s => ({...s, indicators: {...s.indicators, bollinger: c}}))}
                                    className="data-[state=checked]:bg-emerald-600 scale-75" 
                                />
                            </div>
                            <div className="flex items-center justify-between">
                                <Label htmlFor="ema" className="text-sm">200 EMA</Label>
                                <Switch 
                                    id="ema" 
                                    checked={scanSettings.indicators.ema}
                                    onCheckedChange={(c) => setScanSettings(s => ({...s, indicators: {...s.indicators, ema: c}}))}
                                    className="data-[state=checked]:bg-emerald-600 scale-75" 
                                />
                            </div>
                            <div className="flex items-center justify-between">
                                <Label htmlFor="stoch" className="text-sm">Stochastic</Label>
                                <Switch 
                                    id="stoch" 
                                    checked={scanSettings.indicators.stochastic}
                                    onCheckedChange={(c) => setScanSettings(s => ({...s, indicators: {...s.indicators, stochastic: c}}))}
                                    className="data-[state=checked]:bg-emerald-600 scale-75" 
                                />
                            </div>
                        </div>
                    </div>
                </PopoverContent>
            </Popover>

            <Button 
                onClick={handleGenerateSignals} 
                disabled={isGenerating}
                className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-[0_0_15px_-3px_rgba(16,185,129,0.3)]"
            >
                {isGenerating ? (
                <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Analyzing...</>
                ) : (
                <><Zap className="w-4 h-4 mr-2" /> Scan Market</>
                )}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
             {isGenerating ? (
                // Scanning Animation State
                <>
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-[180px] rounded-xl bg-slate-900/40 border border-slate-800 p-4 animate-pulse relative overflow-hidden">
                       <div className="absolute inset-0 bg-gradient-to-r from-transparent via-emerald-500/5 to-transparent skew-x-12 translate-x-[-100%] animate-[shimmer_1s_infinite]"></div>
                       <div className="flex gap-3 mb-4">
                         <div className="w-10 h-10 rounded-lg bg-slate-800"></div>
                         <div className="space-y-2">
                           <div className="h-4 w-16 bg-slate-800 rounded"></div>
                           <div className="h-3 w-12 bg-slate-800 rounded"></div>
                         </div>
                       </div>
                       <div className="space-y-2 mt-4">
                          <div className="h-8 bg-slate-800/50 rounded"></div>
                          <div className="h-8 bg-slate-800/50 rounded"></div>
                       </div>
                    </div>
                  ))}
                </>
             ) : signals.length === 0 ? (
               <div className="col-span-3 text-center py-8 text-slate-500 text-sm bg-slate-950/30 rounded-lg border border-slate-800/30 border-dashed flex flex-col items-center justify-center gap-2">
                 <BrainCircuit className="w-8 h-8 text-slate-600 mb-2 opacity-50" />
                 <p>AI Engine Standby</p>
                 <p className="text-xs opacity-70">Click "Scan Market" to generate real-time signals</p>
               </div>
             ) : (
               // Show all ANALYSIS signals with Execute button
               signals
                 .filter(signal => signal.status === 'ANALYSIS')
                 .filter((signal, index, self) => 
                    index === self.findIndex((t) => t.pair === signal.pair)
                 )
                 .map(signal => (
                   <SignalCard 
                      key={signal.id} 
                      signal={signal} 
                      onExecute={(updatedSignal) => executeSignalMutation.mutate(updatedSignal)} 
                    />
                 ))
             )}
          </div>
        </CardContent>
      </Card>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Running Trades (Wide) */}
        <div className="lg:col-span-2 space-y-6">
          


          <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-white flex items-center gap-2">
                  <Activity className="w-5 h-5 text-emerald-400" /> Running Trades
                </CardTitle>
                <CardDescription className="text-slate-400">Active market positions</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    const toastId = toast.loading('Waiting for MT4 sync...');
                    try {
                      // Wait 6 seconds for EA to push latest data to bridge
                      await new Promise(resolve => setTimeout(resolve, 6000));
                      
                      // Force complete cache clear
                      queryClient.removeQueries(['trades-home']);
                      
                      // Fetch completely fresh data directly from database
                      const freshTrades = await base44.entities.Trade.filter({ status: 'OPEN' }, '-updated_date', 100);
                      console.log('[REFRESH] Fresh trades from DB:', freshTrades.length, freshTrades);
                      
                      // Update cache with fresh data
                      queryClient.setQueryData(['trades-home'], freshTrades);
                      
                      const count = freshTrades.length;
                      toast.success(`Synced - ${count} open trade${count !== 1 ? 's' : ''}`, { id: toastId });
                    } catch (e) {
                      console.error('Sync error:', e);
                      toast.error('Sync failed: ' + e.message, { id: toastId });
                    }
                  }}
                  className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10 hover:border-emerald-500/50"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Refresh
                </Button>
                <Badge variant="outline" className="border-blue-500/30 text-blue-400 bg-blue-500/10">
                  {trades.length} Open
                </Badge>
                {activeConnection?.last_sync && (
                  <span className="text-[10px] text-slate-500">
                    EA: {Math.floor((Date.now() - new Date(activeConnection.last_sync).getTime()) / 1000)}s ago
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-slate-950/50">
                  <TableRow className="border-slate-800 hover:bg-slate-900/50">
                    <TableHead className="text-slate-400 h-10">Symbol</TableHead>
                    <TableHead className="text-slate-400 h-10">Type</TableHead>
                    <TableHead className="text-slate-400 h-10">Price</TableHead>
                    <TableHead className="text-slate-400 h-10 text-right">Profit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trades.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 text-slate-500">
                        No active trades running
                      </TableCell>
                    </TableRow>
                  ) : (
                    trades.map((trade) => (
                      <TableRow key={trade.id} className="border-slate-800 hover:bg-slate-800/30">
                        <TableCell className="font-medium text-slate-200">{trade.pair}</TableCell>
                        <TableCell>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded ${trade.type === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                            {trade.type}
                          </span>
                        </TableCell>
                        <TableCell className="text-slate-300 text-sm">{trade.open_price}</TableCell>
                        <TableCell className={`text-right font-medium ${(trade.pnl || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {(trade.pnl || 0) >= 0 ? '+' : ''}{(trade.pnl || 0).toFixed(2)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Market News */}
          <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Newspaper className="w-5 h-5 text-amber-400" /> Market News
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {news.map((item, i) => (
                  <div key={i} className="flex gap-4 group">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="secondary" className="bg-slate-800 text-slate-400 text-[10px] h-5 hover:bg-slate-700">
                          {item.source}
                        </Badge>
                        <span className={`text-[10px] font-bold uppercase ${
                          item.sentiment === 'POSITIVE' ? 'text-emerald-400' : 
                          item.sentiment === 'NEGATIVE' ? 'text-rose-400' : 'text-slate-400'
                        }`}>
                          {item.sentiment}
                        </span>
                        <span className="text-[10px] text-slate-500 ml-auto">2h ago</span>
                      </div>
                      <h4 className="text-sm font-medium text-slate-200 group-hover:text-emerald-400 transition-colors cursor-pointer line-clamp-1">
                        {item.title}
                      </h4>
                      <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                        {item.summary}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Economic Calendar & Stats */}
        <div className="space-y-6">
          <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <CalendarDays className="w-5 h-5 text-purple-400" /> Economic Events
              </CardTitle>
              <CardDescription className="text-slate-400">Upcoming high impact events</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-slate-800">
                {events.map((event, i) => (
                  <div key={i} className={`p-4 hover:bg-slate-800/30 transition-colors border-l-4 ${
                    event.impact === 'HIGH' ? 'border-l-red-500 bg-red-500/5' :
                    event.impact === 'MEDIUM' ? 'border-l-yellow-500 bg-yellow-500/5' :
                    'border-l-blue-500 bg-blue-500/5'
                  }`}>
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">{event.time}</span>
                        <span className={`text-xs font-bold px-2.5 py-1 rounded ${
                          event.impact === 'HIGH' ? 'bg-red-500 text-white' :
                          event.impact === 'MEDIUM' ? 'bg-yellow-500 text-slate-900' :
                          'bg-blue-500 text-white'
                        }`}>
                          {event.impact}
                        </span>
                      </div>
                      <span className="font-bold text-slate-300 text-xs">{event.currency}</span>
                      </div>
                      <div className="flex items-center justify-between mb-2 group/link">
                      <p className="text-sm font-medium text-slate-200">{event.title}</p>
                      <a 
                          href={event.url || `https://www.google.com/search?q=${encodeURIComponent(event.title + " " + event.currency + " economic event")}`} 
                          target="_blank" 
                          rel="noreferrer"
                          className="p-1.5 rounded transition-all bg-emerald-500 hover:bg-emerald-600 border border-emerald-400 shadow-lg shadow-emerald-500/20"
                          title="View Event Details"
                      >
                          <ExternalLink className="w-3.5 h-3.5 text-white" />
                      </a>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-[10px] text-slate-500">
                      <div>
                        <span className="block text-slate-600">Actual</span>
                        <span className="text-slate-300 font-mono">{event.actual || '--'}</span>
                      </div>
                      <div>
                        <span className="block text-slate-600">Forecast</span>
                        <span className="text-slate-300 font-mono">{event.forecast}</span>
                      </div>
                      <div>
                        <span className="block text-slate-600">Previous</span>
                        <span className="text-slate-300 font-mono">{event.previous}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <DailyPerformanceCard balance={mt4Account.balance} />
        </div>
      </div>
    </div>
  );
}