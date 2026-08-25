// ════════════════════════════════════════════════════════════════════════════
// Market data access
// ════════════════════════════════════════════════════════════════════════════
// Priority order:
//
//  1. CandleHistory — OHLC uploaded by the EA via CopyRates(). This is YOUR
//     BROKER'S data, which is the data your orders actually execute against.
//     It costs nothing, has no rate limit, and cannot silently change format.
//     This is the right source for live trading.
//
//  2. Yahoo Finance — unofficial, undocumented, rate-limited, delayed intraday.
//     Acceptable for backtest history and development. NOT a foundation for
//     live trading: it will break without warning and nobody will tell you.
//
// The old frontend used open.er-api.com, which refreshes ONCE PER DAY on the
// free tier, and then applied random jitter to make it look like it was
// ticking. That path is gone.
// ════════════════════════════════════════════════════════════════════════════

import { Candle } from './indicators.ts';
import { normalizeSymbol } from './instruments.ts';

export type CandleSource = 'BROKER' | 'YAHOO' | 'NONE';

export interface CandleFetchResult {
    candles: Candle[];
    source: CandleSource;
    warning: string | null;
}

const MIN_BARS = 210;   // EMA200 needs 200 + headroom

// ─── 1. Broker candles from the CandleHistory entity ────────────────────────

export async function fetchBrokerCandles(
    base44: any, symbol: string, timeframe: string,
): Promise<Candle[]> {
    const sym = normalizeSymbol(symbol);
    const rows = await base44.asServiceRole.entities.CandleHistory.filter(
        { symbol: sym, timeframe }, '-bar_time', 1,
    ).catch(() => []);

    if (!rows?.length) return [];
    const row = rows[0];

    let bars: any[];
    try {
        bars = typeof row.bars === 'string' ? JSON.parse(row.bars) : row.bars;
    } catch { return []; }
    if (!Array.isArray(bars)) return [];

    const candles: Candle[] = [];
    for (const b of bars) {
        const t = Number(b.t ?? b.time);
        const o = Number(b.o ?? b.open);
        const h = Number(b.h ?? b.high);
        const l = Number(b.l ?? b.low);
        const c = Number(b.c ?? b.close);
        if (![t, o, h, l, c].every(Number.isFinite)) continue;
        if (h < l || h < o || h < c || l > o || l > c) continue;   // reject malformed bars
        candles.push({ time: t, open: o, high: h, low: l, close: c, volume: Number(b.v ?? b.volume) || 1 });
    }

    candles.sort((a, b) => a.time - b.time);
    return dedupeByTime(candles);
}

// ─── 2. Yahoo Finance fallback ──────────────────────────────────────────────

function toYahooSymbol(symbol: string): string {
    const s = normalizeSymbol(symbol);
    const map: Record<string, string> = {
        US500: '^GSPC', SPX500: '^GSPC', SP500: '^GSPC',
        NAS100: '^NDX', US100: '^NDX',
        US30: '^DJI', DJI: '^DJI',
        GER40: '^GDAXI', DE40: '^GDAXI',
        UK100: '^FTSE',
        AUS200: '^AXJO',
        JPN225: '^N225',
        HK50: '^HSI',
        FRA40: '^FCHI',
        ESP35: '^IBEX',
        XAUUSD: 'GC=F', XAGUSD: 'SI=F',
        USOIL: 'CL=F', UKOIL: 'BZ=F',
        BTCUSD: 'BTC-USD', ETHUSD: 'ETH-USD', SOLUSD: 'SOL-USD',
        XRPUSD: 'XRP-USD', LTCUSD: 'LTC-USD', ADAUSD: 'ADA-USD',
        DOGEUSD: 'DOGE-USD', AVAXUSD: 'AVAX-USD', LINKUSD: 'LINK-USD',
        DOTUSD: 'DOT-USD', MATICUSD: 'MATIC-USD',
    };
    if (map[s]) return map[s];
    if (/^[A-Z]{6}$/.test(s)) return `${s}=X`;
    return s;
}

export async function fetchYahooCandles(symbol: string, timeframe: string): Promise<Candle[]> {
    const ySym = toYahooSymbol(symbol);

    // H4 is not offered by Yahoo — fetch 60m and aggregate.
    const intervalMap: Record<string, string> = {
        M5: '5m', M15: '15m', M30: '30m', H1: '60m', H4: '60m', D1: '1d', W1: '1wk',
    };
    const rangeMap: Record<string, string> = {
        M5: '1mo', M15: '1mo', M30: '1mo', H1: '2y', H4: '2y', D1: '10y', W1: '10y',
    };
    const interval = intervalMap[timeframe] || '60m';
    const range = rangeMap[timeframe] || '2y';

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}` +
        `?interval=${interval}&range=${range}`;

    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!resp.ok) throw new Error(`Yahoo ${resp.status} for ${ySym}`);
    const data = await resp.json();
    const r = data?.chart?.result?.[0];
    if (!r) throw new Error(`No Yahoo data for ${ySym}`);

    const ts: number[] = r.timestamp || [];
    const q = r.indicators?.quote?.[0];
    if (!q) throw new Error(`No Yahoo quote block for ${ySym}`);

    let candles: Candle[] = [];
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

// ─── Combined accessor ──────────────────────────────────────────────────────

export async function fetchCandlesDetailed(
    base44: any, symbol: string, timeframe: string,
): Promise<CandleFetchResult> {
    // Broker data first
    try {
        const broker = await fetchBrokerCandles(base44, symbol, timeframe);
        if (broker.length >= MIN_BARS) {
            return { candles: broker, source: 'BROKER', warning: null };
        }
        if (broker.length > 0) {
            const yahoo = await fetchYahooCandles(symbol, timeframe).catch(() => [] as Candle[]);
            if (yahoo.length >= MIN_BARS) {
                return {
                    candles: yahoo, source: 'YAHOO',
                    warning: `Broker history for ${symbol} ${timeframe} has only ${broker.length} bars — ` +
                        `using Yahoo. Increase BarsToUpload in the EA to trade on broker data.`,
                };
            }
        }
    } catch (e: any) {
        console.warn('[marketData] broker fetch failed:', e.message);
    }

    // Yahoo fallback
    try {
        const yahoo = await fetchYahooCandles(symbol, timeframe);
        if (yahoo.length >= MIN_BARS) {
            return {
                candles: yahoo, source: 'YAHOO',
                warning: `Using Yahoo Finance for ${symbol} ${timeframe} — delayed and unofficial. ` +
                    `Attach the EA to this symbol so it uploads broker candles.`,
            };
        }
        return { candles: yahoo, source: 'YAHOO', warning: `Only ${yahoo.length} bars available for ${symbol} ${timeframe}` };
    } catch (e: any) {
        return { candles: [], source: 'NONE', warning: `No data for ${symbol} ${timeframe}: ${e.message}` };
    }
}

export async function fetchCandles(base44: any, symbol: string, timeframe: string): Promise<Candle[]> {
    const r = await fetchCandlesDetailed(base44, symbol, timeframe);
    if (r.warning) console.log('[marketData]', r.warning);
    return r.candles;
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function dedupeByTime(candles: Candle[]): Candle[] {
    const seen = new Map<number, Candle>();
    for (const c of candles) seen.set(c.time, c);
    return [...seen.values()].sort((a, b) => a.time - b.time);
}

/**
 * Drop the still-forming bar.
 *
 * Computing indicators on an in-progress candle is lookahead bias in a backtest
 * and produces repainting signals live: the RSI at 10:05 is not the RSI the bar
 * will close with. The previous implementation only trimmed bars where
 * o == h == l == c, which misses the far more common case of a partially formed
 * bar with real movement in it.
 */
export function dropFormingBar(candles: Candle[], timeframe: string): Candle[] {
    if (!candles.length) return candles;
    const tfSeconds: Record<string, number> = {
        M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D1: 86400, W1: 604800,
    };
    const size = tfSeconds[timeframe] || 3600;
    const now = Math.floor(Date.now() / 1000);
    const out = [...candles];
    while (out.length) {
        const lastBar = out[out.length - 1];
        // A bar is closed once `now` has passed its close time.
        if (lastBar.time + size > now) out.pop();
        else break;
    }
    return out;
}

/** Aggregate N consecutive candles into one (e.g. 60m → H4). */
export function aggregate(candles: Candle[], factor: number): Candle[] {
    const out: Candle[] = [];
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
