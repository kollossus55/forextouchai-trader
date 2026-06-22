import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Heart, Signal, Zap, Activity, CheckCircle, XCircle, AlertTriangle,
  Clock, TrendingUp, TrendingDown, Radio, Bot, Shield, RefreshCw, Server, Wifi, WifiOff, Trash2
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger
} from '@/components/ui/alert-dialog';

const fmt = (n) => n == null ? '–' : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const timeAgo = (iso) => {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ago`;
};

const STATUS = {
  healthy: { icon: CheckCircle, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', label: 'Healthy' },
  warning: { icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20', label: 'Warning' },
  critical: { icon: XCircle, color: 'text-rose-400', bg: 'bg-rose-500/10', border: 'border-rose-500/20', label: 'Critical' },
  offline: { icon: WifiOff, color: 'text-slate-500', bg: 'bg-slate-800/50', border: 'border-slate-700', label: 'Offline' },
};

export default function SystemHealth() {
  const { user } = useAuth();
  const [isResetting, setIsResetting] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  const handleReset = async () => {
    setIsResetting(true);
    setResetDone(false);
    try {
      await base44.functions.invoke('resetData', {});
      setResetDone(true);
      refetch();
      setTimeout(() => setResetDone(false), 4000);
    } catch (e) {
      console.error('Reset failed:', e);
    } finally {
      setIsResetting(false);
    }
  };

  const { data: connections = [], refetch: refetchConnections, isFetching: f1 } = useQuery({
    queryKey: ['sh-connections'],
    queryFn: () => base44.entities.BrokerConnection.list('-updated_date', 100),
    refetchInterval: 15000,
    initialData: []
  });

  const { data: openTrades = [], refetch: refetchTrades, isFetching: f2 } = useQuery({
    queryKey: ['sh-open-trades'],
    queryFn: () => base44.entities.Trade.filter({ status: 'OPEN' }, '-created_date', 200),
    refetchInterval: 30000,
    initialData: []
  });

  const { data: bots = [], refetch: refetchBots, isFetching: f3 } = useQuery({
    queryKey: ['sh-bots'],
    queryFn: () => base44.entities.BotConfig.list('-updated_date', 50),
    refetchInterval: 30000,
    initialData: []
  });

  const { data: allSignals = [], refetch: refetchSignals, isFetching: f4 } = useQuery({
    queryKey: ['sh-signals'],
    queryFn: async () => {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const results = await Promise.all([
        base44.entities.Signal.filter({ status: 'PENDING' }, '-created_date', 100),
        base44.entities.Signal.filter({ status: 'ACTIVE' }, '-created_date', 100),
        base44.entities.Signal.filter({ status: 'CLOSED' }, '-created_date', 100),
        base44.entities.Signal.filter({ status: 'EXPIRED' }, '-created_date', 100),
        base44.entities.Signal.filter({ status: 'SKIPPED' }, '-created_date', 100),
      ]);
      return results.flat().filter(s => s.created_date >= cutoff);
    },
    refetchInterval: 15000,
    initialData: []
  });

  const { data: riskSettings = [], refetch: refetchRisk, isFetching: f5 } = useQuery({
    queryKey: ['sh-risk'],
    queryFn: () => base44.entities.RiskManagementSettings.list('-created_date', 100),
    refetchInterval: 60000,
    initialData: []
  });

  const isFetching = f1 || f2 || f3 || f4 || f5;
  const refetch = () => { refetchConnections(); refetchTrades(); refetchBots(); refetchSignals(); refetchRisk(); };

  // ── Aggregated health metrics ──
  const health = useMemo(() => {
    const now = Date.now();

    // Connection health
    const accountHealth = connections.map(c => {
      const lastSyncMs = c.last_sync ? now - new Date(c.last_sync).getTime() : Infinity;
      const isConnected = c.connection_status === 'CONNECTED';
      let status;
      if (!isConnected) status = 'offline';
      else if (lastSyncMs < 60_000) status = 'healthy';       // < 1 min
      else if (lastSyncMs < 300_000) status = 'warning';     // 1–5 min
      else status = 'critical';                               // > 5 min
      return { ...c, lastSyncMs, status, ageStr: timeAgo(c.last_sync) };
    });

    const liveCount = accountHealth.filter(a => a.status === 'healthy').length;
    const warningCount = accountHealth.filter(a => a.status === 'warning').length;
    const criticalCount = accountHealth.filter(a => a.status === 'critical').length;
    const offlineCount = accountHealth.filter(a => a.status === 'offline').length;

    // Signal pipeline (last 24h)
    const botSignals = allSignals.filter(s => s.bot_id);
    const pending = botSignals.filter(s => s.status === 'PENDING').length;
    const active = botSignals.filter(s => s.status === 'ACTIVE').length;
    const closed = botSignals.filter(s => s.status === 'CLOSED').length;
    const expired = botSignals.filter(s => s.status === 'EXPIRED').length;
    const skipped = botSignals.filter(s => s.status === 'SKIPPED').length;
    const totalDispatched = active + closed + expired; // signals that reached bridge
    const dispatchRate = totalDispatched > 0 ? Math.round((closed / totalDispatched) * 100) : 0;

    // Bot status
    const runningBots = bots.filter(b => b.status === 'RUNNING').length;
    const stoppedBots = bots.filter(b => b.status === 'STOPPED').length;
    const pausedBots = bots.filter(b => b.status === 'PAUSED').length;

    // Risk — balance map for correct % calculation
    const balanceMap = {};
    connections.forEach(c => { if (c.account_number) balanceMap[c.account_number] = c.balance || 0; });

    const pausedAccounts = riskSettings.filter(r => r.is_trading_paused).length;
    const accountsNearLimit = riskSettings.filter(r => {
      if (!r.max_daily_loss_percent || !r.daily_loss_current || !r.account_number) return false;
      const bal = balanceMap[r.account_number] || 0;
      if (bal <= 0) return false;
      const actualPct = (r.daily_loss_current / bal) * 100;
      return (actualPct / r.max_daily_loss_percent) >= (r.alert_threshold_percent || 80) / 100;
    }).length;

    const highExpiry = expired > 20 && dispatchRate < 20;

    // Overall status (worst of all subsystems)
    let overallStatus = 'healthy';
    if (offlineCount === connections.length && connections.length > 0) overallStatus = 'offline';
    else if (criticalCount > 0 || pausedAccounts > 0) overallStatus = 'critical';
    else if (warningCount > 0 || accountsNearLimit > 0 || highExpiry) overallStatus = 'warning';

    return {
      accountHealth, liveCount, warningCount, criticalCount, offlineCount,
      pending, active, closed, expired, skipped, dispatchRate,
      runningBots, stoppedBots, pausedBots,
      pausedAccounts, accountsNearLimit,
      overallStatus, highExpiry,
      totalConnections: connections.length,
      totalOpenTrades: openTrades.length,
    };
  }, [connections, openTrades, bots, allSignals, riskSettings]);

  const StatusIcon = STATUS[health.overallStatus].icon;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Heart className={`w-8 h-8 ${STATUS[health.overallStatus].color}`} /> System Health
          </h1>
          <p className="text-slate-400 mt-1">Live pipeline monitoring for your trading accounts</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge className={`${STATUS[health.overallStatus].bg} ${STATUS[health.overallStatus].color} ${STATUS[health.overallStatus].border} text-sm px-3 py-1`}>
            <StatusIcon className="w-4 h-4 mr-1" />
            {STATUS[health.overallStatus].label}
          </Badge>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                disabled={isResetting}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-sm transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" />
                {isResetting ? 'Resetting…' : resetDone ? '✓ Done' : 'Reset Data'}
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent className="bg-slate-900 border-slate-700 text-slate-100">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-white">Reset All Trading Data?</AlertDialogTitle>
                <AlertDialogDescription className="text-slate-400">
                  This will permanently delete all <strong className="text-slate-200">Trades</strong>, <strong className="text-slate-200">Signals</strong>, and <strong className="text-slate-200">Alerts</strong>, and reset all <strong className="text-slate-200">Risk counters</strong> (daily loss, drawdown, paused state) back to zero. Broker connections and bot configurations are kept. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700">Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleReset}
                  className="bg-rose-600 hover:bg-rose-700 text-white"
                >
                  Yes, Reset Everything
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Alerts banner */}
      {(health.criticalCount > 0 || health.pausedAccounts > 0 || health.warningCount > 0 || health.accountsNearLimit > 0 || health.highExpiry) && (
        <div className="flex flex-col gap-2">
          {health.criticalCount > 0 && (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300">
              <XCircle className="w-5 h-5 flex-shrink-0" />
              <span className="text-sm font-medium">{health.criticalCount} connection(s) have not synced in over 5 minutes — EA may be offline.</span>
            </div>
          )}
          {health.pausedAccounts > 0 && (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300">
              <XCircle className="w-5 h-5 flex-shrink-0" />
              <span className="text-sm font-medium">{health.pausedAccounts} account(s) have trading paused due to risk limits being breached.</span>
            </div>
          )}
          {health.warningCount > 0 && (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300">
              <AlertTriangle className="w-5 h-5 flex-shrink-0" />
              <span className="text-sm font-medium">{health.warningCount} connection(s) last synced 1–5 minutes ago — EA heartbeat is delayed. Check your EA is running.</span>
            </div>
          )}
          {health.accountsNearLimit > 0 && (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300">
              <AlertTriangle className="w-5 h-5 flex-shrink-0" />
              <span className="text-sm font-medium">{health.accountsNearLimit} account(s) are approaching their daily loss limit — see Risk Status below.</span>
            </div>
          )}
          {health.highExpiry && (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300">
              <AlertTriangle className="w-5 h-5 flex-shrink-0" />
              <span className="text-sm font-medium">High signal expiry rate — {health.expired} signals expired vs {health.closed} executed (dispatch rate: {health.dispatchRate}%). The EA is receiving signals but not confirming execution. Check that auto-execution is enabled on your bot and the EA is actively trading.</span>
            </div>
          )}
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard
          icon={<Radio className="w-5 h-5 text-cyan-400" />}
          label="Live Connections"
          value={health.liveCount}
          sub={`of ${health.totalConnections} total`}
          valueClass={health.liveCount > 0 ? 'text-emerald-400' : 'text-rose-400'}
        />
        <StatCard
          icon={<TrendingUp className="w-5 h-5 text-amber-400" />}
          label="Open Trades"
          value={health.totalOpenTrades}
          sub="across all accounts"
        />
        <StatCard
          icon={<Bot className="w-5 h-5 text-emerald-400" />}
          label="Running Bots"
          value={health.runningBots}
          sub={`${health.stoppedBots} stopped, ${health.pausedBots} paused`}
          valueClass={health.runningBots > 0 ? 'text-emerald-400' : 'text-rose-400'}
        />
        <StatCard
          icon={<Zap className="w-5 h-5 text-purple-400" />}
          label="Signals (24h)"
          value={allSignals.length}
          sub={`${health.closed} executed`}
        />
        <StatCard
          icon={<Signal className="w-5 h-5 text-blue-400" />}
          label="Dispatch Rate"
          value={health.dispatchRate > 0 ? `${health.dispatchRate}%` : '–'}
          sub={`${health.closed}/${health.closed + health.expired} dispatched`}
          valueClass={health.dispatchRate >= 50 ? 'text-emerald-400' : health.dispatchRate >= 20 ? 'text-amber-400' : 'text-rose-400'}
        />
        <StatCard
          icon={<Shield className="w-5 h-5 text-rose-400" />}
          label="Paused Accounts"
          value={health.pausedAccounts}
          sub={`${health.accountsNearLimit} near limit`}
          valueClass={health.pausedAccounts > 0 ? 'text-rose-400' : 'text-emerald-400'}
        />
      </div>

      {/* Connection Health + Signal Pipeline side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Connection Health */}
        <Card className="bg-slate-900/50 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white text-sm flex items-center gap-2">
              <Server className="w-4 h-4 text-cyan-400" /> EA Connection Health
            </CardTitle>
          </CardHeader>
          <CardContent>
            {connections.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-8">No broker connections configured</p>
            ) : (
              <div className="space-y-3">
                {health.accountHealth.map(acc => {
                  const S = STATUS[acc.status];
                  const Icon = S.icon;
                  const syncPercent = acc.lastSyncMs < 300_000
                    ? Math.max(0, 100 - (acc.lastSyncMs / 3000))
                    : 0;
                  return (
                    <div key={acc.id} className={`p-3 rounded-lg ${S.bg} ${S.border} border`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Icon className={`w-4 h-4 ${S.color}`} />
                          <span className="text-slate-200 font-medium text-sm">{acc.account_number}</span>
                          <span className="text-slate-500 text-xs">{acc.platform || 'MT4'} · {acc.server_name || '–'}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`text-xs font-medium ${S.color}`}>{S.label}</span>
                          <span className="text-slate-500 text-xs">{acc.ageStr}</span>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-slate-500 text-xs w-12">Sync</span>
                        <Progress value={syncPercent} className={`flex-1 h-1.5 ${acc.status === 'healthy' ? '[&>div]:bg-emerald-500' : acc.status === 'warning' ? '[&>div]:bg-amber-500' : '[&>div]:bg-rose-500'}`} />
                        <span className="text-slate-500 text-xs w-10 text-right">{acc.lastSyncMs < 1000 ? 'now' : `${Math.round(acc.lastSyncMs / 1000)}s`}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Signal Pipeline */}
        <Card className="bg-slate-900/50 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white text-sm flex items-center gap-2">
              <Signal className="w-4 h-4 text-purple-400" /> Signal Pipeline — Last 24h
            </CardTitle>
          </CardHeader>
          <CardContent>
            {allSignals.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-8">No signals in the last 24 hours</p>
            ) : (
              <div className="space-y-4">
                {/* Pipeline stages */}
                <PipelineStage
                  label="Generated (PENDING)"
                  count={health.pending}
                  color="text-amber-400"
                  bgBar="bg-amber-500"
                  icon={<Clock className="w-4 h-4" />}
                  description="Signals waiting to be picked up by bridge"
                />
                <PipelineStage
                  label="Dispatched (ACTIVE)"
                  count={health.active}
                  color="text-blue-400"
                  bgBar="bg-blue-500"
                  icon={<Zap className="w-4 h-4" />}
                  description="Sent to MT4/MT5 — awaiting execution confirm"
                />
                <PipelineStage
                  label="Executed (CLOSED)"
                  count={health.closed}
                  color="text-emerald-400"
                  bgBar="bg-emerald-500"
                  icon={<CheckCircle className="w-4 h-4" />}
                  description="EA confirmed and trade opened successfully"
                />
                <PipelineStage
                  label="Expired"
                  count={health.expired}
                  color="text-rose-400"
                  bgBar="bg-rose-500"
                  icon={<XCircle className="w-4 h-4" />}
                  description="EA didn't confirm within 10–20 min window"
                />
                <PipelineStage
                  label="Skipped"
                  count={health.skipped}
                  color="text-slate-400"
                  bgBar="bg-slate-500"
                  icon={<TrendingDown className="w-4 h-4" />}
                  description="Bridge skipped — cooldown, open pair, or risk block"
                />

                {/* Dispatch efficiency bar */}
                {health.closed + health.expired > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-800">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-slate-400">Dispatch Efficiency</span>
                      <span className={`text-xs font-bold ${health.dispatchRate >= 50 ? 'text-emerald-400' : health.dispatchRate >= 20 ? 'text-amber-400' : 'text-rose-400'}`}>
                        {health.dispatchRate}%
                      </span>
                    </div>
                    <div className="flex h-2.5 rounded-full overflow-hidden bg-slate-800">
                      {health.closed > 0 && (
                        <div className="bg-emerald-500 transition-all" style={{ width: `${health.dispatchRate}%` }} />
                      )}
                      {health.expired > 0 && (
                        <div className="bg-rose-500 transition-all" style={{ width: `${100 - health.dispatchRate}%` }} />
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">{health.closed} executed / {health.expired} expired of {health.closed + health.expired} dispatched signals</p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bot Status + Risk Status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bot Status */}
        <Card className="bg-slate-900/50 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white text-sm flex items-center gap-2">
              <Bot className="w-4 h-4 text-emerald-400" /> Bot Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            {bots.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-8">No bots configured</p>
            ) : (
              <div className="space-y-2">
                {bots.map(bot => {
                  const isRunning = bot.status === 'RUNNING';
                  const isPaused = bot.status === 'PAUSED';
                  return (
                    <div key={bot.id} className="flex items-center justify-between p-2 rounded-md bg-slate-950/50 border border-slate-800/50">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${isRunning ? 'bg-emerald-500 animate-pulse' : isPaused ? 'bg-amber-500' : 'bg-slate-600'}`} />
                        <span className="text-slate-200 text-sm">{bot.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500 text-xs">{bot.strategy_type}</span>
                        <Badge variant="outline" className={
                          isRunning ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10 text-xs' :
                          isPaused ? 'border-amber-500/30 text-amber-400 bg-amber-500/10 text-xs' :
                          'border-slate-600 text-slate-400 text-xs'
                        }>
                          {isRunning && <Activity className="w-3 h-3 mr-1 animate-pulse" />}
                          {bot.status}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Risk Status */}
        <Card className="bg-slate-900/50 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white text-sm flex items-center gap-2">
              <Shield className="w-4 h-4 text-amber-400" /> Risk Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            {riskSettings.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-8">No risk settings configured</p>
            ) : (
              <div className="space-y-3">
                {riskSettings.map(r => {
                  const accountLabel = r.account_number || 'Global';
                  const isPaused = r.is_trading_paused;
                  const bal = connections.find(c => c.account_number === r.account_number)?.balance || 0;
                  const actualLossPct = bal > 0 ? (r.daily_loss_current / bal) * 100 : 0;
                  const lossPct = r.max_daily_loss_percent > 0
                    ? Math.round((actualLossPct / r.max_daily_loss_percent) * 100)
                    : 0;
                  const nearLimit = lossPct >= (r.alert_threshold_percent || 80);
                  const atLimit = lossPct >= 100;
                  const statusColor = atLimit ? 'text-rose-400' : nearLimit ? 'text-amber-400' : 'text-emerald-400';
                  const barColor = atLimit ? 'bg-rose-500' : nearLimit ? 'bg-amber-500' : 'bg-emerald-500';

                  return (
                    <div key={r.id} className={`p-3 rounded-lg border ${isPaused ? 'bg-rose-500/10 border-rose-500/30' : nearLimit ? 'bg-amber-500/10 border-amber-500/30' : 'bg-slate-950/50 border-slate-800/50'}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-slate-200 text-sm font-medium">{accountLabel}</span>
                        <div className="flex items-center gap-2">
                          {isPaused && <Badge className="bg-rose-500/20 text-rose-400 border-rose-500/30 text-xs">Paused</Badge>}
                          <span className={`text-xs font-bold ${statusColor}`}>{lossPct}% of daily limit</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500 text-xs w-16">Daily Loss</span>
                        <Progress value={Math.min(lossPct, 100)} className={`flex-1 h-1.5 [&>div]:${barColor}`} />
                        <span className="text-slate-500 text-xs w-20 text-right">
                          {actualLossPct.toFixed(1)}% / {r.max_daily_loss_percent}%
                        </span>
                      </div>
                      {r.limit_hit_at && (
                        <p className="text-xs text-slate-500 mt-1">Limit hit {timeAgo(r.limit_hit_at)}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
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

function PipelineStage({ label, count, color, bgBar, icon, description }) {
  const maxCount = 50;
  const barWidth = Math.min((count / maxCount) * 100, 100);
  return (
    <div className="flex items-center gap-3">
      <div className={`${color} flex-shrink-0`}>{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-xs text-slate-400">{label}</span>
          <span className={`text-sm font-bold ${color}`}>{count}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
            <div className={`h-full rounded-full transition-all ${bgBar}`} style={{ width: `${barWidth}%` }} />
          </div>
          <span className="text-xs text-slate-500 hidden sm:inline">{description}</span>
        </div>
      </div>
    </div>
  );
}