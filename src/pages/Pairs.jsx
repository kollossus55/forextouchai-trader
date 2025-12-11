import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { 
  Search, 
  TrendingUp, 
  TrendingDown, 
  BarChart2, 
  ArrowRightLeft,
  Filter
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function Pairs() {
  const [searchTerm, setSearchTerm] = useState('');
  const [volatilityFilter, setVolatilityFilter] = useState('ALL');

  const { data: pairs } = useQuery({
    queryKey: ['pairs'],
    queryFn: () => base44.entities.CurrencyPair.list({ limit: 50 }),
    initialData: []
  });

  const filteredPairs = pairs.filter(pair => {
    const matchesSearch = pair.symbol.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesVol = volatilityFilter === 'ALL' || pair.volatility === volatilityFilter;
    return matchesSearch && matchesVol;
  });

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">Market Pairs</h1>
          <p className="text-slate-400 mt-1">Real-time quotes and spreads</p>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
            <Input 
              placeholder="Search symbol..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 bg-slate-900 border-slate-800 text-slate-200"
            />
          </div>
          <Select value={volatilityFilter} onValueChange={setVolatilityFilter}>
            <SelectTrigger className="w-full sm:w-40 bg-slate-900 border-slate-800 text-slate-200">
              <SelectValue placeholder="Volatility" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Volatility</SelectItem>
              <SelectItem value="LOW">Low</SelectItem>
              <SelectItem value="MEDIUM">Medium</SelectItem>
              <SelectItem value="HIGH">High</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filteredPairs.map((pair) => (
          <Card key={pair.id} className="bg-slate-900/50 border-slate-800 backdrop-blur-sm hover:border-emerald-500/30 transition-all group">
            <CardContent className="p-5">
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 flex items-center justify-center font-bold text-slate-200 shadow-inner">
                    {pair.symbol.substring(0,3)}
                  </div>
                  <div>
                    <h3 className="font-bold text-lg text-white leading-none">{pair.symbol}</h3>
                    <Badge variant="outline" className={`mt-1 text-[10px] h-5 ${
                      pair.volatility === 'HIGH' ? 'border-rose-500/30 text-rose-400 bg-rose-500/5' : 
                      pair.volatility === 'MEDIUM' ? 'border-amber-500/30 text-amber-400 bg-amber-500/5' : 
                      'border-emerald-500/30 text-emerald-400 bg-emerald-500/5'
                    }`}>
                      {pair.volatility} VOL
                    </Badge>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold text-white tracking-tight">{pair.current_price.toFixed(5)}</p>
                  <div className={`flex items-center justify-end text-xs font-medium ${pair.change_24h >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {pair.change_24h >= 0 ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                    {pair.change_24h > 0 ? '+' : ''}{pair.change_24h}%
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between text-sm text-slate-500">
                  <span>Spread</span>
                  <span className="text-slate-300">{pair.spread} pips</span>
                </div>
                
                <div className="grid grid-cols-2 gap-2 mt-4">
                  <Button variant="outline" className="border-slate-700 hover:bg-slate-800 text-slate-300 w-full">
                    <BarChart2 className="w-4 h-4 mr-2" /> Chart
                  </Button>
                  <Button className="bg-emerald-600 hover:bg-emerald-700 text-white w-full">
                    <ArrowRightLeft className="w-4 h-4 mr-2" /> Trade
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}