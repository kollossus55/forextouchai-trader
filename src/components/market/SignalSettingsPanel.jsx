import React, { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Settings2, RotateCcw, ChevronDown, ChevronRight } from 'lucide-react';
import {
  useSignalSettings, SENSITIVITY_THRESHOLDS,
} from '@/components/services/signalSettings';

const SENSITIVITY_INFO = {
  LOW: { label: 'Low', desc: 'Fewer, higher-quality signals. Needs strong indicator agreement.' },
  MEDIUM: { label: 'Medium', desc: 'Balanced — the default behaviour.' },
  HIGH: { label: 'High', desc: 'More signals, faster reactions. Lower bar to trigger.' },
};

// Each indicator carries a literal colour palette (enabled tint + dot) so
// Tailwind keeps the classes. Disabled rows are faded instead.
const FACTOR_META = [
  { key: 'rsi',        label: 'RSI',              hint: 'Overbought / oversold',  on: 'border-amber-500/40 bg-amber-500/5',   dot: 'bg-amber-400' },
  { key: 'macd',       label: 'MACD',             hint: 'Momentum crossover',     on: 'border-sky-500/40 bg-sky-500/5',      dot: 'bg-sky-400' },
  { key: 'bollinger',  label: 'Bollinger Bands',  hint: 'Volatility position',    on: 'border-violet-500/40 bg-violet-500/5', dot: 'bg-violet-400' },
  { key: 'emaCross',   label: 'EMA 20/50',        hint: 'Trend direction',        on: 'border-cyan-500/40 bg-cyan-500/5',    dot: 'bg-cyan-400' },
  { key: 'ema200',     label: 'Price vs EMA200',  hint: 'Long-term trend',        on: 'border-indigo-500/40 bg-indigo-500/5', dot: 'bg-indigo-400' },
  { key: 'stochastic', label: 'Stochastic',       hint: 'Oscillator extremes',    on: 'border-fuchsia-500/40 bg-fuchsia-500/5', dot: 'bg-fuchsia-400' },
];

export default function SignalSettingsPanel({ open, onOpenChange }) {
  const { settings, update, reset } = useSignalSettings();
  const [showAdvanced, setShowAdvanced] = useState(false);

  const setFactor = (key, patch) =>
    update({ factors: { ...settings.factors, [key]: { ...settings.factors[key], ...patch } } });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-800 text-white sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-emerald-400" />
            Signal Engine Settings
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Tune how the Pairs tab generates BUY / SELL signals. Saved on this device.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* Sensitivity */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-slate-200">Signal Sensitivity</Label>
              <span className="text-xs text-emerald-400 font-mono">
                threshold {SENSITIVITY_THRESHOLDS[settings.sensitivity]}%
              </span>
            </div>
            <Select value={settings.sensitivity} onValueChange={(v) => update({ sensitivity: v })}>
              <SelectTrigger className="bg-slate-950 border-slate-800 text-slate-200">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-800 text-slate-200">
                {Object.entries(SENSITIVITY_INFO).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    <div className="flex flex-col">
                      <span>{v.label}</span>
                      <span className="text-[10px] text-slate-500">{v.desc}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-slate-500">
              Minimum indicator agreement needed before a pair shows BUY or SELL instead of NEUTRAL.
            </p>
          </div>

          <Separator className="bg-slate-800" />

          {/* Signal Lock Duration */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-slate-200">Signal Lock Duration</Label>
              <span className="text-xs text-emerald-400 font-mono">
                {settings.lockMinutes === 0 ? 'Off' : `${settings.lockMinutes} min`}
              </span>
            </div>
            <Slider
              value={[settings.lockMinutes]}
              min={0} max={60} step={1}
              onValueChange={([v]) => update({ lockMinutes: v })}
              className="py-2"
            />
            <p className="text-[11px] text-slate-500">
              Prevents a signal from flipping for this long after it's confirmed. 0 = off (signals can change every recalc).
            </p>
          </div>

          {/* Min Lock Confidence */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-slate-200">Min Lock Confidence</Label>
              <span className="text-xs text-emerald-400 font-mono">{settings.minLockConfidence}%</span>
            </div>
            <Slider
              value={[settings.minLockConfidence]}
              min={0} max={90} step={5}
              onValueChange={([v]) => update({ minLockConfidence: v })}
              className="py-2"
            />
            <p className="text-[11px] text-slate-500">
              A signal must reach this confidence to become locked. Lower = locks trigger more easily.
            </p>
          </div>

          {/* Recalc Interval */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-slate-200">Recalc Interval</Label>
              <span className="text-xs text-emerald-400 font-mono">{settings.recalcInterval}s</span>
            </div>
            <Slider
              value={[settings.recalcInterval]}
              min={5} max={120} step={5}
              onValueChange={([v]) => update({ recalcInterval: v })}
              className="py-2"
            />
            <p className="text-[11px] text-slate-500">
              How often every pair's signal is recomputed.
            </p>
          </div>

          <Separator className="bg-slate-800" />

          {/* Advanced: factor weights & enables */}
          <div className="space-y-3">
            <button
              type="button"
              className="flex items-center gap-2 text-sm font-semibold text-slate-200 hover:text-white"
              onClick={() => setShowAdvanced((s) => !s)}
            >
              {showAdvanced ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              Indicator Factors
              <span className="text-[10px] text-slate-500 font-normal">(weight & enable)</span>
            </button>

            {showAdvanced && (
              <div className="space-y-4 pl-1">
                {(() => {
                 const totalEnabled = FACTOR_META.reduce(
                   (s, m) => s + (settings.factors[m.key].enabled ? settings.factors[m.key].weight : 0), 0
                 );
                 return FACTOR_META.map((fm) => {
                   const f = settings.factors[fm.key];
                   const share = totalEnabled > 0 && f.enabled ? Math.round((f.weight / totalEnabled) * 100) : 0;
                   return (
                     <div key={fm.key} className={`rounded-lg border p-3 space-y-2 transition-all ${
                       f.enabled ? fm.on : 'border-slate-800 bg-slate-900/40 opacity-50'
                     }`}>
                       <div className="flex items-center justify-between">
                         <div className="flex items-center gap-2.5">
                           <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${f.enabled ? fm.dot : 'bg-slate-600'}`} />
                           <Switch
                             checked={f.enabled}
                             onCheckedChange={(checked) => setFactor(fm.key, { enabled: checked })}
                           />
                           <div className="flex flex-col">
                             <span className={`text-sm ${f.enabled ? 'text-slate-100' : 'text-slate-500'}`}>{fm.label}</span>
                             <span className="text-[10px] text-slate-500">{fm.hint}</span>
                           </div>
                         </div>
                         <div className="flex items-center gap-2">
                           <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                             f.enabled ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-700/40 text-slate-500'
                           }`}>
                             {f.enabled ? 'ON' : 'OFF'}
                           </span>
                           <div className="flex flex-col items-end leading-none">
                             <span className={`text-xs font-mono ${f.enabled ? 'text-emerald-400' : 'text-slate-600'}`}>{f.weight}</span>
                             <span className={`text-[9px] ${f.enabled ? 'text-slate-400' : 'text-slate-600'}`}>
                               {f.enabled ? `${share}% share` : '—'}
                             </span>
                           </div>
                         </div>
                         </div>
                         <Slider
                         value={[f.weight]}
                         min={0} max={50} step={1}
                         disabled={!f.enabled}
                         onValueChange={([v]) => setFactor(fm.key, { weight: v })}
                         className="py-1"
                         />
                         {/* Relative-strength bar: shows each factor's % of total enabled weight */}
                         <div className="h-1.5 rounded-full bg-slate-800/60 overflow-hidden">
                         <div
                           className={`h-full rounded-full transition-all duration-300 ${f.enabled ? fm.dot : 'bg-slate-700'}`}
                           style={{ width: `${f.enabled ? share : 0}%` }}
                         />
                         </div>
                         </div>
                         );
                         });})()}
                         </div>
                         )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={reset} className="border-slate-700 text-slate-300 hover:bg-slate-800">
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Reset to defaults
          </Button>
          <Button onClick={() => onOpenChange(false)} className="bg-emerald-600 hover:bg-emerald-700">
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}