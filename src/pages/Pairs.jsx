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
  Activity,
  Clock,
  AlertTriangle,
  ShieldAlert,
  ShieldCheck,
  Settings2
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
import IndicatorPanel from '@/components/market/IndicatorPanel';
import IndicatorCharts from '@/components/market/IndicatorCharts';
import AdvancedChart from '@/components/charts/AdvancedChart';
import { MarketDataService } from '@/components/services/MarketDataService';
import { recordTick, computeSignal } from '@/components/services/SignalEngine';
import SignalSettingsPanel from '@/components/market/SignalSettingsPanel';
import PairCard from '@/components/market/PairCard';
import TopPicksStrip from '@/components/market/TopPicksStrip';
import IndicatorChips from '@/components/market/IndicatorChips';
import { useSignalSettings } from '@/components/services/signalSettings';
import { setTopPick as publishTopPick } from '@/lib/topPickStore';

export default function Pairs() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [tradeModalOpen, setTradeModalOpen] = useState(false);
  const [selectedPair, setSelectedPair] = useState(null);
  const [selectedPairDetails, setSelectedPairDetails] = useState(null);
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [tradeType, setTradeType] = useState('BUY');
  const [volume, setVolume] = useState('0.10');
  const [stopLossPips, setStopLossPips] = useState('30');
  const [takeProfitPips, setTakeProfitPips] = useState('60');
  const [selectedAccounts, setSelectedAccounts] = useState([]);
  const [timeframe, setTimeframe] = useState(() => {
    try { return localStorage.getItem('forextouchai_pairs_timeframe') || 'H4'; } catch { return 'H4'; }
  });
  const handleTimeframeChange = (v) => {
    setTimeframe(v);
    try { localStorage.setItem('forextouchai_pairs_timeframe', v); } catch {}
  };
  const [showAdvancedChart, setShowAdvancedChart] = useState(false);
  const [aiSuggestedLot, setAiSuggestedLot] = useState(null);
  const [signalSettingsOpen, setSignalSettingsOpen] = useState(false);
  const { settings: signalSettings } = useSignalSettings();
  
  // Real-time State
  const [liveData, setLiveData] = useState({});
  const [pairIndicators, setPairIndicators] = useState({});
  const [pairChartData, setPairChartData] = useState({});
  const [pairFactors, setPairFactors] = useState({}); // signal factor breakdown per pair

  const { data: pairs, isLoading, isFetching } = useQuery({
    queryKey: ['pairs'],
    queryFn: () => base44.entities.CurrencyPair.list(),
    staleTime: 30000, // reuse cached list within 30s so navigation shows pairs instantly
    initialData: [],
    initialDataUpdatedAt: 0 // force a real refetch on cold load (initialData [] is otherwise treated as fresh → never fetched → blank grid)
  });

  const { data: connections } = useQuery({
    queryKey: ['broker-connections'],
    queryFn: () => base44.entities.BrokerConnection.list(),
    initialData: [],
    initialDataUpdatedAt: 0
  });

  const { data: riskSettings } = useQuery({
    queryKey: ['risk-settings'],
    queryFn: () => base44.entities.RiskManagementSettings.list('-created_date', 1).then(d => d[0] || null),
    initialData: null
  });

  // Initialize Market Data
  useEffect(() => {
    MarketDataService.initialize();
  }, []);

  // Sync with MarketDataService & compute REAL indicator-based signals
  useEffect(() => {
    if (pairs.length === 0) return;

    // Tick accumulator: fires every second for live price feed
    const tickInterval = setInterval(async () => {
      await MarketDataService.fetchAll();

      setLiveData(prev => {
        const next = { ...prev };
        pairs.forEach(pair => {
          const realPrice = MarketDataService.getPrice(pair.symbol);
          // Record tick into SignalEngine history store
          recordTick(pair.symbol, realPrice);

          let current = next[pair.id];
          if (!current || !Array.isArray(current.history)) {
            const history = Array.from({ length: 20 }, (_, i) => ({
              time: i, price: realPrice * (1 + (Math.random() - 0.5) * 0.002)
            }));
            current = { current_price: realPrice, change_24h: pair.change_24h, history, ai_confidence: current?.ai_confidence || 0, ai_signal: current?.ai_signal || 'NEUTRAL', signal_timestamp: current?.signal_timestamp || Date.now() };
          }
          const newHistory = [...current.history.slice(-49), { time: Date.now(), price: realPrice }];
          next[pair.id] = { ...current, current_price: realPrice, change_24h: pair.change_24h, history: newHistory };
        });
        return next;
      });
    }, 1000);

    // Signal recalculator: fires every 30 seconds using real indicators
    const signalInterval = setInterval(() => {
      pairs.forEach(pair => {
        const price = MarketDataService.getPrice(pair.symbol);
        if (!price || price <= 0) return;

        const result = computeSignal(pair.symbol, timeframe, price);

        setLiveData(prev => {
          const current = prev[pair.id] || {};
          const signalChanged = current.ai_signal !== result.signal;
          return {
            ...prev,
            [pair.id]: {
              ...current,
              ai_signal: result.signal,
              ai_confidence: result.confidence,
              liveSignal: result.liveSignal,
              liveConfidence: result.liveConfidence,
              signal_timestamp: signalChanged ? Date.now() : (current.signal_timestamp || Date.now())
            }
          };
        });

        // Store indicators + chart candles + factors for the modal
        setPairIndicators(prev => ({ ...prev, [pair.id]: result.indicators }));
        setPairChartData(prev => ({ ...prev, [pair.id]: result.chartCandles }));
        setPairFactors(prev => ({ ...prev, [pair.id]: result.factors }));
      });
    }, (signalSettings.recalcInterval || 30) * 1000);

    // Run signal calculation immediately on mount / timeframe change
    setTimeout(() => {
      pairs.forEach(pair => {
        const price = MarketDataService.getPrice(pair.symbol) || pair.current_price || 1;
        const result = computeSignal(pair.symbol, timeframe, price);
        setLiveData(prev => ({
          ...prev,
          [pair.id]: {
            ...(prev[pair.id] || {}),
            ai_signal: result.signal,
            ai_confidence: result.confidence,
            liveSignal: result.liveSignal,
            liveConfidence: result.liveConfidence,
            signal_timestamp: Date.now()
          }
        }));
        setPairIndicators(prev => ({ ...prev, [pair.id]: result.indicators }));
        setPairChartData(prev => ({ ...prev, [pair.id]: result.chartCandles }));
        setPairFactors(prev => ({ ...prev, [pair.id]: result.factors }));
      });
    }, 1500);

    return () => { clearInterval(tickInterval); clearInterval(signalInterval); };
  }, [pairs, timeframe, signalSettings.recalcInterval]);

  // Recompute every pair's signal immediately when engine settings change
  useEffect(() => {
    if (pairs.length === 0) return;
    pairs.forEach(pair => {
      const price = MarketDataService.getPrice(pair.symbol) || pair.current_price || 1;
      const result = computeSignal(pair.symbol, timeframe, price);
      setLiveData(prev => ({
        ...prev,
        [pair.id]: {
          ...(prev[pair.id] || {}),
          ai_signal: result.signal,
          ai_confidence: result.confidence,
          liveSignal: result.liveSignal,
          liveConfidence: result.liveConfidence,
          signal_timestamp: Date.now()
          }
          }));
          setPairIndicators(prev => ({ ...prev, [pair.id]: result.indicators }));
          setPairChartData(prev => ({ ...prev, [pair.id]: result.chartCandles }));
          setPairFactors(prev => ({ ...prev, [pair.id]: result.factors }));
          });
          // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signalSettings]);

  const sendSignal = useMutation({
    mutationFn: async (signalBase) => {
      // Send one signal per selected account
      const targets = selectedAccounts.length > 0 ? selectedAccounts : [null];
      await Promise.all(targets.map(acct =>
        base44.entities.Signal.create({ ...signalBase, ...(acct ? { owner_email: acct } : {}) })
      ));
    },
    onSuccess: () => {
      const count = selectedAccounts.length;
      toast.success("Order Sent to Bridge", { description: `Dispatched to ${count} account${count !== 1 ? 's' : ''}` });
      setTradeModalOpen(false);
    },
    onError: (err) => {
      toast.error("Failed to send order", { description: err.message });
    }
  });

  const handleTradeClick = (pair, type) => {
    setSelectedPair(pair);
    setTradeType(type);

    // Pre-select all connected accounts
    const connectedAccounts = (connections || [])
      .filter(c => c.connection_status === 'CONNECTED')
      .map(c => c.account_number);
    setSelectedAccounts(connectedAccounts.length > 0 ? connectedAccounts : (connections || []).map(c => c.account_number));

    // AI-suggested SL/TP: use indicator-based values if available, else defaults
    const live = liveData[pair.id];
    const indicators = pairIndicators[pair.id];
    const price = live?.current_price || pair.current_price || 0;
    const pipSize = (pair.symbol || '').toUpperCase().includes('JPY') ? 0.01 : 0.0001;

    let suggestedSL = 30;
    let suggestedTP = 60;

    if (indicators && price > 0) {
      // Use ATR-based suggestion if available (ATR in price units → convert to pips)
      const atr = indicators.atr?.value;
      if (atr && atr > 0) {
        suggestedSL = Math.round(atr * 1.5 / pipSize);
        suggestedTP = Math.round(atr * 3.0 / pipSize);
      } else {
        // Fallback: use Bollinger Band width as volatility proxy
        const bbUpper = indicators.bollingerBands?.upper;
        const bbLower = indicators.bollingerBands?.lower;
        if (bbUpper && bbLower) {
          const bbRange = (bbUpper - bbLower) / 2;
          suggestedSL = Math.max(20, Math.round(bbRange * 0.8 / pipSize));
          suggestedTP = Math.max(40, Math.round(bbRange * 1.6 / pipSize));
        }
      }
    }

    setStopLossPips(String(suggestedSL));
    setTakeProfitPips(String(suggestedTP));

    // AI-suggested lot size based on risk % of account balance
    if (riskSettings?.risk_per_trade_percent && price > 0) {
      const totalBalance = (connections || []).reduce((sum, c) => sum + (c.balance || 0), 0);
      if (totalBalance > 0) {
        const riskAmount = totalBalance * (riskSettings.risk_per_trade_percent / 100);
        const slInPrice = suggestedSL * pipSize;
        const rawLot = slInPrice > 0 ? riskAmount / (slInPrice * 100000) : 0.1;
        const clampedLot = Math.min(Math.max(parseFloat(rawLot.toFixed(2)), 0.01), 10);
        setVolume(String(clampedLot));
        setAiSuggestedLot(clampedLot);
      }
    } else {
      setAiSuggestedLot(null);
    }

    setTradeModalOpen(true);
  };

  const handleViewDetails = (pair) => {
    setSelectedPairDetails(pair);
    setDetailsModalOpen(true);
    
    // Always recalculate indicators when modal opens
    // Indicators are already computed by the SignalEngine every 30s.
    // If not yet available (first open), compute immediately.
    if (!pairIndicators[pair.id]) {
      const price = pair.current_price || 1;
      const result = computeSignal(pair.symbol, timeframe, price);
      setPairIndicators(prev => ({ ...prev, [pair.id]: result.indicators }));
      setPairChartData(prev => ({ ...prev, [pair.id]: result.chartCandles }));
      setPairFactors(prev => ({ ...prev, [pair.id]: result.factors }));
    }
  };

  // Count how many indicators agree on a given direction from the factors array
  const getIndicatorAgreement = (pairId, direction) => {
    const factors = pairFactors[pairId] || [];
    const agreeing = factors.filter(f => f.direction === direction);
    const opposing = factors.filter(f => f.direction && f.direction !== 'NEUTRAL' && f.direction !== direction);
    return { agreeing: agreeing.length, opposing: opposing.length, names: agreeing.map(f => f.name) };
  };

  const getManualPipSize = (symbol) => {
    const s = (symbol || '').replace('/', '').toUpperCase();
    return s.includes('JPY') ? 0.01 : 0.0001;
  };

  const calcSLTP = () => {
    if (!selectedPair) return { slPrice: 0, tpPrice: 0, executionPrice: 0 };
    const executionPrice = liveData[selectedPair.id]?.current_price || selectedPair.current_price || 0;
    const pipSize = getManualPipSize(selectedPair.symbol);
    const slPips = parseFloat(stopLossPips) || 0;
    const tpPips = parseFloat(takeProfitPips) || 0;

    const slPrice = slPips > 0
      ? (tradeType === 'BUY' ? executionPrice - slPips * pipSize : executionPrice + slPips * pipSize)
      : 0;
    const tpPrice = tpPips > 0
      ? (tradeType === 'BUY' ? executionPrice + tpPips * pipSize : executionPrice - tpPips * pipSize)
      : 0;
    return { slPrice, tpPrice, executionPrice };
  };

  const executeTrade = () => {
    if (!selectedPair) return;
    const minAgree = signalSettings.minIndicatorAgreement ?? 3;
    const { agreeing } = getIndicatorAgreement(selectedPair.id, tradeType);
    if (agreeing < minAgree) {
      toast.error('Trade Blocked — Insufficient Confluence', {
        description: `Only ${agreeing} of ${minAgree} required indicators agree ${tradeType} on ${selectedPair.symbol}.`,
        duration: 5000
      });
      return;
    }
    const { slPrice, tpPrice, executionPrice } = calcSLTP();

    // Warn (but allow) if trading against AI signal direction
    const aiSignal = liveData[selectedPair.id]?.liveSignal || liveData[selectedPair.id]?.ai_signal;
    if (aiSignal && aiSignal !== 'NEUTRAL' && aiSignal !== tradeType) {
      toast.warning('AI Signal Conflict', {
        description: `AI signals ${aiSignal} for ${selectedPair.symbol}. Proceeding with manual override.`,
        duration: 4000
      });
    }

    // Hard validation: reject if SL/TP are on the wrong side of entry
    if (slPrice > 0) {
      if (tradeType === 'BUY' && slPrice >= executionPrice) {
        toast.error('Invalid Stop Loss', { description: `SL (${slPrice.toFixed(5)}) must be below entry (${executionPrice.toFixed(5)}) for BUY` });
        return;
      }
      if (tradeType === 'SELL' && slPrice <= executionPrice) {
        toast.error('Invalid Stop Loss', { description: `SL (${slPrice.toFixed(5)}) must be above entry (${executionPrice.toFixed(5)}) for SELL` });
        return;
      }
    }
    if (tpPrice > 0) {
      if (tradeType === 'BUY' && tpPrice <= executionPrice) {
        toast.error('Invalid Take Profit', { description: `TP (${tpPrice.toFixed(5)}) must be above entry (${executionPrice.toFixed(5)}) for BUY` });
        return;
      }
      if (tradeType === 'SELL' && tpPrice >= executionPrice) {
        toast.error('Invalid Take Profit', { description: `TP (${tpPrice.toFixed(5)}) must be below entry (${executionPrice.toFixed(5)}) for SELL` });
        return;
      }
    }

    sendSignal.mutate({
      pair: selectedPair.symbol,
      type: tradeType,
      entry_price: executionPrice,
      lot_size: parseFloat(volume),
      stop_loss: parseFloat(slPrice.toFixed(5)),
      take_profit: parseFloat(tpPrice.toFixed(5)),
      confidence: 100,
      strategy: 'MANUAL_EXECUTION',
      status: 'PENDING',
      result_pnl: 0
    });
  };

  const getCategory = (pair) => {
    const sym = pair.symbol.replace('/', '');
    const majorForex = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD', 'XAUUSD'];
    const minorForex = ['EURGBP', 'EURJPY', 'GBPJPY', 'EURCHF', 'AUDJPY', 'GBPCHF', 'EURAUD', 'EURCAD', 'EURNZD', 'GBPAUD', 'GBPCAD', 'GBPNZD', 'AUDCAD', 'AUDCHF', 'AUDNZD', 'CADCHF', 'CADJPY', 'CHFJPY', 'NZDCAD', 'NZDCHF', 'NZDJPY'];
    if (majorForex.includes(sym)) return 'MAJOR';
    if (minorForex.includes(sym)) return 'MINOR';
    return null; // Non-forex — exclude
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

  // Deduplicate pairs by symbol (normalize slash format, keep the most recent)
  const normalizeSymbol = (s) => (s || '').replace('/', '').toUpperCase();
  const uniquePairs = mergedPairs.reduce((acc, pair) => {
    const existing = acc.find(p => normalizeSymbol(p.symbol) === normalizeSymbol(pair.symbol));
    if (!existing) {
      acc.push(pair);
    } else if (new Date(pair.created_date) > new Date(existing.created_date)) {
      // Replace with newer record if duplicate found
      const index = acc.indexOf(existing);
      acc[index] = pair;
    }
    return acc;
  }, []);

  const filteredPairs = uniquePairs.filter(pair =>
    getCategory(pair) !== null &&
    pair.symbol.toLowerCase().includes(searchTerm.toLowerCase())
  ).sort((a, b) => (b.liveConfidence ?? b.ai_confidence ?? 0) - (a.liveConfidence ?? a.ai_confidence ?? 0));

  // Top Picks: the strongest directional (BUY/SELL) setups by LIVE AI
  // confidence, ranked identically to the grid (liveConfidence desc) so the
  // strip's #1 is always the grid's #1 — no hold, no drift.
  const topPickThreshold = signalSettings.topPickConfidence ?? 75;
  const topPicks = filteredPairs
    .filter(p => {
      const sig = p.liveSignal || p.ai_signal;
      const conf = p.liveConfidence ?? p.ai_confidence ?? 0;
      return sig && sig !== 'NEUTRAL' && conf >= topPickThreshold;
    })
    .sort((a, b) => (b.liveConfidence ?? b.ai_confidence ?? 0) - (a.liveConfidence ?? a.ai_confidence ?? 0))
    .slice(0, 1);

  // Top Picks mirror the grid live — same sort (liveConfidence desc), same
  // threshold + directional filter. No hold, so the strip always matches the
  // top of the Pairs grid exactly.
  const displayPicks = topPicks;
  const topPickIds = new Set(displayPicks.map(p => p.id));

  // Publish the strip's exact #1 Top Pick to the shared store so the global
  // TopPickWatcher popup mirrors the strip instead of recomputing independently.
  useEffect(() => {
    publishTopPick(displayPicks[0] || null);
  }, [displayPicks]);

  const majorPairs = filteredPairs.filter(p => getCategory(p) === 'MAJOR');
  const minorPairs = filteredPairs.filter(p => getCategory(p) === 'MINOR');

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
        <div className="w-[110px]">
            <Select value={timeframe} onValueChange={handleTimeframeChange}>
                <SelectTrigger className="bg-emerald-950/30 border-emerald-500/50 text-emerald-400 font-bold h-10 hover:bg-emerald-500/10 hover:border-emerald-400 transition-all shadow-[0_0_15px_-5px_rgba(16,185,129,0.3)]">
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
        <Button
          onClick={() => setSignalSettingsOpen(true)}
          className="bg-emerald-600/15 border border-emerald-500/50 text-emerald-400 font-semibold hover:bg-emerald-600 hover:text-white hover:border-emerald-400 transition-all shadow-[0_0_15px_-5px_rgba(16,185,129,0.45)]"
        >
          <Settings2 className="w-4 h-4 mr-1.5" /> Signal
        </Button>
      </div>
      </div>

      {(isLoading || (isFetching && (!pairs || pairs.length === 0))) ? (
        <div className="flex flex-col justify-center items-center py-20 gap-3">
           <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500"></div>
           <p className="text-slate-400 text-sm">Loading market pairs…</p>
        </div>
      ) : (
      <>
      <TopPicksStrip picks={displayPicks} onTrade={handleTradeClick} threshold={signalSettings.topPickConfidence ?? 75} />

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
            {majorPairs.map(pair => (
              <PairCard key={pair.id} pair={pair} topPickIds={topPickIds} factors={pairFactors[pair.id]} onViewDetails={handleViewDetails} onTrade={handleTradeClick} />
            ))}
            {majorPairs.length === 0 && <div className="text-slate-500 col-span-full text-center py-10">No major pairs found</div>}
          </div>
        </TabsContent>
        
        <TabsContent value="minors" className="mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {minorPairs.map(pair => (
              <PairCard key={pair.id} pair={pair} topPickIds={topPickIds} factors={pairFactors[pair.id]} onViewDetails={handleViewDetails} onTrade={handleTradeClick} />
            ))}
            {minorPairs.length === 0 && <div className="text-slate-500 col-span-full text-center py-10">No minor pairs found</div>}
          </div>
        </TabsContent>
      </Tabs>
      </>
      )}

      {/* Trade Modal */}
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
            {/* AI Signal Confirmation Banner */}
            {selectedPair && (() => {
              const lockedSignal = liveData[selectedPair.id]?.ai_signal;
              const lockedConf = liveData[selectedPair.id]?.ai_confidence ?? 0;
              const liveConf = liveData[selectedPair.id]?.liveConfidence ?? lockedConf;
              const isAligned = !lockedSignal || lockedSignal === 'NEUTRAL' || lockedSignal === tradeType;
              const isNeutral = !lockedSignal || lockedSignal === 'NEUTRAL';
              return (
                <div className={`rounded-lg px-3 py-2.5 flex items-start gap-2.5 border text-sm ${
                  isNeutral ? 'bg-slate-800/50 border-slate-700 text-slate-400' :
                  isAligned ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' :
                  'bg-rose-500/10 border-rose-500/40 text-rose-300'
                }`}>
                  {isNeutral ? <AlertTriangle className="w-4 h-4 mt-0.5 text-slate-400 shrink-0" /> :
                   isAligned ? <ShieldCheck className="w-4 h-4 mt-0.5 text-emerald-400 shrink-0" /> :
                   <ShieldAlert className="w-4 h-4 mt-0.5 text-rose-400 shrink-0" />}
                  <div>
                    <div className="font-semibold">
                      {isNeutral ? 'AI: No Signal' :
                          isAligned ? `AI Confirmed: ${lockedSignal} (${lockedConf}% locked)` :
                          `⚠ AI signals ${lockedSignal} — manual override active`}
                        </div>
                        <div className="text-xs mt-0.5 opacity-75">
                          {isNeutral ? 'AI has no directional bias. Proceed with caution.' :
                           isAligned ? `Locked signal holds steady for execution. Live: ${liveConf}%.` :
                           'You are trading against the AI signal. Order will still be sent.'}
                    </div>
                  </div>
                </div>
              );
            })()}
            {/* Indicator Confluence Validation */}
            {selectedPair && (() => {
              const minAgree = signalSettings.minIndicatorAgreement ?? 3;
              const { agreeing, opposing, names } = getIndicatorAgreement(selectedPair.id, tradeType);
              const passes = agreeing >= minAgree;
              return (
                <div className={`rounded-lg px-3 py-2.5 flex items-start gap-2.5 border text-sm ${
                  passes ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-rose-500/10 border-rose-500/40 text-rose-300'
                }`}>
                  {passes ? <ShieldCheck className="w-4 h-4 mt-0.5 text-emerald-400 shrink-0" /> : <ShieldAlert className="w-4 h-4 mt-0.5 text-rose-400 shrink-0" />}
                  <div className="flex-1">
                    <div className="font-semibold">
                      {passes
                        ? `Confluence Validated: ${agreeing} indicators agree ${tradeType}`
                        : `Insufficient Confluence: ${agreeing}/${minAgree} indicators agree ${tradeType}`}
                    </div>
                    <div className="text-xs mt-0.5 opacity-75">
                      {names.length > 0 ? names.join(' · ') : 'No indicators aligned with this direction'}
                      {opposing > 0 && ` · ${opposing} opposing`}
                    </div>
                    {!passes && (
                      <div className="text-xs mt-1 text-rose-400 font-semibold">
                        Trade blocked — need at least {minAgree} indicators to agree {tradeType}.
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
            {/* Account selector */}
            {connections && connections.length > 0 && (
              <div className="grid grid-cols-4 items-start gap-4">
                <Label className="text-right text-slate-400 pt-2">Accounts</Label>
                <div className="col-span-3 space-y-2">
                  {connections.map(conn => (
                    <label key={conn.account_number} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedAccounts.includes(conn.account_number)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedAccounts(prev => [...prev, conn.account_number]);
                          } else {
                            setSelectedAccounts(prev => prev.filter(a => a !== conn.account_number));
                          }
                        }}
                        className="accent-emerald-500"
                      />
                      <span className="text-sm text-slate-300 font-mono">{conn.account_number}</span>
                      <span className="text-xs text-slate-500">{conn.platform || 'MT4'} · {conn.server_name}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${conn.connection_status === 'CONNECTED' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700 text-slate-400'}`}>
                        {conn.connection_status}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right text-slate-400">Volume</Label>
              <div className="col-span-3 flex items-center gap-2">
                <Input 
                  value={volume}
                  onChange={(e) => setVolume(e.target.value)}
                  className="bg-slate-950 border-slate-800" 
                  type="number"
                  step="0.01"
                />
                {aiSuggestedLot && (
                  <span className="text-[10px] text-purple-400 whitespace-nowrap font-semibold">
                    AI: {aiSuggestedLot}
                  </span>
                )}
              </div>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right text-slate-400">Price</Label>
              <div className="col-span-3 font-mono text-slate-200">
                {selectedPair && (liveData[selectedPair.id]?.current_price || selectedPair.current_price).toFixed(5)}
              </div>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right text-slate-400">Stop Loss</Label>
              <div className="col-span-3 flex items-center gap-2">
                <Input 
                  value={stopLossPips}
                  onChange={(e) => setStopLossPips(e.target.value)}
                  className="bg-slate-950 border-slate-800" 
                  type="number"
                  step="1"
                  placeholder="0 = none"
                />
                <span className="text-xs text-slate-500 whitespace-nowrap">pips</span>
              </div>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right text-slate-400">Take Profit</Label>
              <div className="col-span-3 flex items-center gap-2">
                <Input 
                  value={takeProfitPips}
                  onChange={(e) => setTakeProfitPips(e.target.value)}
                  className="bg-slate-950 border-slate-800" 
                  type="number"
                  step="1"
                  placeholder="0 = none"
                />
                <span className="text-xs text-slate-500 whitespace-nowrap">pips</span>
              </div>
            </div>
          </div>
          {selectedPair && (() => {
            const { slPrice, tpPrice, executionPrice } = calcSLTP();
            const isLivePrice = !!liveData[selectedPair.id]?.current_price;
            // Detect invalid SL/TP direction
            const slInvalid = slPrice > 0 && (tradeType === 'BUY' ? slPrice >= executionPrice : slPrice <= executionPrice);
            const tpInvalid = tpPrice > 0 && (tradeType === 'BUY' ? tpPrice <= executionPrice : tpPrice >= executionPrice);
            return (
              <div className={`px-1 pb-2 text-xs bg-slate-950/50 rounded-lg p-3 border mx-1 ${slInvalid || tpInvalid ? 'border-rose-500/50' : 'border-slate-800'}`}>
                {!isLivePrice && <div className="text-amber-400 mb-2 font-semibold">⚠ Using cached price — live price not yet loaded</div>}
                {(slInvalid || tpInvalid) && <div className="text-rose-400 mb-2 font-semibold">⚠ Invalid SL/TP — order will be blocked</div>}
                <div className="flex justify-between text-slate-500"><span>Entry:</span><span className={`font-mono ${isLivePrice ? 'text-slate-300' : 'text-amber-400'}`}>{executionPrice.toFixed(5)}</span></div>
                <div className="flex justify-between text-slate-500"><span>SL Price:</span><span className={slInvalid ? 'text-rose-500 font-mono font-bold' : slPrice > 0 ? 'text-rose-400 font-mono' : 'text-slate-500'}>{slPrice > 0 ? slPrice.toFixed(5) : 'None'}</span></div>
                <div className="flex justify-between text-slate-500"><span>TP Price:</span><span className={tpInvalid ? 'text-rose-500 font-mono font-bold' : tpPrice > 0 ? 'text-emerald-400 font-mono' : 'text-slate-500'}>{tpPrice > 0 ? tpPrice.toFixed(5) : 'None'}</span></div>
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTradeModalOpen(false)} className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white">
              Cancel
            </Button>
            {(() => {
              const minAgree = signalSettings.minIndicatorAgreement ?? 3;
              const confluencePasses = selectedPair && getIndicatorAgreement(selectedPair.id, tradeType).agreeing >= minAgree;
              return (
                <Button 
                  onClick={executeTrade}
                  disabled={selectedAccounts.length === 0 || sendSignal.isPending || !confluencePasses}
                  className={tradeType === 'BUY' ? 'bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40' : 'bg-rose-600 hover:bg-rose-700 disabled:opacity-40'}
                >
                  {sendSignal.isPending ? 'Sending...' : !confluencePasses ? `Need ${minAgree} indicators` : tradeType === 'BUY' ? 'Buy by Market' : 'Sell by Market'}
                </Button>
              );
            })()}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Indicator Details Modal */}
      <Dialog open={detailsModalOpen} onOpenChange={setDetailsModalOpen}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white sm:max-w-[900px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BarChart2 className="w-5 h-5 text-purple-400" />
              Technical Analysis - {selectedPairDetails?.symbol}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Real-time indicators and charts for {timeframe} timeframe
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-6">
            {selectedPairDetails && pairIndicators[selectedPairDetails.id] && pairChartData[selectedPairDetails.id]?.length > 0 ? (
              <>
                {/* Chart Mode Toggle */}
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    onClick={() => setShowAdvancedChart(!showAdvancedChart)}
                    className={`text-xs font-semibold ${
                      showAdvancedChart 
                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white' 
                        : 'bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-emerald-500/30'
                    }`}
                  >
                    {showAdvancedChart ? 'Basic Charts' : 'Advanced Charts'}
                  </Button>
                </div>
                
                {/* Charts Section */}
                <div>
                  <h3 className="text-sm font-semibold text-slate-300 mb-3">
                    {showAdvancedChart ? 'Advanced Chart Analysis' : 'Indicator Charts'}
                  </h3>
                  {showAdvancedChart ? (
                    <AdvancedChart
                      priceData={pairChartData[selectedPairDetails.id] || []}
                      pairSymbol={selectedPairDetails.symbol}
                      currentPrice={selectedPairDetails.current_price}
                    />
                  ) : (
                    <IndicatorCharts 
                      priceData={pairChartData[selectedPairDetails.id] || []}
                      indicators={pairIndicators[selectedPairDetails.id]}
                    />
                  )}
                </div>
                
                {/* Signal Factor Breakdown — colour-enhanced, shows enabled/disabled */}
                <div>
                  <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                    <BrainCircuit className="w-4 h-4 text-purple-400" /> Signal Factor Breakdown
                  </h3>
                  <IndicatorChips
                    factors={pairFactors[selectedPairDetails.id] || []}
                    settings={signalSettings}
                    variant="modal"
                  />
                </div>

                {/* Values Panel */}
                <div>
                  <h3 className="text-sm font-semibold text-slate-300 mb-3">Current Values</h3>
                  <IndicatorPanel 
                    indicators={pairIndicators[selectedPairDetails.id]} 
                    currentPrice={selectedPairDetails.current_price}
                  />
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-purple-500 mb-4"></div>
                <p className="text-slate-400 text-sm">Calculating technical indicators...</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailsModalOpen(false)} className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SignalSettingsPanel open={signalSettingsOpen} onOpenChange={setSignalSettingsOpen} />
    </div>
  );
}