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
  SlidersHorizontal
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
import AITradeManagerCard from '@/components/dashboard/AITradeManagerCard';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MarketDataService } from '@/components/services/MarketDataService';

export default function Overview() {
  const queryClient = useQueryClient();
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [isGenerating, setIsGenerating] = useState(false);
  
  // Scan Settings State
  const [scanSettings, setScanSettings] = useState({
    minConfidence: 80,
    lotSize: 0.01,
    indicators: {
        rsi: true,
        macd: true,
        bollinger: false,
        ema: true,
        stochastic: false
    }
  });

  const { data: connections } = useQuery({
    queryKey: ['broker-connections'],
    queryFn: () => base44.entities.BrokerConnection.list(),
    refetchInterval: 3000, // Poll every 3 seconds for updates
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

  const { data: trades } = useQuery({
    queryKey: ['trades-home'],
    queryFn: () => base44.entities.Trade.filter({ status: 'OPEN' }, '-updated_date', 10),
    refetchInterval: 3000, // Refresh UI every 3s to show live PnL updates
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
    mutationFn: (signal) => base44.entities.Signal.update(signal.id, { 
        status: 'PENDING',
        lot_size: signal.lot_size || 0.01 
    }),
    onSuccess: () => {
      queryClient.invalidateQueries(['ai-signals']);
      toast.success("Trade Sent to MT4");
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

      // Invoke Backend Function for Real AI Analysis with Timeframe
      const { data: aiSignal } = await base44.functions.invoke('analyzeMarket', {
          pairs,
          marketData: MarketDataService.prices,
          minConfidence: scanSettings.minConfidence,
          indicators: activeIndicators,
          timeframe: 'H1' // Default to H1 for Overview page signals
      });

      if (aiSignal && aiSignal.pair) {
          // Prevent duplicates
          const isDuplicate = signals.some(s => s.pair === aiSignal.pair && s.status === 'ANALYSIS');
          
          if (isDuplicate) {
             toast.info("Analysis Updated", { description: `Latest setup for ${aiSignal.pair} is already shown.` });
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
              status: 'ANALYSIS',
              result_pnl: 0
          });
          toast.success("AI Analysis Complete", { description: `Found setup for ${aiSignal.pair}` });
      }
    } catch (error) {
        console.error("AI Generation Failed:", error);
        toast.error("Failed to generate signal", { description: "Please check OpenAI API Key" });
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
    broker: activeConnection ? activeConnection.server_name.split('-')[0] : "Demo Broker",
    server: activeConnection ? activeConnection.server_name : "Demo-Server",
    accountNumber: activeConnection ? activeConnection.account_number : "---",
    platform: activeConnection ? activeConnection.platform : "MT4",
    leverage: activeConnection?.leverage || "1:500",
    currency: activeConnection?.currency || "USD",
    balance: baseBalance,
    equity: currentEquity,
    margin: currentMargin,
    freeMargin: freeMargin,
    marginLevel: marginLevel,
    profit: currentEquity - baseBalance
  };

  const refreshConnection = () => {
    queryClient.invalidateQueries(['broker-connections']);
    setLastUpdated(new Date());
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header & Connection Status */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Overview</h1>
          <p className="text-slate-400 mt-1">MT4 Account Status & Market Intelligence</p>
        </div>
        <div className="flex items-center gap-3 bg-slate-900/50 p-2 rounded-lg border border-slate-800 backdrop-blur-sm">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium ${isConnected ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
            {isConnected ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
            {isConnected ? `Connected to ${activeConnection?.platform || 'MT4'}` : 'Disconnected'}
          </div>
          {activeConnection && (
              <div className="hidden md:flex items-center gap-2 px-2 text-xs text-slate-400 border-l border-slate-700 pl-3">
                  <span className="font-mono text-slate-300">{activeConnection.server_name}</span>
                  <span className="opacity-50">#</span>
                  <span className="font-mono text-slate-300">{activeConnection.account_number}</span>
              </div>
          )}
          <div className="h-6 w-[1px] bg-slate-700 mx-1"></div>
          <span className="text-xs text-slate-500 mr-2">
            Last update: {lastUpdated.toLocaleTimeString()}
          </span>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-white" onClick={refreshConnection}>
            <RefreshCw className={`w-4 h-4`} />
          </Button>
        </div>
      </div>

      {/* MT4 Account Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-slate-900 to-slate-900 border-slate-800 shadow-lg relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <DollarSign className="w-16 h-16 text-emerald-500" />
          </div>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">Balance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">${mt4Account.balance.toLocaleString('en-US', {minimumFractionDigits: 2})}</div>
            <p className="text-xs text-slate-500 mt-1 flex justify-between">
              <span>Broker: <span className="text-slate-300">{mt4Account.broker}</span></span>
              {activeConnection && <span className="text-emerald-400 text-[10px] border border-emerald-500/20 px-1 rounded bg-emerald-500/10">Live</span>}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-slate-900 to-slate-900 border-slate-800 shadow-lg relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <Activity className="w-16 h-16 text-blue-500" />
          </div>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">Equity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">${mt4Account.equity.toLocaleString('en-US', {minimumFractionDigits: 2})}</div>
            <div className={`flex items-center text-xs mt-1 ${mt4Account.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {mt4Account.profit >= 0 ? '+' : ''}${mt4Account.profit.toFixed(2)} floating
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-slate-900 to-slate-900 border-slate-800 shadow-lg relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <PieChart className="w-16 h-16 text-purple-500" />
          </div>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">Margin Level</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">{mt4Account.marginLevel.toFixed(2)}%</div>
            <Progress value={Math.min(100, mt4Account.marginLevel/50)} className="h-1.5 mt-2 bg-slate-800" indicatorClassName="bg-purple-500" />
            <p className="text-xs text-slate-500 mt-1">Leverage: {mt4Account.leverage}</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-slate-900 to-slate-900 border-slate-800 shadow-lg relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <BarChart3 className="w-16 h-16 text-amber-500" />
          </div>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">Free Margin</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">${mt4Account.freeMargin.toLocaleString('en-US', {minimumFractionDigits: 2})}</div>
            <p className="text-xs text-slate-500 mt-1">
              Used: <span className="text-slate-300">${mt4Account.margin.toLocaleString()}</span>
            </p>
          </CardContent>
        </Card>
      </div>

      {/* AI Signal Generator Banner */}
      <Card className="bg-gradient-to-r from-emerald-900/30 to-slate-900 border-emerald-500/30 relative overflow-hidden mb-6">
        <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none"></div>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle className="text-white flex items-center gap-2">
              <BrainCircuit className="w-5 h-5 text-emerald-400" /> AI Signal Generator
            </CardTitle>
            <CardDescription className="text-emerald-200/60">
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
               // Deduplicate signals by pair for display
               signals
                 .filter((signal, index, self) => 
                    index === self.findIndex((t) => t.pair === signal.pair)
                 )
                 .map(signal => (
                   <SignalCard 
                      key={signal.id} 
                      signal={signal} 
                      onExecute={() => executeSignalMutation.mutate(signal)} 
                    />
                 ))
             )}
          </div>
        </CardContent>
      </Card>

      {/* AI Trade Manager Card */}
      <div className="grid grid-cols-1 gap-6">
        <AITradeManagerCard />
      </div>

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
                  onClick={() => {
                    queryClient.invalidateQueries(['trades-home']);
                    queryClient.invalidateQueries(['broker-connections']);
                    toast.success('Syncing with MT4...');
                  }}
                  className="text-slate-300 border-slate-700 hover:bg-slate-800"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Sync Now
                </Button>
                <Badge variant="outline" className="border-blue-500/30 text-blue-400 bg-blue-500/10">
                  {trades.length} Open
                </Badge>
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
                        <TableCell className={`text-right font-medium ${trade.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {trade.pnl >= 0 ? '+' : ''}{trade.pnl.toFixed(2)}
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
                  <div key={i} className="p-4 hover:bg-slate-800/30 transition-colors">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">{event.time}</span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                          event.impact === 'HIGH' ? 'border-rose-500/30 text-rose-400 bg-rose-500/10' :
                          event.impact === 'MEDIUM' ? 'border-amber-500/30 text-amber-400 bg-amber-500/10' :
                          'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
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
                          className="opacity-0 group-hover/link:opacity-100 transition-opacity p-1 hover:bg-slate-800 rounded"
                          title="View Event Details"
                      >
                          <ExternalLink className="w-3.5 h-3.5 text-slate-400 hover:text-emerald-400" />
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

          <Card className="bg-gradient-to-br from-emerald-900/20 to-slate-900 border-emerald-500/20">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-white">Daily Performance</h3>
                <Badge className="bg-emerald-500 text-white hover:bg-emerald-600 border-0">+4.2%</Badge>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Profit</span>
                  <span className="text-emerald-400 font-mono">+$1,240.50</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Trades</span>
                  <span className="text-slate-200 font-mono">12 (8 Wins)</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Lots</span>
                  <span className="text-slate-200 font-mono">4.52</span>
                </div>
                <Progress value={75} className="h-1.5 mt-2 bg-slate-800" indicatorClassName="bg-emerald-500" />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}