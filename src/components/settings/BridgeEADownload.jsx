import React from 'react';
import { Button } from '@/components/ui/button';
import { Laptop } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';

const MT5_VERSION = '1.14';
const MT4_VERSION = '3.17';
const MT5_FILE = `ForexTouchAI_Bridge_MT5_v${MT5_VERSION}.mq5`;
const MT4_FILE = `ForexTouchAI_Bridge_v${MT4_VERSION}.mq4`;

export default function BridgeEADownload({ connectionStatus, user, handleRegenerateKey, isRegeneratingKey }) {
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
    <Card className="bg-slate-900/50 border-slate-800">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Laptop className="w-5 h-5 text-blue-400" /> Bridge EA Installation
        </CardTitle>
        <CardDescription className="text-slate-400">
          Required to sync Balance, Equity, and Live Trades from your terminal to this dashboard.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {connectionStatus === 'DISCONNECTED' && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mb-4">
            <div className="flex gap-3">
              <span className="text-amber-400 text-lg">⚠</span>
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-amber-300">Connection Status: DISCONNECTED</h4>
                <p className="text-xs text-amber-200/80">
                  The MT4/MT5 platform is not sending data. The EA must be running and properly configured.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* API Key Display */}
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <span className="text-amber-400 text-lg">🔑</span>
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-semibold text-amber-300 mb-1">Your EA API Key (Required)</h4>
              <p className="text-xs text-amber-200/70 mb-2">Paste this token into the <strong>ApiKey</strong> field when attaching the EA in MT4/MT5. This key is unique to your account.</p>
              {!user?.ea_api_key ? (
                <div className="space-y-2">
                  <p className="text-xs text-amber-300/80">No API key generated yet. Click below to create your unique key.</p>
                  <Button size="sm" onClick={handleRegenerateKey} disabled={isRegeneratingKey}
                    className="bg-amber-500/20 border border-amber-500/30 text-amber-300 hover:bg-amber-500/30">
                    {isRegeneratingKey ? 'Generating...' : '⚡ Generate My API Key'}
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-2 items-center">
                    <code className="flex-1 bg-slate-950 border border-slate-700 rounded px-3 py-2 text-xs text-emerald-400 font-mono break-all select-all">
                      {user.ea_api_key}
                    </code>
                    <Button size="sm" variant="outline" className="border-amber-500/30 text-amber-300 hover:bg-amber-500/10 shrink-0"
                      onClick={() => { navigator.clipboard.writeText(user.ea_api_key); toast.success('API Key copied!'); }}>
                      Copy
                    </Button>
                  </div>
                  <Button size="sm" variant="outline" onClick={handleRegenerateKey} disabled={isRegeneratingKey}
                    className="border-rose-500/30 text-rose-400 hover:bg-rose-500/10 text-xs">
                    {isRegeneratingKey ? 'Regenerating...' : '🔄 Regenerate Key (invalidates old key)'}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="bg-slate-950/50 p-4 rounded-lg border border-slate-800/50 space-y-3">
          <h4 className="text-sm font-medium text-slate-200">Setup Instructions:</h4>
          <ol className="list-decimal list-inside text-xs text-slate-400 space-y-2">
            <li>Download the <span className="text-blue-400">MT4 (.mq4)</span> or <span className="text-purple-400">MT5 (.mq5)</span> bridge file below depending on your platform.</li>
            <li><strong>MT4:</strong> File → Open Data Folder → MQL4 → Experts → paste .mq4 file there.<br/><strong>MT5:</strong> File → Open Data Folder → MQL5 → Experts → paste .mq5 file there.</li>
            <li>Right-click Navigator → Refresh. You should see "ForexTouchAI_Bridge" in Expert Advisors.</li>
            <li className="text-amber-400 font-medium">CRITICAL: Go to Tools &gt; Options &gt; Expert Advisors.</li>
            <li>Check <strong>"Allow WebRequest for listed URLs"</strong> and add BOTH URLs below to the list (some MT5 builds reject the request unless the full path is whitelisted — this is why your Gold/Silver EAs connect but the Bridge EA gets error 5203).</li>
            <li className="text-white font-mono bg-slate-900 p-1.5 mt-1 block text-center select-all rounded">https://forex-ai-trader-cc744e2a.base44.app</li>
            <li className="text-white font-mono bg-slate-900 p-1.5 mt-1 block text-center select-all rounded">https://forex-ai-trader-cc744e2a.base44.app/functions/bridge</li>
            <li className="text-amber-400 font-bold">Do NOT include a trailing slash "/" at the end of either URL.</li>
            <li>Drag the EA from Navigator onto ANY chart (only attach once).</li>
            <li className="text-amber-300 font-semibold">In the EA inputs, paste your <strong>API Key</strong> (shown above) into the <code>ApiKey</code> field.</li>
            <li className="text-cyan-300 font-semibold">If your broker uses a symbol suffix (e.g. IC Markets ".PRO", Pepperstone ".r"), enter it in the <code>SymbolSuffix</code> input (e.g. ".PRO"). Leave empty if your broker has no suffix.</li>
            <li className="text-emerald-300 font-semibold">Live accounts: The EA v{MT5_VERSION}+ (MT5) / v{MT4_VERSION}+ (MT4) automatically enforces your broker's minimum stop distance, spread limits, lot-step normalization, and IOC fill mode. If a trade is rejected, check the Experts tab log — the rejection reason (spread, stops level, trade mode) is printed in plain English.</li>
            <li>Click "Allow live trading" and "Allow DLL imports" when prompted.</li>
            <li className="text-emerald-400 font-medium">If setup is correct, you'll see "SUCCESS: Connected to server successfully" in the Experts tab.</li>
            <li><strong>Common Errors:</strong>
              <ul className="list-disc ml-6 mt-1 space-y-1">
                <li>Error 5203: URL not in allowed list</li>
                <li>Error -1: WebRequest disabled or URL has trailing slash</li>
                <li>No connection: EA not attached to chart or AutoTrading is off</li>
              </ul>
            </li>
          </ol>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex gap-2 ml-auto">
            <Button
              onClick={() => downloadStatic(MT4_FILE, MT4_VERSION)}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              Download MT4 Bridge (.mq4) — v{MT4_VERSION}
            </Button>
            <Button
              onClick={() => downloadStatic(MT5_FILE, MT5_VERSION)}
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              Download MT5 Bridge (.mq5) — v{MT5_VERSION}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}