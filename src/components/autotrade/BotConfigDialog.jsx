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
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Clock, Shield, BarChart, Settings } from 'lucide-react';

export default function BotConfigDialog({ open, onOpenChange, onSubmit, initialData }) {
  const { data: availablePairs } = useQuery({
    queryKey: ['pairs-list'],
    queryFn: () => base44.entities.CurrencyPair.list(),
    initialData: []
  });

  const [formData, setFormData] = React.useState({
    name: '',
    strategy_type: 'AI_PREDICTIVE',
    risk_level: 'MEDIUM',
    lot_size: 0.1,
    min_confidence: 80,
    trading_start_time: '08:00',
    trading_end_time: '17:00',
    stop_loss_pips: 30,
    take_profit_pips: 60,
    max_open_trades: 3,
    pairs: ['EUR/USD']
  });

  useEffect(() => {
    if (initialData) {
      setFormData({
        ...initialData,
        pairs: initialData.pairs || ['EUR/USD']
      });
    } else {
      // Reset to defaults for new bot
      setFormData({
        name: '',
        strategy_type: 'AI_PREDICTIVE',
        risk_level: 'MEDIUM',
        lot_size: 0.1,
        min_confidence: 80,
        trading_start_time: '08:00',
        trading_end_time: '17:00',
        stop_loss_pips: 30,
        take_profit_pips: 60,
        max_open_trades: 3,
        pairs: ['EUR/USD']
      });
    }
  }, [initialData, open]);

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
            <TabsList className="grid w-full grid-cols-4 bg-slate-950 border border-slate-800">
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="risk">Risk & Lots</TabsTrigger>
              <TabsTrigger value="schedule">Schedule</TabsTrigger>
              <TabsTrigger value="ai">AI Thresholds</TabsTrigger>
            </TabsList>

            {/* General Tab */}
            <TabsContent value="general" className="space-y-4 mt-4 bg-slate-900/50 p-4 rounded-lg border border-slate-800/50">
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
              <div className="space-y-2">
                <Label>Strategy Engine</Label>
                <Select 
                  value={formData.strategy_type} 
                  onValueChange={v => setFormData({...formData, strategy_type: v})}
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
                    <SelectItem value="HYBRID_ALL">Hybrid (All Strategies)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Active Pairs</Label>
                <div className="flex flex-wrap gap-2 p-3 bg-slate-950 border border-slate-800 rounded-md max-h-40 overflow-y-auto">
                    {availablePairs.map(pair => (
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
                    {availablePairs.length === 0 && <span className="text-xs text-slate-500">No pairs available. Please check Pairs tab.</span>}
                </div>
                <p className="text-[10px] text-slate-500">Select which currency pairs this bot should trade.</p>
              </div>
            </TabsContent>

            {/* Risk Tab */}
            <TabsContent value="risk" className="space-y-6 mt-4 bg-slate-900/50 p-4 rounded-lg border border-slate-800/50">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Risk Level</Label>
                  <Select 
                    value={formData.risk_level} 
                    onValueChange={v => setFormData({...formData, risk_level: v})}
                  >
                    <SelectTrigger className="bg-slate-950 border-slate-800">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LOW">Low (Conservative)</SelectItem>
                      <SelectItem value="MEDIUM">Medium (Balanced)</SelectItem>
                      <SelectItem value="HIGH">High (Aggressive)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Lot Size</Label>
                  <Input 
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={formData.lot_size}
                    onChange={e => setFormData({...formData, lot_size: parseFloat(e.target.value)})}
                    className="bg-slate-950 border-slate-800"
                  />
                </div>
              </div>
              
              <div className="space-y-4 pt-2">
                <div className="flex justify-between">
                   <Label>Stop Loss (Pips)</Label>
                   <span className="text-xs text-slate-400">{formData.stop_loss_pips} pips</span>
                </div>
                <Slider 
                  value={[formData.stop_loss_pips]} 
                  min={5} 
                  max={200} 
                  step={5}
                  onValueChange={([v]) => setFormData({...formData, stop_loss_pips: v})}
                  className="py-1"
                />
              </div>

              <div className="space-y-4">
                <div className="flex justify-between">
                   <Label>Take Profit (Pips)</Label>
                   <span className="text-xs text-slate-400">{formData.take_profit_pips} pips</span>
                </div>
                <Slider 
                  value={[formData.take_profit_pips]} 
                  min={5} 
                  max={500} 
                  step={5}
                  onValueChange={([v]) => setFormData({...formData, take_profit_pips: v})}
                  className="py-1"
                />
              </div>
            </TabsContent>

            {/* Schedule Tab */}
            <TabsContent value="schedule" className="space-y-4 mt-4 bg-slate-900/50 p-4 rounded-lg border border-slate-800/50">
              <div className="flex items-center gap-2 mb-2 text-slate-400 text-sm">
                <Clock className="w-4 h-4" />
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
            <TabsContent value="ai" className="space-y-6 mt-4 bg-slate-900/50 p-4 rounded-lg border border-slate-800/50">
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