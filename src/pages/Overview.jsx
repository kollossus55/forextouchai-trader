import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
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
  Zap
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import SignalCard from '@/components/dashboard/SignalCard';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MarketDataService } from '@/components/services/MarketDataService';

export default function Overview() {
  const queryClient = useQueryClient();
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [isGenerating, setIsGenerating] = useState(false);
  const [simulatedEquity, setSimulatedEquity] = useState(0);

  const { data: connections } = useQuery({
    queryKey: ['broker-connections'],
    queryFn: () => base44.entities.BrokerConnection.list(),
    initialData: []
  });

  const activeConnection = connections?.[0] || null;
  const isConnected = activeConnection?.connection_status === 'CONNECTED';

  // Simulate Live Data Feed from Bridge
  useEffect(() => {
    if (!isConnected) return;
    
    // Default base balance if 0 (simulating initial sync)
    const baseBalance = (activeConnection?.balance && activeConnection.balance > 0) ? activeConnection.balance : 10000;
    
    setSimulatedEquity(baseBalance);

    const interval = setInterval(() => {
        // Simulate minor market fluctuations on equity
        setSimulatedEquity(prev => {
            const volatility = (Math.random() - 0.5) * 15; // Random fluctuation
            return prev + volatility;
        });
        setLastUpdated(new Date());
    }, 2000);
    
    return () => clearInterval(interval);
  }, [isConnected, activeConnection?.balance]);

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

  const generateSignalMutation = useMutation({
    mutationFn: (signalData) => base44.entities.Signal.create(signalData),
    onSuccess: () => {
      queryClient.invalidateQueries(['ai-signals']);
    }
  });

  const executeSignalMutation = useMutation({
    mutationFn: (signal) => base44.entities.Signal.update(signal.id, { status: 'PENDING' }),
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
    // Refresh market data before generating
    await MarketDataService.fetchAll();
    
    // Simulate AI Processing time
    setTimeout(() => {
      const pairs = ['EUR/USD', 'GBP/USD', 'XAU/USD', 'USD/JPY', 'BTC/USD'];
      const pair = pairs[Math.floor(Math.random() * pairs.length)];
      
      // Get Real Price
      const currentPrice = MarketDataService.getPrice(pair);
      
      // AI Logic Simulation
      const type = Math.random() > 0.5 ? 'BUY' : 'SELL';
      const price = currentPrice;
      
      // Calculate SL/TP based on pair volatility (approx)
      const isJpy = pair.includes('JPY');
      const isCrypto = pair.includes('BTC');
      const pipMult = isJpy ? 0.01 : (isCrypto ? 10 : 0.0001);
      
      const slPips = isCrypto ? 50 : 30;
      const tpPips = isCrypto ? 150 : 60;
      
      const sl = type === 'BUY' ? price - (slPips * pipMult) : price + (slPips * pipMult);
      const tp = type === 'BUY' ? price + (tpPips * pipMult) : price - (tpPips * pipMult);
      
      generateSignalMutation.mutate({
        pair,
        type,
        entry_price: parseFloat(price.toFixed(isJpy || isCrypto ? 2 : 5)),
        stop_loss: parseFloat(sl.toFixed(isJpy || isCrypto ? 2 : 5)),
        take_profit: parseFloat(tp.toFixed(isJpy || isCrypto ? 2 : 5)),
        confidence: Math.floor(Math.random() * 15) + 85, // 85-99%
        strategy: 'AI_SMART_SCALPER',
        status: 'ANALYSIS',
        result_pnl: 0
      });
      setIsGenerating(false);
    }, 2000);
  };

  // MT4 Account Data (with simulation fallback)
  const baseBalance = (activeConnection?.balance && activeConnection.balance > 0) ? activeConnection.balance : 10000;
  const currentEquity = simulatedEquity || baseBalance;
  const currentMargin = activeConnection?.margin || 145.20; // Simulated used margin
  
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
    freeMargin: currentEquity - currentMargin,
    marginLevel: currentMargin > 0 ? (currentEquity / currentMargin) * 100 : 0,
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
               signals.map(signal => (
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
              <Badge variant="outline" className="border-blue-500/30 text-blue-400 bg-blue-500/10">
                {trades.length} Open
              </Badge>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-slate-950/50">
                  <TableRow className="border-slate-800 hover:bg-slate-900/50">
                    <TableHead className="text-slate-400 h-10">Symbol</TableHead>
                    <TableHead className="text-slate-400 h-10">Type</TableHead>
                    <TableHead className="text-slate-400 h-10">Vol</TableHead>
                    <TableHead className="text-slate-400 h-10">Price</TableHead>
                    <TableHead className="text-slate-400 h-10 text-right">Profit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trades.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-slate-500">
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
                        <TableCell className="text-slate-300 text-sm">{trade.lot_size}</TableCell>
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
                    <p className="text-sm font-medium text-slate-200 mb-2">{event.title}</p>
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