/**
 * SignalEngine — Real multi-factor technical analysis signal engine
 * Computes RSI, MACD, Bollinger Bands, Stochastic, EMA cross signals
 * and combines them into a weighted confidence score.
 */
import { EMA, RSI, MACD, BollingerBands, ATR, Stochastic } from 'technicalindicators';
import {
  getSignalSettings, getDirectionalThreshold, getLockMs, getMinLockConfidence,
} from './signalSettings';

// ─── OHLC History Store ─────────────────────────────────────────────────────
// We accumulate real price ticks into minute-level OHLC candles, then
// resample to the requested timeframe.
const tickStore = {}; // symbol → [{ t, p }]
const MAX_TICKS = 2000;

// ─── Signal Lock Store ───────────────────────────────────────────────────────
// Prevents signal direction from flipping for a configurable period after a
// directional signal is confirmed. Neutral signals never lock.
// (duration & min confidence come from signalSettings — user configurable)
const signalLock = {};                  // symbol+tf → { signal, confidence, lockedAt }

export function recordTick(symbol, price) {
    if (!tickStore[symbol]) tickStore[symbol] = [];
    tickStore[symbol].push({ t: Date.now(), p: price });
    if (tickStore[symbol].length > MAX_TICKS) {
        tickStore[symbol] = tickStore[symbol].slice(-MAX_TICKS);
    }
}

// Build OHLC candles from tick data, resampled to the given timeframe
function buildCandles(symbol, timeframe) {
    const ticks = tickStore[symbol] || [];
    if (ticks.length < 5) return null;

    const tfMs = {
        M1: 60000, M5: 300000, M15: 900000,
        H1: 3600000, H4: 14400000, D1: 86400000
    };
    const bucketSize = tfMs[timeframe] || 3600000;

    const buckets = {};
    for (const { t, p } of ticks) {
        const key = Math.floor(t / bucketSize) * bucketSize;
        if (!buckets[key]) buckets[key] = { open: p, high: p, low: p, close: p };
        else {
            buckets[key].high = Math.max(buckets[key].high, p);
            buckets[key].low = Math.min(buckets[key].low, p);
            buckets[key].close = p;
        }
    }

    return Object.keys(buckets)
        .sort((a, b) => Number(a) - Number(b))
        .map(k => ({ ...buckets[k], time: Number(k) }));
}

// NOTE: `generateRealisticHistory()` used to live here.
//
// It fabricated a random-walk price series whenever there were not enough real
// ticks, and its own comment admitted the walk was tuned so "the indicators
// need that trend to produce the confluence that reaches Top Pick confidence
// levels". RSI, MACD and Bollinger Bands were then computed correctly — on
// invented candles — and surfaced to the user as analysis.
//
// It has been deleted. When there is not enough real history, the engine now
// returns an explicit INSUFFICIENT_DATA result and the UI shows an empty state.
// An empty state is infinitely better than a confident fabrication.

// ─── Deterministic D1 higher-timeframe bias ───────────────────────────────────
// Seeded by symbol so the D1 trend is STABLE across recalcs (it would flap
// every 30s if we used Math.random() like the selected-timeframe history).
// The Pairs grid + Top Picks use this as a hard trend filter: signals that
// fight the D1 trend get their confidence capped below the Top Picks / bot
// threshold, so only trend-aligned setups surface as high-confidence picks.
function _hashString(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    return h >>> 0;
}
function _mulberry32(seed) {
    let s = seed >>> 0;
    return function () {
        s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function computeD1Bias(symbol) {
    // Higher-timeframe bias requires real daily candles. The client does not
    // have them — the backend does, via broker OHLC uploaded by the EA.
    // Returning UNKNOWN is honest; the previous version seeded a random walk
    // from a hash of the symbol name and reported the result as a D1 trend.
    const candles = buildCandles(symbol, 'D1');
    if (!candles || candles.length < 200) {
        return { bias: 'UNKNOWN', ema20: null, ema50: null, ema200: null, price: null };
    }
    const closes = candles.map(c => c.close);
    const ema20Arr = EMA.calculate({ period: 20, values: closes });
    const ema50Arr = EMA.calculate({ period: 50, values: closes });
    const ema200Arr = EMA.calculate({ period: 200, values: closes });
    const ema20 = ema20Arr.length ? ema20Arr[ema20Arr.length - 1] : null;
    const ema50 = ema50Arr.length ? ema50Arr[ema50Arr.length - 1] : null;
    const ema200 = ema200Arr.length ? ema200Arr[ema200Arr.length - 1] : null;
    const price = closes[closes.length - 1];

    let bias = 'NEUTRAL';
    if (ema20 != null && ema50 != null && ema200 != null) {
        if (price > ema20 && ema20 > ema50 && price > ema200) bias = 'BULLISH';
        else if (price < ema20 && ema20 < ema50 && price < ema200) bias = 'BEARISH';
        else if (price > ema200) bias = 'BULLISH';
        else if (price < ema200) bias = 'BEARISH';
    }
    return { bias, ema20, ema50, ema200, price };
}

// ─── Core Signal Calculation ────────────────────────────────────────────────
export function computeSignal(symbol, timeframe, currentPrice) {
    const candles = buildCandles(symbol, timeframe);

    // Indicators need real history. If we do not have it, say so — do not
    // manufacture candles to fill the gap.
    if (!candles || candles.length < 60) {
        return {
            signal: 'INSUFFICIENT_DATA',
            confidence: 0,
            available: false,
            reason: `Only ${candles ? candles.length : 0} real ${timeframe} candles collected. ` +
                    `Live indicator analysis needs 60+. Signals generated by your bots use broker ` +
                    `candles server-side and are unaffected by this.`,
            factors: [],
            indicators: {},
        };
    }

    const closes = candles.map(c => c.close);
    const highs  = candles.map(c => c.high);
    const lows   = candles.map(c => c.low);
    const n = closes.length;

    // ── Compute Indicators ──────────────────────────────────────────────────
    const rsiArr  = RSI.calculate({ period: 14, values: closes });
    const macdArr = MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
    const bbArr   = BollingerBands.calculate({ period: 20, values: closes, stdDev: 2 });
    const stochArr= Stochastic.calculate({ high: highs, low: lows, close: closes, period: 14, signalPeriod: 3 });
    const ema20Arr= EMA.calculate({ period: 20, values: closes });
    const ema50Arr= EMA.calculate({ period: 50, values: closes });
    const ema200Arr=EMA.calculate({ period: 200, values: closes });
    const atrArr  = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });

    const rsi    = rsiArr[rsiArr.length - 1];
    const macd   = macdArr[macdArr.length - 1];
    const bb     = bbArr[bbArr.length - 1];
    const stoch  = stochArr[stochArr.length - 1];
    const ema20  = ema20Arr[ema20Arr.length - 1];
    const ema50  = ema50Arr[ema50Arr.length - 1];
    const ema200 = ema200Arr.length > 0 ? ema200Arr[ema200Arr.length - 1] : null;
    const atr    = atrArr[atrArr.length - 1];
    const price  = closes[n - 1];

    // ── Multi-factor Scoring (weights & enables driven by user settings) ───
    // Each factor contributes a score in range [-weight, +weight].
    // Positive = bullish, Negative = bearish.
    const F = getSignalSettings().factors;
    const half = (w) => Math.round(w / 2);
    const factors = [];

    // 1. RSI
    if (rsi !== undefined && F.rsi.enabled) {
        const w = F.rsi.weight;
        if (rsi < 30)      factors.push({ name: 'RSI Oversold',        score: w,       direction: 'BUY'  });
        else if (rsi < 40) factors.push({ name: 'RSI Mild Oversold',   score: half(w), direction: 'BUY'  });
        else if (rsi > 70) factors.push({ name: 'RSI Overbought',      score: w,       direction: 'SELL' });
        else if (rsi > 60) factors.push({ name: 'RSI Mild Overbought', score: half(w), direction: 'SELL' });
        else               factors.push({ name: 'RSI Neutral',        score: 0,       direction: 'NEUTRAL' });
    }

    // 2. MACD crossover
    if (macd && F.macd.enabled) {
        const w = F.macd.weight;
        const hist = macd.histogram;
        if (hist > 0)      factors.push({ name: 'MACD Bullish Cross', score: hist > 0.0001 ? w : half(w), direction: 'BUY'  });
        else if (hist < 0) factors.push({ name: 'MACD Bearish Cross', score: Math.abs(hist) > 0.0001 ? w : half(w), direction: 'SELL' });
    }

    // 3. Bollinger Bands position
    if (bb && F.bollinger.enabled) {
        const w = F.bollinger.weight;
        const bbRange = bb.upper - bb.lower;
        const percentB = bbRange > 0 ? ((price - bb.lower) / bbRange) * 100 : 50;
        if (price < bb.lower)       factors.push({ name: 'Price Below BB', score: w,       direction: 'BUY'  });
        else if (percentB < 20)     factors.push({ name: 'BB Lower Zone',  score: half(w), direction: 'BUY'  });
        else if (price > bb.upper)  factors.push({ name: 'Price Above BB', score: w,       direction: 'SELL' });
        else if (percentB > 80)     factors.push({ name: 'BB Upper Zone',  score: half(w), direction: 'SELL' });
    }

    // 4. EMA 20/50 Trend
    if (ema20 && ema50 && F.emaCross.enabled) {
        const w = F.emaCross.weight;
        if (ema20 > ema50) factors.push({ name: 'EMA20 > EMA50 (Bullish)', score: w, direction: 'BUY'  });
        else               factors.push({ name: 'EMA20 < EMA50 (Bearish)', score: w, direction: 'SELL' });
    }

    // 5. Price vs EMA200
    if (ema200 && F.ema200.enabled) {
        const w = F.ema200.weight;
        if (price > ema200) factors.push({ name: 'Above EMA200', score: w, direction: 'BUY'  });
        else                 factors.push({ name: 'Below EMA200', score: w, direction: 'SELL' });
    }

    // 6. Stochastic
    if (stoch && F.stochastic.enabled) {
        const w = F.stochastic.weight;
        if (stoch.k < 20 && stoch.d < 20)      factors.push({ name: 'Stoch Oversold',   score: w, direction: 'BUY'  });
        else if (stoch.k > 80 && stoch.d > 80) factors.push({ name: 'Stoch Overbought', score: w, direction: 'SELL' });
    }

    // ── Tally scores ────────────────────────────────────────────────────────
    let buyScore = 0, sellScore = 0, totalWeight = 0;
    for (const f of factors) {
        totalWeight += f.score;
        if (f.direction === 'BUY')  buyScore  += f.score;
        if (f.direction === 'SELL') sellScore += f.score;
    }

    // maxPossible = sum of enabled factor weights (dynamic with user settings)
    const maxPossible = Object.values(getSignalSettings().factors)
        .reduce((s, f) => s + (f.enabled ? f.weight : 0), 0) || 100;
    const buyPct  = totalWeight > 0 ? (buyScore  / maxPossible) * 100 : 0;
    const sellPct = totalWeight > 0 ? (sellScore / maxPossible) * 100 : 0;
    // Net confluence: how strongly indicators agree (positive = bullish).
    // Rewards clean agreement over mixed signals — a trend with oscillators
    // fighting it scores lower than one where oscillators are neutral/aligned.
    const netPct = totalWeight > 0 ? ((buyScore - sellScore) / maxPossible) * 100 : 0;

    const threshold = getDirectionalThreshold();
    let signal = 'NEUTRAL';
    let confidence = 50;

    // Confidence scales from 50 at the threshold up to ~97 based on NET
    // confluence (agreement minus opposition). The old formula used raw
    // buyPct, which maxes at ~65% in real trends (oscillators naturally
    // fight trends), capping confidence at 74% so no Top Picks ever cleared
    // the 75% threshold. Net confluence lets clean 3-4 indicator agreement
    // reach 80-95% while mixed signals stay below 75%.
    if (buyPct > sellPct && buyPct >= threshold) {
        signal = 'BUY';
        confidence = Math.min(97, Math.round(50 + Math.max(0, netPct) * 0.9));
    } else if (sellPct > buyPct && sellPct >= threshold) {
        signal = 'SELL';
        confidence = Math.min(97, Math.round(50 + Math.max(0, -netPct) * 0.9));
    } else {
        confidence = Math.round(50 - Math.abs(buyPct - sellPct));
    }

    // Capture live (pre-lock) values — Top Picks ranks by these so the strip
    // reflects current market strength instead of a 30-min locked confidence.
    const liveSignal = signal;
    let liveConfidence = confidence;

    // ── Signal Lock (duration & min confidence from user settings) ───────────
    // If a directional signal was locked recently, hold it unless the lock
    // has expired. A stronger opposing signal does NOT override the lock —
    // wait for expiry to prevent noise-driven flips. Set lockMinutes=0 to disable.
    const lockKey = `${symbol}_${timeframe}`;
    const now = Date.now();
    const lock = signalLock[lockKey];
    const lockMs = getLockMs();
    const minLockConf = getMinLockConfidence();

    if (lockMs > 0 && lock && (now - lock.lockedAt) < lockMs) {
        // Still within lock window — preserve locked signal & confidence
        signal = lock.signal;
        confidence = lock.confidence;
    } else {
        // Lock window expired or no lock — set a new lock if signal is directional
        if (signal !== 'NEUTRAL' && confidence >= minLockConf) {
            signalLock[lockKey] = { signal, confidence, lockedAt: now };
        } else if (signal === 'NEUTRAL') {
            // Clear any expired lock on neutral
            delete signalLock[lockKey];
        }
    }

    // ── D1 higher-timeframe bias gate ───────────────────────────────────────
    // Filters counter-trend signals: if the selected-timeframe signal fights
    // the D1 trend, confidence is capped below the Top Picks / bot threshold
    // so only trend-aligned setups surface as high-confidence picks.
    const d1 = computeD1Bias(symbol);
    // Map signal direction to D1 bias terminology for comparison:
    // BUY = BULLISH, SELL = BEARISH. Without this mapping, 'BULLISH' !== 'BUY'
    // is always true and EVERY directional signal gets capped at 74.
    const signalBias = signal === 'BUY' ? 'BULLISH' : signal === 'SELL' ? 'BEARISH' : 'NEUTRAL';
    const liveSignalBias = liveSignal === 'BUY' ? 'BULLISH' : liveSignal === 'SELL' ? 'BEARISH' : 'NEUTRAL';
    const d1Conflicts = d1.bias !== 'NEUTRAL' && signalBias !== 'NEUTRAL' && d1.bias !== signalBias;
    const d1LiveConflicts = d1.bias !== 'NEUTRAL' && liveSignalBias !== 'NEUTRAL' && d1.bias !== liveSignalBias;
    if (d1Conflicts) confidence = Math.min(confidence, 74);
    if (d1LiveConflicts) liveConfidence = Math.min(liveConfidence, 74);
    if (d1Conflicts) {
        factors.push({ name: `D1 Trend Conflict (${d1.bias})`, score: 0, direction: 'NEUTRAL' });
    } else if (signal !== 'NEUTRAL' && d1.bias !== 'NEUTRAL') {
        factors.push({ name: `D1 Trend Aligned (${d1.bias})`, score: 0, direction: 'NEUTRAL' });
    } else {
        factors.push({ name: `D1 Trend: ${d1.bias}`, score: 0, direction: 'NEUTRAL' });
    }

    // ── Build normalised indicator snapshot ─────────────────────────────────
    const bbRange2 = bb ? (bb.upper - bb.lower) : 0;
    const percentB = bb && bbRange2 > 0 ? ((price - bb.lower) / bbRange2) * 100 : 50;

    const indicatorSnapshot = {
        rsi,
        macd: {
            value:     macd?.MACD     || 0,
            signal:    macd?.signal   || 0,
            histogram: macd?.histogram || 0
        },
        bollingerBands: {
            upper:    bb?.upper  || price,
            middle:   bb?.middle || price,
            lower:    bb?.lower  || price,
            percentB: Math.round(percentB)
        },
        stochastic: { k: stoch?.k || 50, d: stoch?.d || 50 },
        ema20, ema50, ema200,
        atr: { value: atr || price * 0.001 },
        d1: { bias: d1.bias, ema20: d1.ema20, ema50: d1.ema50, ema200: d1.ema200 }
    };

    // ── Build chart-ready candle series ─────────────────────────────────────
    const last60 = candles.slice(-60);
    const closes60 = last60.map(c => c.close);
    const rsiSeries   = RSI.calculate({ period: 14, values: closes60 });
    const macdSeries  = MACD.calculate({ values: closes60, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
    const bbSeries    = BollingerBands.calculate({ period: 20, values: closes60, stdDev: 2 });
    const stochSeries = Stochastic.calculate({ high: last60.map(c=>c.high), low: last60.map(c=>c.low), close: closes60, period: 14, signalPeriod: 3 });
    const ema200Series= EMA.calculate({ period: Math.min(50, closes60.length - 1), values: closes60 });

    const chartCandles = last60.map((c, i) => {
        const rsiOffset   = i - (last60.length - rsiSeries.length);
        const macdOffset  = i - (last60.length - macdSeries.length);
        const bbOffset    = i - (last60.length - bbSeries.length);
        const stochOffset = i - (last60.length - stochSeries.length);
        const ema200Off   = i - (last60.length - ema200Series.length);
        return {
            close: c.close, high: c.high, low: c.low, open: c.open,
            indicators: {
                rsi:          rsiOffset >= 0   ? rsiSeries[rsiOffset]          : null,
                macdHistogram: macdOffset >= 0  ? macdSeries[macdOffset]?.histogram : null,
                macdValue:    macdOffset >= 0  ? macdSeries[macdOffset]?.MACD   : null,
                macdSignal:   macdOffset >= 0  ? macdSeries[macdOffset]?.signal : null,
                bbUpper:      bbOffset >= 0    ? bbSeries[bbOffset]?.upper      : null,
                bbMiddle:     bbOffset >= 0    ? bbSeries[bbOffset]?.middle     : null,
                bbLower:      bbOffset >= 0    ? bbSeries[bbOffset]?.lower      : null,
                stochK:       stochOffset >= 0 ? stochSeries[stochOffset]?.k    : null,
                stochD:       stochOffset >= 0 ? stochSeries[stochOffset]?.d    : null,
                ema200:       ema200Off >= 0   ? ema200Series[ema200Off]        : null
            }
        };
    });

    return { signal, confidence, liveSignal, liveConfidence, indicators: indicatorSnapshot, factors, chartCandles };
}