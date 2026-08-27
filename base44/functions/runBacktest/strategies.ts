// ════════════════════════════════════════════════════════════════════════════
// Strategy evaluation — deterministic confluence scoring
// ════════════════════════════════════════════════════════════════════════════
// Each strategy returns a signal from a weighted score over CONFIRMED
// conditions. Same input always produces the same output, which is what makes
// the backtester meaningful.
//
// Confidence is the percentage of available weight actually satisfied, scaled
// by data quality and session liquidity. It is not a number a model felt was
// appropriate — it is a ratio you can audit.
//
// Indicator toggles (ind_use_rsi etc.) remove that factor's weight from BOTH
// the numerator and the denominator, so disabling an indicator neither blocks a
// signal nor inflates confidence.
// ════════════════════════════════════════════════════════════════════════════

import { MarketSnapshot, TimeframeSnapshot } from './analysis.ts';
import { Zone } from './structure.ts';

export type SignalType = 'BUY' | 'SELL' | 'NEUTRAL';

export interface Factor {
    key: string;
    label: string;
    weight: number;
    direction: 'BULLISH' | 'BEARISH' | 'NONE';
    detail: string;
}

export interface StrategyResult {
    type: SignalType;
    confidence: number;             // 0–100
    rawScore: number;
    availableWeight: number;
    factors: Factor[];
    reasons: string[];
    blockedBy: string[];
    // Stop distance in PRICE units, derived from real ATR / structure
    stopDistance: number | null;
    targetDistance: number | null;
    stopBasis: string;
}

export interface BotSettings {
    strategy_type: string;
    min_confidence?: number;
    timeframe?: string;
    atr_multiplier_sl?: number;
    atr_multiplier_tp?: number;
    sl_tp_mode?: 'FIXED' | 'ATR';
    stop_loss_pips?: number;
    take_profit_pips?: number;
    require_htf_alignment?: boolean;
    min_adx?: number;
    avoid_rollover?: boolean;
    min_session_quality?: number;
    [key: string]: unknown;
}

function enabled(bot: BotSettings, field: string): boolean {
    return bot[field] !== false;
}

// ─── Shared factor builders ─────────────────────────────────────────────────

function emaFactor(tf: TimeframeSnapshot, weight: number): Factor {
    const d = tf.emaStack === 'BULLISH' ? 'BULLISH' : tf.emaStack === 'BEARISH' ? 'BEARISH' : 'NONE';
    return {
        key: 'ema', label: 'EMA stack', weight, direction: d,
        detail: `20/50/200 ${tf.emaStack}` +
            (tf.ema20 !== null ? ` (${tf.ema20.toFixed(5)}/${tf.ema50?.toFixed(5)}/${tf.ema200?.toFixed(5)})` : ''),
    };
}

function rsiFactor(tf: TimeframeSnapshot, weight: number, buyMax = 70, sellMin = 30): Factor {
    const v = tf.rsi;
    let d: Factor['direction'] = 'NONE';
    if (v !== null) {
        if (v > 50 && v < buyMax) d = 'BULLISH';
        else if (v < 50 && v > sellMin) d = 'BEARISH';
    }
    return { key: 'rsi', label: 'RSI', weight, direction: d, detail: v === null ? 'n/a' : `RSI ${v.toFixed(1)}` };
}

function macdFactor(tf: TimeframeSnapshot, weight: number): Factor {
    const h = tf.macdHistogram;
    const d = h === null ? 'NONE' : h > 0 ? 'BULLISH' : h < 0 ? 'BEARISH' : 'NONE';
    return {
        key: 'macd', label: 'MACD', weight, direction: d,
        detail: h === null ? 'n/a' : `histogram ${h.toFixed(6)}${tf.macdCross ? ` (${tf.macdCross} cross)` : ''}`,
    };
}

function adxFactor(tf: TimeframeSnapshot, weight: number, threshold = 25): Factor {
    const a = tf.adx, p = tf.plusDI, m = tf.minusDI;
    let d: Factor['direction'] = 'NONE';
    if (a !== null && a >= threshold && p !== null && m !== null) {
        d = p > m ? 'BULLISH' : 'BEARISH';
    }
    return { key: 'adx', label: 'ADX', weight, direction: d, detail: a === null ? 'n/a' : `ADX ${a.toFixed(1)}` };
}

function structureFactor(tf: TimeframeSnapshot, weight: number): Factor {
    const s = tf.structure;
    const d = s.state === 'BULLISH' ? 'BULLISH' : s.state === 'BEARISH' ? 'BEARISH' : 'NONE';
    return {
        key: 'structure', label: 'Market structure', weight, direction: d,
        detail: `${s.state}${s.lastEvent ? ` — last ${s.lastEvent} ${s.lastEventDirection}` : ''}`,
    };
}

function patternFactor(tf: TimeframeSnapshot, weight: number): Factor {
    const p = tf.patterns;
    if (!p.length) return { key: 'candlestick', label: 'Candlestick', weight, direction: 'NONE', detail: 'none' };
    const bull = p.filter(x => x.direction === 'BULLISH').reduce((a, b) => a + b.strength, 0);
    const bear = p.filter(x => x.direction === 'BEARISH').reduce((a, b) => a + b.strength, 0);
    const d = bull > bear ? 'BULLISH' : bear > bull ? 'BEARISH' : 'NONE';
    return { key: 'candlestick', label: 'Candlestick', weight, direction: d, detail: p.map(x => x.name).join(', ') };
}

function stochFactor(tf: TimeframeSnapshot, weight: number): Factor {
    const k = tf.stochK, dv = tf.stochD;
    let d: Factor['direction'] = 'NONE';
    if (k !== null && dv !== null) {
        if (k < 30 && k > dv) d = 'BULLISH';
        else if (k > 70 && k < dv) d = 'BEARISH';
        else if (k > dv && k < 70) d = 'BULLISH';
        else if (k < dv && k > 30) d = 'BEARISH';
    }
    return { key: 'stochastic', label: 'Stochastic', weight, direction: d, detail: k === null ? 'n/a' : `K ${k.toFixed(1)} D ${dv?.toFixed(1)}` };
}

function bollingerFactor(tf: TimeframeSnapshot, weight: number, meanReversion: boolean): Factor {
    const pos = tf.bbPosition;
    let d: Factor['direction'] = 'NONE';
    if (pos !== null) {
        if (meanReversion) {
            if (pos <= 0.05) d = 'BULLISH';
            else if (pos >= 0.95) d = 'BEARISH';
        } else {
            if (pos > 0.55) d = 'BULLISH';
            else if (pos < 0.45) d = 'BEARISH';
        }
    }
    return { key: 'bollinger', label: 'Bollinger', weight, direction: d, detail: pos === null ? 'n/a' : `band position ${(pos * 100).toFixed(0)}%` };
}

function liquidityFactor(tf: TimeframeSnapshot, weight: number): Factor {
    const s = tf.structure.liquiditySweep;
    return {
        key: 'liquidity', label: 'Liquidity sweep', weight,
        direction: s ?? 'NONE',
        detail: s ? `${s} sweep and reclaim` : 'none',
    };
}

function zoneFactor(tf: TimeframeSnapshot, price: number, atrVal: number | null, weight: number): Factor {
    if (atrVal === null || atrVal === 0) {
        return { key: 'zone', label: 'Institutional zone', weight, direction: 'NONE', detail: 'n/a' };
    }
    const near = (z: Zone) => price >= z.bottom - atrVal * 0.3 && price <= z.top + atrVal * 0.3;
    const hits = tf.structure.zones.filter(near);
    if (!hits.length) return { key: 'zone', label: 'Institutional zone', weight, direction: 'NONE', detail: 'not at a zone' };
    const bull = hits.filter(z => z.direction === 'BULLISH').length;
    const bear = hits.filter(z => z.direction === 'BEARISH').length;
    const d = bull > bear ? 'BULLISH' : bear > bull ? 'BEARISH' : 'NONE';
    return {
        key: 'zone', label: 'Institutional zone', weight, direction: d,
        detail: hits.map(z => `${z.direction} ${z.kind}`).join(', '),
    };
}

function divergenceFactor(tf: TimeframeSnapshot, weight: number): Factor {
    const d = tf.rsiDivergence;
    return { key: 'divergence', label: 'RSI divergence', weight, direction: d ?? 'NONE', detail: d ?? 'none' };
}

function fibonacciFactor(tf: TimeframeSnapshot, price: number, atrVal: number | null, weight: number): Factor {
    if (atrVal === null || atrVal === 0) {
        return { key: 'fibonacci', label: 'Fibonacci', weight, direction: 'NONE', detail: 'n/a' };
    }
    const supports = tf.structure.supportLevels;
    const resistances = tf.structure.resistanceLevels;
    if (!supports.length || !resistances.length) {
        return { key: 'fibonacci', label: 'Fibonacci', weight, direction: 'NONE', detail: 'no swing levels' };
    }
    const swingHigh = Math.max(...resistances.slice(0, 3));
    const swingLow = Math.min(...supports.slice(0, 3));
    const range = swingHigh - swingLow;
    if (range <= 0) {
        return { key: 'fibonacci', label: 'Fibonacci', weight, direction: 'NONE', detail: 'no range' };
    }
    const fib382 = swingLow + range * 0.382;
    const fib500 = swingLow + range * 0.500;
    const fib618 = swingLow + range * 0.618;
    const tol = atrVal * 0.3;
    const near = (lvl: number) => Math.abs(price - lvl) <= tol;
    const structDir = tf.structure.state;
    let direction: Factor['direction'] = 'NONE';
    let detail = 'no confluence';
    if (structDir === 'BULLISH' && (near(fib618) || near(fib500) || near(fib382))) {
        direction = 'BULLISH';
        detail = near(fib618) ? '61.8% retracement confluence' : near(fib500) ? '50% retracement confluence' : '38.2% retracement';
    } else if (structDir === 'BEARISH' && (near(fib618) || near(fib500) || near(fib382))) {
        direction = 'BEARISH';
        detail = near(fib618) ? '61.8% retracement confluence' : near(fib500) ? '50% retracement confluence' : '38.2% retracement';
    }
    return { key: 'fibonacci', label: 'Fibonacci', weight, direction, detail };
}

function vwapFactor(tf: TimeframeSnapshot, weight: number): Factor {
    const v = tf.vwap;
    const d = v === null ? 'NONE' : tf.close > v ? 'BULLISH' : 'BEARISH';
    return { key: 'vwap', label: 'VWAP', weight, direction: d, detail: v === null ? 'n/a' : `price ${tf.close > v ? 'above' : 'below'} VWAP` };
}

// ─── Strategy factor sets ───────────────────────────────────────────────────

type FactorSet = (snap: MarketSnapshot, bot: BotSettings) => Factor[];

const FACTOR_SETS: Record<string, FactorSet> = {

    AI_PREDICTIVE: (s, b) => {
        const tf = s.entry, a = tf.atr;
        const mr = tf.regime === 'RANGING';
        return [
            enabled(b, 'ind_use_structure') ? structureFactor(tf, 3) : null,
            enabled(b, 'ind_use_ema') ? emaFactor(tf, 3) : null,
            enabled(b, 'ind_use_adx') ? adxFactor(tf, 2, b.min_adx ?? 20) : null,
            enabled(b, 'ind_use_rsi') ? rsiFactor(tf, 2) : null,
            enabled(b, 'ind_use_macd') ? macdFactor(tf, 2) : null,
            enabled(b, 'ind_use_structure') ? zoneFactor(tf, s.price, a, 3) : null,
            enabled(b, 'ind_use_liquidity') ? liquidityFactor(tf, 2) : null,
            enabled(b, 'ind_use_candlestick') ? patternFactor(tf, 2) : null,
            enabled(b, 'ind_use_bollinger') ? bollingerFactor(tf, 1, mr) : null,
            enabled(b, 'ind_use_stochastic') ? stochFactor(tf, 1) : null,
        ].filter(Boolean) as Factor[];
    },

    SCALPING: (s, b) => {
        const tf = s.entry;
        return [
            enabled(b, 'ind_use_ema') ? emaFactor(tf, 3) : null,
            enabled(b, 'ind_use_rsi') ? rsiFactor(tf, 2) : null,
            enabled(b, 'ind_use_macd') ? macdFactor(tf, 2) : null,
            enabled(b, 'ind_use_stochastic') ? stochFactor(tf, 2) : null,
            enabled(b, 'ind_use_bollinger') ? bollingerFactor(tf, 2, true) : null,
            enabled(b, 'ind_use_candlestick') ? patternFactor(tf, 1) : null,
        ].filter(Boolean) as Factor[];
    },

    SWING: (s, b) => {
        const tf = s.entry, htf = s.higher ?? s.entry;
        return [
            enabled(b, 'ind_use_structure') ? structureFactor(htf, 4) : null,
            enabled(b, 'ind_use_ema') ? emaFactor(tf, 3) : null,
            enabled(b, 'ind_use_adx') ? adxFactor(tf, 2, b.min_adx ?? 22) : null,
            enabled(b, 'ind_use_rsi') ? divergenceFactor(tf, 3) : null,
            enabled(b, 'ind_use_macd') ? macdFactor(tf, 2) : null,
            enabled(b, 'ind_use_structure') ? zoneFactor(htf, s.price, htf.atr, 3) : null,
            enabled(b, 'ind_use_candlestick') ? patternFactor(tf, 2) : null,
            enabled(b, 'ind_use_bollinger') ? bollingerFactor(tf, 1, false) : null,
        ].filter(Boolean) as Factor[];
    },

    DAY_TRADING: (s, b) => {
        const tf = s.entry;
        return [
            enabled(b, 'ind_use_ema') ? emaFactor(tf, 3) : null,
            enabled(b, 'ind_use_vwap') ? vwapFactor(tf, 2) : null,
            enabled(b, 'ind_use_structure') ? structureFactor(tf, 3) : null,
            enabled(b, 'ind_use_rsi') ? rsiFactor(tf, 2) : null,
            enabled(b, 'ind_use_macd') ? macdFactor(tf, 2) : null,
            enabled(b, 'ind_use_structure') ? zoneFactor(tf, s.price, tf.atr, 2) : null,
            enabled(b, 'ind_use_candlestick') ? patternFactor(tf, 2) : null,
            enabled(b, 'ind_use_stochastic') ? stochFactor(tf, 1) : null,
        ].filter(Boolean) as Factor[];
    },

    PRICE_ACTION: (s, b) => {
        const tf = s.entry;
        return [
            enabled(b, 'ind_use_structure') ? structureFactor(tf, 4) : null,
            enabled(b, 'ind_use_liquidity') ? liquidityFactor(tf, 3) : null,
            enabled(b, 'ind_use_candlestick') ? patternFactor(tf, 3) : null,
            enabled(b, 'ind_use_structure') ? zoneFactor(tf, s.price, tf.atr, 3) : null,
            enabled(b, 'ind_use_fibonacci') ? fibonacciFactor(tf, s.price, tf.atr, 2) : null,
        ].filter(Boolean) as Factor[];
    },

    PATTERN_TRADING: (s, b) => {
        const tf = s.entry;
        return [
            enabled(b, 'ind_use_candlestick') ? patternFactor(tf, 4) : null,
            enabled(b, 'ind_use_structure') ? structureFactor(tf, 3) : null,
            enabled(b, 'ind_use_structure') ? zoneFactor(tf, s.price, tf.atr, 3) : null,
            enabled(b, 'ind_use_ema') ? emaFactor(tf, 2) : null,
        ].filter(Boolean) as Factor[];
    },

    CANDLESTICK: (s, b) => {
        const tf = s.entry;
        return [
            patternFactor(tf, 5),
            enabled(b, 'ind_use_structure') ? structureFactor(tf, 3) : null,
            enabled(b, 'ind_use_ema') ? emaFactor(tf, 2) : null,
            enabled(b, 'ind_use_structure') ? zoneFactor(tf, s.price, tf.atr, 2) : null,
        ].filter(Boolean) as Factor[];
    },

    HYBRID_ALL: (s, b) => {
        const tf = s.entry;
        const mr = tf.regime === 'RANGING';
        return [
            enabled(b, 'ind_use_structure') ? structureFactor(tf, 3) : null,
            enabled(b, 'ind_use_ema') ? emaFactor(tf, 3) : null,
            enabled(b, 'ind_use_rsi') ? rsiFactor(tf, 2) : null,
            enabled(b, 'ind_use_macd') ? macdFactor(tf, 2) : null,
            enabled(b, 'ind_use_adx') ? adxFactor(tf, 2, b.min_adx ?? 20) : null,
            enabled(b, 'ind_use_stochastic') ? stochFactor(tf, 1) : null,
            enabled(b, 'ind_use_cci') ? { key: 'cci', label: 'CCI', weight: 1,
                direction: (tf.cci === null ? 'NONE' : tf.cci > 100 ? 'BULLISH' : tf.cci < -100 ? 'BEARISH' : 'NONE') as Factor['direction'],
                detail: tf.cci === null ? 'n/a' : `CCI ${tf.cci.toFixed(1)}` } : null,
            enabled(b, 'ind_use_bollinger') ? bollingerFactor(tf, 1, mr) : null,
            enabled(b, 'ind_use_candlestick') ? patternFactor(tf, 2) : null,
            enabled(b, 'ind_use_liquidity') ? liquidityFactor(tf, 2) : null,
            enabled(b, 'ind_use_structure') ? zoneFactor(tf, s.price, tf.atr, 2) : null,
        ].filter(Boolean) as Factor[];
    },

    GOLD_XAUUSD: (s, b) => {
        const tf = s.entry;
        return [
            enabled(b, 'ind_use_structure') ? structureFactor(tf, 3) : null,
            enabled(b, 'ind_use_ema') ? emaFactor(tf, 3) : null,
            enabled(b, 'ind_use_adx') ? adxFactor(tf, 2, b.min_adx ?? 22) : null,
            enabled(b, 'ind_use_rsi') ? rsiFactor(tf, 2) : null,
            enabled(b, 'ind_use_macd') ? macdFactor(tf, 2) : null,
            enabled(b, 'ind_use_structure') ? zoneFactor(tf, s.price, tf.atr, 2) : null,
            enabled(b, 'ind_use_candlestick') ? patternFactor(tf, 2) : null,
            enabled(b, 'ind_use_stochastic') ? stochFactor(tf, 1) : null,
        ].filter(Boolean) as Factor[];
    },

    SILVER_XAGUSD: (s, b) => FACTOR_SETS.GOLD_XAUUSD(s, b),

    SP500_AI: (s, b) => {
        const tf = s.entry;
        const f: Factor[] = [];
        if (enabled(b, 'sp500_use_ha')) f.push({
            key: 'ha', label: 'Heikin Ashi', weight: 3,
            direction: tf.haBullish ? 'BULLISH' : tf.haBearish ? 'BEARISH' : 'NONE',
            detail: tf.haBullish ? 'bullish' : tf.haBearish ? 'bearish' : 'flat',
        });
        if (enabled(b, 'sp500_use_ssl')) f.push({
            key: 'ssl', label: 'SSL channel', weight: 3,
            direction: tf.sslBullish ? 'BULLISH' : tf.sslBearish ? 'BEARISH' : 'NONE',
            detail: tf.sslBullish ? 'bullish' : tf.sslBearish ? 'bearish' : 'flat',
        });
        if (enabled(b, 'sp500_use_ai_rsi')) f.push(rsiFactor(tf, 2));
        if (enabled(b, 'sp500_use_tmo')) f.push(macdFactor(tf, 2));
        f.push({
            key: 'cmo', label: 'CMO', weight: 2,
            direction: tf.cmo === null ? 'NONE' : tf.cmo > 50 ? 'BEARISH' : tf.cmo < -50 ? 'BULLISH' : 'NONE',
            detail: tf.cmo === null ? 'n/a' : `CMO ${tf.cmo.toFixed(1)}`,
        });
        return f;
    },
};

// ─── Stop placement ─────────────────────────────────────────────────────────

/**
 * Real ATR-based stop, widened to sit beyond the nearest structural level so it
 * isn't parked exactly where everyone else's is. Returns PRICE distances.
 */
function computeStops(
    snap: MarketSnapshot, bot: BotSettings, direction: 'BUY' | 'SELL',
): { stopDistance: number | null; targetDistance: number | null; basis: string } {
    const tf = snap.entry;
    const atrVal = tf.atr;

    if (bot.sl_tp_mode === 'FIXED') {
        const pip = snap.spec.pipSize;
        if (!Number.isFinite(pip)) return { stopDistance: null, targetDistance: null, basis: 'unknown instrument' };
        return {
            stopDistance: (bot.stop_loss_pips ?? 30) * pip,
            targetDistance: (bot.take_profit_pips ?? 60) * pip,
            basis: `fixed ${bot.stop_loss_pips ?? 30}/${bot.take_profit_pips ?? 60} pips`,
        };
    }

    if (atrVal === null || atrVal === 0) return { stopDistance: null, targetDistance: null, basis: 'ATR unavailable' };

    const slMult = bot.atr_multiplier_sl ?? 1.5;
    const tpMult = bot.atr_multiplier_tp ?? 3.0;
    let stopDistance = atrVal * slMult;
    let basis = `${slMult}× ATR (${atrVal.toFixed(5)})`;

    // Push the stop beyond the nearest opposing structure level if that level
    // sits within our ATR stop — being stopped just before a level is the most
    // avoidable loss there is.
    const levels = direction === 'BUY' ? tf.structure.supportLevels : tf.structure.resistanceLevels;
    const price = snap.price;
    for (const lvl of levels) {
        const dist = Math.abs(price - lvl);
        if (dist < stopDistance && dist > 0) {
            const widened = dist + atrVal * 0.25;
            if (widened > stopDistance && widened < atrVal * (slMult * 2)) {
                stopDistance = widened;
                basis = `${slMult}× ATR widened beyond structure at ${lvl.toFixed(5)}`;
            }
            break;
        }
    }

    return { stopDistance, targetDistance: atrVal * tpMult, basis };
}

// ─── Main evaluation ────────────────────────────────────────────────────────

export function evaluateStrategy(snap: MarketSnapshot, bot: BotSettings): StrategyResult {
    const strategy = bot.strategy_type || 'AI_PREDICTIVE';
    const build = FACTOR_SETS[strategy] || FACTOR_SETS.AI_PREDICTIVE;
    const factors = build(snap, bot);

    const availableWeight = factors.reduce((a, f) => a + f.weight, 0);
    let bull = 0, bear = 0;
    for (const f of factors) {
        if (f.direction === 'BULLISH') bull += f.weight;
        if (f.direction === 'BEARISH') bear += f.weight;
    }

    const blockedBy: string[] = [];

    // ── Hard gates ──────────────────────────────────────────────────────────
    // Only FATAL data problems veto a signal. Missing higher-timeframe context
    // is handled by `confidenceMultiplier` below instead of stopping the bot.
    if (!snap.dataQuality.ok) blockedBy.push(...snap.dataQuality.fatal);
    if ((bot.avoid_rollover !== false) && snap.inRollover) blockedBy.push('Inside rollover window — spreads unreliable');

    const minSessQ = bot.min_session_quality ?? 0;
    if (snap.spec.category !== 'CRYPTO' && snap.sessionQuality < minSessQ) {
        blockedBy.push(`Session ${snap.session} below minimum liquidity quality`);
    }

    if (snap.entry.regime === 'VOLATILE') {
        blockedBy.push('Volatile regime — ATR far above its own average');
    }

    const net = bull - bear;
    const direction: SignalType = net > 0 ? 'BUY' : net < 0 ? 'SELL' : 'NEUTRAL';

    // Higher-timeframe alignment gate (default ON — this is the single most
    // effective filter in the whole system)
    if (bot.require_htf_alignment !== false && direction !== 'NEUTRAL' && (snap.higher || snap.daily)) {
        const want = direction === 'BUY' ? 'BULLISH' : 'BEARISH';
        if (snap.htfBias !== 'NEUTRAL' && snap.htfBias !== want) {
            blockedBy.push(`Higher-timeframe bias is ${snap.htfBias}, signal is ${direction}`);
        }
    }

    const winning = direction === 'BUY' ? bull : bear;
    const losing = direction === 'BUY' ? bear : bull;

    // Confidence = share of available weight in the winning direction, scaled
    // by session liquidity and data quality. The previous formula subtracted
    // opposing weight, which made it nearly impossible to reach typical bot
    // thresholds (60-75%) even with strong confluence — a setup with 70% of
    // indicators agreeing and 30% opposing scored only ~36%.
    let confidence = 0;
    if (availableWeight > 0 && direction !== 'NEUTRAL') {
        const agreement = winning / availableWeight;
        confidence = Math.max(0, Math.min(1, agreement)) * 100;
        if (snap.spec.category !== 'CRYPTO' && bot.ind_use_session_timing !== false) confidence *= snap.sessionQuality;
        confidence *= snap.dataQuality.confidenceMultiplier;
    }
    confidence = Math.round(confidence);

    const stops = direction === 'NEUTRAL'
        ? { stopDistance: null, targetDistance: null, basis: 'n/a' }
        : computeStops(snap, bot, direction);

    // Reject setups whose stop is not meaningfully bigger than the cost of
    // entering. A 4-pip stop on a 3-pip spread is not a trade.
    if (stops.stopDistance !== null && Number.isFinite(snap.spec.pipSize)) {
        const stopPips = stops.stopDistance / snap.spec.pipSize;
        if (stopPips < snap.spec.typicalSpread * 3) {
            blockedBy.push(`Stop ${stopPips.toFixed(1)} pips is under 3× typical spread (${snap.spec.typicalSpread})`);
        }
    }

    const finalType: SignalType = blockedBy.length > 0 ? 'NEUTRAL' : direction;

    const reasons = factors
        .filter(f => f.direction !== 'NONE')
        .sort((a, b) => b.weight - a.weight)
        .map(f => `${f.label}: ${f.detail} → ${f.direction} (w${f.weight})`);

    return {
        type: finalType,
        confidence: finalType === 'NEUTRAL' ? 0 : confidence,
        rawScore: net,
        availableWeight,
        factors,
        reasons,
        blockedBy,
        stopDistance: stops.stopDistance,
        targetDistance: stops.targetDistance,
        stopBasis: stops.basis,
    };
}

export const SUPPORTED_STRATEGIES = Object.keys(FACTOR_SETS);