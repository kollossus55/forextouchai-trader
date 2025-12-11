import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { 
  Search, 
  TrendingUp, 
  TrendingDown, 
  BarChart2, 
  ArrowRightLeft,
  BrainCircuit,
  CheckCircle2,
  Activity,
  Zap
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import TickChart from '@/components/market/TickChart';

export default function Pairs() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [tradeModalOpen, setTradeModalOpen] = useState(false);
  const [selectedPair, setSelectedPair] = useState(null);
  const [tradeType, setTradeType] = useState('BUY');
  const [volume, setVolume] = useState('0.10');
  
  // Real-time Simulation State
  const [liveData, setLiveData] = useState({});

  const { data: pairs, isLoading } = useQuery({
    queryKey: ['pairs'],
    queryFn: () => base44.entities.CurrencyPair.list(),
    initialData: []
  });

  // Initialize live data simulation
  useEffect(() => {
    if (pairs.length > 0 && Object.keys(liveData).length === 0) {
      const initialData = {};
      pairs.forEach(pair => {
        // Generate initial mock history
        const history = [];
        let price = pair.current_price;
        for (let i = 0; i < 20; i++) {
          price = price * (1 + (Math.random() - 0.5) * 0.001);
          history.push({ time: i, price });
        }
        initialData[pair.id] = {
          current_price: pair.current_price,
          change_24h: pair.change_24h,
          history
        };
      });
      setLiveData(initialData);
    }
  }, [pairs]);

  // Simulate Ticks
  useEffect(() => {
    const interval = setInterval(() => {
      setLiveData(prev => {
        const next = { ...prev };
        Object.keys(next).forEach(id => {
          const current = next[id];
          const volatility = 0.0005; // 0.05% move
          const change = (Math.random() - 0.5) * volatility;
          const newPrice = current.current_price * (1 + change);
          
          // Update history
          const newHistory = [...current.history.slice(1), { time: Date.now(), price: newPrice }];
          
          next[id] = {
            ...current,
            current_price: newPrice,
            change_24h: current.change_24h + (change * 100), // Approximate daily change impact
            history: newHistory
          };
        });
        return next;
      });
    }, 1000); // 1 second updates

    return () => clearInterval(interval);
  }, []);

  const createTrade = useMutation({
    mutationFn: (data) => base44.entities.Trade.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['trades-home']); // Refresh dashboard trades
      setTradeModalOpen(false);
      // Optional: Show success toast or notification
    }
  });

  const handleTradeClick = (pair, type) => {
    setSelectedPair(pair);
    setTradeType(type);
    setTradeModalOpen(true);
  };

  const executeTrade = () => {
    if (!selectedPair) return;
    
    createTrade.mutate({
      pair: selectedPair.symbol,
      type: tradeType,
      lot_size: parseFloat(volume),
      open_price: selectedPair.current_price, // simplified execution
      close_price: 0,
      pnl: 0,
      status: 'OPEN',
      is_auto: false
    });
  };

  const getCategory = (pair) => {
    if (pair.category) return pair.category;
    const majors = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF', 'AUD/USD', 'USD/CAD', 'NZD/USD'];
    return majors.includes(pair.symbol) ? 'MAJOR' : 'MINOR';
  };

  const filteredPairs = pairs.filter(pair => 
    pair.symbol.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const majorPairs = filteredPairs.filter(p => getCategory(p) === 'MAJOR');
  const minorPairs = filteredPairs.filter(p => getCategory(p) === 'MINOR');

  const PairCard = ({ pair }) => {
    // Use simulated live data if available, else fallback to static
    const live = liveData[pair.id] || { 
      current_price: pair.current_price, 
      change_24h: pair.change_24h,
      history: []
    };

    return (
      <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-sm hover:border-emerald-500/30 transition-all group overflow-hidden">
        <div className={`h-1 w-full ${
          pair.ai_signal === 'BUY' ? 'bg-emerald-500' : 
          pair.ai_signal === 'SELL' ? 'bg-rose-500' : 'bg-slate-700'
        }`} />
        <CardContent className="p-5">
          <div className="flex justify-between items-start mb-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 flex items-center justify-center font-bold text-slate-200 shadow-inner">
                {pair.symbol.substring(0,3)}
              </div>
              <div>
                <h3 className="font-bold text-lg text-white leading-none flex items-center gap-2">
                  {pair.symbol}
                  <div className="flex items-center">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse mr-1"></span>
                  </div>
                </h3>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="outline" className="text-[10px] h-5 border-slate-700 text-slate-400">
                    {pair.spread} pips
                  </Badge>
                </div>
              </div>
            </div>
            <div className="text-right">
              <p className={`text-xl font-bold tracking-tight font-mono transition-colors duration-300 ${
                live.current_price > pair.current_price ? 'text-emerald-400' : 
                live.current_price < pair.current_price ? 'text-rose-400' : 'text-white'
              }`}>
                {live.current_price.toFixed(5)}
              </p>
              <div className={`flex items-center justify-end text-xs font-medium ${live.change_24h >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {live.change_24h >= 0 ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                {live.change_24h > 0 ? '+' : ''}{live.change_24h.toFixed(2)}%
              </div>
            </div>
          </div>

          {/* Tick Chart */}
          <div className="mb-4">
             <TickChart 
                data={live.history} 
                color={live.change_24h >= 0 ? '#10b981' : '#f43f5e'} 
             />
          </div>

          {/* AI Analysis Section */}
          <div className="bg-slate-950/50 rounded-lg p-3 border border-slate-800/50 mb-4">
            <div className="flex justify-between items-center mb-2">
              <div className="flex items-center gap-1.5">
                <BrainCircuit className="w-3.5 h-3.5 text-purple-400" />
                <span className="text-xs font-semibold text-slate-300">AI Analysis</span>
              </div>
              <Badge className={`text-[10px] h-5 px-2 ${
                pair.ai_signal === 'BUY' ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30' : 
                pair.ai_signal === 'SELL' ? 'bg-rose-500/20 text-rose-400 hover:bg-rose-500/30' : 
                'bg-slate-700/20 text-slate-400'
              }`}>
                {pair.ai_signal || 'NEUTRAL'}
              </Badge>
            </div>
            
            <div className="space-y-1.5">
              <div className="flex justify-between text-[10px] text-slate-400">
                <span>Confidence</span>
                <span className={pair.ai_confidence > 80 ? 'text-emerald-400' : 'text-slate-300'}>
                  {pair.ai_confidence || 0}%
                </span>
              </div>
              <Progress 
                value={pair.ai_confidence || 0} 
                className="h-1 bg-slate-800" 
                indicatorClassName={pair.ai_signal === 'SELL' ? 'bg-rose-500' : 'bg-emerald-500'} 
              />
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-2">
            <Button 
              className="bg-emerald-600/10 hover:bg-emerald-600 text-emerald-500 hover:text-white border border-emerald-600/20 transition-all"
              onClick={() => handleTradeClick(pair, 'BUY')}
            >
              Buy
            </Button>
            <Button 
              className="bg-rose-600/10 hover:bg-rose-600 text-rose-500 hover:text-white border border-rose-600/20 transition-all"
              onClick={() => handleTradeClick(pair, 'SELL')}
            >
              Sell
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
      <div>
        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
          Market Pairs <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-xs py-0.5"><Activity className="w-3 h-3 mr-1 animate-pulse" /> Live Feed</Badge>
        </h1>
        <p className="text-slate-400 mt-1">Real-time quotes & AI analysis</p>
      </div>

      <div className="flex gap-3 w-full md:w-auto">
         <div className="relative flex-1 md:w-64">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
          <Input 
            placeholder="Search pairs..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 bg-slate-900 border-slate-800 text-slate-200"
          />
        </div>
        <Button variant="outline" size="icon" className="border-slate-800 text-slate-400 hover:text-emerald-400 bg-slate-900">
           <BarChart2 className="w-4 h-4" />
        </Button>
      </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center items-center py-20">
           <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500"></div>
        </div>
      ) : (
      <Tabs defaultValue="majors" className="w-full">
        <TabsList className="bg-slate-900 border border-slate-800">
          <TabsTrigger value="majors" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
            Major Pairs
            <Badge variant="secondary" className="ml-2 bg-slate-950 text-slate-400 text-[10px] h-4">{majorPairs.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="minors" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
            Minor Pairs
            <Badge variant="secondary" className="ml-2 bg-slate-950 text-slate-400 text-[10px] h-4">{minorPairs.length}</Badge>
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="majors" className="mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {majorPairs.map(pair => <PairCard key={pair.id} pair={pair} />)}
            {majorPairs.length === 0 && <div className="text-slate-500 col-span-full text-center py-10">No major pairs found</div>}
          </div>
        </TabsContent>
        
        <TabsContent value="minors" className="mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {minorPairs.map(pair => <PairCard key={pair.id} pair={pair} />)}
            {minorPairs.length === 0 && <div className="text-slate-500 col-span-full text-center py-10">No minor pairs found</div>}
          </div>
        </TabsContent>
      </Tabs>
      )}

      <Dialog open={tradeModalOpen} onOpenChange={setTradeModalOpen}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="w-5 h-5 text-emerald-500" />
              Execute Market Order
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {selectedPair?.symbol} • <span className={tradeType === 'BUY' ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>{tradeType}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right text-slate-400">Volume</Label>
              <Input 
                value={volume}
                onChange={(e) => setVolume(e.target.value)}
                className="col-span-3 bg-slate-950 border-slate-800" 
                type="number"
                step="0.01"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right text-slate-400">Price</Label>
              <div className="col-span-3 font-mono text-slate-200">
                {selectedPair?.current_price}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTradeModalOpen(false)} className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white">
              Cancel
            </Button>
            <Button 
              onClick={executeTrade}
              className={tradeType === 'BUY' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'}
            >
              {tradeType === 'BUY' ? 'Buy by Market' : 'Sell by Market'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}