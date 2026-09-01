import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import {
  RefreshCw, Shield, Zap, TrendingUp, TrendingDown, Clock, CheckCircle, XCircle, Activity, Hourglass, Filter, Trash2, Download
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { toast } from 'sonner';

const STATUS_CONFIG = {
  PENDING:  { label: 'PENDING',  color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  ACTIVE:   { label: 'ACTIVE',   color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  CLOSED:   { label: 'CLOSED',   color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  EXPIRED:  { label: 'EXPIRED',  color: 'bg-rose-500/20 text-rose-400 border-rose-500/30' },
  SKIPPED:  { label: 'SKIPPED',  color: 'bg-slate-600/50 text-slate-400 border-slate-600' },
  ANALYSIS: { label: 'ANALYSIS', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
};

function formatAge(dateStr) {
  const ms = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m ago` : `${h}h ago`;
}

function formatTime(dateStr) {
  return new Date(dateStr).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

export default function SignalsDashboard() {
  const { user } = useAuth();
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [filterSource, setFilterSource] = useState('ALL');

  const { data: allSignals = [], refetch, isFetching } = useQuery({
    queryKey: ['signals-dashboard'],
    queryFn: async () => {
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const statuses = ['PENDING', 'ACTIVE', 'CLOSED', 'EXPIRED', 'SKIPPED', 'ANALYSIS'];
      const results = await Promise.all(
        statuses.map(s => base44.entities.Signal.filter({ status: s }, '-created_date', 100))
      );
      return results
        .flat()
        .filter(s => s.created_date >= cutoff)
        .sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
    },
    refetchInterval: 15000,
    initialData: [],
  });

  const queryClient = useQueryClient();

  const handleDeleteSignal = async (id) => {
    try {
      await base44.entities.Signal.delete(id);
      toast.success('Signal deleted');
      queryClient.invalidateQueries({ queryKey: ['signals-dashboard'] });
    } catch (e) {
      toast.error('Failed to delete signal');
    }
  };

  const handleExportCSV = () => {
    if (!filtered.length) { toast.info('No signals to export'); return; }
    const headers = ['Timestamp','Age','Source','Pair','Direction','Entry','StopLoss','TakeProfit','LotSize','Confidence','Strategy','Status','Account','BotId','ResultPnL','RiskAmount','StopPips','DataSource'];
    const rows = filtered.map(s => [
      s.created_date, formatAge(s.created_date), s.source, s.pair, s.type,
      s.entry_price ?? '', s.stop_loss ?? '', s.take_profit ?? '', s.lot_size ?? '',
      s.confidence ?? '', s.strategy ?? '', s.status, s.owner_email ?? '',
      s.bot_id ?? '', s.result_pnl ?? '', s.risk_amount ?? '', s.stop_pips ?? '', s.data_source ?? ''
    ]);
    const escape = (v) => {
      const str = String(v ?? '');
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };
    const csv = [headers.join(','), ...rows.map(r => r.map(escape).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `signals_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filtered.length} signal(s) to CSV`);
  };

  const handleClearPending = async () => {
    const pending = allSignals.filter(s => s.status === 'PENDING');
    if (!pending.length) { toast.info('No pending signals to clear'); return; }
    if (!window.confirm(`Delete ${pending.length} pending signal(s)? New ones will be generated on the next cycle.`)) return;
    try {
      await Promise.all(pending.map(s => base44.entities.Signal.delete(s.id)));
      toast.success(`Cleared ${pending.length} pending signal(s)`);
      queryClient.invalidateQueries({ queryKey: ['signals-dashboard'] });
    } catch (e) {
      toast.error('Failed to clear pending signals');
    }
  };

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

  // Derived source tags
  const withSource = allSignals.map(s => ({
    ...s,
    source: s.strategy === 'MANUAL_EXECUTION' ? '3rd Party' : (s.bot_id ? 'Bot' : 'Manual'),
  }));

  // Unique sources for filter
  const sources = ['ALL', ...new Set(withSource.map(s => s.source))];

  // Filtered signals
  const filtered = withSource.filter(s => {
    const statusOk = filterStatus === 'ALL' || s.status === filterStatus;
    const sourceOk = filterSource === 'ALL' || s.source === filterSource;
    return statusOk && sourceOk;
  });

  // Summary counts
  const counts = allSignals.reduce((acc, s) => {
    acc[s.status] = (acc[s.status] || 0) + 1;
    return acc;
  }, {});

  const thirdPartySignals = withSource.filter(s => s.source === '3rd Party');
  const avgConfidence = thirdPartySignals.length > 0
    ? Math.round(thirdPartySignals.reduce((s, sig) => s + (sig.confidence || 0), 0) / thirdPartySignals.length)
    : 0;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Zap className="w-8 h-8 text-emerald-500" /> Incoming Signals
          </h1>
          <p className="text-slate-400 mt-1">All signals from 3rd party providers & bots — last 7 days</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-sm transition-colors"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
          <button
            onClick={handleClearPending}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-sm transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Clear Pending
          </button>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
          <button
            key={key}
            onClick={() => setFilterStatus(filterStatus === key ? 'ALL' : key)}
            className={`rounded-lg border p-3 text-left transition-all ${filterStatus === key ? 'ring-2 ring-emerald-500/50' : ''} ${cfg.color} hover:opacity-80`}
          >
            <div className="text-xs text-slate-400 mb-1">{cfg.label}</div>
            <div className="text-2xl font-bold text-white">{counts[key] || 0}</div>
          </button>
        ))}
      </div>

      {/* 3rd party stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-slate-900/50 border-slate-800">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-amber-400" />
              <span className="text-xs text-slate-400">3rd Party Signals (7d)</span>
            </div>
            <div className="text-2xl font-bold text-white">{thirdPartySignals.length}</div>
          </CardContent>
        </Card>
        <Card className="bg-slate-900/50 border-slate-800">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="w-4 h-4 text-blue-400" />
              <span className="text-xs text-slate-400">Avg Confidence (3rd Party)</span>
            </div>
            <div className="text-2xl font-bold text-white">{avgConfidence}%</div>
            <Progress value={avgConfidence} className="h-1.5 mt-2 bg-slate-800" />
          </CardContent>
        </Card>
        <Card className="bg-slate-900/50 border-slate-800">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="w-4 h-4 text-emerald-400" />
              <span className="text-xs text-slate-400">Confirmed (CLOSED)</span>
            </div>
            <div className="text-2xl font-bold text-white">
              {thirdPartySignals.filter(s => s.status === 'CLOSED').length}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {thirdPartySignals.filter(s => s.status === 'EXPIRED').length} expired
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-2 text-slate-400 text-sm">
          <Filter className="w-4 h-4" /> Source:
        </div>
        {sources.map(src => (
          <button
            key={src}
            onClick={() => setFilterSource(src)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors border ${
              filterSource === src
                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-500'
            }`}
          >
            {src}
          </button>
        ))}
        {(filterStatus !== 'ALL' || filterSource !== 'ALL') && (
          <button
            onClick={() => { setFilterStatus('ALL'); setFilterSource('ALL'); }}
            className="px-3 py-1 rounded-full text-xs text-rose-400 border border-rose-500/30 hover:bg-rose-500/10 transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Signals table */}
      <Card className="bg-slate-900/50 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2 text-sm">
            <Clock className="w-4 h-4 text-slate-400" />
            {filtered.length} signal{filtered.length !== 1 ? 's' : ''} {filterStatus !== 'ALL' || filterSource !== 'ALL' ? '(filtered)' : ''}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-12">No signals found</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-950/50">
                  <TableRow className="border-slate-800">
                    <TableHead className="text-slate-400">Timestamp</TableHead>
                    <TableHead className="text-slate-400">Age</TableHead>
                    <TableHead className="text-slate-400">Source</TableHead>
                    <TableHead className="text-slate-400">Pair</TableHead>
                    <TableHead className="text-slate-400 text-center">Direction</TableHead>
                    <TableHead className="text-slate-400">Entry</TableHead>
                    <TableHead className="text-slate-400">SL</TableHead>
                    <TableHead className="text-slate-400">TP</TableHead>
                    <TableHead className="text-slate-400">Lot</TableHead>
                    <TableHead className="text-slate-400">Confidence</TableHead>
                    <TableHead className="text-slate-400">Account</TableHead>
                    <TableHead className="text-slate-400 text-center">Status</TableHead>
                    <TableHead className="text-slate-400 text-center">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(s => {
                    const cfg = STATUS_CONFIG[s.status] || STATUS_CONFIG.ANALYSIS;
                    return (
                      <TableRow key={s.id} className="border-slate-800 hover:bg-slate-800/20">
                        <TableCell className="text-slate-400 text-xs font-mono whitespace-nowrap">
                          {formatTime(s.created_date)}
                        </TableCell>
                        <TableCell className="text-slate-500 text-xs whitespace-nowrap">
                          {formatAge(s.created_date)}
                        </TableCell>
                        <TableCell>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
                            s.source === '3rd Party'
                              ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                              : s.source === 'Bot'
                              ? 'bg-purple-500/10 text-purple-400 border-purple-500/30'
                              : 'bg-slate-700 text-slate-300 border-slate-600'
                          }`}>{s.source}</span>
                        </TableCell>
                        <TableCell className="text-slate-200 font-semibold">{s.pair}</TableCell>
                        <TableCell className="text-center">
                          {s.type === 'BUY' ? (
                            <span className="inline-flex items-center gap-1 text-emerald-400 font-bold text-xs">
                              <TrendingUp className="w-3.5 h-3.5" /> BUY
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-rose-400 font-bold text-xs">
                              <TrendingDown className="w-3.5 h-3.5" /> SELL
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-slate-300 text-xs font-mono">{s.entry_price || '–'}</TableCell>
                        <TableCell className="text-slate-400 text-xs font-mono">{s.stop_loss || '–'}</TableCell>
                        <TableCell className="text-slate-400 text-xs font-mono">{s.take_profit || '–'}</TableCell>
                        <TableCell className="text-slate-300 text-xs">{s.lot_size ?? '–'}</TableCell>
                        <TableCell>
                          {s.confidence != null ? (
                            <div className="flex items-center gap-2 min-w-[80px]">
                              <Progress
                                value={s.confidence}
                                className="h-1.5 w-14 bg-slate-800"
                              />
                              <span className={`text-xs font-medium ${
                                s.confidence >= 80 ? 'text-emerald-400' :
                                s.confidence >= 60 ? 'text-amber-400' : 'text-rose-400'
                              }`}>{s.confidence}%</span>
                            </div>
                          ) : (
                            <span className="text-slate-500 text-xs">–</span>
                          )}
                        </TableCell>
                        <TableCell className="text-slate-400 text-xs font-mono">{s.owner_email || <span className="text-rose-400">–</span>}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className={`text-xs ${cfg.color}`}>
                            {s.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <button
                            onClick={() => handleDeleteSignal(s.id)}
                            className="text-slate-500 hover:text-rose-400 transition-colors"
                            title="Delete signal"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}