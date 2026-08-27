// ════════════════════════════════════════════════════════════════════════════
// Indicator library — deterministic, no market data invented
// ════════════════════════════════════════════════════════════════════════════
// Every function here returns a series ALIGNED TO THE INPUT: index i of the
// output corresponds to index i of the input candles, with `null` for bars
// where the indicator has insufficient lookback.
//
// The old code returned ragged arrays (an EMA of period 20 over 200 bars
// returned 181 values starting at an unknown offset), which made it impossible
// to line indicators up with each other or with a bar timestamp. Alignment is
// the single most important property for a backtester that must not look ahead.
// ════════════════════════════════════════════════════════════════════════════

export interface Candle {
    time: number;    // epoch seconds
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export type Series = (number | null)[];

// ─── Helpers ────────────────────────────────────────────────────────────────

export function last<T>(arr: T[]): T | null {
    return arr.length ? arr[arr.length - 1] : null;
}

/** Most recent non-null value of an aligned series. */
export function lastVal(s: Series): number | null {
    for (let i = s.length - 1; i >= 0; i--) if (s[i] !== null) return s[i];
    return null;
}

/** Value n bars back from the end (0 = last bar). */
export function valAt(s: Series, back: number): number | null {
    const i = s.length - 1 - back;
    return i >= 0 ? s[i] : null;
}

function filled(len: number): Series {
    return new Array(len).fill(null);
}

// ─── Moving averages ────────────────────────────────────────────────────────

export function sma(values: number[], period: number): Series {
    const out = filled(values.length);
    if (period <= 0 || values.length < period) return out;
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
        sum += values[i];
        if (i >= period) sum -= values[i - period];
        if (i >= period - 1) out[i] = sum / period;
    }
    return out;
}

export function ema(values: number[], period: number): Series {
    const out = filled(values.length);
    if (period <= 0 || values.length < period) return out;
    const k = 2 / (period + 1);
    let prev = 0;
    for (let i = 0; i < period; i++) prev += values[i];
    prev /= period;                       // seed with SMA
    out[period - 1] = prev;
    for (let i = period; i < values.length; i++) {
        prev = values[i] * k + prev * (1 - k);
        out[i] = prev;
    }
    return out;
}

/** Wilder's smoothing (RMA) — used by RSI, ATR, ADX. */
export function rma(values: number[], period: number): Series {
    const out = filled(values.length);
    if (period <= 0 || values.length < period) return out;
    let prev = 0;
    for (let i = 0; i < period; i++) prev += values[i];
    prev /= period;
    out[period - 1] = prev;
    for (let i = period; i < values.length; i++) {
        prev = (prev * (period - 1) + values[i]) / period;
        out[i] = prev;
    }
    return out;
}

// ─── Oscillators ────────────────────────────────────────────────────────────

export function rsi(closes: number[], period = 14): Series {
    const out = filled(closes.length);
    if (closes.length < period + 1) return out;

    const gains: number[] = [0];
    const losses: number[] = [0];
    for (let i = 1; i < closes.length; i++) {
        const ch = closes[i] - closes[i - 1];
        gains.push(ch > 0 ? ch : 0);
        losses.push(ch < 0 ? -ch : 0);
    }

    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i <= period; i++) { avgGain += gains[i]; avgLoss += losses[i]; }
    avgGain /= period; avgLoss /= period;
    out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

    for (let i = period + 1; i < closes.length; i++) {
        avgGain = (avgGain * (period - 1) + gains[i]) / period;
        avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
        out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
    return out;
}

export interface MacdResult { macd: Series; signal: Series; histogram: Series; }

export function macd(closes: number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
    const emaFast = ema(closes, fast);
    const emaSlow = ema(closes, slow);
    const macdLine = filled(closes.length);
    for (let i = 0; i < closes.length; i++) {
        if (emaFast[i] !== null && emaSlow[i] !== null) macdLine[i] = emaFast[i]! - emaSlow[i]!;
    }
    // Signal is an EMA of the MACD line over its defined region only
    const firstIdx = macdLine.findIndex(v => v !== null);
    const signal = filled(closes.length);
    const histogram = filled(closes.length);
    if (firstIdx >= 0) {
        const dense = macdLine.slice(firstIdx).map(v => v as number);
        const sig = ema(dense, signalPeriod);
        for (let i = 0; i < sig.length; i++) {
            if (sig[i] !== null) {
                signal[firstIdx + i] = sig[i];
                histogram[firstIdx + i] = macdLine[firstIdx + i]! - sig[i]!;
            }
        }
    }
    return { macd: macdLine, signal, histogram };
}

export function stochastic(candles: Candle[], kPeriod = 14, dPeriod = 3, smooth = 3) {
    const n = candles.length;
    const rawK = filled(n);
    for (let i = kPeriod - 1; i < n; i++) {
        let hh = -Infinity, ll = Infinity;
        for (let j = i - kPeriod + 1; j <= i; j++) {
            if (candles[j].high > hh) hh = candles[j].high;
            if (candles[j].low < ll) ll = candles[j].low;
        }
        rawK[i] = hh === ll ? 50 : ((candles[i].close - ll) / (hh - ll)) * 100;
    }
    const firstIdx = rawK.findIndex(v => v !== null);
    const k = filled(n), d = filled(n);
    if (firstIdx >= 0) {
        const dense = rawK.slice(firstIdx).map(v => v as number);
        const kS = sma(dense, smooth);
        for (let i = 0; i < kS.length; i++) if (kS[i] !== null) k[firstIdx + i] = kS[i];
        const kFirst = k.findIndex(v => v !== null);
        if (kFirst >= 0) {
            const kDense = k.slice(kFirst).map(v => v as number);
            const dS = sma(kDense, dPeriod);
            for (let i = 0; i < dS.length; i++) if (dS[i] !== null) d[kFirst + i] = dS[i];
        }
    }
    return { k, d };
}

export function cci(candles: Candle[], period = 20): Series {
    const n = candles.length;
    const out = filled(n);
    const tp = candles.map(c => (c.high + c.low + c.close) / 3);
    const tpSma = sma(tp, period);
    for (let i = period - 1; i < n; i++) {
        const mean = tpSma[i];
        if (mean === null) continue;
        let dev = 0;
        for (let j = i - period + 1; j <= i; j++) dev += Math.abs(tp[j] - mean);
        dev /= period;
        out[i] = dev === 0 ? 0 : (tp[i] - mean) / (0.015 * dev);
    }
    return out;
}

/** Chande Momentum Oscillator. */
export function cmo(closes: number[], period = 14): Series {
    const n = closes.length;
    const out = filled(n);
    for (let i = period; i < n; i++) {
        let up = 0, down = 0;
        for (let j = i - period + 1; j <= i; j++) {
            const ch = closes[j] - closes[j - 1];
            if (ch > 0) up += ch; else down -= ch;
        }
        out[i] = (up + down) === 0 ? 0 : ((up - down) / (up + down)) * 100;
    }
    return out;
}

// ─── Volatility ─────────────────────────────────────────────────────────────

export function trueRange(candles: Candle[]): number[] {
    const tr: number[] = [candles.length ? candles[0].high - candles[0].low : 0];
    for (let i = 1; i < candles.length; i++) {
        tr.push(Math.max(
            candles[i].high - candles[i].low,
            Math.abs(candles[i].high - candles[i - 1].close),
            Math.abs(candles[i].low - candles[i - 1].close),
        ));
    }
    return tr;
}

/** Wilder ATR, aligned to input. This is a real range calculation — not a
 *  fixed percentage of price, which is what the previous code used. */
export function atr(candles: Candle[], period = 14): Series {
    if (candles.length < period + 1) return filled(candles.length);
    const tr = trueRange(candles);
    // Wilder seeds from bars 1..period (bar 0's TR has no previous close)
    const out = filled(candles.length);
    let prev = 0;
    for (let i = 1; i <= period; i++) prev += tr[i];
    prev /= period;
    out[period] = prev;
    for (let i = period + 1; i < candles.length; i++) {
        prev = (prev * (period - 1) + tr[i]) / period;
        out[i] = prev;
    }
    return out;
}

export function bollinger(closes: number[], period = 20, mult = 2) {
    const n = closes.length;
    const mid = sma(closes, period);
    const upper = filled(n), lower = filled(n), width = filled(n);
    for (let i = period - 1; i < n; i++) {
        const m = mid[i];
        if (m === null) continue;
        let sq = 0;
        for (let j = i - period + 1; j <= i; j++) sq += (closes[j] - m) ** 2;
        const sd = Math.sqrt(sq / period);
        upper[i] = m + mult * sd;
        lower[i] = m - mult * sd;
        width[i] = m === 0 ? 0 : ((upper[i]! - lower[i]!) / m) * 100;
    }
    return { upper, middle: mid, lower, width };
}

// ─── Trend strength ─────────────────────────────────────────────────────────

export function adx(candles: Candle[], period = 14) {
    const n = candles.length;
    const outAdx = filled(n), outPlus = filled(n), outMinus = filled(n);
    if (n < period * 2 + 1) return { adx: outAdx, plusDI: outPlus, minusDI: outMinus };

    const tr: number[] = [0], plusDM: number[] = [0], minusDM: number[] = [0];
    for (let i = 1; i < n; i++) {
        const upMove = candles[i].high - candles[i - 1].high;
        const downMove = candles[i - 1].low - candles[i].low;
        plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
        minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
        tr.push(Math.max(
            candles[i].high - candles[i].low,
            Math.abs(candles[i].high - candles[i - 1].close),
            Math.abs(candles[i].low - candles[i - 1].close),
        ));
    }

    // Wilder smoothing over bars 1..n-1
    const smooth = (src: number[]) => {
        const o = filled(n);
        let prev = 0;
        for (let i = 1; i <= period; i++) prev += src[i];
        o[period] = prev;
        for (let i = period + 1; i < n; i++) {
            prev = prev - prev / period + src[i];
            o[i] = prev;
        }
        return o;
    };

    const trS = smooth(tr), pS = smooth(plusDM), mS = smooth(minusDM);
    const dx = filled(n);
    for (let i = period; i < n; i++) {
        if (trS[i] === null || trS[i] === 0) continue;
        const pdi = (pS[i]! / trS[i]!) * 100;
        const mdi = (mS[i]! / trS[i]!) * 100;
        outPlus[i] = pdi; outMinus[i] = mdi;
        const sum = pdi + mdi;
        dx[i] = sum === 0 ? 0 : (Math.abs(pdi - mdi) / sum) * 100;
    }

    // ADX = Wilder average of DX
    const firstDx = dx.findIndex(v => v !== null);
    if (firstDx >= 0 && n - firstDx >= period) {
        let prev = 0;
        for (let i = firstDx; i < firstDx + period; i++) prev += dx[i] ?? 0;
        prev /= period;
        outAdx[firstDx + period - 1] = prev;
        for (let i = firstDx + period; i < n; i++) {
            prev = (prev * (period - 1) + (dx[i] ?? 0)) / period;
            outAdx[i] = prev;
        }
    }
    return { adx: outAdx, plusDI: outPlus, minusDI: outMinus };
}

// ─── Derived candle types ───────────────────────────────────────────────────

export function heikinAshi(candles: Candle[]): Candle[] {
    if (!candles.length) return [];
    const out: Candle[] = [];
    let prevOpen = (candles[0].open + candles[0].close) / 2;
    let prevClose = (candles[0].open + candles[0].high + candles[0].low + candles[0].close) / 4;
    out.push({ ...candles[0], open: prevOpen, close: prevClose });
    for (let i = 1; i < candles.length; i++) {
        const c = candles[i];
        const haClose = (c.open + c.high + c.low + c.close) / 4;
        const haOpen = (prevOpen + prevClose) / 2;
        out.push({
            time: c.time, open: haOpen, close: haClose,
            high: Math.max(c.high, haOpen, haClose),
            low: Math.min(c.low, haOpen, haClose),
            volume: c.volume,
        });
        prevOpen = haOpen; prevClose = haClose;
    }
    return out;
}

/** SSL channel — used by the SP500 strategy. */
export function sslChannel(candles: Candle[], period = 9) {
    const n = candles.length;
    const highMa = sma(candles.map(c => c.high), period);
    const lowMa = sma(candles.map(c => c.low), period);
    const up = filled(n), down = filled(n);
    let hlv = 0;
    for (let i = 0; i < n; i++) {
        if (highMa[i] === null || lowMa[i] === null) continue;
        if (candles[i].close > highMa[i]!) hlv = 1;
        else if (candles[i].close < lowMa[i]!) hlv = -1;
        if (hlv === 0) continue;
        down[i] = hlv < 0 ? highMa[i] : lowMa[i];
        up[i]   = hlv < 0 ? lowMa[i]  : highMa[i];
    }
    return { up, down };
}

/** VWAP anchored to each UTC day. */
export function vwap(candles: Candle[]): Series {
    const out = filled(candles.length);
    let curDay = -1, cumPV = 0, cumV = 0;
    for (let i = 0; i < candles.length; i++) {
        const day = Math.floor(candles[i].time / 86400);
        if (day !== curDay) { curDay = day; cumPV = 0; cumV = 0; }
        const tp = (candles[i].high + candles[i].low + candles[i].close) / 3;
        const v = candles[i].volume || 1;
        cumPV += tp * v; cumV += v;
        out[i] = cumV > 0 ? cumPV / cumV : null;
    }
    return out;
}

// ─── Divergence ─────────────────────────────────────────────────────────────

/**
 * Regular RSI divergence over the last `lookback` bars.
 * Returns 'BULLISH' (price lower low, RSI higher low), 'BEARISH', or null.
 */
export function rsiDivergence(candles: Candle[], rsiSeries: Series, lookback = 40): 'BULLISH' | 'BEARISH' | null {
    const n = candles.length;
    if (n < lookback + 5) return null;
    const start = n - lookback;

    // Two most recent confirmed swing lows / highs inside the window
    const lows: number[] = [], highs: number[] = [];
    for (let i = start + 2; i < n - 2; i++) {
        if (candles[i].low < candles[i - 1].low && candles[i].low < candles[i - 2].low &&
            candles[i].low < candles[i + 1].low && candles[i].low < candles[i + 2].low) lows.push(i);
        if (candles[i].high > candles[i - 1].high && candles[i].high > candles[i - 2].high &&
            candles[i].high > candles[i + 1].high && candles[i].high > candles[i + 2].high) highs.push(i);
    }

    if (lows.length >= 2) {
        const a = lows[lows.length - 2], b = lows[lows.length - 1];
        const ra = rsiSeries[a], rb = rsiSeries[b];
        if (ra !== null && rb !== null && candles[b].low < candles[a].low && rb > ra) return 'BULLISH';
    }
    if (highs.length >= 2) {
        const a = highs[highs.length - 2], b = highs[highs.length - 1];
        const ra = rsiSeries[a], rb = rsiSeries[b];
        if (ra !== null && rb !== null && candles[b].high > candles[a].high && rb < ra) return 'BEARISH';
    }
    return null;
}
