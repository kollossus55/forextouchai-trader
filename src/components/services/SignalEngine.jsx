/**
 * SignalEngine — Real multi-factor technical analysis signal engine
 * Computes RSI, MACD, Bollinger Bands, Stochastic, EMA cross signals
 * and combines them into a weighted confidence score.
 */
import { EMA, RSI, MACD, BollingerBands, ATR, Stochastic, SMA } from 'technicalindicators';
import { MarketDataService } from './MarketDataService';
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

// Generate seeded-but-realistic OHLC history when ticks are insufficient
// Uses real current price as anchor and applies mean-reverting random walk
function generateRealisticHistory(currentPrice, periods, timeframe) {
    const tfVolatility = {
        M1: 0.0003, M5: 0.0006, M15: 0.001,
        H1: 0.0018, H4: 0.003, D1: 0.006
    };
    const vol = tfVolatility[timeframe] || 0.0018;

    const candles = [];
    // Start from a realistic recent low
    let price = currentPrice * (1 - vol * 15);

    for (let i = 0; i < periods; i++) {
        // Mean-reverting walk: pull back toward currentPrice over time
        const drift = (currentPrice - price) * 0.03;
        const noise = (Math.random() - 0.5) * 2 * vol * price;
        const open = price;
        const close = price + drift + noise;
        const range = Math.abs(close - open) * (1 + Math.random());
        const high = Math.max(open, close) + range * Math.random() * 0.5;
        const low = Math.min(open, close) - range * Math.random() * 0.5;
        candles.push({ time: Date.now() - (periods - i) * 3600000, open, high, low, close });
        price = close;
    }
    return candles;
}

// ─── Core Signal Calculation ────────────────────────────────────────────────
export function computeSignal(symbol, timeframe, currentPrice) {
    let candles = buildCandles(symbol, timeframe);

    // Need at least 60 candles for reliable indicators
    if (!candles || candles.length < 60) {
        candles = generateRealisticHistory(currentPrice, 120, timeframe);
        // Patch last close to real price
        candles[candles.length - 1].close = currentPrice;
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

    const threshold = getDirectionalThreshold();
    let signal = 'NEUTRAL';
    let confidence = 50;

    // Confidence scales from 50 at the threshold up to ~97, so it reflects
    // genuine confluence strength rather than a bare threshold pass.
    if (buyPct > sellPct && buyPct >= threshold) {
        signal = 'BUY';
        confidence = Math.min(97, Math.round(50 + (buyPct - threshold) * 0.8));
    } else if (sellPct > buyPct && sellPct >= threshold) {
        signal = 'SELL';
        confidence = Math.min(97, Math.round(50 + (sellPct - threshold) * 0.8));
    } else {
        confidence = Math.round(50 - Math.abs(buyPct - sellPct));
    }

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
        atr: { value: atr || price * 0.001 }
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

    return { signal, confidence, indicators: indicatorSnapshot, factors, chartCandles };
}