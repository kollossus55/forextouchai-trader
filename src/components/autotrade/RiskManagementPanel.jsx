import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertTriangle, Shield, TrendingDown, TrendingUp, PauseCircle, Play, Save, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

const DEFAULT_SETTINGS = {
  max_daily_loss_percent: 5,
  max_drawdown_percent: 20,
  max_position_size_percent: 10,
  max_concurrent_trades: 10,
  risk_per_trade_percent: 2,
  alert_threshold_percent: 80,
  stop_trading_on_limit: true,
  daily_profit_target_percent: 0,
  daily_reset_hour: 0,
  auto_resume_hours: 0,
  daily_loss_current: 0,
  peak_equity: 0,
  is_trading_paused: false,
  limit_hit_at: null
};

function AccountRiskSettings({ conn, riskSettings, allRiskSettings, trades, onSaved }) {
  const queryClient = useQueryClient();
  const acctKey = conn.account_number;
  const today = new Date().toISOString().split('T')[0];

  const existingRecord = riskSettings;
  const [formData, setFormData] = useState(existingRecord || { ...DEFAULT_SETTINGS, account_number: acctKey });

  useEffect(() => {
    setFormData(existingRecord || { ...DEFAULT_SETTINGS, account_number: acctKey });
  }, [existingRecord, acctKey]);

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      const settingsData = {
        max_daily_loss_percent: data.max_daily_loss_percent,
        max_drawdown_percent: data.max_drawdown_percent,
        max_position_size_percent: data.max_position_size_percent,
        max_concurrent_trades: data.max_concurrent_trades,
        risk_per_trade_percent: data.risk_per_trade_percent,
        alert_threshold_percent: data.alert_threshold_percent,
        stop_trading_on_limit: data.stop_trading_on_limit,
        daily_profit_target_percent: data.daily_profit_target_percent,
        daily_reset_hour: data.daily_reset_hour,
        auto_resume_hours: data.auto_resume_hours,
      };
      if (existingRecord?.id) {
        return await base44.entities.RiskManagementSettings.update(existingRecord.id, settingsData);
      } else {
        return await base44.entities.RiskManagementSettings.create({ ...settingsData, account_number: acctKey });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['risk-settings']);
      toast.success(`Risk settings saved for account ${acctKey}`);
      if (onSaved) onSaved();
    },
    onError: (err) => toast.error(`Failed to save: ${err.message}`)
  });

  const togglePauseMutation = useMutation({
    mutationFn: async (isPaused) => {
      if (!existingRecord?.id) return;
      const updateData = { is_trading_paused: isPaused };
      // On resume: reset daily counters so tracking starts fresh
      if (!isPaused) {
        updateData.daily_loss_current = 0;
        updateData.last_reset_date = new Date().toISOString(); // full timestamp signals manual reset to monitor
        updateData.limit_hit_at = null;
      }
      return await base44.entities.RiskManagementSettings.update(existingRecord.id, updateData);
    },
    onSuccess: (_, isPaused) => {
      queryClient.invalidateQueries(['risk-settings']);
      toast.success(isPaused ? `Account ${acctKey} trading paused` : `Account ${acctKey} resumed with fresh daily counters`);
    },
    onError: (err) => toast.error(`Failed to toggle: ${err.message}`)
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      if (!existingRecord?.id) return;
      // Only reset tracking fields — keep all config settings (limits, thresholds, etc.) intact
      return await base44.entities.RiskManagementSettings.update(existingRecord.id, {
        daily_loss_current: 0,
        peak_equity: conn.equity || conn.balance || 0,
        last_reset_date: new Date().toISOString(), // full timestamp signals manual reset to monitor
        is_trading_paused: false,
        limit_hit_at: null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['risk-settings']);
      toast.success(`Counters reset for account ${acctKey} — settings preserved`);
    },
    onError: (err) => toast.error(`Reset failed: ${err.message}`)
  });

  const handleChange = (field, value) => {
    if (field === 'stop_trading_on_limit' && !value) {
      setFormData(prev => ({ ...prev, [field]: value, is_trading_paused: false }));
    } else {
      setFormData(prev => ({ ...prev, [field]: value }));
    }
  };

  // Metrics
  const balance = conn.balance || 0;
  const equity = conn.equity || 0;
  const peakEquity = formData.peak_equity > 0 ? formData.peak_equity : equity;
  const drawdown = peakEquity > 0 ? Math.max(0, ((peakEquity - equity) / peakEquity) * 100) : 0;

  const lastReset = formData.last_reset_date ? new Date(formData.last_reset_date) : null;
  const todayClosedTrades = (trades || []).filter(t => {
    if (t.status !== 'CLOSED' || String(t.owner_email) !== String(acctKey)) return false;
    const d = t.updated_date || t.created_date;
    if (!d?.startsWith(today)) return false;
    if (lastReset && new Date(d) < lastReset) return false;
    return true;
  });
  const openTrades = (trades || []).filter(t => t.status === 'OPEN' && String(t.owner_email) === String(acctKey));
  // Use live count from bridge heartbeat if DB trades aren't synced yet
  const openCount = openTrades.length > 0 ? openTrades.length : (conn.open_trade_count ?? 0);
  const closedPnl = todayClosedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const floatingPnl = openTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const dailyPnl = closedPnl + floatingPnl;
  // Use tracked daily_loss_current when risk settings exist (monitorRiskLimits keeps it updated)
  // Falls back to computed trade PnL for accounts without risk tracking
  const hasTracking = !!existingRecord;
  const dailyLossAmount = hasTracking
    ? Math.abs(formData.daily_loss_current || 0)
    : Math.max(0, -dailyPnl);
  const dailyLossPercent = balance > 0 ? (dailyLossAmount / balance) * 100 : 0;

  const dailyLossRisk = formData.max_daily_loss_percent > 0 ? (dailyLossPercent / formData.max_daily_loss_percent) * 100 : 0;
  const drawdownRisk = formData.max_drawdown_percent > 0 ? (drawdown / formData.max_drawdown_percent) * 100 : 0;
  const tradesRisk = formData.max_concurrent_trades > 0 ? (openCount / formData.max_concurrent_trades) * 100 : 0;
  const isAtRisk = dailyLossRisk >= formData.alert_threshold_percent || drawdownRisk >= formData.alert_threshold_percent || tradesRisk >= formData.alert_threshold_percent;
  const isBreached = dailyLossRisk >= 100 || drawdownRisk >= 100;

  // Auto-resume countdown
  const [countdown, setCountdown] = useState(null);
  useEffect(() => {
    if (!formData.is_trading_paused || !formData.auto_resume_hours || !formData.limit_hit_at) {
      setCountdown(null);
      return;
    }
    const calc = () => {
      const hitAt = new Date(formData.limit_hit_at).getTime();
      const resumeAt = hitAt + formData.auto_resume_hours * 60 * 60 * 1000;
      const remaining = Math.max(0, resumeAt - Date.now());
      if (remaining <= 0) { setCountdown(null); return; }
      const h = Math.floor(remaining / 3600000);
      const m = Math.floor((remaining % 3600000) / 60000);
      const s = Math.floor((remaining % 60000) / 1000);
      setCountdown(`${h}h ${m}m ${s}s`);
    };
    calc();
    const iv = setInterval(calc, 1000);
    return () => clearInterval(iv);
  }, [formData.is_trading_paused, formData.auto_resume_hours, formData.limit_hit_at]);

  return (
    <div className="space-y-5">
      {/* Status bar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          {formData.is_trading_paused && <Badge variant="destructive" className="flex items-center gap-1"><PauseCircle className="w-3 h-3" /> Paused</Badge>}
          {isBreached && !formData.is_trading_paused && <Badge variant="destructive" className="animate-pulse flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Limit Breached</Badge>}
          {isAtRisk && !isBreached && <Badge className="bg-yellow-500/20 text-yellow-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> At Risk</Badge>}
          {!isAtRisk && !formData.is_trading_paused && <Badge className="bg-emerald-500/10 text-emerald-400">Normal</Badge>}
          {countdown && <Badge className="bg-cyan-500/10 text-cyan-400 flex items-center gap-1"><RotateCcw className="w-3 h-3" /> Resume in {countdown}</Badge>}
        </div>
        <Button
          size="sm"
          variant={formData.is_trading_paused ? "default" : "destructive"}
          onClick={() => togglePauseMutation.mutate(!formData.is_trading_paused)}
          disabled={!existingRecord?.id}
        >
          {formData.is_trading_paused ? <><Play className="w-4 h-4 mr-1" /> Resume</> : <><PauseCircle className="w-4 h-4 mr-1" /> Pause This Account</>}
        </Button>
      </div>

      {/* Live metrics */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Daily Loss', value: `${dailyLossPercent.toFixed(2)}% / ${formData.max_daily_loss_percent}%`, risk: dailyLossRisk },
          { label: 'Drawdown', value: `${drawdown.toFixed(2)}% / ${formData.max_drawdown_percent}%`, risk: drawdownRisk },
          { label: 'Open Trades', value: `${openCount} / ${formData.max_concurrent_trades}`, risk: tradesRisk },
        ].map(({ label, value, risk }) => (
          <div key={label} className="bg-slate-950 rounded-lg p-3 border border-slate-800">
            <div className="flex justify-between mb-1.5">
              <span className="text-xs text-slate-400">{label}</span>
              <span className={`text-xs font-medium ${risk >= 100 ? 'text-rose-400' : risk >= formData.alert_threshold_percent ? 'text-yellow-400' : 'text-emerald-400'}`}>{value}</span>
            </div>
            <Progress value={Math.min(risk, 100)} className={`h-1.5 ${risk >= 100 ? '[&>div]:bg-rose-500' : risk >= formData.alert_threshold_percent ? '[&>div]:bg-yellow-500' : '[&>div]:bg-emerald-500'}`} />
          </div>
        ))}
      </div>

      <Separator className="bg-slate-800" />

      {/* Config */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-slate-400 uppercase flex items-center gap-1"><TrendingDown className="w-3 h-3" /> Loss Limits</h4>
          {[
            { label: 'Max Daily Loss (%)', field: 'max_daily_loss_percent', step: 0.5 },
            { label: 'Max Drawdown (%)', field: 'max_drawdown_percent', step: 0.5 },
            { label: 'Daily Profit Target (%) — 0=off', field: 'daily_profit_target_percent', step: 0.5, min: 0 },
            { label: 'Risk Per Trade (%)', field: 'risk_per_trade_percent', step: 0.1, min: 0.1 },
            { label: 'Daily Reset Hour (UTC 0–23)', field: 'daily_reset_hour', step: 1, min: 0, max: 23 },
             { label: 'Auto-Resume Hours (0=off)', field: 'auto_resume_hours', step: 0.5, min: 0, max: 24 },
          ].map(({ label, field, step, min = 0, max = 100 }) => (
            <div key={field} className="space-y-1">
              <Label className="text-xs text-slate-300">{label}</Label>
              <Input type="number" min={min} max={100} step={step} value={formData[field] ?? 0}
                onChange={e => handleChange(field, parseFloat(e.target.value))}
                className="bg-slate-950 border-slate-700 text-white h-9" />
            </div>
          ))}
        </div>
        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-slate-400 uppercase flex items-center gap-1"><Shield className="w-3 h-3" /> Position Limits</h4>
          {[
            { label: 'Max Concurrent Trades', field: 'max_concurrent_trades', step: 1, min: 1 },
            { label: 'Max Position Size (%)', field: 'max_position_size_percent', step: 1 },
            { label: 'Alert Threshold (%)', field: 'alert_threshold_percent', step: 5, min: 50 },
          ].map(({ label, field, step, min = 0 }) => (
            <div key={field} className="space-y-1">
              <Label className="text-xs text-slate-300">{label}</Label>
              <Input type="number" min={min} max={100} step={step} value={formData[field] ?? 0}
                onChange={e => handleChange(field, parseFloat(e.target.value))}
                className="bg-slate-950 border-slate-700 text-white h-9" />
            </div>
          ))}
        </div>
      </div>

      <Separator className="bg-slate-800" />

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Switch checked={formData.stop_trading_on_limit} onCheckedChange={v => handleChange('stop_trading_on_limit', v)}
            className="data-[state=checked]:bg-emerald-500" />
          <Label className="text-sm text-slate-300">Auto-stop when limits breached</Label>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => resetMutation.mutate()} disabled={resetMutation.isPending || !existingRecord?.id}
            className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10 h-9 text-sm">
            <RotateCcw className="w-3 h-3 mr-1" /> Reset Counters
          </Button>
          <Button onClick={() => saveMutation.mutate(formData)} disabled={saveMutation.isPending} className="h-9 text-sm">
            <Save className="w-3 h-3 mr-1" /> Save
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function RiskManagementPanel() {
  const queryClient = useQueryClient();

  const { data: riskSettingsList = [] } = useQuery({
    queryKey: ['risk-settings'],
    queryFn: () => base44.entities.RiskManagementSettings.list()
  });

  const { data: connections = [] } = useQuery({
    queryKey: ['broker-connections'],
    queryFn: () => base44.entities.BrokerConnection.list()
  });

  const accountNumbers = connections.map(c => c.account_number).filter(Boolean);

  const { data: openTrades = [] } = useQuery({
    queryKey: ['risk-open-trades', accountNumbers],
    queryFn: async () => {
      if (accountNumbers.length === 0) return [];
      const results = await Promise.all(
        accountNumbers.map(acct => base44.entities.Trade.filter({ status: 'OPEN', owner_email: acct }, '-updated_date', 500))
      );
      return results.flat();
    },
    enabled: accountNumbers.length > 0,
    refetchInterval: 15000,
    staleTime: 0
  });

  const { data: closedTrades = [] } = useQuery({
    queryKey: ['risk-closed-trades', accountNumbers],
    queryFn: async () => {
      if (accountNumbers.length === 0) return [];
      const results = await Promise.all(
        accountNumbers.map(acct => base44.entities.Trade.filter({ status: 'CLOSED', owner_email: acct }, '-updated_date', 500))
      );
      return results.flat();
    },
    enabled: accountNumbers.length > 0,
    refetchInterval: 30000,
    staleTime: 0
  });

  const trades = useMemo(() => [...openTrades, ...closedTrades], [openTrades, closedTrades]);

  // Connected accounts
  const connectedAccounts = connections.filter(c => c.connection_status === 'CONNECTED');

  // Map account_number → risk settings record
  const safeRiskList = Array.isArray(riskSettingsList) ? riskSettingsList : [];
  const riskByAccount = {};
  for (const r of safeRiskList) {
    if (r.account_number) riskByAccount[r.account_number] = r;
  }
  const globalRisk = safeRiskList.find(r => !r.account_number) || null;

  if (connectedAccounts.length === 0) {
    return (
      <Card className="bg-slate-900 border-slate-800">
        <CardContent className="py-10 text-center text-slate-500">No connected accounts to configure risk for.</CardContent>
      </Card>
    );
  }

  // Single account: no tabs needed
  if (connectedAccounts.length === 1) {
    const conn = connectedAccounts[0];
    return (
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Shield className="w-5 h-5 text-emerald-400" /> Risk Management — Account #{conn.account_number}</CardTitle>
          <CardDescription>Per-account risk parameters and real-time monitoring</CardDescription>
        </CardHeader>
        <CardContent>
          <AccountRiskSettings conn={conn} riskSettings={riskByAccount[conn.account_number] || globalRisk} allRiskSettings={riskSettingsList} trades={trades} />
        </CardContent>
      </Card>
    );
  }

  // Multiple accounts: tabs
  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Shield className="w-5 h-5 text-emerald-400" /> Risk Management</CardTitle>
        <CardDescription>Each account has independent risk limits — a breach on one account does not affect others</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue={connectedAccounts[0]?.account_number}>
          <TabsList className="bg-slate-950 border border-slate-800 mb-4 flex-wrap h-auto gap-1">
            {connectedAccounts.map(conn => {
              const risk = riskByAccount[conn.account_number] || globalRisk || null;
              const isPaused = risk?.is_trading_paused;
              return (
                <TabsTrigger key={conn.account_number} value={conn.account_number}
                  className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white flex items-center gap-1.5">
                  {isPaused && <PauseCircle className="w-3 h-3 text-rose-400" />}
                  Acct #{conn.account_number}
                </TabsTrigger>
              );
            })}
          </TabsList>
          {connectedAccounts.map(conn => (
            <TabsContent key={conn.account_number} value={conn.account_number}>
              <AccountRiskSettings
                conn={conn}
                riskSettings={riskByAccount[conn.account_number]}
                allRiskSettings={riskSettingsList}
                trades={trades}
              />
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}