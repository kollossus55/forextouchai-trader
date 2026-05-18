import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Activity, RefreshCw, TrendingUp, TrendingDown, ChevronDown, ChevronUp } from 'lucide-react';

export default function RunningTradesSummary({ trades, connections, onRefresh, lastSync }) {
  const [collapsed, setCollapsed] = useState({});

  // If multiple connections, group trades by connection (account)
  // Each connection gets its own block; trades without a ticket match go to a "General" bucket
  const buildAccountMap = () => {
    // Group by account_number (stored in owner_email by bridge)
    const map = {};
    // Pre-populate all known connection buckets
    for (const conn of connections) {
      map[conn.account_number || conn.id] = { conn, trades: [] };
    }
    for (const trade of trades) {
      const key = trade.owner_email || 'unknown';
      if (!map[key]) {
        // Trade belongs to an account not in connections list — create a bucket for it
        const matchedConn = connections.find(c => c.account_number === key);
        map[key] = { conn: matchedConn || null, trades: [] };
      }
      map[key].trades.push(trade);
    }
    // Remove empty connection buckets (no trades)
    for (const key of Object.keys(map)) {
      if (map[key].trades.length === 0) delete map[key];
    }
    // If no connections, fallback
    if (Object.keys(map).length === 0 && trades.length > 0) {
      return { default: { conn: null, trades } };
    }
    return map;
  };

  const accountMap = buildAccountMap();

  const totalPnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const totalTrades = trades.length;

  return (
    <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-sm">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-white flex items-center gap-2">
            <Activity className="w-5 h-5 text-emerald-400" /> Running Trades
          </CardTitle>
          <CardDescription className="text-slate-400">Active positions per account</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10 hover:border-emerald-500/50"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Badge variant="outline" className="border-blue-500/30 text-blue-400 bg-blue-500/10">
            {totalTrades} Open
          </Badge>
          {lastSync && (
            <span className="text-[10px] text-slate-500">
              EA: {Math.floor((Date.now() - new Date(lastSync).getTime()) / 1000)}s ago
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {totalTrades === 0 ? (
          <div className="text-center py-8 text-slate-500 text-sm">No active trades running</div>
        ) : (
          <>
            {/* Overall summary row */}
            {Object.keys(accountMap).length > 1 && (
              <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-800/30 border border-slate-700/30">
                <span className="text-xs text-slate-400 font-medium">Total across all accounts</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-300">{totalTrades} trades</span>
                  <span className={`text-sm font-bold ${totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
                  </span>
                </div>
              </div>
            )}

            {/* Per-account blocks */}
            {Object.entries(accountMap).map(([acctKey, { conn, trades: acctTrades }]) => {
              const accountPnl = acctTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
              const buys = acctTrades.filter(t => t.type === 'BUY').length;
              const sells = acctTrades.filter(t => t.type === 'SELL').length;

              // Group pairs summary
              const pairSummary = {};
              for (const t of acctTrades) {
                if (!pairSummary[t.pair]) pairSummary[t.pair] = { buy: 0, sell: 0, pnl: 0 };
                pairSummary[t.pair][t.type === 'BUY' ? 'buy' : 'sell']++;
                pairSummary[t.pair].pnl += t.pnl || 0;
              }

              const isCollapsed = collapsed[acctKey];
              return (
                <div key={acctKey} className="border border-slate-700/50 rounded-xl overflow-hidden">
                  {/* Account header — clickable to toggle */}
                  <button
                    onClick={() => setCollapsed(prev => ({ ...prev, [acctKey]: !prev[acctKey] }))}
                    className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-800/50 border-b border-slate-700/40 hover:bg-slate-800/70 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${conn?.connection_status === 'CONNECTED' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-500'}`}></div>
                      <span className="text-sm font-semibold text-slate-200">
                        {conn?.platform || 'MT4'} — {conn?.server_name || 'Account'}
                      </span>
                      <span className="text-xs text-slate-500 font-mono">#{conn?.account_number || acctKey}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-slate-400">{acctTrades.length} trades</span>
                      <div className="flex items-center gap-1">
                        {buys > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold">{buys}B</span>}
                        {sells > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400 font-bold">{sells}S</span>}
                      </div>
                      <span className={`text-sm font-bold flex items-center gap-1 ${accountPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {accountPnl >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {accountPnl >= 0 ? '+' : ''}${accountPnl.toFixed(2)}
                      </span>
                      {isCollapsed ? <ChevronDown className="w-4 h-4 text-slate-400 ml-1" /> : <ChevronUp className="w-4 h-4 text-slate-400 ml-1" />}

                    </div>
                  </button>

                  {/* Pair rows — hidden when collapsed */}
                  {!isCollapsed && <div className="divide-y divide-slate-800/50">
                    {Object.entries(pairSummary).map(([pair, info]) => (
                      <div key={pair} className="flex items-center justify-between px-4 py-2 hover:bg-slate-800/20 transition-colors">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-200 w-20">{pair}</span>
                          <div className="flex gap-1">
                            {info.buy > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                                {info.buy} BUY
                              </span>
                            )}
                            {info.sell > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-400 border border-rose-500/20">
                                {info.sell} SELL
                              </span>
                            )}
                          </div>
                        </div>
                        <span className={`text-xs font-semibold ${info.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {info.pnl >= 0 ? '+' : ''}${info.pnl.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>}
                </div>
              );
            })}
          </>
        )}
      </CardContent>
    </Card>
  );
}