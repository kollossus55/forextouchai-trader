import React, { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Slider } from '@/components/ui/slider';
import { ColoredSlider } from '@/components/ui/colored-slider';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Clock, Shield, BarChart, Settings, Zap, Bot } from 'lucide-react';
import BotConfigAI from './BotConfigAI';

export default function BotConfigDialog({ open, onOpenChange, onSubmit, initialData }) {
  const { data: availablePairs } = useQuery({
    queryKey: ['pairs-list'],
    queryFn: () => base44.entities.CurrencyPair.list(),
    initialData: []
  });

  const uniquePairs = React.useMemo(() => {
    const seen = new Set();
    return availablePairs.filter(pair => {
      if (seen.has(pair.symbol)) return false;
      seen.add(pair.symbol);
      return true;
    });
  }, [availablePairs]);

  const [formData, setFormData] = React.useState({
    name: '',
    strategy_type: 'AI_PREDICTIVE',
    timeframe: 'H1',
    risk_level: 'MEDIUM',
    lot_size: 0.1,
    min_confidence: 80,
    trading_start_time: '08:00',
    trading_end_time: '17:00',
    stop_loss_pips: 30,
    take_profit_pips: 60,
    max_open_trades: 3,
    max_daily_trades: 0,
    pairs: ['EUR/USD'],
    auto_execution: false,
    use_ai_risk: false
  });

  // Strategy-to-Timeframe mapping
  const strategyTimeframes = {
    'SCALPING': 'M5',
    'SWING': 'H4',
    'DAY_TRADING': 'H1',
    'AI_PREDICTIVE': 'H1',
    'PRICE_ACTION': 'H1',
    'PATTERN_TRADING': 'H4',
    'CANDLESTICK': 'M30',
    'HYBRID_ALL': 'H1'
  };

  useEffect(() => {
    if (initialData) {
      setFormData({
        ...initialData,
        pairs: initialData.pairs || ['EUR/USD'],
        sl_tp_mode: initialData.sl_tp_mode || 'FIXED',
        atr_period: initialData.atr_period || 14,
        atr_multiplier_sl: initialData.atr_multiplier_sl || 1.5,
        atr_multiplier_tp: initialData.atr_multiplier_tp || 3.0,
        money_management: initialData.money_management || 'FIXED',
        martingale_multiplier: initialData.martingale_multiplier || 2.0
      });
    } else {
      // Reset to defaults for new bot
      setFormData({
        name: '',
        strategy_type: 'AI_PREDICTIVE',
        timeframe: 'H1',
        risk_level: 'MEDIUM',
        lot_size: 0.1,
        min_confidence: 80,
        trading_start_time: '08:00',
        trading_end_time: '17:00',
        stop_loss_pips: 30,
        take_profit_pips: 60,
        max_open_trades: 3,
        pairs: ['EUR/USD'],
        sl_tp_mode: 'FIXED',
        atr_period: 14,
        atr_multiplier_sl: 1.5,
        atr_multiplier_tp: 3.0,
        money_management: 'FIXED',
        martingale_multiplier: 2.0,
        auto_execution: false,
        use_ai_risk: false
      });
    }
  }, [initialData, open]);

  const [isOptimizing, setIsOptimizing] = React.useState(false);

  const handleOptimize = async () => {
    setIsOptimizing(true);
    try {
        const { data } = await base44.functions.invoke('optimizeStrategy', {
            strategyType: formData.strategy_type,
            currentParams: formData,
            // In a real app, we might pass specific historical data here
        });

        if (data && data.suggested_params) {
            setFormData(prev => ({
                ...prev,
                ...data.suggested_params
            }));
            // Show toast or alert with reasoning
            // alert(`Optimization applied: ${data.suggested_params.reasoning}`); 
        }
    } catch (e) {
        console.error("Optimization failed", e);
    } finally {
        setIsOptimizing(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-800 text-white sm:max-w-[600px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            {initialData ? <Settings className="w-5 h-5 text-emerald-500" /> : <Settings className="w-5 h-5 text-emerald-500" />}
            {initialData ? 'Edit Bot Configuration' : 'Create New Trading Bot'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="mt-4">
          <Tabs defaultValue="general" className="w-full">
            <TabsList className="grid w-full grid-cols-5 bg-slate-950 border border-slate-800">
              <TabsTrigger value="general" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white text-xs">General</TabsTrigger>
              <TabsTrigger value="risk" className="data-[state=active]:bg-rose-600 data-[state=active]:text-white text-xs">Risk</TabsTrigger>
              <TabsTrigger value="schedule" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-xs">Schedule</TabsTrigger>
              <TabsTrigger value="ai" className="data-[state=active]:bg-purple-600 data-[state=active]:text-white text-xs">AI</TabsTrigger>
              <TabsTrigger value="assistant" className="data-[state=active]:bg-purple-600 data-[state=active]:text-white text-xs">
                <Bot className="w-3 h-3 mr-1" />Assistant
              </TabsTrigger>
            </TabsList>

            {/* General Tab */}
            <TabsContent value="general" className="space-y-4 mt-4 bg-slate-900/50 p-4 rounded-lg border border-slate-800/50">
               <div className="flex justify-end mb-2">
                  <Button 
                    type="button" 
                    variant="outline" 
                    size="sm" 
                    onClick={handleOptimize}
                    disabled={isOptimizing}
                    className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                  >
                    {isOptimizing ? <Zap className="w-3 h-3 mr-2 animate-spin" /> : <Zap className="w-3 h-3 mr-2" />}
                    {isOptimizing ? 'AI Optimizing...' : 'AI Auto-Optimize'}
                  </Button>
               </div>
              <div className="space-y-2">
                <Label>Bot Name</Label>
                <Input 
                  value={formData.name}
                  onChange={e => setFormData({...formData, name: e.target.value})}
                  className="bg-slate-950 border-slate-800"
                  placeholder="e.g. Alpha Scalper V1"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Strategy Engine</Label>
                  <Select 
                    value={formData.strategy_type} 
                    onValueChange={v => {
                      const newTimeframe = strategyTimeframes[v] || 'H1';
                      setFormData({...formData, strategy_type: v, timeframe: newTimeframe});
                    }}
                  >
                    <SelectTrigger className="bg-slate-950 border-slate-800">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="AI_PREDICTIVE">AI Predictive Model</SelectItem>
                      <SelectItem value="SCALPING">High Frequency Scalping</SelectItem>
                      <SelectItem value="SWING">Swing Trading</SelectItem>
                      <SelectItem value="DAY_TRADING">Day Trading</SelectItem>
                      <SelectItem value="PRICE_ACTION">Price Action Analysis</SelectItem>
                      <SelectItem value="PATTERN_TRADING">Chart Pattern Trading</SelectItem>
                      <SelectItem value="CANDLESTICK">Candlestick Patterns</SelectItem>
                      <SelectItem value="HYBRID_ALL">Hybrid (All Strategies)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center justify-between">
                    Trading Timeframe
                    <span className="text-[10px] text-emerald-400 font-normal">Auto-set: {strategyTimeframes[formData.strategy_type]}</span>
                  </Label>
                  <Select 
                    value={formData.timeframe} 
                    onValueChange={v => setFormData({...formData, timeframe: v})}
                  >
                    <SelectTrigger className="bg-slate-950 border-slate-800">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="M1">M1 - 1 Minute</SelectItem>
                      <SelectItem value="M5">M5 - 5 Minutes</SelectItem>
                      <SelectItem value="M15">M15 - 15 Minutes</SelectItem>
                      <SelectItem value="M30">M30 - 30 Minutes</SelectItem>
                      <SelectItem value="H1">H1 - 1 Hour</SelectItem>
                      <SelectItem value="H4">H4 - 4 Hours</SelectItem>
                      <SelectItem value="D1">D1 - Daily</SelectItem>
                      <SelectItem value="W1">W1 - Weekly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Active Pairs</Label>
                <div className="flex flex-wrap gap-2 p-3 bg-slate-950 border border-slate-800 rounded-md max-h-40 overflow-y-auto">
                    {uniquePairs.map(pair => (
                        <Badge 
                            key={pair.id}
                            variant="outline"
                            className={`cursor-pointer transition-all select-none ${formData.pairs.includes(pair.symbol) 
                                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50 hover:bg-emerald-500/30' 
                                : 'text-slate-400 border-slate-700 hover:text-slate-200 hover:border-slate-500'}`}
                            onClick={() => {
                                const current = formData.pairs;
                                if (current.includes(pair.symbol)) {
                                    setFormData({...formData, pairs: current.filter(p => p !== pair.symbol)});
                                } else {
                                    setFormData({...formData, pairs: [...current, pair.symbol]});
                                }
                            }}
                        >
                            {pair.symbol}
                        </Badge>
                    ))}
                    {uniquePairs.length === 0 && <span className="text-xs text-slate-500">No pairs available. Please check Pairs tab.</span>}
                </div>
                <p className="text-[10px] text-slate-500">Select which currency pairs this bot should trade.</p>
              </div>
            </TabsContent>

            {/* Risk Tab */}
            <TabsContent value="risk" className="space-y-6 mt-4 bg-gradient-to-br from-rose-900/10 to-slate-900/50 p-4 rounded-lg border border-rose-500/20">
            <div className="flex items-center justify-between p-3 mb-4 rounded bg-slate-950 border border-rose-500/30">
                <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-rose-400" />
                    <div className="flex flex-col">
                        <span className="text-sm font-medium text-rose-100">AI Dynamic Risk Management</span>
                        <span className="text-[10px] text-slate-500">Auto-adjust Stop Loss & Lot Size based on volatility</span>
                    </div>
                </div>
                <Switch 
                    checked={formData.use_ai_risk || false} 
                    onCheckedChange={v => setFormData({...formData, use_ai_risk: v})} 
                    className="data-[state=checked]:bg-emerald-600"
                />
            </div>

            <div className={`space-y-6 transition-opacity ${formData.use_ai_risk ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
                {/* Money Management Section */}
                <div className="p-4 rounded border border-slate-800 bg-slate-950/30 space-y-4">
                    <Label className="text-rose-200">Money Management</Label>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label className="text-xs text-slate-400">Mode</Label>
                            <Select 
                              value={formData.money_management} 
                              onValueChange={v => setFormData({...formData, money_management: v})}
                            >
                                <SelectTrigger className="bg-slate-950 border-slate-800 h-8 text-xs">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="FIXED">Fixed Lot Size</SelectItem>
                                    <SelectItem value="MARTINGALE">Martingale</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        {formData.money_management === 'MARTINGALE' ? (
                             <div className="space-y-2 animate-in fade-in slide-in-from-left-2">
                                <Label className="text-xs text-slate-400">Multiplier</Label>
                                <Input 
                                    type="number" 
                                    step="0.1"
                                    value={formData.martingale_multiplier}
                                    onChange={e => setFormData({...formData, martingale_multiplier: parseFloat(e.target.value)})}
                                    className="bg-slate-950 border-slate-800 h-8 text-xs" 
                                />
                             </div>
                        ) : (
                             <div className="space-y-2">
                                <Label className="text-xs text-slate-400">Lot Size</Label>
                                <Input 
                                    type="number" 
                                    step="0.01"
                                    value={formData.lot_size}
                                    onChange={e => setFormData({...formData, lot_size: parseFloat(e.target.value)})}
                                    className="bg-slate-950 border-slate-800 h-8 text-xs" 
                                />
                             </div>
                        )}
                    </div>
                </div>

                {/* SL/TP Config Section */}
                <div className="p-4 rounded border border-slate-800 bg-slate-950/30 space-y-4">
                    <div className="flex justify-between items-center">
                        <Label className="text-rose-200">Stop Loss & Take Profit</Label>
                        <Select 
                           value={formData.sl_tp_mode} 
                           onValueChange={v => setFormData({...formData, sl_tp_mode: v})}
                        >
                            <SelectTrigger className="bg-slate-950 border-slate-800 h-7 text-xs w-32">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="FIXED">Fixed Pips</SelectItem>
                                <SelectItem value="ATR">ATR Based</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {formData.sl_tp_mode === 'FIXED' ? (
                        <>
                          <div className="space-y-4 pt-2 animate-in fade-in">
                              <div className="flex justify-between">
                                  <Label>Stop Loss (Pips)</Label>
                                  <span className="text-xs text-rose-400">{formData.stop_loss_pips} pips</span>
                              </div>
                              <ColoredSlider 
                                  value={[formData.stop_loss_pips]} 
                                  min={5} 
                                  max={200} 
                                  step={5}
                                  onValueChange={([v]) => setFormData({...formData, stop_loss_pips: v})}
                                  className="py-1"
                                  rangeClassName="bg-rose-500"
                                  thumbClassName="border-rose-500"
                                  trackClassName="bg-rose-500/20"
                              />
                          </div>

                          <div className="space-y-4">
                              <div className="flex justify-between">
                                  <Label>Take Profit (Pips)</Label>
                                  <span className="text-xs text-emerald-400">{formData.take_profit_pips} pips</span>
                              </div>
                              <ColoredSlider 
                                  value={[formData.take_profit_pips]} 
                                  min={5} 
                                  max={500} 
                                  step={5}
                                  onValueChange={([v]) => setFormData({...formData, take_profit_pips: v})}
                                  className="py-1"
                                  rangeClassName="bg-emerald-500"
                                  thumbClassName="border-emerald-500"
                                  trackClassName="bg-emerald-500/20"
                              />
                          </div>
                        </>
                    ) : (
                        <div className="grid grid-cols-3 gap-4 animate-in fade-in">
                            <div className="space-y-2">
                                <Label className="text-xs text-slate-400">ATR Period</Label>
                                <Input 
                                    type="number"
                                    value={formData.atr_period}
                                    onChange={e => setFormData({...formData, atr_period: parseInt(e.target.value)})}
                                    className="bg-slate-950 border-slate-800 h-8 text-xs"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label className="text-xs text-slate-400">SL Multiplier</Label>
                                <Input 
                                    type="number"
                                    step="0.1"
                                    value={formData.atr_multiplier_sl}
                                    onChange={e => setFormData({...formData, atr_multiplier_sl: parseFloat(e.target.value)})}
                                    className="bg-slate-950 border-slate-800 h-8 text-xs"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label className="text-xs text-slate-400">TP Multiplier</Label>
                                <Input 
                                    type="number"
                                    step="0.1"
                                    value={formData.atr_multiplier_tp}
                                    onChange={e => setFormData({...formData, atr_multiplier_tp: parseFloat(e.target.value)})}
                                    className="bg-slate-950 border-slate-800 h-8 text-xs"
                                />
                            </div>
                        </div>
                    )}
                </div>
            </div>
              {formData.use_ai_risk && (
                   <div className="text-xs text-emerald-400 text-center italic">
                       AI will automatically override manual settings based on real-time market conditions.
                   </div>
              )}
            </TabsContent>

            {/* Schedule Tab */}
            <TabsContent value="schedule" className="space-y-4 mt-4 bg-gradient-to-br from-blue-900/10 to-slate-900/50 p-4 rounded-lg border border-blue-500/20">
              <div className="flex items-center gap-2 mb-2 text-blue-300 text-sm">
                <Clock className="w-4 h-4 text-blue-400" />
                <span>Trading Hours (Server Time)</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Start Time</Label>
                  <Input 
                    type="time"
                    value={formData.trading_start_time}
                    onChange={e => setFormData({...formData, trading_start_time: e.target.value})}
                    className="bg-slate-950 border-slate-800"
                  />
                </div>
                <div className="space-y-2">
                  <Label>End Time</Label>
                  <Input 
                    type="time"
                    value={formData.trading_end_time}
                    onChange={e => setFormData({...formData, trading_end_time: e.target.value})}
                    className="bg-slate-950 border-slate-800"
                  />
                </div>
              </div>
              <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded text-xs text-blue-300">
                Bot will only open new trades within this time window. Existing trades will be managed regardless of time.
              </div>
            </TabsContent>

            {/* AI Tab */}
            <TabsContent value="ai" className="space-y-6 mt-4 bg-gradient-to-br from-purple-900/10 to-slate-900/50 p-4 rounded-lg border border-purple-500/20">

               <div className="flex items-center justify-between p-3 rounded bg-purple-500/10 border border-purple-500/20 mb-4">
                  <div className="flex items-center gap-2">
                      <Zap className="w-4 h-4 text-purple-400" />
                      <div className="flex flex-col">
                          <span className="text-sm font-medium text-purple-400">Automated Order Execution</span>
                          <span className="text-[10px] text-emerald-200/60">Allow AI to open/close trades on MT4/MT5 directly</span>
                      </div>
                  </div>
                  <Switch 
                      checked={formData.auto_execution || false} 
                      onCheckedChange={v => setFormData({...formData, auto_execution: v})} 
                      className="data-[state=checked]:bg-emerald-600"
                  />
              </div>

               <div className="space-y-4">
                <div className="flex justify-between">
                   <Label>Minimum AI Confidence</Label>
                   <span className={`text-xs font-bold ${formData.min_confidence >= 80 ? 'text-emerald-400' : 'text-slate-400'}`}>
                     {formData.min_confidence}%
                   </span>
                </div>
                <Slider 
                  value={[formData.min_confidence]} 
                  min={50} 
                  max={99} 
                  step={1}
                  onValueChange={([v]) => setFormData({...formData, min_confidence: v})}
                  className="py-1"
                />
                <p className="text-xs text-slate-500">Only execute trades when AI prediction confidence exceeds this threshold.</p>
              </div>

              <div className="space-y-2 pt-2">
                <Label>Max Concurrent Trades</Label>
                <Input 
                  type="number"
                  min="1"
                  max="50"
                  value={formData.max_open_trades}
                  onChange={e => setFormData({...formData, max_open_trades: parseInt(e.target.value)})}
                  className="bg-slate-950 border-slate-800"
                />
              </div>

              <div className="space-y-2 pt-2">
                <Label className="flex items-center justify-between">
                  Max Daily Trades
                  <span className="text-[10px] text-emerald-400 font-normal">0 = Unlimited</span>
                </Label>
                <Input 
                  type="number"
                  min="0"
                  value={formData.max_daily_trades || 0}
                  onChange={e => setFormData({...formData, max_daily_trades: parseInt(e.target.value)})}
                  className="bg-slate-950 border-slate-800"
                  placeholder="0 for unlimited"
                />
                <p className="text-xs text-slate-500">Maximum trades per day (0 = unlimited). Prevents overtrading.</p>
              </div>
            </TabsContent>

            {/* AI Assistant Tab */}
            <TabsContent value="assistant" className="mt-4">
              <BotConfigAI 
                currentConfig={formData}
                onApplyRecommendation={(updates) => setFormData(prev => ({ ...prev, ...updates }))}
                backtestResults={null}
              />
            </TabsContent>
          </Tabs>

          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white">
              Cancel
            </Button>
            <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700">
              {initialData ? 'Save Configuration' : 'Deploy Bot'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}