import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Power, PauseCircle, PlayCircle, Wifi, WifiOff } from 'lucide-react';
import { toast } from 'sonner';

const DEFAULTS = {
  max_daily_loss_percent: 5,
  max_drawdown_percent: 20,
  max_concurrent_trades: 10,
  risk_per_trade_percent: 2,
  alert_threshold_percent: 80,
  stop_trading_on_limit: true,
  is_trading_paused: false,
};

export default function AccountAutoTradeToggle() {
  const queryClient = useQueryClient();

  const { data: connections = [] } = useQuery({
    queryKey: ['broker-connections-autotrade'],
    queryFn: () => base44.entities.BrokerConnection.list(),
    refetchInterval: 15000,
  });

  const { data: riskSettingsList = [] } = useQuery({
    queryKey: ['risk-settings'],
    queryFn: () => base44.entities.RiskManagementSettings.list(),
  });

  const connectedAccounts = connections.filter(c => c.connection_status === 'CONNECTED');

  const riskByAccount = {};
  for (const r of riskSettingsList) {
    if (r.account_number) riskByAccount[r.account_number] = r;
  }

  const toggleMutation = useMutation({
    mutationFn: async ({ conn, enabled }) => {
      const existing = riskByAccount[conn.account_number];
      if (existing?.id) {
        // Only flip the manual auto-trade toggle — never touch risk-pause fields
        // (is_trading_paused / limit_hit_at are owned by monitorRiskLimits).
        return await base44.entities.RiskManagementSettings.update(existing.id, {
          auto_trade_enabled: enabled,
        });
      }
      return await base44.entities.RiskManagementSettings.create({
        ...DEFAULTS,
        account_number: conn.account_number,
        auto_trade_enabled: enabled,
      });
    },
    onSuccess: (_, { conn, enabled }) => {
      queryClient.invalidateQueries(['risk-settings']);
      queryClient.invalidateQueries(['broker-connections-autotrade']);
      toast.success(
        enabled
          ? `Auto-trade ON for account ${conn.account_number}`
          : `Auto-trade OFF for account ${conn.account_number}`
      );
    },
    onError: (err) => toast.error(`Failed to toggle: ${err.message}`),
  });

  if (connectedAccounts.length === 0) return null;

  return (
    <Card className="bg-slate-900/50 border-slate-800 mb-6">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Power className="w-5 h-5 text-emerald-400" />
          Auto-Trade by Account
        </CardTitle>
        <CardDescription className="text-slate-400 text-sm">
          Toggle auto-trading on or off for each account independently — the bridge stops dispatching signals to paused accounts.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {connectedAccounts.map(conn => {
            const risk = riskByAccount[conn.account_number];
            const autoEnabled = risk?.auto_trade_enabled !== false;
            const isStale = conn.last_sync
              ? (Date.now() - new Date(conn.last_sync).getTime()) > 300000
              : true;

            return (
              <div
                key={conn.account_number}
                className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                  autoEnabled
                    ? 'bg-emerald-500/5 border-emerald-500/30'
                    : 'bg-slate-950/60 border-slate-700'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    {isStale ? (
                      <WifiOff className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                    ) : (
                      <Wifi className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    )}
                    <span className="text-sm font-mono text-slate-200 truncate">#{conn.account_number}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    {autoEnabled ? (
                      <>
                        <PlayCircle className="w-3 h-3 text-emerald-400" />
                        <span className="text-xs text-emerald-400">Auto-Trade ON</span>
                      </>
                    ) : (
                      <>
                        <PauseCircle className="w-3 h-3 text-slate-500" />
                        <span className="text-xs text-slate-500">Auto-Trade OFF</span>
                      </>
                    )}
                  </div>
                </div>
                <Switch
                  checked={autoEnabled}
                  onCheckedChange={(checked) =>
                    toggleMutation.mutate({ conn, enabled: checked })
                  }
                  disabled={toggleMutation.isPending}
                  className="data-[state=checked]:bg-emerald-500 data-[state=unchecked]:bg-slate-700"
                />
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}