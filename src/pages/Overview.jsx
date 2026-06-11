import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  ExternalLink,
  TrendingUp,
  TrendingDown
  } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import DailyPerformanceCard from '@/components/dashboard/DailyPerformanceCard';



export default function Overview() {
  const queryClient = useQueryClient();
  const [lastUpdated, setLastUpdated] = useState(new Date());


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

  const activeConnections = connections?.filter(c => c.connection_status === 'CONNECTED') || [];
  const activeConnection = connections?.[0] || null;
  const isConnected = activeConnections.length > 0;

  // Update last updated timestamp when connection data changes
  useEffect(() => {
    if (activeConnection) {
        setLastUpdated(new Date(activeConnection.updated_date || new Date()));
    }
  }, [activeConnection]);



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





  // Build per-account data array
  const accountList = (connections || []).map(conn => {
    const balance = (conn.balance && conn.balance > 0) ? conn.balance : 0;
    const equity = (conn.equity && conn.equity > 0) ? conn.equity : balance;
    const margin = conn.margin || 0;
    const freeMargin = conn.free_margin || (equity - margin);
    const marginLevel = conn.margin_level || (margin > 0 ? (equity / margin) * 100 : 0);
    return {
      id: conn.id,
      broker: conn.server_name || "Demo Broker",
      accountNumber: conn.account_number || "---",
      platform: conn.platform || "MT4",
      leverage: conn.leverage || "1:500",
      currency: conn.currency || "USD",
      balance, equity, margin, freeMargin, marginLevel,
      profit: equity - balance,
      isConnected: conn.connection_status === 'CONNECTED',
    };
  });

  // Keep mt4Account pointing to first for DailyPerformanceCard compatibility
  const mt4Account = accountList[0] || { balance: 10000, equity: 10000, margin: 0, freeMargin: 10000, marginLevel: 0, profit: 0, broker: 'Demo Broker', accountNumber: '---', platform: 'MT4', leverage: '1:500', currency: 'USD' };

  const refreshConnection = async () => {
    try {
      await base44.functions.invoke('forceSync', {});
      queryClient.invalidateQueries(['broker-connections']);
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

      {/* Per-Account Cards */}
      {accountList.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[['Balance','emerald'],['Equity','cyan'],['Margin Level','purple'],['Free Margin','amber']].map(([label, color]) => (
            <Card key={label} className="bg-slate-900/50 border-slate-800/50 shadow-xl">
              <CardContent className="pt-6">
                <p className="text-sm text-slate-500">{label}</p>
                <p className="text-3xl font-bold text-slate-600 mt-2">--</p>
                <p className="text-xs text-slate-600 mt-2">No account connected</p>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {accountList.map((acct) => (
            <div key={acct.id} className="space-y-2">
              {/* Account label row */}
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${acct.isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`}></div>
                <span className="text-sm font-semibold text-slate-300">{acct.platform} — {acct.broker}</span>
                <span className="text-xs text-slate-500 font-mono">#{acct.accountNumber}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${acct.isConnected ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : 'bg-rose-500/10 text-rose-400 border-rose-500/30'}`}>
                  {acct.isConnected ? 'Live' : 'Offline'}
                </span>
              </div>
              {/* 4 metric cards for this account */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className="relative overflow-hidden bg-gradient-to-br from-slate-900/90 to-slate-900/50 border-slate-800/50 backdrop-blur-sm hover:border-emerald-500/30 transition-all duration-300 group shadow-xl">
                  <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                    <DollarSign className="w-14 h-14 text-emerald-500" />
                  </div>
                  <CardHeader className="pb-1 pt-4 px-4">
                    <CardTitle className="text-xs font-medium text-slate-400 flex items-center gap-2">
                      <div className="p-1 bg-emerald-500/20 rounded"><DollarSign className="w-3 h-3 text-emerald-400" /></div>
                      Balance
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <div className="text-2xl font-bold bg-gradient-to-br from-white to-emerald-100 bg-clip-text text-transparent tracking-tight">
                      ${acct.balance.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1">{acct.currency} · {acct.leverage}</p>
                  </CardContent>
                </Card>

                <Card className="relative overflow-hidden bg-gradient-to-br from-slate-900/90 to-slate-900/50 border-slate-800/50 backdrop-blur-sm hover:border-cyan-500/30 transition-all duration-300 group shadow-xl">
                  <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                    <Activity className="w-14 h-14 text-cyan-500" />
                  </div>
                  <CardHeader className="pb-1 pt-4 px-4">
                    <CardTitle className="text-xs font-medium text-slate-400 flex items-center gap-2">
                      <div className="p-1 bg-cyan-500/20 rounded"><Activity className="w-3 h-3 text-cyan-400" /></div>
                      Equity
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <div className="text-2xl font-bold bg-gradient-to-br from-white to-cyan-100 bg-clip-text text-transparent tracking-tight">
                      ${acct.equity.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                    </div>
                    <div className={`flex items-center gap-1 text-xs font-bold mt-1 ${acct.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {acct.profit >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      {acct.profit >= 0 ? '+' : ''}${Math.abs(acct.profit).toFixed(2)} floating
                    </div>
                  </CardContent>
                </Card>

                <Card className="relative overflow-hidden bg-gradient-to-br from-slate-900/90 to-slate-900/50 border-slate-800/50 backdrop-blur-sm hover:border-purple-500/30 transition-all duration-300 group shadow-xl">
                  <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                    <PieChart className="w-14 h-14 text-purple-500" />
                  </div>
                  <CardHeader className="pb-1 pt-4 px-4">
                    <CardTitle className="text-xs font-medium text-slate-400 flex items-center gap-2">
                      <div className="p-1 bg-purple-500/20 rounded"><PieChart className="w-3 h-3 text-purple-400" /></div>
                      Margin Level
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <div className={`text-2xl font-bold tracking-tight ${acct.marginLevel >= 100 ? 'bg-gradient-to-br from-white to-purple-100' : 'bg-gradient-to-br from-rose-100 to-rose-300'} bg-clip-text text-transparent`}>
                      {acct.marginLevel.toFixed(0)}%
                    </div>
                    <Progress value={Math.min(100, acct.marginLevel / 50)} className="h-1.5 mt-2 bg-slate-800/50 rounded-full" indicatorClassName={`rounded-full ${acct.marginLevel >= 100 ? 'bg-purple-500' : 'bg-rose-500'}`} />
                  </CardContent>
                </Card>

                <Card className="relative overflow-hidden bg-gradient-to-br from-slate-900/90 to-slate-900/50 border-slate-800/50 backdrop-blur-sm hover:border-amber-500/30 transition-all duration-300 group shadow-xl">
                  <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                    <BarChart3 className="w-14 h-14 text-amber-500" />
                  </div>
                  <CardHeader className="pb-1 pt-4 px-4">
                    <CardTitle className="text-xs font-medium text-slate-400 flex items-center gap-2">
                      <div className="p-1 bg-amber-500/20 rounded"><BarChart3 className="w-3 h-3 text-amber-400" /></div>
                      Free Margin
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <div className="text-2xl font-bold bg-gradient-to-br from-white to-amber-100 bg-clip-text text-transparent tracking-tight">
                      ${acct.freeMargin.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1">Used: <span className="text-slate-300">${acct.margin.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span></p>
                  </CardContent>
                </Card>
              </div>
            </div>
          ))}
        </div>
      )}



      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Running Trades (Wide) */}
        <div className="lg:col-span-2 space-y-6">
          




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
                  <div key={i} className="flex gap-4 group p-3 rounded-lg hover:bg-slate-800/40 transition-colors border border-transparent hover:border-slate-700/50">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <Badge variant="secondary" className="bg-slate-800 text-slate-400 text-[10px] h-5 hover:bg-slate-700">
                          {item.source}
                        </Badge>
                        <span className={`text-[10px] font-bold uppercase ${
                          item.sentiment === 'POSITIVE' ? 'text-emerald-400' : 
                          item.sentiment === 'NEGATIVE' ? 'text-rose-400' : 'text-slate-400'
                        }`}>
                          {item.sentiment}
                        </span>
                      </div>
                      <h4 className="text-sm font-medium text-slate-200 group-hover:text-emerald-400 transition-colors line-clamp-1 mb-1">
                        {item.title}
                      </h4>
                      <p className="text-xs text-slate-500 line-clamp-2 mb-2">
                        {item.summary}
                      </p>
                      <a
                        href={item.url || `https://www.google.com/search?q=${encodeURIComponent(item.title)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 hover:text-amber-200 hover:border-amber-400/60 transition-all"
                      >
                        <ExternalLink className="w-3 h-3" />
                        Read Full Article
                      </a>
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