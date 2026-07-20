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

const FACTOR_META = [
  { key: 'rsi',        label: 'RSI',             hint: 'Overbought / oversold' },
  { key: 'macd',       label: 'MACD',            hint: 'Momentum crossover' },
  { key: 'bollinger',  label: 'Bollinger Bands', hint: 'Volatility position' },
  { key: 'emaCross',   label: 'EMA 20/50',       hint: 'Trend direction' },
  { key: 'ema200',     label: 'Price vs EMA200',  hint: 'Long-term trend' },
  { key: 'stochastic', label: 'Stochastic',      hint: 'Oscillator extremes' },
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
                {FACTOR_META.map((fm) => {
                  const f = settings.factors[fm.key];
                  return (
                    <div key={fm.key} className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={f.enabled}
                            onCheckedChange={(checked) => setFactor(fm.key, { enabled: checked })}
                          />
                          <div className="flex flex-col">
                            <span className="text-sm text-slate-200">{fm.label}</span>
                            <span className="text-[10px] text-slate-500">{fm.hint}</span>
                          </div>
                        </div>
                        <span className="text-xs text-emerald-400 font-mono w-10 text-right">{f.weight}</span>
                      </div>
                      <Slider
                        value={[f.weight]}
                        min={0} max={40} step={1}
                        disabled={!f.enabled}
                        onValueChange={([v]) => setFactor(fm.key, { weight: v })}
                        className="py-1"
                      />
                    </div>
                  );
                })}
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