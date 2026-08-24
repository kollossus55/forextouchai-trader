// ════════════════════════════════════════════════════════════════════════════
// Market structure — computed, not described
// ════════════════════════════════════════════════════════════════════════════
// The old prompts asked a language model to "identify order blocks and fair
// value gaps" from a single spot price. Every one of these concepts has a
// mechanical definition, so they belong in code where they can be tested and
// backtested. An FVG literally is "candle 1 high < candle 3 low". That is not
// a judgement call.
// ════════════════════════════════════════════════════════════════════════════

import { Candle, Series, atr, lastVal } from './indicators.ts';

export interface SwingPoint { index: number; price: number; time: number; kind: 'HIGH' | 'LOW'; }

export interface Zone {
    top: number;
    bottom: number;
    index: number;
    time: number;
    direction: 'BULLISH' | 'BEARISH';
    kind: 'ORDER_BLOCK' | 'FVG' | 'SUPPLY' | 'DEMAND';
    mitigated: boolean;
}

export type StructureState = 'BULLISH' | 'BEARISH' | 'RANGING';
export type Regime = 'TRENDING' | 'RANGING' | 'TRANSITIONAL' | 'VOLATILE';

export interface StructureAnalysis {
    swings: SwingPoint[];
    state: StructureState;
    lastEvent: 'BOS' | 'CHOCH' | null;
    lastEventIndex: number | null;
    lastEventDirection: 'BULLISH' | 'BEARISH' | null;
    zones: Zone[];
    equalHighs: number[];
    equalLows: number[];
    liquiditySweep: 'BULLISH' | 'BEARISH' | null;
    supportLevels: number[];
    resistanceLevels: number[];
}

/**
 * Fractal swing points. A swing high at i requires `strength` bars either side
 * with lower highs. Points within `strength` bars of the end are NOT returned:
 * they are unconfirmed, and returning them would be lookahead bias.
 */
export function findSwings(candles: Candle[], strength = 2): SwingPoint[] {
    const out: SwingPoint[] = [];
    for (let i = strength; i < candles.length - strength; i++) {
        let isHigh = true, isLow = true;
        for (let j = 1; j <= strength; j++) {
            if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) isHigh = false;
            if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) isLow = false;
        }
        if (isHigh) out.push({ index: i, price: candles[i].high, time: candles[i].time, kind: 'HIGH' });
        if (isLow) out.push({ index: i, price: candles[i].low, time: candles[i].time, kind: 'LOW' });
    }
    return out.sort((a, b) => a.index - b.index);
}

/**
 * Break of Structure / Change of Character.
 *
 * BOS   = price closes beyond the last swing in the direction of the trend
 *         (continuation).
 * CHoCH = price closes beyond the last opposing swing against the trend
 *         (potential reversal).
 *
 * Uses closes, not wicks — a wick through a level is not a break.
 */
export function detectStructure(candles: Candle[], strength = 2) {
    const swings = findSwings(candles, strength);
    let state: StructureState = 'RANGING';
    let lastEvent: 'BOS' | 'CHOCH' | null = null;
    let lastEventIndex: number | null = null;
    let lastEventDirection: 'BULLISH' | 'BEARISH' | null = null;

    let lastHigh: SwingPoint | null = null;
    let lastLow: SwingPoint | null = null;

    for (let i = 0; i < candles.length; i++) {
        const close = candles[i].close;

        if (lastHigh && close > lastHigh.price && i > lastHigh.index) {
            if (state === 'BEARISH') { lastEvent = 'CHOCH'; lastEventDirection = 'BULLISH'; }
            else { lastEvent = 'BOS'; lastEventDirection = 'BULLISH'; }
            lastEventIndex = i;
            state = 'BULLISH';
            lastHigh = null;
        }
        if (lastLow && close < lastLow.price && i > lastLow.index) {
            if (state === 'BULLISH') { lastEvent = 'CHOCH'; lastEventDirection = 'BEARISH'; }
            else { lastEvent = 'BOS'; lastEventDirection = 'BEARISH'; }
            lastEventIndex = i;
            state = 'BEARISH';
            lastLow = null;
        }

        for (const s of swings) {
            if (s.index !== i) continue;
            if (s.kind === 'HIGH' && (!lastHigh || s.price > lastHigh.price)) lastHigh = s;
            if (s.kind === 'LOW' && (!lastLow || s.price < lastLow.price)) lastLow = s;
        }
    }

    return { swings, state, lastEvent, lastEventIndex, lastEventDirection };
}

/**
 * Fair Value Gaps — three-candle imbalance.
 * Bullish: candle[i-1].high < candle[i+1].low (gap left unfilled on the way up).
 * Only gaps wider than `minAtrFrac` of ATR are kept — otherwise every other
 * bar qualifies and the signal is meaningless.
 */
export function findFVGs(candles: Candle[], atrSeries: Series, minAtrFrac = 0.15, maxAge = 100): Zone[] {
    const out: Zone[] = [];
    const n = candles.length;
    const start = Math.max(1, n - maxAge);
    for (let i = start; i < n - 1; i++) {
        const a = candles[i - 1], c = candles[i + 1];
        const ref = atrSeries[i] ?? null;
        if (ref === null || ref === 0) continue;

        if (a.high < c.low && (c.low - a.high) >= ref * minAtrFrac) {
            out.push({
                bottom: a.high, top: c.low, index: i, time: candles[i].time,
                direction: 'BULLISH', kind: 'FVG',
                mitigated: candles.slice(i + 2).some(x => x.low <= a.high),
            });
        }
        if (a.low > c.high && (a.low - c.high) >= ref * minAtrFrac) {
            out.push({
                bottom: c.high, top: a.low, index: i, time: candles[i].time,
                direction: 'BEARISH', kind: 'FVG',
                mitigated: candles.slice(i + 2).some(x => x.high >= a.low),
            });
        }
    }
    return out;
}

/**
 * Order blocks — the last opposing candle before an impulsive move.
 * "Impulsive" is defined as a displacement of at least `impulseAtr` × ATR
 * within `impulseBars` bars, which keeps this objective.
 */
export function findOrderBlocks(
    candles: Candle[], atrSeries: Series,
    impulseAtr = 1.5, impulseBars = 3, maxAge = 100,
): Zone[] {
    const out: Zone[] = [];
    const n = candles.length;
    const start = Math.max(1, n - maxAge);

    for (let i = start; i < n - impulseBars; i++) {
        const ref = atrSeries[i] ?? null;
        if (ref === null || ref === 0) continue;
        const c = candles[i];
        const isBear = c.close < c.open;
        const isBull = c.close > c.open;

        let maxUp = 0, maxDown = 0;
        for (let j = i + 1; j <= i + impulseBars && j < n; j++) {
            maxUp = Math.max(maxUp, candles[j].high - c.close);
            maxDown = Math.max(maxDown, c.close - candles[j].low);
        }

        // Bullish OB: last DOWN candle before an UP impulse
        if (isBear && maxUp >= ref * impulseAtr) {
            out.push({
                bottom: c.low, top: c.high, index: i, time: c.time,
                direction: 'BULLISH', kind: 'ORDER_BLOCK',
                mitigated: candles.slice(i + impulseBars + 1).some(x => x.low <= c.low),
            });
        }
        // Bearish OB: last UP candle before a DOWN impulse
        if (isBull && maxDown >= ref * impulseAtr) {
            out.push({
                bottom: c.low, top: c.high, index: i, time: c.time,
                direction: 'BEARISH', kind: 'ORDER_BLOCK',
                mitigated: candles.slice(i + impulseBars + 1).some(x => x.high >= c.high),
            });
        }
    }
    return out;
}

/** Equal highs / lows — clustered swing levels where stop liquidity rests. */
export function findEqualLevels(swings: SwingPoint[], candles: Candle[], atrSeries: Series, tolAtr = 0.15) {
    const ref = lastVal(atrSeries) ?? 0;
    const equalHighs: number[] = [];
    const equalLows: number[] = [];
    if (ref === 0) return { equalHighs, equalLows };
    const tol = ref * tolAtr;

    const highs = swings.filter(s => s.kind === 'HIGH').slice(-12);
    const lows = swings.filter(s => s.kind === 'LOW').slice(-12);

    for (let i = 0; i < highs.length; i++) {
        for (let j = i + 1; j < highs.length; j++) {
            if (Math.abs(highs[i].price - highs[j].price) <= tol) {
                const lvl = (highs[i].price + highs[j].price) / 2;
                if (!equalHighs.some(v => Math.abs(v - lvl) <= tol)) equalHighs.push(lvl);
            }
        }
    }
    for (let i = 0; i < lows.length; i++) {
        for (let j = i + 1; j < lows.length; j++) {
            if (Math.abs(lows[i].price - lows[j].price) <= tol) {
                const lvl = (lows[i].price + lows[j].price) / 2;
                if (!equalLows.some(v => Math.abs(v - lvl) <= tol)) equalLows.push(lvl);
            }
        }
    }
    return { equalHighs, equalLows };
}

/**
 * Liquidity sweep — price wicks beyond a level then closes back inside within
 * `window` bars. Bullish sweep = swept lows and reclaimed (buy signal).
 */
export function detectLiquiditySweep(
    candles: Candle[], equalHighs: number[], equalLows: number[], window = 5,
): 'BULLISH' | 'BEARISH' | null {
    const n = candles.length;
    if (n < window + 1) return null;
    const recent = candles.slice(n - window);

    for (const lvl of equalLows) {
        const swept = recent.some(c => c.low < lvl);
        const reclaimed = recent[recent.length - 1].close > lvl;
        if (swept && reclaimed) return 'BULLISH';
    }
    for (const lvl of equalHighs) {
        const swept = recent.some(c => c.high > lvl);
        const reclaimed = recent[recent.length - 1].close < lvl;
        if (swept && reclaimed) return 'BEARISH';
    }
    return null;
}

/** Horizontal S/R from clustered swing points, ranked by touch count. */
export function findKeyLevels(swings: SwingPoint[], atrSeries: Series, currentPrice: number) {
    const ref = lastVal(atrSeries) ?? 0;
    const support: number[] = [], resistance: number[] = [];
    if (ref === 0) return { support, resistance };
    const tol = ref * 0.5;

    const cluster = (points: SwingPoint[]) => {
        const groups: { price: number; count: number }[] = [];
        for (const p of points) {
            const g = groups.find(x => Math.abs(x.price - p.price) <= tol);
            if (g) { g.price = (g.price * g.count + p.price) / (g.count + 1); g.count++; }
            else groups.push({ price: p.price, count: 1 });
        }
        return groups.sort((a, b) => b.count - a.count).slice(0, 5).map(g => g.price);
    };

    const all = cluster(swings.slice(-40));
    for (const lvl of all) {
        if (lvl < currentPrice) support.push(lvl);
        else resistance.push(lvl);
    }
    support.sort((a, b) => b - a);
    resistance.sort((a, b) => a - b);
    return { support, resistance };
}

/** Full structure pass for one timeframe. */
export function analyzeStructure(candles: Candle[], atrPeriod = 14): StructureAnalysis {
    const atrSeries = atr(candles, atrPeriod);
    const { swings, state, lastEvent, lastEventIndex, lastEventDirection } = detectStructure(candles);
    const fvgs = findFVGs(candles, atrSeries);
    const obs = findOrderBlocks(candles, atrSeries);
    const { equalHighs, equalLows } = findEqualLevels(swings, candles, atrSeries);
    const sweep = detectLiquiditySweep(candles, equalHighs, equalLows);
    const price = candles.length ? candles[candles.length - 1].close : 0;
    const { support, resistance } = findKeyLevels(swings, atrSeries, price);

    return {
        swings, state, lastEvent, lastEventIndex, lastEventDirection,
        zones: [...obs, ...fvgs].filter(z => !z.mitigated),
        equalHighs, equalLows,
        liquiditySweep: sweep,
        supportLevels: support,
        resistanceLevels: resistance,
    };
}

/**
 * Regime classification, from measurable properties rather than a description.
 *  VOLATILE     — current ATR far above its own average
 *  TRANSITIONAL — a CHoCH occurred recently
 *  TRENDING     — ADX above threshold and structure directional
 *  RANGING      — everything else
 */
export function classifyRegime(
    candles: Candle[], atrSeries: Series, adxSeries: Series, structure: StructureAnalysis,
): Regime {
    const n = candles.length;
    const curAtr = lastVal(atrSeries);
    const curAdx = lastVal(adxSeries);

    if (curAtr !== null) {
        const defined = atrSeries.filter(v => v !== null) as number[];
        if (defined.length > 30) {
            const recent = defined.slice(-100);
            const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
            if (mean > 0 && curAtr > mean * 1.8) return 'VOLATILE';
        }
    }

    if (structure.lastEvent === 'CHOCH' && structure.lastEventIndex !== null
        && n - structure.lastEventIndex <= 10) return 'TRANSITIONAL';

    if (curAdx !== null && curAdx >= 25 && structure.state !== 'RANGING') return 'TRENDING';

    return 'RANGING';
}

// ─── Candlestick patterns ───────────────────────────────────────────────────

export type PatternDirection = 'BULLISH' | 'BEARISH';
export interface Pattern { name: string; direction: PatternDirection; index: number; strength: number; }

/**
 * Patterns on the LAST CLOSED candle only. Every check requires the candle to
 * be closed — the previous code's prompts insisted on this but had no way to
 * enforce it.
 */
export function detectPatterns(candles: Candle[], atrSeries: Series): Pattern[] {
    const n = candles.length;
    const out: Pattern[] = [];
    if (n < 3) return out;

    const i = n - 1;
    const c = candles[i], p = candles[i - 1], p2 = candles[i - 2];
    const ref = atrSeries[i] ?? null;
    if (ref === null || ref === 0) return out;

    const body = Math.abs(c.close - c.open);
    const range = c.high - c.low;
    if (range === 0) return out;
    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerWick = Math.min(c.open, c.close) - c.low;
    const pBody = Math.abs(p.close - p.open);

    // Engulfing — body must fully cover the prior body and be meaningful vs ATR
    if (c.close > c.open && p.close < p.open &&
        c.close >= p.open && c.open <= p.close && body > pBody && body > ref * 0.5) {
        out.push({ name: 'Bullish Engulfing', direction: 'BULLISH', index: i, strength: 3 });
    }
    if (c.close < c.open && p.close > p.open &&
        c.close <= p.open && c.open >= p.close && body > pBody && body > ref * 0.5) {
        out.push({ name: 'Bearish Engulfing', direction: 'BEARISH', index: i, strength: 3 });
    }

    // Pin bars / hammer / shooting star.
    // The opposing wick is judged against the candle's RANGE, not its body:
    // a dragonfly hammer has a near-zero body, so "upperWick < body" would
    // reject the strongest examples of the pattern.
    if (lowerWick >= body * 2 && lowerWick >= range * 0.6 && upperWick <= range * 0.15 && range > ref * 0.6) {
        out.push({ name: 'Hammer / Bullish Pin', direction: 'BULLISH', index: i, strength: 2 });
    }
    if (upperWick >= body * 2 && upperWick >= range * 0.6 && lowerWick <= range * 0.15 && range > ref * 0.6) {
        out.push({ name: 'Shooting Star / Bearish Pin', direction: 'BEARISH', index: i, strength: 2 });
    }

    // Morning / evening star
    const p2Body = Math.abs(p2.close - p2.open);
    if (p2.close < p2.open && pBody < p2Body * 0.5 && c.close > c.open &&
        c.close > (p2.open + p2.close) / 2) {
        out.push({ name: 'Morning Star', direction: 'BULLISH', index: i, strength: 3 });
    }
    if (p2.close > p2.open && pBody < p2Body * 0.5 && c.close < c.open &&
        c.close < (p2.open + p2.close) / 2) {
        out.push({ name: 'Evening Star', direction: 'BEARISH', index: i, strength: 3 });
    }

    // Tweezers
    const tol = ref * 0.1;
    if (Math.abs(c.low - p.low) <= tol && c.close > c.open && p.close < p.open) {
        out.push({ name: 'Tweezer Bottom', direction: 'BULLISH', index: i, strength: 2 });
    }
    if (Math.abs(c.high - p.high) <= tol && c.close < c.open && p.close > p.open) {
        out.push({ name: 'Tweezer Top', direction: 'BEARISH', index: i, strength: 2 });
    }

    return out;
}

// ─── Sessions ───────────────────────────────────────────────────────────────

export type Session = 'SYDNEY' | 'TOKYO' | 'LONDON' | 'NEWYORK' | 'LONDON_NY_OVERLAP' | 'DEAD';

export function currentSession(epochSeconds: number): Session {
    const h = new Date(epochSeconds * 1000).getUTCHours();
    if (h >= 13 && h < 16) return 'LONDON_NY_OVERLAP';
    if (h >= 8 && h < 13) return 'LONDON';
    if (h >= 16 && h < 21) return 'NEWYORK';
    if (h >= 0 && h < 8) return 'TOKYO';
    if (h >= 21 && h < 24) return 'SYDNEY';
    return 'DEAD';
}

/** Liquidity quality multiplier applied to confidence. */
export function sessionQuality(s: Session): number {
    switch (s) {
        case 'LONDON_NY_OVERLAP': return 1.0;
        case 'LONDON': return 0.95;
        case 'NEWYORK': return 0.9;
        case 'TOKYO': return 0.75;
        case 'SYDNEY': return 0.6;
        default: return 0.5;
    }
}

/** Rollover and thin-liquidity windows where spreads blow out. */
export function isRolloverWindow(epochSeconds: number): boolean {
    const d = new Date(epochSeconds * 1000);
    const h = d.getUTCHours(), m = d.getUTCMinutes();
    // 20:45–21:15 UTC covers the daily rollover on most brokers
    if (h === 20 && m >= 45) return true;
    if (h === 21 && m <= 15) return true;
    return false;
}
