import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend, LineChart, Line, CartesianGrid
} from 'recharts';
import {
  DollarSign, TrendingUp, TrendingDown, Activity, Bot, Shield,
  AlertTriangle, CheckCircle, RefreshCw, Wallet, Target, Hand, Clock, XCircle, Hourglass
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

  const { data: signals = [] } = useQuery({
    queryKey: ['ao-signals'],
    queryFn: () => base44.entities.Signal.filter({ status: 'CLOSED' }, '-updated_date', 500),
    refetchInterval: 60000,
    initialData: []
  });

  // Manual trade signals — all statuses, last 48h
  const { data: manualSignals = [], refetch: refetchManual } = useQuery({
    queryKey: ['ao-manual-signals'],
    queryFn: async () => {
      const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const all = await Promise.all([
        base44.entities.Signal.filter({ strategy: 'MANUAL_EXECUTION', status: 'PENDING' }, '-created_date', 50),
        base44.entities.Signal.filter({ strategy: 'MANUAL_EXECUTION', status: 'ACTIVE' }, '-created_date', 50),
        base44.entities.Signal.filter({ strategy: 'MANUAL_EXECUTION', status: 'EXPIRED' }, '-created_date', 50),
        base44.entities.Signal.filter({ strategy: 'MANUAL_EXECUTION', status: 'CLOSED' }, '-created_date', 50),
        base44.entities.Signal.filter({ strategy: 'MANUAL_EXECUTION', status: 'SKIPPED' }, '-created_date', 50),
      ]);
      return all.flat().filter(s => s.created_date >= cutoff).sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
    },
    refetchInterval: 15000,
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

  // ── Bot performance (last 7 days) ──
  const botPerformance = useMemo(() => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const recentTrades = closedTrades.filter(t => (t.updated_date || t.created_date || '') >= sevenDaysAgo);

    return bots.map(bot => {
      const botTrades = recentTrades.filter(t => t.bot_id === bot.id);
      const wins = botTrades.filter(t => (t.pnl || 0) > 0).length;
      const losses = botTrades.filter(t => (t.pnl || 0) < 0).length;
      const total = wins + losses;
      const winRate = total > 0 ? Math.round((wins / total) * 100) : null;
      const profit = botTrades.reduce((s, t) => s + (t.pnl || 0), 0);

      // Daily profit breakdown (last 7 days)
      const dailyMap = {};
      for (let i = 6; i >= 0; i--) {
        const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        dailyMap[d] = 0;
      }
      botTrades.forEach(t => {
        const day = (t.updated_date || t.created_date || '').split('T')[0];
        if (dailyMap[day] !== undefined) dailyMap[day] += t.pnl || 0;
      });
      const dailyData = Object.entries(dailyMap).map(([date, pnl]) => ({
        date: date.slice(5), // MM-DD
        pnl: parseFloat(pnl.toFixed(2))
      }));

      return { ...bot, wins, losses, total, winRate, profit, dailyData };
    }).sort((a, b) => b.profit - a.profit);
  }, [bots, closedTrades]);

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

      {/* Manual Trade Diagnostics */}
      <Card className="bg-slate-900/50 border-slate-800">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-white flex items-center gap-2">
              <Hand className="w-5 h-5 text-amber-400" /> Manual Trade Diagnostics — Last 48h
            </CardTitle>
            <button onClick={() => refetchManual()} className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1">
              <RefreshCw className="w-3 h-3" /> Refresh
            </button>
          </div>
          {/* Legend */}
          <div className="flex flex-wrap gap-3 mt-2 text-xs text-slate-400">
            <span className="flex items-center gap-1"><Hourglass className="w-3 h-3 text-amber-400" /> PENDING = waiting for bridge pickup</span>
            <span className="flex items-center gap-1"><Activity className="w-3 h-3 text-blue-400" /> ACTIVE = bridge sent to MT4, awaiting confirm</span>
            <span className="flex items-center gap-1"><CheckCircle className="w-3 h-3 text-emerald-400" /> CLOSED = confirmed & trade opened</span>
            <span className="flex items-center gap-1"><XCircle className="w-3 h-3 text-rose-400" /> EXPIRED/SKIPPED = failed to reach MT4</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {manualSignals.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-8">No manual trades in the last 48 hours</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-950/50">
                  <TableRow className="border-slate-800">
                    <TableHead className="text-slate-400">Time</TableHead>
                    <TableHead className="text-slate-400">Pair</TableHead>
                    <TableHead className="text-slate-400">Type</TableHead>
                    <TableHead className="text-slate-400">Lot</TableHead>
                    <TableHead className="text-slate-400">Account</TableHead>
                    <TableHead className="text-slate-400 text-center">Pipeline Status</TableHead>
                    <TableHead className="text-slate-400">Diagnosis</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {manualSignals.map(s => {
                    const ageMs = Date.now() - new Date(s.created_date).getTime();
                    const ageMins = Math.floor(ageMs / 60000);
                    const ageStr = ageMins < 60 ? `${ageMins}m ago` : `${Math.floor(ageMins / 60)}h ${ageMins % 60}m ago`;

                    // Find matching trade
                    const matchedTrade = openTrades.find(t => t.pair?.replace('/', '') === s.pair?.replace('/', '') && t.owner_email === s.owner_email)
                      || openTrades.find(t => t.pair?.replace('/', '') === s.pair?.replace('/', ''));

                    // Determine pipeline stage & diagnosis
                    let statusBadge, diagnosis;
                    if (s.status === 'PENDING') {
                      const stuckMins = ageMs / 60000;
                      if (stuckMins > 2) {
                        statusBadge = <Badge className="bg-rose-500/20 text-rose-400 border-rose-500/30 text-xs">⚠ STUCK PENDING</Badge>;
                        diagnosis = <span className="text-rose-400 text-xs">Bridge not picking up — MT4 may be offline or rate-limited</span>;
                      } else {
                        statusBadge = <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs"><Hourglass className="w-3 h-3 mr-1 inline" />PENDING</Badge>;
                        diagnosis = <span className="text-amber-400 text-xs">Waiting for next bridge heartbeat</span>;
                      }
                    } else if (s.status === 'ACTIVE') {
                      const stuckMins = ageMs / 60000;
                      if (stuckMins > 5) {
                        statusBadge = <Badge className="bg-rose-500/20 text-rose-400 border-rose-500/30 text-xs">⚠ STUCK ACTIVE</Badge>;
                        diagnosis = <span className="text-rose-400 text-xs">Sent to MT4 but no confirmExecution callback — EA may have rejected the order</span>;
                      } else {
                        statusBadge = <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs"><Activity className="w-3 h-3 mr-1 inline animate-pulse" />ACTIVE</Badge>;
                        diagnosis = <span className="text-blue-400 text-xs">Dispatched to MT4 — awaiting execution confirm</span>;
                      }
                    } else if (s.status === 'CLOSED') {
                      statusBadge = <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs"><CheckCircle className="w-3 h-3 mr-1 inline" />CONFIRMED</Badge>;
                      diagnosis = matchedTrade
                        ? <span className="text-emerald-400 text-xs">Trade open ✓ ticket synced</span>
                        : <span className="text-amber-400 text-xs">Signal closed but no matching open trade found</span>;
                    } else if (s.status === 'EXPIRED') {
                      statusBadge = <Badge className="bg-rose-500/20 text-rose-400 border-rose-500/30 text-xs"><XCircle className="w-3 h-3 mr-1 inline" />EXPIRED</Badge>;
                      diagnosis = <span className="text-rose-400 text-xs">Signal expired before MT4 confirmed — bridge was offline or AI blocked dispatch</span>;
                    } else if (s.status === 'SKIPPED') {
                      statusBadge = <Badge className="bg-slate-600/50 text-slate-400 border-slate-600 text-xs">SKIPPED</Badge>;
                      diagnosis = <span className="text-slate-400 text-xs">Bridge skipped — pair already had open trade or cooldown active</span>;
                    } else {
                      statusBadge = <Badge className="bg-slate-700 text-slate-300 text-xs">{s.status}</Badge>;
                      diagnosis = <span className="text-slate-400 text-xs">–</span>;
                    }

                    return (
                      <TableRow key={s.id} className="border-slate-800 hover:bg-slate-800/20">
                        <TableCell className="text-slate-400 text-xs font-mono whitespace-nowrap">{ageStr}</TableCell>
                        <TableCell className="text-slate-200 font-semibold">{s.pair}</TableCell>
                        <TableCell>
                          <span className={`text-xs font-bold ${s.type === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}`}>{s.type}</span>
                        </TableCell>
                        <TableCell className="text-slate-300 text-xs">{s.lot_size || '–'}</TableCell>
                        <TableCell className="text-slate-400 text-xs font-mono">{s.owner_email || <span className="text-rose-400">No account</span>}</TableCell>
                        <TableCell className="text-center">{statusBadge}</TableCell>
                        <TableCell>{diagnosis}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bot Performance - Last 7 Days */}
      <Card className="bg-slate-900/50 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Bot className="w-5 h-5 text-purple-400" /> Bot Performance — Last 7 Days
          </CardTitle>
        </CardHeader>
        <CardContent>
          {botPerformance.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-8">No bots configured</p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {botPerformance.map(bot => (
                <div key={bot.id} className="bg-slate-950/50 border border-slate-800/50 rounded-lg p-4">
                  {/* Bot header */}
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-slate-200 font-medium">{bot.name}</p>
                        <Badge variant="outline" className={
                          bot.status === 'RUNNING' ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10 text-xs' :
                          bot.status === 'PAUSED' ? 'border-amber-500/30 text-amber-400 bg-amber-500/10 text-xs' :
                          'border-slate-600 text-slate-400 text-xs'
                        }>
                          {bot.status === 'RUNNING' && <Activity className="w-3 h-3 mr-1 animate-pulse" />}
                          {bot.status}
                        </Badge>
                      </div>
                      <p className="text-slate-500 text-xs mt-0.5">{bot.strategy_type} · {bot.timeframe}</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-lg font-bold ${bot.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {bot.profit >= 0 ? '+' : ''}${fmt(bot.profit)}
                      </p>
                      <p className="text-xs text-slate-500">{bot.total} trades</p>
                    </div>
                  </div>

                  {/* Win rate bar */}
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-xs text-slate-400 w-16 shrink-0">Win Rate</span>
                    {bot.winRate != null ? (
                      <>
                        <div className="flex-1 h-2 rounded-full bg-slate-800 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${bot.winRate >= 60 ? 'bg-emerald-500' : bot.winRate >= 45 ? 'bg-amber-500' : 'bg-rose-500'}`}
                            style={{ width: `${bot.winRate}%` }}
                          />
                        </div>
                        <span className={`text-sm font-bold w-10 text-right ${bot.winRate >= 60 ? 'text-emerald-400' : bot.winRate >= 45 ? 'text-amber-400' : 'text-rose-400'}`}>
                          {bot.winRate}%
                        </span>
                        <span className="text-xs text-slate-500">{bot.wins}W/{bot.losses}L</span>
                      </>
                    ) : (
                      <span className="text-slate-500 text-xs">No trades yet</span>
                    )}
                  </div>

                  {/* Daily P&L sparkline */}
                  <ResponsiveContainer width="100%" height={70}>
                    <LineChart data={bot.dailyData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                      <XAxis dataKey="date" tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis hide />
                      <Tooltip
                        contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, fontSize: 11 }}
                        formatter={(v) => [`$${fmt(v)}`, 'P&L']}
                      />
                      <Line
                        type="monotone"
                        dataKey="pnl"
                        stroke={bot.profit >= 0 ? '#10b981' : '#f43f5e'}
                        strokeWidth={2}
                        dot={{ r: 3, fill: bot.profit >= 0 ? '#10b981' : '#f43f5e' }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ))}
            </div>
          )}
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