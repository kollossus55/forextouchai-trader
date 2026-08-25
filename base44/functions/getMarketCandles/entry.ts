// ════════════════════════════════════════════════════════════════════════════
// getMarketCandles — true market OHLC for the Pairs grid
// ════════════════════════════════════════════════════════════════════════════
// Returns real broker candles (from CandleHistory, uploaded by the EA) for the
// requested symbols + timeframe, falling back to Yahoo Finance when the EA
// hasn't attached to a symbol. This is the same data the server-side bot
// signal generator runs on, so the Pairs grid finally shows true prices and
// real indicators instead of the 24h-old open.er-api.com reference rate that
// the old client feed provided.
//
// The candle-fetch logic is inlined here (mirroring _shared/marketData.ts)
// because the function bundler does not allow new functions to reach outside
// their own directory via relative imports.
//
// One row per symbol, capped to the last 250 bars (enough for EMA200 + display).
// ════════════════════════════════════════════════════════════════════════════

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.43';

// ── minimal symbol normalizer (mirrors _shared/instruments.ts) ──────────────
const ALIASES = {
    GOLD: 'XAUUSD', XAU: 'XAUUSD', SILVER: 'XAGUSD', XAG: 'XAGUSD',
    BITCOIN: 'BTCUSD', BTC: 'BTCUSD', ETHEREUM: 'ETHUSD', ETH: 'ETHUSD',
    SOL: 'SOLUSD', XRP: 'XRPUSD', LTC: 'LTCUSD', ADA: 'ADAUSD', DOGE: 'DOGEUSD',
    AVAX: 'AVAXUSD', LINK: 'LINKUSD', DOT: 'DOTUSD', MATIC: 'MATICUSD',
    NASDAQ: 'NAS100', DOW: 'US30', FTSE: 'UK100', DAX: 'GER40',
    NIKKEI: 'JPN225', CAC: 'FRA40', HSI: 'HK50', WTI: 'USOIL', BRENT: 'UKOIL',
};
function normalizeSymbol(raw) {
    if (!raw) return '';
    let s = raw.toUpperCase().replace(/[\/\-_ ]/g, '');
    const dot = s.indexOf('.');
    if (dot > 0) s = s.slice(0, dot);
    if (s.length > 6 && /^(?:[A-Z]{6})(?:M|PRO|RAW|ECN|C|I|Z)$/.test(s)) s = s.slice(0, 6);
    return ALIASES[s] || s;
}

function toYahooSymbol(symbol) {
    const s = normalizeSymbol(symbol);
    const map = {
        US500: '^GSPC', SPX500: '^GSPC', SP500: '^GSPC', NAS100: '^NDX', US100: '^NDX',
        US30: '^DJI', DJI: '^DJI', GER40: '^GDAXI', DE40: '^GDAXI', UK100: '^FTSE',
        AUS200: '^AXJO', JPN225: '^N225', HK50: '^HSI', FRA40: '^FCHI', ESP35: '^IBEX',
        XAUUSD: 'GC=F', XAGUSD: 'SI=F', USOIL: 'CL=F', UKOIL: 'BZ=F',
        BTCUSD: 'BTC-USD', ETHUSD: 'ETH-USD', SOLUSD: 'SOL-USD', XRPUSD: 'XRP-USD',
        LTCUSD: 'LTC-USD', ADAUSD: 'ADA-USD', DOGEUSD: 'DOGE-USD', AVAXUSD: 'AVAX-USD',
        LINKUSD: 'LINK-USD', DOTUSD: 'DOT-USD', MATICUSD: 'MATIC-USD',
    };
    if (map[s]) return map[s];
    if (/^[A-Z]{6}$/.test(s)) return `${s}=X`;
    return s;
}

const TF_SECONDS = { M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D1: 86400, W1: 604800 };

function dedupeByTime(candles) {
    const seen = new Map();
    for (const c of candles) seen.set(c.time, c);
    return [...seen.values()].sort((a, b) => a.time - b.time);
}

function dropFormingBar(candles, timeframe) {
    if (!candles.length) return candles;
    const size = TF_SECONDS[timeframe] || 3600;
    const now = Math.floor(Date.now() / 1000);
    const out = [...candles];
    while (out.length) {
        if (out[out.length - 1].time + size > now) out.pop();
        else break;
    }
    return out;
}

function aggregate(candles, factor) {
    const out = [];
    for (let i = 0; i + factor <= candles.length; i += factor) {
        const chunk = candles.slice(i, i + factor);
        out.push({
            time: chunk[chunk.length - 1].time,
            open: chunk[0].open,
            high: Math.max(...chunk.map(c => c.high)),
            low: Math.min(...chunk.map(c => c.low)),
            close: chunk[chunk.length - 1].close,
            volume: chunk.reduce((a, c) => a + c.volume, 0),
        });
    }
    return out;
}

async function fetchBrokerCandles(base44, symbol, timeframe) {
    const sym = normalizeSymbol(symbol);
    const rows = await base44.asServiceRole.entities.CandleHistory
        .filter({ symbol: sym, timeframe }, '-bar_time', 1).catch(() => []);
    if (!rows?.length) return [];
    const row = rows[0];
    let bars;
    try { bars = typeof row.bars === 'string' ? JSON.parse(row.bars) : row.bars; } catch { return []; }
    if (!Array.isArray(bars)) return [];
    const candles = [];
    for (const b of bars) {
        const t = Number(b.t ?? b.time), o = Number(b.o ?? b.open), h = Number(b.h ?? b.high),
              l = Number(b.l ?? b.low), c = Number(b.c ?? b.close);
        if (![t, o, h, l, c].every(Number.isFinite)) continue;
        if (h < l || h < o || h < c || l > o || l > c) continue;
        candles.push({ time: t, open: o, high: h, low: l, close: c, volume: Number(b.v ?? b.volume) || 1 });
    }
    candles.sort((a, b) => a.time - b.time);
    return dedupeByTime(candles);
}

async function fetchYahooCandles(symbol, timeframe) {
    const ySym = toYahooSymbol(symbol);
    const intervalMap = { M5: '5m', M15: '15m', M30: '30m', H1: '60m', H4: '60m', D1: '1d', W1: '1wk' };
    const rangeMap = { M5: '1mo', M15: '1mo', M30: '1mo', H1: '2y', H4: '2y', D1: '10y', W1: '10y' };
    const interval = intervalMap[timeframe] || '60m';
    const range = rangeMap[timeframe] || '2y';
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}?interval=${interval}&range=${range}`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!resp.ok) throw new Error(`Yahoo ${resp.status} for ${ySym}`);
    const data = await resp.json();
    const r = data?.chart?.result?.[0];
    if (!r) throw new Error(`No Yahoo data for ${ySym}`);
    const ts = r.timestamp || [];
    const q = r.indicators?.quote?.[0];
    if (!q) throw new Error(`No Yahoo quote block for ${ySym}`);
    let candles = [];
    for (let i = 0; i < ts.length; i++) {
        const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
        if (o == null || h == null || l == null || c == null) continue;
        candles.push({ time: ts[i], open: o, high: h, low: l, close: c, volume: q.volume?.[i] || 1 });
    }
    candles = dedupeByTime(candles);
    candles = dropFormingBar(candles, timeframe);
    if (timeframe === 'H4') candles = aggregate(candles, 4);
    return candles;
}

const MIN_BARS = 210;

async function fetchCandlesDetailed(base44, symbol, timeframe) {
    try {
        const broker = await fetchBrokerCandles(base44, symbol, timeframe);
        if (broker.length >= MIN_BARS) return { candles: broker, source: 'BROKER', warning: null };
        if (broker.length > 0) {
            const yahoo = await fetchYahooCandles(symbol, timeframe).catch(() => []);
            if (yahoo.length >= MIN_BARS) {
                return { candles: yahoo, source: 'YAHOO', warning: `Broker history for ${symbol} ${timeframe} has only ${broker.length} bars — using Yahoo. Increase BarsToUpload in the EA to trade on broker data.` };
            }
        }
    } catch (e) {
        console.warn('[getMarketCandles] broker fetch failed:', e.message);
    }
    try {
        const yahoo = await fetchYahooCandles(symbol, timeframe);
        if (yahoo.length >= MIN_BARS) {
            return { candles: yahoo, source: 'YAHOO', warning: `Using Yahoo Finance for ${symbol} ${timeframe} — delayed and unofficial. Attach the EA to this symbol so it uploads broker candles.` };
        }
        return { candles: yahoo, source: 'YAHOO', warning: `Only ${yahoo.length} bars available for ${symbol} ${timeframe}` };
    } catch (e) {
        return { candles: [], source: 'NONE', warning: `No data for ${symbol} ${timeframe}: ${e.message}` };
    }
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            }
        });
    }

    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, {
                status: 401,
                headers: { 'Access-Control-Allow-Origin': '*' }
            });
        }

        const body = await req.json().catch(() => ({}));
        const { symbols, timeframe = 'H4' } = body;
        if (!Array.isArray(symbols) || symbols.length === 0) {
            return Response.json({ error: 'symbols array required' }, {
                status: 400,
                headers: { 'Access-Control-Allow-Origin': '*' }
            });
        }

        const list = symbols.slice(0, 40);
        const results = await Promise.all(list.map(async (sym) => {
            try {
                const r = await fetchCandlesDetailed(base44, sym, timeframe);
                const candles = (r.candles || []).slice(-250);
                const latestPrice = candles.length ? candles[candles.length - 1].close : null;
                return { symbol: sym, candles, source: r.source, latestPrice, warning: r.warning };
            } catch (e) {
                return { symbol: sym, candles: [], source: 'NONE', latestPrice: null, warning: e.message };
            }
        }));

        const map = {};
        for (const r of results) map[r.symbol] = r;

        return Response.json({ results: map, fetchedAt: Date.now() }, {
            headers: { 'Access-Control-Allow-Origin': '*' }
        });

    } catch (error) {
        console.error('[GET_CANDLES ERROR]', error.message);
        return Response.json({ error: error.message }, {
            status: 500,
            headers: { 'Access-Control-Allow-Origin': '*' }
        });
    }
});