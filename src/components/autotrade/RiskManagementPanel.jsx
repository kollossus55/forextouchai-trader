import React, { useState, useEffect } from 'react';
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
import { AlertTriangle, Shield, TrendingDown, TrendingUp, PauseCircle, Play, Save, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

export default function RiskManagementPanel() {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState(null);

  // Fetch risk settings
  const { data: riskSettings } = useQuery({
    queryKey: ['risk-settings'],
    queryFn: async () => {
      const settings = await base44.entities.RiskManagementSettings.list();
      return settings[0] || null;
    }
  });

  // Fetch account info for current metrics
  const { data: connections } = useQuery({
    queryKey: ['broker-connections'],
    queryFn: () => base44.entities.BrokerConnection.list()
  });

  // Fetch all trades for risk calculation
  const { data: trades } = useQuery({
    queryKey: ['all-trades'],
    queryFn: () => base44.entities.Trade.list()
  });

  useEffect(() => {
    if (riskSettings) {
      setFormData(riskSettings);
    } else {
      setFormData({
        max_daily_loss_percent: 5,
        max_drawdown_percent: 20,
        max_position_size_percent: 10,
        max_concurrent_trades: 10,
        risk_per_trade_percent: 2,
        alert_threshold_percent: 80,
        stop_trading_on_limit: true,
        daily_loss_current: 0,
        peak_equity: 0,
        is_trading_paused: false
      });
    }
  }, [riskSettings]);

  // Create/Update mutation
  const saveMutation = useMutation({
    mutationFn: async (data) => {
      if (riskSettings?.id) {
        return await base44.entities.RiskManagementSettings.update(riskSettings.id, data);
      } else {
        return await base44.entities.RiskManagementSettings.create(data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['risk-settings']);
      toast.success('Risk management settings saved');
    }
  });

  // Toggle trading pause
  const togglePauseMutation = useMutation({
    mutationFn: async (isPaused) => {
      if (!riskSettings?.id) return;
      return await base44.entities.RiskManagementSettings.update(riskSettings.id, {
        is_trading_paused: isPaused
      });
    },
    onSuccess: (_, isPaused) => {
      queryClient.invalidateQueries(['risk-settings']);
      toast.success(isPaused ? 'Trading paused by risk management' : 'Trading resumed');
    }
  });

  const handleSave = () => {
    saveMutation.mutate(formData);
  };

  const resetMutation = useMutation({
    mutationFn: async () => {
      if (!riskSettings?.id) return;
      return await base44.entities.RiskManagementSettings.update(riskSettings.id, {
        daily_loss_current: 0,
        peak_equity: 0,
        is_trading_paused: false,
        last_reset_date: new Date().toISOString() // full ISO timestamp, not just date
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['risk-settings']);
      toast.success('Risk counters reset — trading resumed');
    }
  });

  const handleReset = () => {
    resetMutation.mutate();
  };

  const handleChange = (field, value) => {
    // When disabling auto-stop, also clear the paused flag
    if (field === 'stop_trading_on_limit' && value === false) {
      setFormData(prev => ({ ...prev, [field]: value, is_trading_paused: false }));
    } else {
      setFormData(prev => ({ ...prev, [field]: value }));
    }
  };

  if (!formData) return null;

  // Calculate metrics per account
  const today = new Date().toISOString().split('T')[0];
  const lastReset = formData.last_reset_date ? new Date(formData.last_reset_date) : null;

  // Build per-account stats
  const accountStats = (connections || []).map(conn => {
    const ownerEmail = conn.created_by;
    const balance = conn.balance || 0;
    const equity = conn.equity || 0;

    // Trades for this account after last reset
    const accountTodayTrades = trades?.filter(t => {
      if (t.status !== 'CLOSED') return false;
      if (!t.created_date?.startsWith(today)) return false;
      if (lastReset && new Date(t.created_date) < lastReset) return false;
      if (ownerEmail && t.owner_email !== ownerEmail) return false;
      return true;
    }) || [];

    const dailyPnL = accountTodayTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const dailyLossPercent = balance > 0 ? Math.abs((dailyPnL / balance) * 100) : 0;
    const peakEquity = formData.peak_equity > 0 ? formData.peak_equity : equity;
    const drawdown = peakEquity > 0 ? Math.max(0, ((peakEquity - equity) / peakEquity) * 100) : 0;
    const openCount = trades?.filter(t => t.status === 'OPEN' && (!ownerEmail || t.owner_email === ownerEmail)).length || 0;

    return { conn, balance, equity, dailyLossPercent, drawdown, openCount };
  });

  // Combined totals (sum across accounts) for overall risk gauge
  const totalBalance = accountStats.reduce((s, a) => s + a.balance, 0);
  const totalOpenTrades = accountStats.reduce((s, a) => s + a.openCount, 0);
  const avgDailyLossPercent = accountStats.length > 0 ? accountStats.reduce((s, a) => s + a.dailyLossPercent, 0) / accountStats.length : 0;
  const avgDrawdown = accountStats.length > 0 ? accountStats.reduce((s, a) => s + a.drawdown, 0) / accountStats.length : 0;

  // Risk status (based on averages / totals)
  const dailyLossRisk = (avgDailyLossPercent / formData.max_daily_loss_percent) * 100;
  const drawdownRisk = (avgDrawdown / formData.max_drawdown_percent) * 100;
  const tradesRisk = (totalOpenTrades / formData.max_concurrent_trades) * 100;

  const isAtRisk = dailyLossRisk >= formData.alert_threshold_percent || 
                   drawdownRisk >= formData.alert_threshold_percent ||
                   tradesRisk >= formData.alert_threshold_percent;

  const isLimitBreached = dailyLossRisk >= 100 || drawdownRisk >= 100 || tradesRisk >= 100;

  return (
    <div className="space-y-6">
      {/* Status Overview */}
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-emerald-400" />
                Risk Management
              </CardTitle>
              <CardDescription>Global risk parameters and real-time monitoring</CardDescription>
            </div>
            <div className="flex items-center gap-3">
              {formData.is_trading_paused && (
                <Badge variant="destructive" className="flex items-center gap-1.5">
                  <PauseCircle className="w-3 h-3" />
                  Trading Paused
                </Badge>
              )}
              {isLimitBreached && !formData.is_trading_paused && (
                <Badge variant="destructive" className="flex items-center gap-1.5 animate-pulse">
                  <AlertTriangle className="w-3 h-3" />
                  Limit Breached
                </Badge>
              )}
              {isAtRisk && !isLimitBreached && (
                <Badge className="bg-yellow-500/20 text-yellow-400 flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3" />
                  At Risk
                </Badge>
              )}
              <Button
                size="sm"
                variant={formData.is_trading_paused ? "default" : "destructive"}
                onClick={() => togglePauseMutation.mutate(!formData.is_trading_paused)}
              >
                {formData.is_trading_paused ? (
                  <>
                    <Play className="w-4 h-4 mr-2" />
                    Resume Trading
                  </>
                ) : (
                  <>
                    <PauseCircle className="w-4 h-4 mr-2" />
                    Pause All Trading
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Current Risk Levels - Per Account */}
          {accountStats.map(({ conn, dailyLossPercent, drawdown, openCount }, idx) => {
            const accDailyRisk = (dailyLossPercent / formData.max_daily_loss_percent) * 100;
            const accDrawdownRisk = (drawdown / formData.max_drawdown_percent) * 100;
            const accTradesRisk = (openCount / formData.max_concurrent_trades) * 100;
            return (
              <div key={conn.id} className="space-y-2">
                {accountStats.length > 1 && (
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    Account #{conn.account_number || idx + 1}
                  </p>
                )}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-slate-950 rounded-lg p-4 border border-slate-800">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-slate-400">Daily Loss</span>
                      <span className={`text-sm font-medium ${accDailyRisk >= 100 ? 'text-rose-400' : accDailyRisk >= formData.alert_threshold_percent ? 'text-yellow-400' : 'text-emerald-400'}`}>
                        {dailyLossPercent.toFixed(2)}% / {formData.max_daily_loss_percent}%
                      </span>
                    </div>
                    <Progress value={Math.min(accDailyRisk, 100)} className={`h-2 ${accDailyRisk >= 100 ? '[&>div]:bg-rose-500' : accDailyRisk >= formData.alert_threshold_percent ? '[&>div]:bg-yellow-500' : '[&>div]:bg-emerald-500'}`} />
                  </div>
                  <div className="bg-slate-950 rounded-lg p-4 border border-slate-800">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-slate-400">Drawdown</span>
                      <span className={`text-sm font-medium ${accDrawdownRisk >= 100 ? 'text-rose-400' : accDrawdownRisk >= formData.alert_threshold_percent ? 'text-yellow-400' : 'text-emerald-400'}`}>
                        {drawdown.toFixed(2)}% / {formData.max_drawdown_percent}%
                      </span>
                    </div>
                    <Progress value={Math.min(accDrawdownRisk, 100)} className={`h-2 ${accDrawdownRisk >= 100 ? '[&>div]:bg-rose-500' : accDrawdownRisk >= formData.alert_threshold_percent ? '[&>div]:bg-yellow-500' : '[&>div]:bg-emerald-500'}`} />
                  </div>
                  <div className="bg-slate-950 rounded-lg p-4 border border-slate-800">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-slate-400">Open Trades</span>
                      <span className={`text-sm font-medium ${accTradesRisk >= 100 ? 'text-rose-400' : accTradesRisk >= formData.alert_threshold_percent ? 'text-yellow-400' : 'text-emerald-400'}`}>
                        {openCount} / {formData.max_concurrent_trades}
                      </span>
                    </div>
                    <Progress value={Math.min(accTradesRisk, 100)} className={`h-2 ${accTradesRisk >= 100 ? '[&>div]:bg-rose-500' : accTradesRisk >= formData.alert_threshold_percent ? '[&>div]:bg-yellow-500' : '[&>div]:bg-emerald-500'}`} />
                  </div>
                </div>
              </div>
            );
          })}
          {accountStats.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-4">No connected accounts</p>
          )}

          <Separator className="bg-slate-800" />

          {/* Configuration */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                <TrendingDown className="w-4 h-4" />
                Loss Limits
              </h3>
              
              <div className="space-y-2">
                <Label className="text-sm font-medium text-white">Max Daily Loss (%)</Label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={formData.max_daily_loss_percent}
                  onChange={(e) => handleChange('max_daily_loss_percent', parseFloat(e.target.value))}
                  className="bg-slate-950 border-slate-700 text-white text-base h-11 [&::-webkit-inner-spin-button]:opacity-100 [&::-webkit-outer-spin-button]:opacity-100 [&::-webkit-inner-spin-button]:bg-slate-800 [&::-webkit-outer-spin-button]:bg-slate-800"
                />
                <p className="text-xs text-slate-400">Stop trading if daily loss exceeds this percentage</p>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium text-white">Max Drawdown (%)</Label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={formData.max_drawdown_percent}
                  onChange={(e) => handleChange('max_drawdown_percent', parseFloat(e.target.value))}
                  className="bg-slate-950 border-slate-700 text-white text-base h-11 [&::-webkit-inner-spin-button]:opacity-100 [&::-webkit-outer-spin-button]:opacity-100 [&::-webkit-inner-spin-button]:bg-slate-800 [&::-webkit-outer-spin-button]:bg-slate-800"
                />
                <p className="text-xs text-slate-400">Maximum allowed equity drawdown from peak</p>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium text-white flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                  Daily Profit Target (%)
                </Label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={formData.daily_profit_target_percent ?? 0}
                  onChange={(e) => handleChange('daily_profit_target_percent', parseFloat(e.target.value))}
                  className="bg-slate-950 border-slate-700 text-white text-base h-11 [&::-webkit-inner-spin-button]:opacity-100 [&::-webkit-outer-spin-button]:opacity-100"
                />
                <p className="text-xs text-slate-400">Close all trades & pause when daily profit reaches this % of balance (0 = disabled)</p>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium text-white">Risk Per Trade (%)</Label>
                <Input
                  type="number"
                  min="0.1"
                  max="10"
                  step="0.1"
                  value={formData.risk_per_trade_percent}
                  onChange={(e) => handleChange('risk_per_trade_percent', parseFloat(e.target.value))}
                  className="bg-slate-950 border-slate-700 text-white text-base h-11 [&::-webkit-inner-spin-button]:opacity-100 [&::-webkit-outer-spin-button]:opacity-100 [&::-webkit-inner-spin-button]:bg-slate-800 [&::-webkit-outer-spin-button]:bg-slate-800"
                />
                <p className="text-xs text-slate-400">Maximum risk per individual trade</p>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                <Shield className="w-4 h-4" />
                Position Limits
              </h3>

              <div className="space-y-2">
                <Label className="text-sm font-medium text-white">Max Position Size (%)</Label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={formData.max_position_size_percent}
                  onChange={(e) => handleChange('max_position_size_percent', parseFloat(e.target.value))}
                  className="bg-slate-950 border-slate-700 text-white text-base h-11 [&::-webkit-inner-spin-button]:opacity-100 [&::-webkit-outer-spin-button]:opacity-100 [&::-webkit-inner-spin-button]:bg-slate-800 [&::-webkit-outer-spin-button]:bg-slate-800"
                />
                <p className="text-xs text-slate-400">Maximum position size as % of account balance</p>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium text-white">Max Concurrent Trades</Label>
                <Input
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  value={formData.max_concurrent_trades}
                  onChange={(e) => handleChange('max_concurrent_trades', parseInt(e.target.value))}
                  className="bg-slate-950 border-slate-700 text-white text-base h-11 [&::-webkit-inner-spin-button]:opacity-100 [&::-webkit-outer-spin-button]:opacity-100 [&::-webkit-inner-spin-button]:bg-slate-800 [&::-webkit-outer-spin-button]:bg-slate-800"
                />
                <p className="text-xs text-slate-400">Maximum number of open trades per account</p>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium text-white">Alert Threshold (%)</Label>
                <Input
                  type="number"
                  min="50"
                  max="100"
                  step="5"
                  value={formData.alert_threshold_percent}
                  onChange={(e) => handleChange('alert_threshold_percent', parseInt(e.target.value))}
                  className="bg-slate-950 border-slate-700 text-white text-base h-11 [&::-webkit-inner-spin-button]:opacity-100 [&::-webkit-outer-spin-button]:opacity-100 [&::-webkit-inner-spin-button]:bg-slate-800 [&::-webkit-outer-spin-button]:bg-slate-800"
                />
                <p className="text-xs text-slate-400">Alert when risk reaches this % of limit</p>
              </div>
            </div>
          </div>

          <Separator className="bg-slate-800" />

          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Switch
                checked={formData.stop_trading_on_limit}
                onCheckedChange={(checked) => handleChange('stop_trading_on_limit', checked)}
                className={formData.stop_trading_on_limit ? 'data-[state=checked]:bg-emerald-500' : 'data-[state=unchecked]:bg-rose-500'}
              />
              <Label className="text-sm text-slate-300">
                Auto-stop trading when limits breached
              </Label>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleReset}
                disabled={resetMutation.isPending}
                className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300"
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                Reset Counters
              </Button>
              <Button onClick={handleSave} disabled={saveMutation.isPending}>
                <Save className="w-4 h-4 mr-2" />
                Save Settings
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}