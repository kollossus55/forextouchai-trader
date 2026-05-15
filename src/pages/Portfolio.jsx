import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { 
  History, 
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  Download
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function Portfolio() {
  const { data: trades } = useQuery({
    queryKey: ['trades-all'],
    queryFn: () => base44.entities.Trade.list('-created_date', 100),
    refetchInterval: 10000,
    staleTime: 0,
    gcTime: 0,
    initialData: []
  });

  const openTrades = trades.filter(t => t.status === 'OPEN');
  const closedTrades = trades.filter(t => t.status === 'CLOSED');
  
  const totalPnL = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const openPnL = openTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Wallet className="w-8 h-8 text-emerald-500" /> Portfolio
          </h1>
          <p className="text-slate-400 mt-1">Manage your positions and trade history</p>
        </div>
        <Button className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 hover:text-emerald-300 transition-all">
          <Download className="w-4 h-4 mr-2" /> Export Report
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">Closed P&L</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${totalPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(2)}
            </div>
            <p className="text-xs text-slate-500 mt-1">Realized profit</p>
          </CardContent>
        </Card>
        <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">Open P&L</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${openPnL >= 0 ? 'text-blue-400' : 'text-orange-400'}`}>
              {openPnL >= 0 ? '+' : ''}${openPnL.toFixed(2)}
            </div>
            <p className="text-xs text-slate-500 mt-1">Unrealized profit</p>
          </CardContent>
        </Card>
        <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">Total Trades</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">{trades.length}</div>
            <p className="text-xs text-slate-500 mt-1">
              <span className="text-emerald-400">{openTrades.length}</span> open • <span className="text-slate-400">{closedTrades.length}</span> closed
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="open" className="w-full">
        <TabsList className="bg-slate-900 border border-slate-800">
          <TabsTrigger value="open" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
            Open Positions
            <Badge variant="secondary" className="ml-2 bg-slate-950 text-slate-400 text-[10px] h-4">{openTrades.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="history" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
            Trade History
            <Badge variant="secondary" className="ml-2 bg-slate-950 text-slate-400 text-[10px] h-4">{closedTrades.length}</Badge>
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="open" className="mt-4">
          <Card className="bg-slate-900/50 border-slate-800">
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-slate-900/50">
                  <TableRow className="border-slate-800 hover:bg-slate-900/50">
                    <TableHead className="text-slate-400">Pair</TableHead>
                    <TableHead className="text-slate-400">Type</TableHead>
                    <TableHead className="text-slate-400">Open Price</TableHead>
                    <TableHead className="text-slate-400">Current Price</TableHead>
                    <TableHead className="text-slate-400 text-right">P&L</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                 {openTrades.length === 0 ? (
                   <TableRow>
                     <TableCell colSpan={5} className="text-center py-8 text-slate-500">
                       No open positions
                     </TableCell>
                   </TableRow>
                 ) : (
                   openTrades.map((trade) => (
                     <TableRow key={trade.id} className="border-slate-800 hover:bg-slate-800/30">
                       <TableCell className="font-medium text-slate-200">{trade.pair}</TableCell>
                       <TableCell>
                         <Badge variant="outline" className={`${trade.type === 'BUY' ? 'text-emerald-400 border-emerald-500/30' : 'text-rose-400 border-rose-500/30'}`}>
                           {trade.type}
                         </Badge>
                       </TableCell>
                       <TableCell className="text-slate-300 font-mono text-sm">{trade.open_price.toFixed(5)}</TableCell>
                       <TableCell className="text-slate-300 font-mono text-sm">
                          {trade.close_price ? trade.close_price.toFixed(5) : (trade.open_price * (trade.type === 'BUY' ? 1.001 : 0.999)).toFixed(5)}
                       </TableCell>
                       <TableCell className={`text-right font-medium ${trade.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                         {trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}
                       </TableCell>
                     </TableRow>
                   ))
                 )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <Card className="bg-slate-900/50 border-slate-800">
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-slate-900/50">
                  <TableRow className="border-slate-800 hover:bg-slate-900/50">
                    <TableHead className="text-slate-400">Date</TableHead>
                    <TableHead className="text-slate-400">Pair</TableHead>
                    <TableHead className="text-slate-400">Type</TableHead>
                    <TableHead className="text-slate-400">Open</TableHead>
                    <TableHead className="text-slate-400">Close</TableHead>
                    <TableHead className="text-slate-400 text-right">Profit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {closedTrades.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-slate-500">
                        No trade history
                      </TableCell>
                    </TableRow>
                  ) : (
                    closedTrades.map((trade) => (
                      <TableRow key={trade.id} className="border-slate-800 hover:bg-slate-800/30">
                        <TableCell className="text-slate-400 text-xs">
                          {new Date(trade.created_date).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="font-medium text-slate-200">{trade.pair}</TableCell>
                        <TableCell>
                          <span className={`text-xs font-bold ${trade.type === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {trade.type}
                          </span>
                        </TableCell>
                        <TableCell className="text-slate-300 font-mono text-sm">{trade.open_price.toFixed(5)}</TableCell>
                        <TableCell className="text-slate-300 font-mono text-sm">{trade.close_price ? trade.close_price.toFixed(5) : 'N/A'}</TableCell>
                        <TableCell className={`text-right font-medium ${trade.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}