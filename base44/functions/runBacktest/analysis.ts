// ════════════════════════════════════════════════════════════════════════════
// Multi-timeframe analysis snapshot
// ════════════════════════════════════════════════════════════════════════════
// Produces the complete, computed picture of one instrument that strategies
// score against. Every field here is derived from real candles. Nothing is
// estimated, assumed or generated.
//
// This is the object that used to be a language model's imagination.
// ════════════════════════════════════════════════════════════════════════════

import {
    Candle, Series, lastVal, valAt,
    ema, rsi, macd, stochastic, cci, cmo, atr, bollinger, adx,
    heikinAshi, sslChannel, vwap, rsiDivergence,
} from './indicators.ts';
import {
    analyzeStructure, classifyRegime, detectPatterns, currentSession,
    sessionQuality, isRolloverWindow,
    StructureAnalysis, Regime, Pattern, Session, Zone,
} from './structure.ts';
import { InstrumentSpec } from './instruments.ts';

export interface TimeframeSnapshot {
    timeframe: string;
    barCount: number;
    lastBarTime: number;
    close: number;

    ema20: number | null;
    ema50: number | null;
    ema200: number | null;
    emaStack: 'BULLISH' | 'BEARISH' | 'MIXED';

    rsi: number | null;
    rsiPrev: number | null;
    rsiDivergence: 'BULLISH' | 'BEARISH' | null;

    macd: number | null;
    macdSignal: number | null;
    macdHistogram: number | null;
    macdHistogramPrev: number | null;
    macdCross: 'BULLISH' | 'BEARISH' | null;

    stochK: number | null;
    stochD: number | null;
    cci: number | null;
    cmo: number | null;

    atr: number | null;
    atrPercent: number | null;      // ATR as % of price
    atrAverage: number | null;      // mean ATR over the window, for regime work

    bbUpper: number | null;
    bbMiddle: number | null;
    bbLower: number | null;
    bbWidth: number | null;
    bbPosition: number | null;      // 0 = lower band, 1 = upper band

    adx: number | null;
    plusDI: number | null;
    minusDI: number | null;

    vwap: number | null;

    haBullish: boolean;
    haBearish: boolean;
    sslBullish: boolean;
    sslBearish: boolean;

    structure: StructureAnalysis;
    regime: Regime;
    patterns: Pattern[];
}

export interface MarketSnapshot {
    symbol: string;
    spec: InstrumentSpec;
    price: number;                  // last CLOSED bar's close on the entry timeframe
    generatedAt: number;            // epoch seconds of the last closed bar
    session: Session;
    sessionQuality: number;
    inRollover: boolean;
    entry: TimeframeSnapshot;       // bot's configured timeframe
    higher: TimeframeSnapshot | null;
    daily: TimeframeSnapshot | null;
    htfBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    dataQuality: DataQuality;
}

/**
 * Data problems are graded, not lumped together.
 *
 * `fatal`     — the analysis cannot be trusted at all; no signal may be issued.
 * `degraded`  — some context is missing but the entry timeframe is sound; the
 *               signal is allowed through with reduced confidence.
 *
 * Grading matters: an earlier version treated "D1 unavailable" as fatal, which
 * meant a single hiccup in the daily feed would silently stop a live bot from
 * trading at all, with no error anywhere.
 */
export interface DataQuality {
    ok: boolean;                    // no fatal problems
    fatal: string[];
    degraded: string[];
    confidenceMultiplier: number;   // 1.0 clean, lower when degraded
}

function stackOf(e20: number | null, e50: number | null, e200: number | null, price: number) {
    if (e20 === null || e50 === null || e200 === null) return 'MIXED' as const;
    if (price > e20 && e20 > e50 && e50 > e200) return 'BULLISH' as const;
    if (price < e20 && e20 < e50 && e50 < e200) return 'BEARISH' as const;
    return 'MIXED' as const;
}

/**
 * Build a snapshot for one timeframe.
 *
 * IMPORTANT: `candles` must contain CLOSED bars only. The caller is responsible
 * for dropping the in-progress bar. Computing indicators on a forming bar is
 * lookahead bias in live trading and produces signals that repaint.
 */
export function buildTimeframeSnapshot(timeframe: string, candles: Candle[]): TimeframeSnapshot | null {
    const n = candles.length;
    if (n < 60) return null;

    const closes = candles.map(c => c.close);
    const price = closes[n - 1];

    const e20 = ema(closes, 20), e50 = ema(closes, 50), e200 = ema(closes, 200);
    const r = rsi(closes, 14);
    const m = macd(closes);
    const st = stochastic(candles);
    const a = atr(candles, 14);
    const bb = bollinger(closes, 20, 2);
    const dx = adx(candles, 14);
    const ha = heikinAshi(candles);
    const ssl = sslChannel(candles, 9);
    const vw = vwap(candles);

    const atrNow = lastVal(a);
    const definedAtr = a.filter(v => v !== null) as number[];
    const atrAvg = definedAtr.length ? definedAtr.slice(-100).reduce((x, y) => x + y, 0) / Math.min(100, definedAtr.length) : null;

    const structure = analyzeStructure(candles, 14);
    const regime = classifyRegime(candles, a, dx.adx, structure);
    const patterns = detectPatterns(candles, a);

    const hist = lastVal(m.histogram);
    const histPrev = valAt(m.histogram, 1);
    let macdCross: 'BULLISH' | 'BEARISH' | null = null;
    if (hist !== null && histPrev !== null) {
        if (histPrev <= 0 && hist > 0) macdCross = 'BULLISH';
        if (histPrev >= 0 && hist < 0) macdCross = 'BEARISH';
    }

    const bbU = lastVal(bb.upper), bbL = lastVal(bb.lower);
    const bbPos = (bbU !== null && bbL !== null && bbU !== bbL)
        ? (price - bbL) / (bbU - bbL) : null;

    const haLast = ha[ha.length - 1];
    const sslUp = lastVal(ssl.up), sslDown = lastVal(ssl.down);

    return {
        timeframe,
        barCount: n,
        lastBarTime: candles[n - 1].time,
        close: price,

        ema20: lastVal(e20), ema50: lastVal(e50), ema200: lastVal(e200),
        emaStack: stackOf(lastVal(e20), lastVal(e50), lastVal(e200), price),

        rsi: lastVal(r), rsiPrev: valAt(r, 1),
        rsiDivergence: rsiDivergence(candles, r),

        macd: lastVal(m.macd), macdSignal: lastVal(m.signal),
        macdHistogram: hist, macdHistogramPrev: histPrev, macdCross,

        stochK: lastVal(st.k), stochD: lastVal(st.d),
        cci: lastVal(cci(candles, 20)),
        cmo: lastVal(cmo(closes, 14)),

        atr: atrNow,
        atrPercent: atrNow !== null && price > 0 ? (atrNow / price) * 100 : null,
        atrAverage: atrAvg,

        bbUpper: bbU, bbMiddle: lastVal(bb.middle), bbLower: bbL,
        bbWidth: lastVal(bb.width), bbPosition: bbPos,

        adx: lastVal(dx.adx), plusDI: lastVal(dx.plusDI), minusDI: lastVal(dx.minusDI),

        vwap: lastVal(vw),

        haBullish: haLast ? haLast.close > haLast.open : false,
        haBearish: haLast ? haLast.close < haLast.open : false,
        sslBullish: sslUp !== null && sslDown !== null ? sslUp > sslDown : false,
        sslBearish: sslUp !== null && sslDown !== null ? sslUp < sslDown : false,

        structure, regime, patterns,
    };
}

/** Higher-timeframe bias: agreement between structure state and EMA stack. */
function biasOf(tf: TimeframeSnapshot | null): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
    if (!tf) return 'NEUTRAL';
    const structural = tf.structure.state;
    const stack = tf.emaStack;
    if (structural === 'BULLISH' && stack !== 'BEARISH') return 'BULLISH';
    if (structural === 'BEARISH' && stack !== 'BULLISH') return 'BEARISH';
    if (stack === 'BULLISH' && structural !== 'BEARISH') return 'BULLISH';
    if (stack === 'BEARISH' && structural !== 'BULLISH') return 'BEARISH';
    return 'NEUTRAL';
}

export interface SnapshotOptions {
    /**
     * The moment being analysed, in epoch seconds. Live callers omit it and get
     * wall-clock time. The BACKTESTER must pass the bar's own timestamp —
     * otherwise every historical bar is judged "stale" against today's date and
     * no signal is ever produced.
     */
    nowSeconds?: number;
}

export function buildMarketSnapshot(
    symbol: string,
    spec: InstrumentSpec,
    candlesByTf: Record<string, Candle[]>,
    entryTf: string,
    higherTf: string,
    opts: SnapshotOptions = {},
): MarketSnapshot | null {
    const fatal: string[] = [];
    const degraded: string[] = [];

    const entryCandles = candlesByTf[entryTf] || [];
    const entry = buildTimeframeSnapshot(entryTf, entryCandles);
    if (!entry) return null;

    // EMA200 needs 200 bars of history. Without it the trend filter is blind,
    // which is a fatal problem on the timeframe we actually trade.
    if (entryCandles.length < 210) {
        fatal.push(`${entryTf}: ${entryCandles.length} bars (need 210 for EMA200)`);
    }

    const higher = candlesByTf[higherTf] ? buildTimeframeSnapshot(higherTf, candlesByTf[higherTf]) : null;
    const daily = candlesByTf['D1'] ? buildTimeframeSnapshot('D1', candlesByTf['D1']) : null;

    if (!higher) degraded.push(`${higherTf}: unavailable — higher-timeframe gate relaxed`);
    if (!daily) degraded.push('D1: unavailable — regime detection uses the higher timeframe only');

    // Staleness is measured against the moment being analysed, so it is a live
    // concern only. In replay, `nowSeconds` is the bar's own time and the age
    // is zero by construction.
    const tfSeconds: Record<string, number> = {
        M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D1: 86400, W1: 604800,
    };
    const barSec = tfSeconds[entryTf] || 3600;
    const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
    const ageSec = now - entry.lastBarTime;
    if (ageSec > barSec * 3) {
        fatal.push(`${entryTf}: last bar is ${Math.round(ageSec / 60)} min old — data is stale`);
    }

    // Missing context reduces confidence rather than vetoing the trade.
    let multiplier = 1.0;
    if (!higher) multiplier *= 0.85;
    if (!daily) multiplier *= 0.95;

    const htfBias = biasOf(daily) !== 'NEUTRAL' ? biasOf(daily) : biasOf(higher);

    return {
        symbol, spec,
        price: entry.close,
        generatedAt: entry.lastBarTime,
        session: currentSession(entry.lastBarTime),
        sessionQuality: sessionQuality(currentSession(entry.lastBarTime)),
        inRollover: isRolloverWindow(entry.lastBarTime),
        entry, higher, daily, htfBias,
        dataQuality: {
            ok: fatal.length === 0,
            fatal, degraded,
            confidenceMultiplier: multiplier,
        },
    };
}
