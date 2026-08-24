import React from 'react';
import { Button } from '@/components/ui/button';

const MT4_VERSION = '1.05';
const MT5_VERSION = '1.06';
const MT4_FILE = `SilverForexTouchAI_EA_v105.mq4`;
const MT5_FILE = `SilverForexTouchAI_EA_v106.mq5`;

export default function SilverEADownload() {
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
    <div className="bg-slate-400/10 border border-slate-400/30 rounded-lg p-4 space-y-3 mt-4">
      <div className="flex items-start gap-3">
        <span className="text-2xl">🥈</span>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="text-sm font-semibold text-slate-200">Silver (XAGUSD) Dedicated EA</h4>
            <span className="text-xs font-bold text-emerald-300 bg-emerald-500/20 border border-emerald-500/40 px-2 py-0.5 rounded-full">LATEST: MT5 v{MT5_VERSION} / MT4 v{MT4_VERSION}</span>
          </div>
          <p className="text-xs text-slate-300/70 mb-1">
            Use this separate EA exclusively for your <strong>SILVER_XAGUSD</strong> bot. It runs independently from the standard and Gold bridge EAs with:
          </p>
          <ul className="text-xs text-slate-300/60 list-disc ml-4 space-y-0.5 mb-3">
            <li><strong>MagicNumber 88888</strong> — keeps Silver trades separate from Forex (12345) and Gold (99999)</li>
            <li><strong>3dp price precision</strong> — correct for XAGUSD ($30.125)</li>
            <li><strong>Slippage 50 points</strong> — appropriate tolerance for Silver execution</li>
            <li>Only picks up XAGUSD signals — ignores all Forex & Gold signals</li>
            <li><strong>MaxSilverTrades = 3</strong> (default) — limits concurrent Silver trades; set to 0 for unlimited</li>
            <li><strong>Live-account hardening</strong> — trade-mode guard, spread check, broker min-stop enforcement, lot-step normalization</li>
            <li><strong>Min SL/TP distance $0.20</strong> — respects broker minimum stop distance for Silver</li>
            <li><strong>EnableTrailing</strong> — set to true to activate trailing stop on all Silver trades</li>
          </ul>
          <p className="text-xs text-slate-200/80 font-semibold mb-3">
            ⚠ Attach this EA to a separate XAGUSD chart alongside your standard bridge EA.
          </p>
          <div className="bg-red-500/10 border border-red-500/30 rounded p-3 mb-3">
            <p className="text-xs text-red-300 font-semibold mb-1">⚠ MT4: Two URLs must be whitelisted in Tools → Options → Expert Advisors → Allow WebRequest:</p>
            <code className="text-xs text-red-200/80 block">https://forex-ai-trader-cc744e2a.base44.app/functions/bridge</code>
            <code className="text-xs text-red-200/80 block">https://forex-ai-trader-cc744e2a.base44.app/functions/confirmExecution</code>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              onClick={() => downloadStatic(MT4_FILE, MT4_VERSION)}
              className="bg-slate-500/20 border border-slate-400/40 text-slate-200 hover:bg-slate-500/30 hover:text-white text-xs"
              size="sm"
            >
              🥈 Download Silver EA MT4 (.mq4) — v{MT4_VERSION}
            </Button>
            <Button
              onClick={() => downloadStatic(MT5_FILE, MT5_VERSION)}
              className="bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/30 hover:text-indigo-100 text-xs"
              size="sm"
            >
              🥈 Download Silver EA MT5 (.mq5) — v{MT5_VERSION}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}