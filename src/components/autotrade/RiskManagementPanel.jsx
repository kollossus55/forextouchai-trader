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
import { AlertTriangle, Shield, TrendingDown, PauseCircle, Play, Save } from 'lucide-react';
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

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  if (!formData) return null;

  // Calculate current metrics
  const currentAccount = connections?.[0];
  const accountBalance = currentAccount?.balance || 0;
  const accountEquity = currentAccount?.equity || 0;
  
  // Calculate daily loss
  const today = new Date().toISOString().split('T')[0];
  const todayTrades = trades?.filter(t => 
    t.created_date?.startsWith(today) && t.status === 'CLOSED'
  ) || [];
  const dailyPnL = todayTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const dailyLossPercent = accountBalance > 0 ? Math.abs((dailyPnL / accountBalance) * 100) : 0;

  // Calculate drawdown
  const peakEquity = formData.peak_equity || accountEquity;
  const currentDrawdown = peakEquity > 0 ? ((peakEquity - accountEquity) / peakEquity) * 100 : 0;

  // Open trades count
  const openTradesCount = trades?.filter(t => t.status === 'OPEN').length || 0;

  // Risk status
  const dailyLossRisk = (dailyLossPercent / formData.max_daily_loss_percent) * 100;
  const drawdownRisk = (currentDrawdown / formData.max_drawdown_percent) * 100;
  const tradesRisk = (openTradesCount / formData.max_concurrent_trades) * 100;

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
          {/* Current Risk Levels */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-slate-950 rounded-lg p-4 border border-slate-800">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-slate-400">Daily Loss</span>
                <span className={`text-sm font-medium ${dailyLossRisk >= 100 ? 'text-rose-400' : dailyLossRisk >= formData.alert_threshold_percent ? 'text-yellow-400' : 'text-emerald-400'}`}>
                  {dailyLossPercent.toFixed(2)}% / {formData.max_daily_loss_percent}%
                </span>
              </div>
              <Progress 
                value={Math.min(dailyLossRisk, 100)} 
                className={`h-2 ${dailyLossRisk >= 100 ? '[&>div]:bg-rose-500' : dailyLossRisk >= formData.alert_threshold_percent ? '[&>div]:bg-yellow-500' : '[&>div]:bg-emerald-500'}`}
              />
            </div>

            <div className="bg-slate-950 rounded-lg p-4 border border-slate-800">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-slate-400">Drawdown</span>
                <span className={`text-sm font-medium ${drawdownRisk >= 100 ? 'text-rose-400' : drawdownRisk >= formData.alert_threshold_percent ? 'text-yellow-400' : 'text-emerald-400'}`}>
                  {currentDrawdown.toFixed(2)}% / {formData.max_drawdown_percent}%
                </span>
              </div>
              <Progress 
                value={Math.min(drawdownRisk, 100)} 
                className={`h-2 ${drawdownRisk >= 100 ? '[&>div]:bg-rose-500' : drawdownRisk >= formData.alert_threshold_percent ? '[&>div]:bg-yellow-500' : '[&>div]:bg-emerald-500'}`}
              />
            </div>

            <div className="bg-slate-950 rounded-lg p-4 border border-slate-800">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-slate-400">Open Trades</span>
                <span className={`text-sm font-medium ${tradesRisk >= 100 ? 'text-rose-400' : tradesRisk >= formData.alert_threshold_percent ? 'text-yellow-400' : 'text-emerald-400'}`}>
                  {openTradesCount} / {formData.max_concurrent_trades}
                </span>
              </div>
              <Progress 
                value={Math.min(tradesRisk, 100)} 
                className={`h-2 ${tradesRisk >= 100 ? '[&>div]:bg-rose-500' : tradesRisk >= formData.alert_threshold_percent ? '[&>div]:bg-yellow-500' : '[&>div]:bg-emerald-500'}`}
              />
            </div>
          </div>

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
                <p className="text-xs text-slate-400">Maximum number of open trades across all bots</p>
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
              />
              <Label className="text-sm text-slate-300">
                Auto-stop trading when limits breached
              </Label>
            </div>

            <Button onClick={handleSave} disabled={saveMutation.isPending}>
              <Save className="w-4 h-4 mr-2" />
              Save Settings
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}