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

export type CandleSource = 'BROKER' | 'STOOQ' | 'YAHOO' | 'NONE';

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
        JPN225: '^N225', JP225: '^N225',
        EUSTX50: '^STOXX50E',
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

// ─── 3. Stooq fallback ──────────────────────────────────────────────────────
// Stooq is free, needs no API key, and covers all the index symbols Yahoo 404s
// on (notably EUSTX50 and JP225). Intraday times are in each exchange's local
// clock, so bars are aligned to themselves but the forming-bar trim is
// approximate — acceptable for a fallback that exists to fill history.

function toStooqSymbol(symbol: string): string | null {
    const s = normalizeSymbol(symbol);
    const map: Record<string, string> = {
        US500: '^spx', SPX500: '^spx', SP500: '^spx',
        NAS100: '^ndx', US100: '^ndx',
        US30: '^dji', DJI: '^dji',
        GER40: '^gdaxi', DE40: '^gdaxi',
        UK100: '^ftse',
        FRA40: '^cac',
        JPN225: '^n225', JP225: '^n225',
        AUS200: '^axjo',
        ESP35: '^ibex',
        EUSTX50: '^stoxx50e',
        HK50: '^hsi',
        XAUUSD: 'xauusd', XAGUSD: 'xagusd',
    };
    if (map[s]) return map[s];
    if (/^[A-Z]{6}$/.test(s)) return s.toLowerCase();   // forex pairs
    return null;   // crypto/energy not reliably covered
}

export async function fetchStooqCandles(symbol: string, timeframe: string): Promise<Candle[]> {
    const stooqSym = toStooqSymbol(symbol);
    if (!stooqSym) throw new Error(`Stooq: no symbol for ${symbol}`);

    const intervalMap: Record<string, string> = {
        M5: '5min', M15: '15min', M30: '30min', H1: '60min', H4: '60min', D1: 'd', W1: 'w',
    };
    const interval = intervalMap[timeframe] || '60min';
    const isDaily = interval === 'd' || interval === 'w';

    const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSym)}&i=${interval}`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!resp.ok) throw new Error(`Stooq ${resp.status} for ${stooqSym}`);
    const text = await resp.text();
    if (!text || text.trim().length === 0) throw new Error(`Stooq: empty for ${stooqSym}`);

    const lines = text.trim().split('\n');
    if (lines.length < 2) throw new Error(`Stooq: no rows for ${stooqSym}`);

    const header = lines[0].toLowerCase().split(',').map(h => h.trim());
    const iDate = header.indexOf('date');
    const iTime = header.indexOf('time');
    const iOpen = header.indexOf('open');
    const iHigh = header.indexOf('high');
    const iLow = header.indexOf('low');
    const iClose = header.indexOf('close');
    const iVol = header.indexOf('volume');
    if (iDate < 0 || iOpen < 0 || iClose < 0) throw new Error(`Stooq: bad header for ${stooqSym}`);

    const candles: Candle[] = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        const dateStr = cols[iDate]?.trim();
        if (!dateStr || dateStr.length < 8) continue;
        const y = parseInt(dateStr.slice(0, 4), 10);
        const mo = parseInt(dateStr.slice(4, 6), 10) - 1;
        const d = parseInt(dateStr.slice(6, 8), 10);
        if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) continue;

        let secs = 0;
        if (!isDaily && iTime >= 0) {
            const timeStr = cols[iTime]?.trim() || '0';
            const padded = timeStr.padStart(6, '0');
            const hh = parseInt(padded.slice(0, 2), 10);
            const mm = parseInt(padded.slice(2, 4), 10);
            const ss = parseInt(padded.slice(4, 6), 10);
            secs = (hh || 0) * 3600 + (mm || 0) * 60 + (ss || 0);
        }

        const epoch = Math.floor(Date.UTC(y, mo, d) / 1000) + secs;
        const o = parseFloat(cols[iOpen]);
        const hi = parseFloat(cols[iHigh]);
        const lo = parseFloat(cols[iLow]);
        const c = parseFloat(cols[iClose]);
        const v = parseFloat(cols[iVol]) || 1;
        if (![o, hi, lo, c].every(Number.isFinite)) continue;
        if (hi < lo || hi < o || hi < c || lo > o || lo > c) continue;
        candles.push({ time: epoch, open: o, high: hi, low: lo, close: c, volume: v });
    }

    let deduped = dedupeByTime(candles);
    deduped = dropFormingBar(deduped, timeframe);
    if (timeframe === 'H4') deduped = aggregate(deduped, 4);
    return deduped;
}

// ─── Combined accessor ──────────────────────────────────────────────────────

export async function fetchCandlesDetailed(
    base44: any, symbol: string, timeframe: string,
): Promise<CandleFetchResult> {
    // 1. Broker data — your EA's uploads, real-time, the prices you execute at
    try {
        const broker = await fetchBrokerCandles(base44, symbol, timeframe);
        if (broker.length >= MIN_BARS) {
            return { candles: broker, source: 'BROKER', warning: null };
        }
    } catch (e: any) {
        console.warn('[marketData] broker fetch failed:', e.message);
    }

    // 2. Stooq fallback — free, no key, covers indices Yahoo 404s on
    try {
        const stooq = await fetchStooqCandles(symbol, timeframe);
        if (stooq.length >= MIN_BARS) {
            return {
                candles: stooq, source: 'STOOQ',
                warning: `Using Stooq for ${symbol} ${timeframe} — ~15min delayed. ` +
                    `Attach the EA to this symbol so it uploads broker candles.`,
            };
        }
    } catch (e: any) {
        console.warn('[marketData] stooq fetch failed:', e.message);
    }

    // 3. Yahoo fallback — covers forex/metals/crypto
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