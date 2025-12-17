import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { 
  Search, 
  TrendingUp, 
  TrendingDown, 
  BarChart2, 
  ArrowRightLeft,
  BrainCircuit,
  CheckCircle2,
  Activity
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
import { MarketDataService } from '@/components/services/MarketDataService';

export default function Pairs() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [tradeModalOpen, setTradeModalOpen] = useState(false);
  const [selectedPair, setSelectedPair] = useState(null);
  const [tradeType, setTradeType] = useState('BUY');
  const [volume, setVolume] = useState('0.10');
  const [timeframe, setTimeframe] = useState('H1'); // Default to 1 Hour
  
  // Real-time State
  const [liveData, setLiveData] = useState({});

  const { data: pairs, isLoading } = useQuery({
    queryKey: ['pairs'],
    queryFn: () => base44.entities.CurrencyPair.list(),
    initialData: []
  });

  // Initialize Market Data
  useEffect(() => {
    MarketDataService.initialize();
  }, []);

  // Sync with MarketDataService & Simulate AI
  useEffect(() => {
    if (pairs.length === 0) return;

    const getTimeframeSignal = (pair, tf) => {
        // Deterministic signal generation based on Timeframe + Time Bucket + Pair
        const tfDurations = { 
            'M1': 60000, 
            'M5': 300000, 
            'M15': 900000, 
            'H1': 3600000, 
            'H4': 14400000, 
            'D1': 86400000 
        };
        const duration = tfDurations[tf] || 3600000;
        const bucket = Math.floor(Date.now() / duration);

        // Simple hash function
        const seed = pair.symbol + tf + bucket;
        let hash = 0;
        for (let i = 0; i < seed.length; i++) {
            hash = ((hash << 5) - hash) + seed.charCodeAt(i);
            hash |= 0;
        }
        const rand = Math.abs(hash);

        // Calculate Confidence (Base + Volatility Noise)
        const baseConfidence = 60 + (rand % 35); // 60-95%

        // Determine Direction
        // Strong bias towards 24h trend if confidence is high
        const trend = pair.change_24h > 0 ? 'BUY' : 'SELL';
        const counterTrend = pair.change_24h > 0 ? 'SELL' : 'BUY';

        // 70% chance to follow trend, 30% chance for counter-trend/correction
        const direction = (rand % 100) < 70 ? trend : counterTrend;

        // Only signal if confidence > 75
        let signal = 'NEUTRAL';
        if (baseConfidence > 75) {
            signal = direction;
        }

        return { signal, confidence: baseConfidence };
    };

    const interval = setInterval(async () => {
      // Ensure we have the latest data
      await MarketDataService.fetchAll();

      setLiveData(prev => {
        const next = { ...prev };

        pairs.forEach(pair => {
            // Get real price from service
            const realPrice = MarketDataService.getPrice(pair.symbol);

            // Init or Get Current State
            let current = next[pair.id];
            if (!current) {
                const history = [];
                // Backfill dummy history
                for (let i = 0; i < 20; i++) {
                   history.push({ time: i, price: realPrice * (1 + (Math.random() - 0.5) * 0.002) });
                }
                current = {
                    current_price: realPrice,
                    change_24h: pair.change_24h,
                    history,
                    ai_confidence: 0,
                    ai_signal: 'NEUTRAL'
                };
            }

            // Update Price History
            const newHistory = [...current.history.slice(1), { time: Date.now(), price: realPrice }];

            // Get Stable Signal for current timeframe
            const { signal, confidence } = getTimeframeSignal(pair, timeframe);

            next[pair.id] = {
                ...current,
                current_price: realPrice,
                change_24h: pair.change_24h, 
                history: newHistory,
                ai_confidence: confidence,
                ai_signal: signal
            };
        });

        return next;
      });
    }, 1000); 

    return () => clearInterval(interval);
  }, [pairs, timeframe]);

  const sendSignal = useMutation({
    mutationFn: (data) => base44.entities.Signal.create(data),
    onSuccess: () => {
      toast.success("Order Sent to Bridge", { description: "Waiting for MT4 execution..." });
      setTradeModalOpen(false);
    },
    onError: (err) => {
      toast.error("Failed to send order", { description: err.message });
    }
  });

  const handleTradeClick = (pair, type) => {
    setSelectedPair(pair);
    setTradeType(type);
    setTradeModalOpen(true);
  };

  const executeTrade = () => {
    if (!selectedPair) return;
    
    // Use the simulated live price for execution accuracy
    const executionPrice = liveData[selectedPair.id]?.current_price || selectedPair.current_price;

    sendSignal.mutate({
      pair: selectedPair.symbol,
      type: tradeType,
      entry_price: executionPrice,
      lot_size: parseFloat(volume),
      stop_loss: 0, // 0 implies no SL for market order (or handled by EA default)
      take_profit: 0,
      confidence: 100,
      strategy: 'MANUAL_EXECUTION',
      status: 'PENDING', // Bridge picks up PENDING signals
      result_pnl: 0
    });
  };

  const getCategory = (pair) => {
    if (pair.category) return pair.category;
    const majors = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF', 'AUD/USD', 'USD/CAD', 'NZD/USD'];
    return majors.includes(pair.symbol) ? 'MAJOR' : 'MINOR';
  };

  // Merge Live Data with Static Data
  const mergedPairs = pairs.map(pair => {
      const live = liveData[pair.id];
      return {
          ...pair,
          ...live, // Overrides static ai_confidence/signal/price with live values
          current_price: live?.current_price || pair.current_price,
          history: live?.history || []
      };
  });

  const filteredPairs = mergedPairs.filter(pair => 
    pair.symbol.toLowerCase().includes(searchTerm.toLowerCase())
  ).sort((a, b) => (b.ai_confidence || 0) - (a.ai_confidence || 0));

  const maxConfidence = Math.max(...mergedPairs.map(p => p.ai_confidence || 0));

  const majorPairs = filteredPairs.filter(p => getCategory(p) === 'MAJOR');
  const minorPairs = filteredPairs.filter(p => getCategory(p) === 'MINOR');

  const PairCard = ({ pair }) => {
    // pair now includes live data (merged)
    const isTopPick = (pair.ai_confidence || 0) === maxConfidence && maxConfidence > 70;
    
    return (
      <Card className={`bg-slate-900/50 backdrop-blur-sm transition-all group overflow-hidden ${
          isTopPick 
            ? 'border-2 border-amber-400/50 shadow-[0_0_20px_-5px_rgba(251,191,36,0.2)]' 
            : 'border border-slate-800 hover:border-emerald-500/30'
        }`}>
        <div className={`h-1 w-full ${
          isTopPick ? 'bg-gradient-to-r from-amber-300 via-amber-500 to-amber-300' :
          pair.ai_signal === 'BUY' ? 'bg-emerald-500' : 
          pair.ai_signal === 'SELL' ? 'bg-rose-500' : 'bg-slate-700'
        }`} />
        <CardContent className="p-5 relative">
          {isTopPick && (
            <div className="absolute -top-3 -right-3">
               <span className="relative flex h-6 w-6">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-6 w-6 bg-amber-500 items-center justify-center">
                    <Activity className="h-3 w-3 text-amber-950" />
                  </span>
               </span>
            </div>
          )}
          <div className="flex justify-between items-start mb-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 flex items-center justify-center font-bold text-slate-200 shadow-inner">
                {pair.symbol.substring(0,3)}
              </div>
              <div>
                <h3 className="font-bold text-lg text-white leading-none flex items-center gap-2">
                  {pair.symbol}
                  {isTopPick && <Badge className="bg-amber-500/20 text-amber-300 border-0 text-[10px] px-1 py-0 h-4">Top Pick</Badge>}
                </h3>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="outline" className="text-[10px] h-5 border-slate-700 text-slate-400">
                    {pair.spread} pips
                  </Badge>
                </div>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xl font-bold tracking-tight font-mono transition-colors duration-300 text-white">
                {pair.current_price.toFixed(5)}
              </p>
              <div className={`flex items-center justify-end text-xs font-medium ${pair.change_24h >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {pair.change_24h >= 0 ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                {pair.change_24h > 0 ? '+' : ''}{pair.change_24h.toFixed(2)}%
              </div>
            </div>
          </div>

          {/* Tick Chart */}
          <div className="mb-4">
             <TickChart 
                data={pair.history} 
                color={pair.change_24h >= 0 ? '#10b981' : '#f43f5e'} 
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
        <div className="w-[100px]">
            <Select value={timeframe} onValueChange={setTimeframe}>
                <SelectTrigger className="bg-slate-900 border-slate-800 text-slate-200 h-10">
                    <SelectValue placeholder="Period" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-800 text-slate-200">
                    <SelectItem value="M1">M1</SelectItem>
                    <SelectItem value="M5">M5</SelectItem>
                    <SelectItem value="M15">M15</SelectItem>
                    <SelectItem value="H1">H1</SelectItem>
                    <SelectItem value="H4">H4</SelectItem>
                    <SelectItem value="D1">D1</SelectItem>
                </SelectContent>
            </Select>
        </div>
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
                {selectedPair && (liveData[selectedPair.id]?.current_price || selectedPair.current_price).toFixed(5)}
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