import React from 'react';
import { ArrowUp, ArrowDown, PowerOff } from 'lucide-react';
import { INDICATORS, factorKey } from '@/components/services/indicatorMeta';

/**
 * Colour-enhanced indicator chips that also surface enabled/disabled status.
 * variant="card"  → compact pills for the PairCard grid.
 * variant="modal" → larger rows with ON/OFF + score for the details modal.
 *
 * Each of the six indicators is always rendered so the user can see at a
 * glance which ones are enabled (bright, directional glow) and which are
 * disabled (faded, dashed, power-off icon).
 */
export default function IndicatorChips({ factors = [], settings, variant = 'card' }) {
  const s = settings?.factors || {};
  const isModal = variant === 'modal';

  const chipCls = (enabled, dir) => {
    if (!enabled) {
      return 'bg-slate-800/20 border-slate-700/40 text-slate-600 opacity-50 border-dashed';
    }
    if (dir === 'BUY') {
      return 'bg-gradient-to-r from-emerald-500/30 to-emerald-400/15 border-emerald-400/60 text-emerald-100 shadow-[0_0_8px_-2px_rgba(16,185,129,0.55)]';
    }
    if (dir === 'SELL') {
      return 'bg-gradient-to-r from-rose-500/30 to-rose-400/15 border-rose-400/60 text-rose-100 shadow-[0_0_8px_-2px_rgba(244,63,94,0.55)]';
    }
    return 'bg-slate-800/40 border-slate-600/60 text-slate-300';
  };

  const StatusIcon = ({ enabled, dir }) => {
    if (!enabled) return <PowerOff className="w-2.5 h-2.5 shrink-0" />;
    if (dir === 'BUY') return <ArrowUp className="w-2.5 h-2.5 shrink-0" />;
    if (dir === 'SELL') return <ArrowDown className="w-2.5 h-2.5 shrink-0" />;
    return <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0 animate-pulse" />;
  };

  if (isModal) {
    return (
      <div className="grid grid-cols-2 gap-2">
        {INDICATORS.map((ind) => {
          const enabled = s[ind.key]?.enabled !== false;
          const active = (factors || []).find((f) => factorKey(f.name) === ind.key);
          const dir = active?.direction || 'NEUTRAL';
          return (
            <div
              key={ind.key}
              className={`flex items-center justify-between rounded-lg px-3 py-2.5 border ${chipCls(enabled, dir)}`}
            >
              <span className="flex items-center gap-2 text-xs font-medium">
                <StatusIcon enabled={enabled} dir={dir} />
                {ind.label}
              </span>
              <span className="text-xs font-bold tracking-tight">
                {!enabled ? 'OFF' : dir === 'NEUTRAL' ? 'ON' : `${dir} ${active ? '+' + active.score : ''}`}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-1 pt-1">
      {INDICATORS.map((ind) => {
        const enabled = s[ind.key]?.enabled !== false;
        const active = (factors || []).find((f) => factorKey(f.name) === ind.key);
        const dir = active?.direction || 'NEUTRAL';
        return (
          <span
            key={ind.key}
            className={`inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full border ${chipCls(enabled, dir)}`}
          >
            <StatusIcon enabled={enabled} dir={dir} />
            {ind.short}
          </span>
        );
      })}
    </div>
  );
}