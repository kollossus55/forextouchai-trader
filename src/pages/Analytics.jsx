import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LineChart, PieChart as PieIcon, BarChart3, TrendingUp, TrendingDown, Activity, Percent, DollarSign } from 'lucide-react';

const mockEquityData = [
  { name: 'Jan', value: 10000 },
  { name: 'Feb', value: 12500 },
  { name: 'Mar', value: 11200 },
  { name: 'Apr', value: 14800 },
  { name: 'May', value: 16500 },
  { name: 'Jun', value: 15900 },
  { name: 'Jul', value: 18200 },
  { name: 'Aug', value: 21500 },
  { name: 'Sep', value: 24560 },
];

const mockMonthlyPnL = [
  { name: 'Jan', pnl: 2500 },
  { name: 'Feb', pnl: 2500 },
  { name: 'Mar', pnl: -1300 },
  { name: 'Apr', pnl: 3600 },
  { name: 'May', pnl: 1700 },
  { name: 'Jun', pnl: -600 },
  { name: 'Jul', pnl: 2300 },
  { name: 'Aug', pnl: 3300 },
  { name: 'Sep', pnl: 3060 },
];

const mockAllocation = [
  { name: 'EUR/USD', value: 45 },
  { name: 'GBP/USD', value: 25 },
  { name: 'USD/JPY', value: 20 },
  { name: 'Other', value: 10 },
];

const COLORS = ['#10b981', '#3b82f6', '#8b5cf6', '#64748b'];

export default function Analytics() {
  const [selectedBotId, setSelectedBotId] = React.useState('all');

  const { data: bots } = useQuery({
    queryKey: ['bots'],
    queryFn: () => base44.entities.BotConfig.list(),
    refetchInterval: 5000,
    initialData: []
  });

  const { data: trades } = useQuery({
    queryKey: ['trades-analytics'],
    queryFn: () => base44.entities.Trade.list(),
    refetchInterval: 3000,
    initialData: []
  });

  // Filter trades based on selection
  const filteredTrades = React.useMemo(() => {
    if (selectedBotId === 'all') return trades;
    return trades.filter(t => t.bot_id === selectedBotId);
  }, [trades, selectedBotId]);

  // Calculate Metrics
  const metrics = React.useMemo(() => {
    const totalTrades = filteredTrades.length;
    if (totalTrades === 0) return {
      totalPnL: 0,
      winRate: 0,
      profitFactor: 0,
      maxDrawdown: 0,
      avgTrade: 0,
      totalVolume: 0,
      grossProfit: 0,
      grossLoss: 0,
      winningTrades: 0,
      losingTrades: 0,
      avgWin: 0,
      avgLoss: 0,
      bestTrade: 0,
      worstTrade: 0,
      maxConsecutiveWins: 0,
      maxConsecutiveLosses: 0,
      peak: 0,
      currentEquity: 0
    };

    const closedTrades = filteredTrades.filter(t => t.status === 'CLOSED' || t.pnl !== undefined);
    const winningTrades = closedTrades.filter(t => t.pnl > 0);
    const losingTrades = closedTrades.filter(t => t.pnl <= 0);

    const totalPnL = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
    const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));
    
    const winRate = closedTrades.length > 0 ? (winningTrades.length / closedTrades.length) * 100 : 0;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 100 : 0;
    const avgTrade = closedTrades.length > 0 ? totalPnL / closedTrades.length : 0;
    const totalVolume = filteredTrades.reduce((sum, t) => sum + (t.lot_size || 0), 0);

    const avgWin = winningTrades.length > 0 ? grossProfit / winningTrades.length : 0;
    const avgLoss = losingTrades.length > 0 ? grossLoss / losingTrades.length : 0;
    const bestTrade = closedTrades.length > 0 ? Math.max(...closedTrades.map(t => t.pnl || 0)) : 0;
    const worstTrade = closedTrades.length > 0 ? Math.min(...closedTrades.map(t => t.pnl || 0)) : 0;

    // Calculate consecutive wins/losses
    let maxConsecutiveWins = 0;
    let maxConsecutiveLosses = 0;
    let currentWinStreak = 0;
    let currentLossStreak = 0;
    closedTrades.forEach(trade => {
      if (trade.pnl > 0) {
        currentWinStreak++;
        currentLossStreak = 0;
        if (currentWinStreak > maxConsecutiveWins) maxConsecutiveWins = currentWinStreak;
      } else if (trade.pnl < 0) {
        currentLossStreak++;
        currentWinStreak = 0;
        if (currentLossStreak > maxConsecutiveLosses) maxConsecutiveLosses = currentLossStreak;
      }
    });

    // Max Drawdown calculation
    let peak = 0;
    let maxDD = 0;
    let currentPnL = 0;
    
    closedTrades.forEach(t => {
      currentPnL += t.pnl;
      if (currentPnL > peak) peak = currentPnL;
      const dd = peak - currentPnL;
      if (dd > maxDD) maxDD = dd;
    });

    return {
      totalPnL,
      winRate,
      profitFactor,
      maxDrawdown: maxDD,
      avgTrade,
      totalVolume,
      tradesCount: totalTrades,
      grossProfit,
      grossLoss,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      avgWin,
      avgLoss,
      bestTrade,
      worstTrade,
      maxConsecutiveWins,
      maxConsecutiveLosses,
      peak,
      currentEquity: currentPnL
    };
  }, [filteredTrades]);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <LineChart className="w-8 h-8 text-emerald-500" /> Analytics
          </h1>
          <p className="text-slate-400 mt-1">Deep dive into your trading performance</p>
        </div>
        
        <div className="w-full md:w-64">
           <Select value={selectedBotId} onValueChange={setSelectedBotId}>
             <SelectTrigger className="bg-slate-900 border-slate-800">
               <SelectValue placeholder="Select Bot" />
             </SelectTrigger>
             <SelectContent>
               <SelectItem value="all">All Bots & Manual</SelectItem>
               {bots.map(bot => (
                 <SelectItem key={bot.id} value={bot.id}>{bot.name}</SelectItem>
               ))}
             </SelectContent>
           </Select>
        </div>
      </div>

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-sm">
           <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
             <CardTitle className="text-sm font-medium text-slate-400">Net Profit</CardTitle>
             <DollarSign className={`w-4 h-4 ${metrics.totalPnL >= 0 ? 'text-emerald-500' : 'text-rose-500'}`} />
           </CardHeader>
           <CardContent>
             <div className={`text-2xl font-bold ${metrics.totalPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
               ${metrics.totalPnL.toFixed(2)}
             </div>
             <div className="mt-3 space-y-1.5 text-xs">
               <div className="flex justify-between items-center">
                 <span className="text-slate-500">Gross Profit</span>
                 <span className="text-emerald-400 font-medium">+${metrics.grossProfit.toFixed(2)}</span>
               </div>
               <div className="flex justify-between items-center">
                 <span className="text-slate-500">Gross Loss</span>
                 <span className="text-rose-400 font-medium">-${metrics.grossLoss.toFixed(2)}</span>
               </div>
               <div className="flex justify-between items-center pt-1 border-t border-slate-800">
                 <span className="text-slate-500">Best Trade</span>
                 <span className="text-emerald-400 font-medium">+${metrics.bestTrade.toFixed(2)}</span>
               </div>
               <div className="flex justify-between items-center">
                 <span className="text-slate-500">Worst Trade</span>
                 <span className="text-rose-400 font-medium">${metrics.worstTrade.toFixed(2)}</span>
               </div>
             </div>
           </CardContent>
        </Card>

        <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-sm">
           <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
             <CardTitle className="text-sm font-medium text-slate-400">Win Rate</CardTitle>
             <Percent className="w-4 h-4 text-blue-500" />
           </CardHeader>
           <CardContent>
             <div className="text-2xl font-bold text-blue-400">
               {metrics.winRate.toFixed(1)}%
             </div>
             <div className="mt-3 space-y-1.5 text-xs">
               <div className="flex justify-between items-center">
                 <span className="text-slate-500">Winning Trades</span>
                 <span className="text-emerald-400 font-medium">{metrics.winningTrades}</span>
               </div>
               <div className="flex justify-between items-center">
                 <span className="text-slate-500">Losing Trades</span>
                 <span className="text-rose-400 font-medium">{metrics.losingTrades}</span>
               </div>
               <div className="flex justify-between items-center pt-1 border-t border-slate-800">
                 <span className="text-slate-500">Max Win Streak</span>
                 <span className="text-emerald-400 font-medium">{metrics.maxConsecutiveWins}</span>
               </div>
               <div className="flex justify-between items-center">
                 <span className="text-slate-500">Max Loss Streak</span>
                 <span className="text-rose-400 font-medium">{metrics.maxConsecutiveLosses}</span>
               </div>
             </div>
           </CardContent>
        </Card>

        <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-sm">
           <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
             <CardTitle className="text-sm font-medium text-slate-400">Profit Factor</CardTitle>
             <TrendingUp className="w-4 h-4 text-amber-500" />
           </CardHeader>
           <CardContent>
             <div className="text-2xl font-bold text-amber-400">
               {metrics.profitFactor.toFixed(2)}
             </div>
             <div className="mt-3 space-y-1.5 text-xs">
               <div className="flex justify-between items-center">
                 <span className="text-slate-500">Avg Win</span>
                 <span className="text-emerald-400 font-medium">+${metrics.avgWin.toFixed(2)}</span>
               </div>
               <div className="flex justify-between items-center">
                 <span className="text-slate-500">Avg Loss</span>
                 <span className="text-rose-400 font-medium">-${metrics.avgLoss.toFixed(2)}</span>
               </div>
               <div className="flex justify-between items-center pt-1 border-t border-slate-800">
                 <span className="text-slate-500">Risk/Reward</span>
                 <span className="text-white font-medium">{metrics.avgLoss > 0 ? (metrics.avgWin / metrics.avgLoss).toFixed(2) : '0.00'}</span>
               </div>
               <div className="flex justify-between items-center">
                 <span className="text-slate-500">Rating</span>
                 <span className={metrics.profitFactor >= 1.5 ? 'text-emerald-400' : metrics.profitFactor >= 1 ? 'text-amber-400' : 'text-rose-400'}>
                   {metrics.profitFactor >= 1.5 ? 'Excellent' : metrics.profitFactor >= 1 ? 'Good' : 'Poor'}
                 </span>
               </div>
             </div>
           </CardContent>
        </Card>

        <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-sm">
           <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
             <CardTitle className="text-sm font-medium text-slate-400">Max Drawdown</CardTitle>
             <TrendingDown className="w-4 h-4 text-rose-500" />
           </CardHeader>
           <CardContent>
             <div className="text-2xl font-bold text-rose-400">
               -${metrics.maxDrawdown.toFixed(2)}
             </div>
             <div className="mt-3 space-y-1.5 text-xs">
               <div className="flex justify-between items-center">
                 <span className="text-slate-500">Peak Equity</span>
                 <span className="text-white font-medium">${metrics.peak.toFixed(2)}</span>
               </div>
               <div className="flex justify-between items-center">
                 <span className="text-slate-500">Current Equity</span>
                 <span className="text-white font-medium">${metrics.currentEquity.toFixed(2)}</span>
               </div>
               <div className="flex justify-between items-center pt-1 border-t border-slate-800">
                 <span className="text-slate-500">Drawdown %</span>
                 <span className="text-rose-400 font-medium">
                   {metrics.peak > 0 ? ((metrics.maxDrawdown / metrics.peak) * 100).toFixed(1) : '0.0'}%
                 </span>
               </div>
               <div className="flex justify-between items-center">
                 <span className="text-slate-500">Total Trades</span>
                 <span className="text-white font-medium">{metrics.tradesCount}</span>
               </div>
             </div>
           </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 bg-slate-900/50 border-slate-800 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="text-white">Equity Curve</CardTitle>
            <CardDescription className="text-slate-400">Account growth over time</CardDescription>
          </CardHeader>
          <CardContent className="h-[350px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={mockEquityData}>
                <defs>
                  <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="name" stroke="#64748b" tick={{fontSize: 12}} tickLine={false} axisLine={false} />
                <YAxis stroke="#64748b" tick={{fontSize: 12}} tickLine={false} axisLine={false} tickFormatter={(value) => `$${value/1000}k`} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#f8fafc' }}
                  itemStyle={{ color: '#10b981' }}
                />
                <Area type="monotone" dataKey="value" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorValue)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <PieIcon className="w-5 h-5 text-purple-400" /> Allocation
              </CardTitle>
            </CardHeader>
            <CardContent className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={mockAllocation}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    fill="#8884d8"
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {mockAllocation.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#f8fafc' }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex justify-center gap-4 text-xs text-slate-400 mt-2">
                {mockAllocation.map((entry, index) => (
                  <div key={index} className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[index] }}></div>
                    {entry.name}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-400" /> Monthly Performance
          </CardTitle>
        </CardHeader>
        <CardContent className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={mockMonthlyPnL}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="name" stroke="#64748b" tick={{fontSize: 12}} tickLine={false} axisLine={false} />
              <YAxis stroke="#64748b" tick={{fontSize: 12}} tickLine={false} axisLine={false} tickFormatter={(value) => `$${value}`} />
              <Tooltip 
                cursor={{fill: '#1e293b', opacity: 0.4}}
                contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#f8fafc' }}
              />
              <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                {mockMonthlyPnL.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? '#10b981' : '#f43f5e'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}