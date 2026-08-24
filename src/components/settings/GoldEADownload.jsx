import React from 'react';
import { Button } from '@/components/ui/button';

const MT4_VERSION = '1.05';
const MT5_VERSION = '1.06';
const MT4_FILE = `GoldForexTouchAI_EA_v105.mq4`;
const MT5_FILE = `GoldForexTouchAI_EA_v106.mq5`;

export default function GoldEADownload() {
  // Direct download from static file — the EA source lives in /public/ea/ so it's
  // never bundled into JS and never subject to JS-bundle caching. The ?v= query
  // string busts any CDN/browser cache of the static file itself.
  const downloadStatic = (file, version) => {
    const a = document.createElement('a');
    a.href = `/ea/${file}?v=${version}`;
    a.download = file;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 space-y-3">
      <div className="flex items-start gap-3">
        <span className="text-2xl">🥇</span>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="text-sm font-semibold text-amber-300">Gold (XAUUSD) Dedicated EA</h4>
            <span className="text-xs font-bold text-emerald-300 bg-emerald-500/20 border border-emerald-500/40 px-2 py-0.5 rounded-full">LATEST: MT5 v{MT5_VERSION} / MT4 v{MT4_VERSION}</span>
          </div>
          <p className="text-xs text-amber-200/70 mb-1">
            Use this separate EA exclusively for your <strong>GOLD_XAUUSD</strong> bot. It runs independently from the standard bridge EA with:
          </p>
          <ul className="text-xs text-amber-200/60 list-disc ml-4 space-y-0.5 mb-3">
            <li><strong>MagicNumber 99999</strong> — keeps Gold trades separate from Forex trades</li>
            <li><strong>Slippage 100 points</strong> — required by brokers for Gold execution</li>
            <li><strong>2dp price precision</strong> — correct for XAUUSD ($3200.50)</li>
            <li>Only picks up XAUUSD signals — ignores all Forex signals</li>
            <li><strong>MaxGoldTrades = 3</strong> (default) — limits concurrent Gold trades; set to 0 for unlimited</li>
            <li><strong>Live-account hardening</strong> — trade-mode guard, spread check, broker min-stop enforcement, lot-step normalization</li>
            <li><strong>EnableTrailing = false</strong> — set to true to activate trailing stop on all Gold trades</li>
            <li><strong>TrailingStartPoints = 150</strong> — profit in points before trailing activates ($1.50 on Gold)</li>
            <li><strong>TrailingStopPoints = 100</strong> — trailing distance in points ($1.00 on Gold)</li>
          </ul>
          <p className="text-xs text-amber-300/80 font-semibold mb-3">
            ⚠ Attach this EA to a separate XAUUSD chart alongside your standard bridge EA.
          </p>
          <div className="bg-red-500/10 border border-red-500/30 rounded p-3 mb-3">
            <p className="text-xs text-red-300 font-semibold mb-1">⚠ MT4: Two URLs must be whitelisted in Tools → Options → Expert Advisors → Allow WebRequest:</p>
            <code className="text-xs text-red-200/80 block">https://forex-ai-trader-cc744e2a.base44.app/functions/bridge</code>
            <code className="text-xs text-red-200/80 block">https://forex-ai-trader-cc744e2a.base44.app/functions/confirmExecution</code>
            <p className="text-xs text-red-200/60 mt-1">Both are required — missing the second causes "WebRequest failed" after trade execution.</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              onClick={() => downloadStatic(MT4_FILE, MT4_VERSION)}
              className="bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30 hover:text-amber-100 text-xs"
              size="sm"
            >
              🥇 Download Gold EA MT4 (.mq4) — v{MT4_VERSION}
            </Button>
            <Button
              onClick={() => downloadStatic(MT5_FILE, MT5_VERSION)}
              className="bg-purple-500/20 border border-purple-500/40 text-purple-300 hover:bg-purple-500/30 hover:text-purple-100 text-xs"
              size="sm"
            >
              🥇 Download Gold EA MT5 (.mq5) — v{MT5_VERSION}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}