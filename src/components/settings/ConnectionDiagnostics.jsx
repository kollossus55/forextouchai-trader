import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Activity, Wifi, WifiOff, RefreshCw, AlertCircle, CheckCircle2, Clock, TrendingUp } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

export default function ConnectionDiagnostics() {
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [diagnostics, setDiagnostics] = useState(null);

  // Fetch broker connection status
  const { data: connections, refetch: refetchConnection } = useQuery({
    queryKey: ['broker-connections-diagnostics'],
    queryFn: () => base44.entities.BrokerConnection.list(),
    refetchInterval: 3000,
    initialData: []
  });

  const connection = connections?.[0];
  const isConnected = connection && connection.connection_status === 'CONNECTED';

  // Calculate connection metrics
  const lastSyncTime = connection?.last_sync ? new Date(connection.last_sync) : null;
  const timeSinceSync = lastSyncTime ? Date.now() - lastSyncTime.getTime() : null;
  const syncStatus = timeSinceSync && timeSinceSync < 15000 ? 'HEALTHY' : 'STALE';

  // Test connection to bridge endpoint - directly fetch diagnostics URL
  const testConnection = async () => {
    setIsTestingConnection(true);
    try {
      const response = await fetch('/functions/bridge', { method: 'OPTIONS' });
      const data = await response.json();
      
      if (data) {
        setDiagnostics(data);
        const latency = data.average_latency_ms || 'N/A';
        const successRate = data.success_rate || '0%';
        toast.success('Bridge connection healthy', {
          description: `Status: ${data.status || 'OK'} - ${data.successful_requests || 0} successful requests`
        });
      }
    } catch (error) {
      toast.error('Connection test failed', {
        description: error.message || 'Unable to reach bridge endpoint'
      });
      setDiagnostics({ error: error.message });
    } finally {
      setIsTestingConnection(false);
    }
  };

  const getStatusColor = (status) => {
    if (status === 'HEALTHY' || status === 'CONNECTED') return 'text-emerald-400 bg-emerald-500/20';
    if (status === 'STALE' || status === 'DISCONNECTED') return 'text-amber-400 bg-amber-500/20';
    return 'text-rose-400 bg-rose-500/20';
  };

  return (
    <div className="space-y-4">
      {/* Connection Status Overview */}
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-white flex items-center gap-2">
                {isConnected ? <Wifi className="w-5 h-5 text-emerald-400" /> : <WifiOff className="w-5 h-5 text-rose-400" />}
                Connection Status
              </CardTitle>
              <CardDescription>Real-time MT4/MT5 connection monitoring</CardDescription>
            </div>
            <Button 
              onClick={() => { refetchConnection(); testConnection(); }}
              disabled={isTestingConnection}
              variant="outline"
              className="border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isTestingConnection ? 'animate-spin' : ''}`} />
              Test Connection
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Status Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Connection State */}
            <div className="bg-slate-950/50 rounded-lg p-4 border border-slate-800">
              <div className="text-xs text-slate-400 mb-2">Connection State</div>
              <Badge className={`text-sm ${getStatusColor(connection?.connection_status || 'DISCONNECTED')} border-0`}>
                {connection?.connection_status || 'DISCONNECTED'}
              </Badge>
            </div>

            {/* Sync Health */}
            <div className="bg-slate-950/50 rounded-lg p-4 border border-slate-800">
              <div className="text-xs text-slate-400 mb-2">Sync Health</div>
              <Badge className={`text-sm ${getStatusColor(syncStatus)} border-0`}>
                {syncStatus}
              </Badge>
            </div>

            {/* Last Sync */}
            <div className="bg-slate-950/50 rounded-lg p-4 border border-slate-800">
              <div className="text-xs text-slate-400 mb-2">Last Sync</div>
              <div className="text-white font-mono text-sm">
                {timeSinceSync ? `${Math.floor(timeSinceSync / 1000)}s ago` : 'Never'}
              </div>
            </div>
          </div>

          {/* Connection Timeline */}
          {lastSyncTime && (
            <div className="bg-slate-950/50 rounded-lg p-4 border border-slate-800">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-400">Time Since Last Sync</span>
                <span className="text-xs text-slate-300">{Math.floor(timeSinceSync / 1000)}s / 20s limit</span>
              </div>
              <Progress 
                value={Math.min((timeSinceSync / 20000) * 100, 100)} 
                className="h-2 bg-slate-800"
                indicatorClassName={timeSinceSync < 10000 ? 'bg-emerald-500' : timeSinceSync < 15000 ? 'bg-amber-500' : 'bg-rose-500'}
              />
              <div className="text-[10px] text-slate-500 mt-1">
                {timeSinceSync < 10000 ? '✓ Excellent' : timeSinceSync < 15000 ? '⚠ Warning' : '✗ Critical'}
              </div>
            </div>
          )}

          {/* Account Details */}
          {connection && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-slate-950/50 rounded-lg p-3 border border-slate-800">
                <div className="text-xs text-slate-400">Platform</div>
                <div className="text-white font-medium text-sm">{connection.platform || 'MT4'}</div>
              </div>
              <div className="bg-slate-950/50 rounded-lg p-3 border border-slate-800">
                <div className="text-xs text-slate-400">Account</div>
                <div className="text-white font-medium text-sm">{connection.account_number || 'N/A'}</div>
              </div>
              <div className="bg-slate-950/50 rounded-lg p-3 border border-slate-800">
                <div className="text-xs text-slate-400">Server</div>
                <div className="text-white font-medium text-sm truncate">{connection.server_name || 'N/A'}</div>
              </div>
              <div className="bg-slate-950/50 rounded-lg p-3 border border-slate-800">
                <div className="text-xs text-slate-400">Leverage</div>
                <div className="text-white font-medium text-sm">{connection.leverage || '1:100'}</div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Advanced Diagnostics */}
      {diagnostics && !diagnostics.error && (
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Activity className="w-5 h-5 text-cyan-400" />
              Bridge Diagnostics
            </CardTitle>
            <CardDescription>Detailed bridge endpoint performance metrics</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Success Rate */}
              <div className="bg-slate-950/50 rounded-lg p-4 border border-slate-800">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-slate-400">Success Rate</span>
                  {parseFloat(diagnostics.success_rate) > 95 ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-amber-400" />
                  )}
                </div>
                <div className="text-2xl font-bold text-white">{diagnostics.success_rate}</div>
                <div className="text-xs text-slate-500 mt-1">
                  {diagnostics.successful_requests}/{diagnostics.total_requests} requests
                </div>
              </div>

              {/* Average Latency */}
              <div className="bg-slate-950/50 rounded-lg p-4 border border-slate-800">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-slate-400">Avg Latency</span>
                  <Clock className="w-4 h-4 text-cyan-400" />
                </div>
                <div className="text-2xl font-bold text-white">{diagnostics.average_latency_ms}ms</div>
                <div className="text-xs text-slate-500 mt-1">
                  {diagnostics.average_latency_ms < 200 ? 'Excellent' : diagnostics.average_latency_ms < 500 ? 'Good' : 'Slow'}
                </div>
              </div>

              {/* Consecutive Failures */}
              <div className="bg-slate-950/50 rounded-lg p-4 border border-slate-800">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-slate-400">Failures</span>
                  {diagnostics.consecutive_failures === 0 ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-400" />
                  )}
                </div>
                <div className="text-2xl font-bold text-white">{diagnostics.consecutive_failures}</div>
                <div className="text-xs text-slate-500 mt-1">
                  Consecutive failures
                </div>
              </div>
            </div>

            {/* Latency History Chart */}
            {diagnostics.latency_history && diagnostics.latency_history.length > 0 && (
              <div className="mt-4 bg-slate-950/50 rounded-lg p-4 border border-slate-800">
                <div className="text-xs text-slate-400 mb-3">Latency History (Last 20 Requests)</div>
                <div className="flex items-end gap-1 h-24">
                  {diagnostics.latency_history.map((latency, i) => (
                    <div key={i} className="flex-1 flex flex-col justify-end">
                      <div 
                        className={`w-full rounded-t ${
                          latency < 200 ? 'bg-emerald-500' : latency < 500 ? 'bg-amber-500' : 'bg-rose-500'
                        }`}
                        style={{ height: `${Math.min((latency / 1000) * 100, 100)}%` }}
                        title={`${latency}ms`}
                      />
                    </div>
                  ))}
                </div>
                <div className="flex justify-between text-[10px] text-slate-500 mt-2">
                  <span>0ms</span>
                  <span>Max: {Math.max(...diagnostics.latency_history)}ms</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Connection Tips */}
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white text-sm">Connection Tips</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-slate-400">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
            <span>EA should sync every 5 seconds. Connection is marked stale after 20s without sync.</span>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
            <span>Check that your MT4/MT5 has active internet connection and EA is running.</span>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
            <span>If latency is high (&gt;500ms), check your network connection or server location.</span>
          </div>
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
            <span>Consecutive failures &gt; 3 indicates a problem. Restart EA and check bridge URL.</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}