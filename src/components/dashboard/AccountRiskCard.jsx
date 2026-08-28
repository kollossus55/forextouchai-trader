import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

/**
 * 5th metric card for an account row on the Overview.
 * Shows how much of the account's total-risk budget is currently consumed by
 * open positions, as a glanceable progress bar.
 *
 * Props:
 *  - usedRiskAmount: sum of risk_amount across this account's OPEN trades
 *  - balance: account balance (denominator for the %)
 *  - maxTotalRiskPercent: cap from RiskManagementSettings (default 6)
 */
export default function AccountRiskCard({ usedRiskAmount, balance, maxTotalRiskPercent }) {
  const cap = maxTotalRiskPercent && maxTotalRiskPercent > 0 ? maxTotalRiskPercent : 6;
  const bal = balance > 0 ? balance : 0;
  const usedPercent = bal > 0 ? (usedRiskAmount / bal) * 100 : 0;
  const ratio = cap > 0 ? usedPercent / cap : 0;
  const fill = Math.min(100, ratio * 100);

  // Colour escalates as the budget is consumed: green → amber → red
  const tone = ratio >= 1 ? 'rose' : ratio >= 0.7 ? 'amber' : 'emerald';
  const toneMap = {
    emerald: { text: 'text-emerald-400', chip: 'bg-emerald-500/20', bar: 'bg-emerald-500', border: 'hover:border-emerald-500/30', glow: 'text-emerald-500' },
    amber:   { text: 'text-amber-400',   chip: 'bg-amber-500/20',   bar: 'bg-amber-500',   border: 'hover:border-amber-500/30',   glow: 'text-amber-500' },
    rose:    { text: 'text-rose-400',    chip: 'bg-rose-500/20',    bar: 'bg-rose-500',    border: 'hover:border-rose-500/30',    glow: 'text-rose-500' },
  }[tone];

  return (
    <Card className={`relative overflow-hidden bg-gradient-to-br from-slate-900/90 to-slate-900/50 border-slate-800/50 backdrop-blur-sm ${toneMap.border} transition-all duration-300 group shadow-xl`}>
      <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
        <ShieldAlert className={`w-14 h-14 ${toneMap.glow}`} />
      </div>
      <CardHeader className="pb-1 pt-4 px-4">
        <CardTitle className="text-xs font-medium text-slate-400 flex items-center gap-2">
          <div className={`p-1 rounded ${toneMap.chip}`}><ShieldAlert className={`w-3 h-3 ${toneMap.text}`} /></div>
          Risk Used
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className={`text-2xl font-bold tracking-tight ${tone === 'rose' ? 'bg-gradient-to-br from-rose-100 to-rose-300' : 'bg-gradient-to-br from-white to-slate-100'} bg-clip-text text-transparent`}>
          {usedPercent.toFixed(1)}%
        </div>
        <Progress value={fill} className="h-1.5 mt-2 bg-slate-800/50 rounded-full" indicatorClassName={`rounded-full ${toneMap.bar}`} />
        <p className="text-[10px] text-slate-500 mt-1">
          of <span className={`font-semibold ${toneMap.text}`}>{cap}%</span> cap · ${usedRiskAmount.toFixed(2)} at risk
        </p>
      </CardContent>
    </Card>
  );
}