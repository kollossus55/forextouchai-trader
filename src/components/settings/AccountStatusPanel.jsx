import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Activity } from 'lucide-react';
import { toast } from 'sonner';

export default function AccountStatusPanel() {
  const [connections, setConnections] = useState([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const fetch = async () => {
      try {
        const data = await base44.entities.BrokerConnection.list('-updated_date');
        setConnections(data);
      } catch (e) {
        console.error('AccountStatusPanel fetch error:', e);
      }
    };
    fetch();
    const interval = setInterval(() => {
      fetch();
      setTick(t => t + 1); // force re-render for live countdown
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  if (connections.length === 0) return null;

  const now = Date.now();

  const getStatus = (conn) => {
    if (!conn.last_sync) return { connected: false, stale: true, secondsAgo: null };
    const timeSinceSync = now - new Date(conn.last_sync).getTime();
    const connected = timeSinceSync <= 300000 && conn.connection_status === 'CONNECTED';
    const stale = timeSinceSync > 300000;
    return { connected, stale, secondsAgo: Math.floor(timeSinceSync / 1000) };
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Activity className="w-5 h-5 text-emerald-400" />
        <h2 className="text-lg font-bold text-white">
          Connected Accounts ({connections.length})
        </h2>
        <div className="flex gap-1 ml-auto">
          {connections.map(conn => {
            const { connected } = getStatus(conn);
            return (
              <div
                key={conn.id}
                className={`w-2.5 h-2.5 rounded-full ${connected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`}
                title={`Account ${conn.account_number}: ${connected ? 'ONLINE' : 'OFFLINE'}`}
              />
            );
          })}
        </div>
      </div>

      <div className={`grid gap-3 ${connections.length === 1 ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2'}`}>
        {connections.map((conn) => {
          const { connected, stale, secondsAgo } = getStatus(conn);
          return (
            <Card
              key={conn.id}
              className={`border-2 transition-all ${connected ? 'bg-emerald-950/20 border-emerald-500/40' : 'bg-rose-950/20 border-rose-500/40'}`}
            >
              <CardHeader className="pb-2 pt-4 px-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`w-2.5 h-2.5 rounded-full ${connected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
                    <div>
                      <CardTitle className="text-white text-sm font-semibold">
                        {conn.platform || 'MT4'} — #{conn.account_number}
                      </CardTitle>
                      <p className="text-[11px] text-slate-400">{conn.server_name}</p>
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={`text-xs ${connected
                      ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10'
                      : 'border-rose-500/40 text-rose-400 bg-rose-500/10'}`}
                  >
                    {connected ? '✓ ONLINE' : stale ? '✕ STALE' : '✕ OFFLINE'}
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="px-4 pb-3 pt-0">
                <div className="grid grid-cols-4 gap-2 mt-1">
                  <div className="text-center bg-slate-900/50 rounded p-2">
                    <p className="text-[10px] text-slate-500 mb-0.5">Balance</p>
                    <p className="text-sm font-bold text-white">${(conn.balance || 0).toFixed(2)}</p>
                  </div>
                  <div className="text-center bg-slate-900/50 rounded p-2">
                    <p className="text-[10px] text-slate-500 mb-0.5">Equity</p>
                    <p className="text-sm font-bold text-emerald-400">${(conn.equity || 0).toFixed(2)}</p>
                  </div>
                  <div className="text-center bg-slate-900/50 rounded p-2">
                    <p className="text-[10px] text-slate-500 mb-0.5">Free Margin</p>
                    <p className="text-sm font-semibold text-slate-300">${(conn.free_margin || 0).toFixed(2)}</p>
                  </div>
                  <div className="text-center bg-slate-900/50 rounded p-2">
                    <p className="text-[10px] text-slate-500 mb-0.5">Last Sync</p>
                    <p className={`text-xs font-mono ${secondsAgo === null ? 'text-slate-500' : secondsAgo > 300 ? 'text-rose-400' : secondsAgo > 120 ? 'text-amber-400' : 'text-emerald-400'}`}>
                      {secondsAgo !== null ? `${secondsAgo}s ago` : 'Never'}
                    </p>
                  </div>
                </div>
              </CardContent>

              <CardFooter className="px-4 pb-3 pt-0 justify-end">
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-6 text-xs bg-rose-600/80 hover:bg-rose-600"
                  onClick={async () => {
                    if (!window.confirm(`Delete connection for account ${conn.account_number}?`)) return;
                    try {
                      await base44.entities.BrokerConnection.delete(conn.id);
                      setConnections(prev => prev.filter(c => c.id !== conn.id));
                      toast.success('Connection deleted');
                    } catch (e) {
                      toast.error('Failed to delete: ' + e.message);
                    }
                  }}
                >
                  Delete
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </div>
  );
}