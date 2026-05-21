import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend
} from 'recharts';
import {
  DollarSign, TrendingUp, TrendingDown, Activity, Bot, Shield,
  AlertTriangle, CheckCircle, RefreshCw, Wallet, Target
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';

const fmt = (n) => n == null ? '–' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function AdminOverview() {
  const { user } = useAuth();

  const { data: connections = [], refetch, isFetching } = useQuery({
    queryKey: ['ao-connections'],
    queryFn: () => base44.entities.BrokerConnection.list('-updated_date', 100),
    refetchInterval: 30000,
    initialData: []
  });

  const { data: openTrades = [] } = useQuery({
    queryKey: ['ao-open-trades'],
    queryFn: () => base44.entities.Trade.filter({ status: 'OPEN' }, '-created_date', 500),
    refetchInterval: 30000,
    initialData: []
  });

  const { data: closedTrades = [] } = useQuery({
    queryKey: ['ao-closed-trades'],
    queryFn: () => base44.entities.Trade.filter({ status: 'CLOSED' }, '-updated_date', 500),
    refetchInterval: 60000,
    initialData: []
  });

  const { data: bots = [] } = useQuery({
    queryKey: ['ao-bots'],
    queryFn: () => base44.entities.BotConfig.list('-updated_date', 100),
    refetchInterval: 30000,
    initialData: []
  });

  const { data: riskSettings = [] } = useQuery({
    queryKey: ['ao-risk'],
    queryFn: () => base44.entities.RiskManagementSettings.list('-created_date', 100),
    initialData: []
  });

  const today = new Date().toISOString().split('T')[0];

  // ── Aggregated metrics ──
  const metrics = useMemo(() => {
    const connected = connections.filter(c => c.connection_status === 'CONNECTED');
    const totalBalance = connected.reduce((s, c) => s + (c.balance || 0), 0);
    const totalEquity = connected.reduce((s, c) => s + (c.equity || 0), 0);
    const floatingPnl = totalEquity - totalBalance;

    const wins = closedTrades.filter(t => (t.pnl || 0) > 0).length;
    const losses = closedTrades.filter(t => (t.pnl || 0) < 0).length;
    const total = wins + losses;
    const winRate = total > 0 ? (wins / total) * 100 : 0;

    const todayTrades = closedTrades.filter(t => (t.updated_date || t.created_date || '').startsWith(today));
    const todayPnl = todayTrades.reduce((s, t) => s + (t.pnl || 0), 0);

    const runningBots = bots.filter(b => b.status === 'RUNNING').length;
    const pausedAccounts = riskSettings.filter(r => r.is_trading_paused).length;

    return { totalBalance, totalEquity, floatingPnl, wins, losses, winRate, todayPnl, runningBots, pausedAccounts, connectedCount: connected.length };
  }, [connections, closedTrades, bots, riskSettings, today]);

  // ── Per-account rows ──
  const accountRows = useMemo(() => {
    return connections.map(conn => {
      const acctNum = conn.account_number;
      const acctOpenTrades = openTrades.filter(t => t.owner_email === acctNum);
      const acctClosedTrades = closedTrades.filter(t => t.owner_email === acctNum);
      const todayPnl = acctClosedTrades
        .filter(t => (t.updated_date || t.created_date || '').startsWith(today))
        .reduce((s, t) => s + (t.pnl || 0), 0);
      const wins = acctClosedTrades.filter(t => (t.pnl || 0) > 0).length;
      const losses = acctClosedTrades.filter(t => (t.pnl || 0) < 0).length;
      const winRate = (wins + losses) > 0 ? Math.round((wins / (wins + losses)) * 100) : null;
      const risk = riskSettings.find(r => r.account_number === acctNum);
      const isStale = conn.last_sync ? (Date.now() - new Date(conn.last_sync).getTime()) > 300000 : true;
      const isLive = conn.connection_status === 'CONNECTED' && !isStale;
      return { ...conn, acctOpenTrades, todayPnl, wins, losses, winRate, isPaused: risk?.is_trading_paused || false, isLive };
    });
  }, [connections, openTrades, closedTrades, riskSettings, today]);

  // ── Win/Loss by pair (top 8) ──
  const pairPnl = useMemo(() => {
    const map = {};
    for (const t of closedTrades) {
      const p = (t.pair || 'Unknown').replace('/', '');
      if (!map[p]) map[p] = { pair: p, pnl: 0, trades: 0 };
      map[p].pnl += t.pnl || 0;
      map[p].trades++;
    }
    return Object.values(map).sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl)).slice(0, 8);
  }, [closedTrades]);

  // ── Win/Loss pie ──
  const pieData = [
    { name: 'Wins', value: metrics.wins, color: '#10b981' },
    { name: 'Losses', value: metrics.losses, color: '#f43f5e' },
  ];

  if (user?.role !== 'admin') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="bg-slate-900/50 border-slate-800 p-8 text-center max-w-md">
          <Shield className="w-16 h-16 text-rose-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">Access Denied</h2>
          <p className="text-slate-400">Admins only.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Activity className="w-8 h-8 text-emerald-500" /> Admin Overview
          </h1>
          <p className="text-slate-400 mt-1">Live platform health across all accounts</p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Paused accounts alert */}
      {metrics.pausedAccounts > 0 && (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm font-medium">{metrics.pausedAccounts} account(s) have trading paused due to risk limits.</span>
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
        <StatCard icon={<Wallet className="w-5 h-5 text-cyan-400" />} label="Total Equity" value={`$${fmt(metrics.totalEquity)}`} sub={`Balance: $${fmt(metrics.totalBalance)}`} />
        <StatCard icon={<DollarSign className="w-5 h-5 text-emerald-400" />} label="Floating P&L" value={`${metrics.floatingPnl >= 0 ? '+' : ''}$${fmt(metrics.floatingPnl)}`} valueClass={metrics.floatingPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'} sub="Unrealised" />
        <StatCard icon={<Target className="w-5 h-5 text-purple-400" />} label="Win Rate" value={`${metrics.winRate.toFixed(1)}%`} sub={`${metrics.wins}W / ${metrics.losses}L`} />
        <StatCard icon={<Activity className="w-5 h-5 text-amber-400" />} label="Active Trades" value={openTrades.length} sub={`${metrics.connectedCount} connected accounts`} />
        <StatCard icon={<Bot className="w-5 h-5 text-emerald-400" />} label="Running Bots" value={metrics.runningBots} sub={`of ${bots.length} total`} />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* P&L by pair */}
        <Card className="bg-slate-900/50 border-slate-800 lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-white text-sm flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-400" /> P&L by Pair (all-time)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {pairPnl.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-8">No closed trade data yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={pairPnl} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <XAxis dataKey="pair" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={v => `$${v}`} />
                  <Tooltip
                    contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }}
                    labelStyle={{ color: '#e2e8f0' }}
                    formatter={(v) => [`$${fmt(v)}`, 'P&L']}
                  />
                  <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                    {pairPnl.map((entry, i) => (
                      <Cell key={i} fill={entry.pnl >= 0 ? '#10b981' : '#f43f5e'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Win/Loss pie */}
        <Card className="bg-slate-900/50 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white text-sm flex items-center gap-2">
              <Target className="w-4 h-4 text-purple-400" /> Win / Loss Ratio
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-center">
            {metrics.wins + metrics.losses === 0 ? (
              <p className="text-slate-500 text-sm text-center py-8">No closed trade data yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={4}>
                    {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }}
                    formatter={(v, name) => [v, name]}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Per-account table */}
      <Card className="bg-slate-900/50 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Wallet className="w-5 h-5 text-cyan-400" /> Account Performance
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-950/50">
                <TableRow className="border-slate-800">
                  <TableHead className="text-slate-400">Account</TableHead>
                  <TableHead className="text-slate-400">Platform</TableHead>
                  <TableHead className="text-slate-400 text-right">Balance</TableHead>
                  <TableHead className="text-slate-400 text-right">Equity</TableHead>
                  <TableHead className="text-slate-400 text-right">Open Trades</TableHead>
                  <TableHead className="text-slate-400 text-right">Today P&L</TableHead>
                  <TableHead className="text-slate-400 text-right">Win Rate</TableHead>
                  <TableHead className="text-slate-400 text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accountRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-10 text-slate-500">No broker connections found</TableCell>
                  </TableRow>
                ) : accountRows.map(row => (
                  <TableRow key={row.id} className="border-slate-800 hover:bg-slate-800/20">
                    <TableCell className="font-mono text-slate-200 font-medium">{row.account_number}</TableCell>
                    <TableCell className="text-slate-400">{row.platform || 'MT4'}</TableCell>
                    <TableCell className="text-right text-slate-200">${fmt(row.balance)}</TableCell>
                    <TableCell className="text-right text-slate-200">${fmt(row.equity)}</TableCell>
                    <TableCell className="text-right">
                      <span className={`font-medium ${row.acctOpenTrades.length > 0 ? 'text-amber-400' : 'text-slate-400'}`}>
                        {row.acctOpenTrades.length}
                      </span>
                    </TableCell>
                    <TableCell className={`text-right font-medium ${row.todayPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {row.todayPnl >= 0 ? '+' : ''}${fmt(row.todayPnl)}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.winRate != null ? (
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-slate-300 text-sm">{row.winRate}%</span>
                          <Progress value={row.winRate} className="w-16 h-1.5 bg-slate-800" />
                        </div>
                      ) : <span className="text-slate-500">–</span>}
                    </TableCell>
                    <TableCell className="text-center">
                      {row.isPaused ? (
                        <Badge variant="outline" className="border-amber-500/30 text-amber-400 bg-amber-500/10 text-xs">Paused</Badge>
                      ) : row.isLive ? (
                        <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 bg-emerald-500/10 text-xs">
                          <CheckCircle className="w-3 h-3 mr-1" /> Live
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-rose-500/30 text-rose-400 bg-rose-500/10 text-xs">Offline</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Bot Status */}
      <Card className="bg-slate-900/50 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Bot className="w-5 h-5 text-purple-400" /> Bot Status Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {bots.length === 0 ? (
              <p className="text-slate-500 text-sm col-span-3 text-center py-4">No bots configured</p>
            ) : bots.map(bot => (
              <div key={bot.id} className="flex items-center justify-between p-3 rounded-lg bg-slate-950/50 border border-slate-800/50">
                <div>
                  <p className="text-slate-200 text-sm font-medium">{bot.name}</p>
                  <p className="text-slate-500 text-xs mt-0.5">{bot.strategy_type} · {bot.timeframe}</p>
                </div>
                <Badge variant="outline" className={
                  bot.status === 'RUNNING' ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10 text-xs' :
                  bot.status === 'PAUSED' ? 'border-amber-500/30 text-amber-400 bg-amber-500/10 text-xs' :
                  'border-slate-600 text-slate-400 text-xs'
                }>
                  {bot.status === 'RUNNING' && <Activity className="w-3 h-3 mr-1 animate-pulse" />}
                  {bot.status}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ icon, label, value, sub, valueClass = 'text-white' }) {
  return (
    <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-sm">
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center gap-2 mb-2">
          {icon}
          <span className="text-xs text-slate-400">{label}</span>
        </div>
        <div className={`text-2xl font-bold ${valueClass}`}>{value}</div>
        {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}