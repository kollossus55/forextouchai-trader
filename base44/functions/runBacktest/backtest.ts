// ════════════════════════════════════════════════════════════════════════════
// Backtester
// ════════════════════════════════════════════════════════════════════════════
// Replaces a function that never loaded a candle and produced results from
// `Math.random()` against hardcoded per-strategy win rates. That version could
// not produce a losing result: a 60% win rate at 2:1 reward:risk is +0.8R of
// expectancy per trade.
//
// Rules this implementation holds to:
//
//  1. NO LOOKAHEAD. The signal at bar i sees bars 0..i only, and fills happen
//     at bar i+1's open. This is the single most common way a retail backtest
//     produces a fantasy equity curve.
//  2. COSTS ARE REAL. Spread on entry and exit, commission per side, and swap
//     on positions held through rollover. On short-timeframe strategies costs
//     frequently exceed gross edge entirely.
//  3. PESSIMISTIC INTRABAR RESOLUTION. When a bar's range contains both the
//     stop and the target, the STOP is assumed to have been hit first. Without
//     this rule a backtest systematically overstates its win rate.
//  4. HONEST METRICS. True Sharpe from the standard deviation of returns, plus
//     the numbers that reveal fragility: longest losing streak, and P&L with
//     the single best trade removed.
// ════════════════════════════════════════════════════════════════════════════

import { Candle } from './indicators.ts';
import { InstrumentSpec } from './instruments.ts';
import { buildMarketSnapshot } from './analysis.ts';
import { evaluateStrategy, BotSettings } from './strategies.ts';
import { computeLotSize } from './risk.ts';

export interface BacktestCosts {
    spreadPips: number;          // round-trip cost is applied on entry
    commissionPerLotPerSide: number;
    swapLongPerLotPerDay: number;
    swapShortPerLotPerDay: number;
    slippagePips: number;
}

export interface BacktestConfig {
    initialBalance: number;
    accountCurrency: string;
    riskPercent: number;
    maxPositionSizePercent: number;
    leverage: number;
    costs: BacktestCosts;
    minConfidence: number;
    maxConcurrent: number;
    warmupBars: number;
}

export interface BacktestTrade {
    entryTime: number;
    exitTime: number;
    direction: 'BUY' | 'SELL';
    entryPrice: number;
    exitPrice: number;
    stopLoss: number;
    takeProfit: number;
    lots: number;
    grossPnl: number;
    costs: number;
    netPnl: number;
    rMultiple: number;
    barsHeld: number;
    exitReason: 'STOP' | 'TARGET' | 'END_OF_DATA';
    confidence: number;
    reasons: string[];
}

export interface BacktestResult {
    symbol: string;
    strategy: string;
    barsProcessed: number;
    signalsGenerated: number;
    signalsTaken: number;
    signalsRejected: Record<string, number>;

    trades: BacktestTrade[];
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;

    initialBalance: number;
    finalBalance: number;
    netPnl: number;
    returnPercent: number;
    grossProfit: number;
    grossLoss: number;
    totalCosts: number;
    profitFactor: number;
    expectancyR: number;

    maxDrawdownPercent: number;
    maxDrawdownAbsolute: number;
    longestLosingStreak: number;
    sharpeRatio: number;
    sortinoRatio: number;

    netPnlExcludingBestTrade: number;
    avgWin: number;
    avgLoss: number;
    avgBarsHeld: number;

    equityCurve: { time: number; equity: number }[];
    periodStart: number;
    periodEnd: number;
    warnings: string[];
}

interface OpenTrade {
    entryIndex: number;
    entryTime: number;
    direction: 'BUY' | 'SELL';
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    lots: number;
    riskAmount: number;
    entryCost: number;
    confidence: number;
    reasons: string[];
}

const TF_SECONDS: Record<string, number> = {
    M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D1: 86400, W1: 604800,
};

export const DEFAULT_COSTS: BacktestCosts = {
    spreadPips: 1.5,
    commissionPerLotPerSide: 3.5,
    swapLongPerLotPerDay: -2.0,
    swapShortPerLotPerDay: -2.0,
    slippagePips: 0.3,
};

/**
 * Align higher-timeframe candles to a given point in time WITHOUT looking
 * ahead: returns only bars that had already closed at `asOfTime`.
 */
function htfSlice(candles: Candle[], asOfTime: number): Candle[] {
    let hi = candles.length;
    let lo = 0;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (candles[mid].time <= asOfTime) lo = mid + 1; else hi = mid;
    }
    return candles.slice(0, lo);
}

export function runBacktest(
    symbol: string,
    spec: InstrumentSpec,
    candlesByTf: Record<string, Candle[]>,
    entryTf: string,
    higherTf: string,
    bot: BotSettings,
    config: BacktestConfig,
): BacktestResult {

    const warnings: string[] = [];
    const bars = candlesByTf[entryTf] || [];
    const trades: BacktestTrade[] = [];
    const rejected: Record<string, number> = {};
    const equityCurve: { time: number; equity: number }[] = [];

    let balance = config.initialBalance;
    let peak = balance;
    let maxDdAbs = 0, maxDdPct = 0;
    let signalsGenerated = 0, signalsTaken = 0;
    let open: OpenTrade | null = null;

    const pip = spec.pipSize;
    const barSeconds = TF_SECONDS[entryTf] || 3600;

    if (bars.length < config.warmupBars + 50) {
        warnings.push(`Only ${bars.length} bars — need at least ${config.warmupBars + 50}. Results are not meaningful.`);
    }
    if (!Number.isFinite(pip)) {
        warnings.push(`Unknown instrument ${symbol} — cannot backtest.`);
        return emptyResult(symbol, bot, config, warnings);
    }

    const reject = (k: string) => { rejected[k] = (rejected[k] || 0) + 1; };

    // Costs, expressed per lot
    const spreadCostPerLot = (config.costs.spreadPips + config.costs.slippagePips) * spec.pipValuePerLot;
    const commissionPerLot = config.costs.commissionPerLotPerSide * 2;

    for (let i = config.warmupBars; i < bars.length - 1; i++) {
        const bar = bars[i];
        const nextBar = bars[i + 1];

        // ── 1. Manage the open position on THIS bar ────────────────────────
        if (open) {
            const hitStop = open.direction === 'BUY' ? bar.low <= open.stopLoss : bar.high >= open.stopLoss;
            const hitTarget = open.direction === 'BUY' ? bar.high >= open.takeProfit : bar.low <= open.takeProfit;

            let exitPrice: number | null = null;
            let exitReason: BacktestTrade['exitReason'] | null = null;

            // Pessimistic: if both are inside the bar's range, assume the stop
            // was reached first. We have no intrabar data to prove otherwise,
            // and assuming the favourable order inflates the win rate.
            if (hitStop) { exitPrice = open.stopLoss; exitReason = 'STOP'; }
            else if (hitTarget) { exitPrice = open.takeProfit; exitReason = 'TARGET'; }

            if (exitPrice !== null && exitReason !== null) {
                const barsHeld = i - open.entryIndex;
                const daysHeld = Math.max(0, (bar.time - open.entryTime) / 86400);
                const swapRate = open.direction === 'BUY'
                    ? config.costs.swapLongPerLotPerDay : config.costs.swapShortPerLotPerDay;
                const swap = swapRate * open.lots * daysHeld;

                const priceMove = open.direction === 'BUY'
                    ? exitPrice - open.entryPrice
                    : open.entryPrice - exitPrice;
                const grossPnl = (priceMove / pip) * spec.pipValuePerLot * open.lots;
                const costs = open.entryCost - swap;   // swap is negative → adds to cost
                const netPnl = grossPnl - costs;

                balance += netPnl;
                trades.push({
                    entryTime: open.entryTime, exitTime: bar.time,
                    direction: open.direction,
                    entryPrice: open.entryPrice, exitPrice,
                    stopLoss: open.stopLoss, takeProfit: open.takeProfit,
                    lots: open.lots, grossPnl, costs, netPnl,
                    rMultiple: open.riskAmount > 0 ? netPnl / open.riskAmount : 0,
                    barsHeld, exitReason,
                    confidence: open.confidence, reasons: open.reasons,
                });
                open = null;

                if (balance > peak) peak = balance;
                const dd = peak - balance;
                if (dd > maxDdAbs) maxDdAbs = dd;
                const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
                if (ddPct > maxDdPct) maxDdPct = ddPct;
            }
        }

        if (i % 10 === 0) equityCurve.push({ time: bar.time, equity: Math.round(balance * 100) / 100 });

        // ── 2. Look for a new signal, using bars 0..i ONLY ─────────────────
        if (open) continue;
        if (balance <= 0) { warnings.push('Account reached zero — simulation halted.'); break; }

        const slice: Record<string, Candle[]> = { [entryTf]: bars.slice(0, i + 1) };
        for (const tf of Object.keys(candlesByTf)) {
            if (tf === entryTf) continue;
            slice[tf] = htfSlice(candlesByTf[tf], bar.time);
        }

        // `nowSeconds` is the bar being analysed — never wall-clock time, or
        // every historical bar would be judged stale and nothing would trade.
        const snap = buildMarketSnapshot(symbol, spec, slice, entryTf, higherTf, { nowSeconds: bar.time });
        if (!snap) { reject('no_snapshot'); continue; }

        const result = evaluateStrategy(snap, bot);
        if (result.type === 'NEUTRAL') {
            reject(result.blockedBy.length ? result.blockedBy[0].slice(0, 60) : 'no_direction');
            continue;
        }
        signalsGenerated++;

        if (result.confidence < config.minConfidence) { reject('below_min_confidence'); continue; }
        if (result.stopDistance === null || result.targetDistance === null) { reject('no_stop_distance'); continue; }

        // ── 3. Fill at the NEXT bar's open, plus spread and slippage ───────
        const rawFill = nextBar.open;
        const costPips = config.costs.spreadPips + config.costs.slippagePips;
        const fill = result.type === 'BUY' ? rawFill + costPips * pip : rawFill - costPips * pip;

        const stopLoss = result.type === 'BUY' ? fill - result.stopDistance : fill + result.stopDistance;
        const takeProfit = result.type === 'BUY' ? fill + result.targetDistance : fill - result.targetDistance;

        const sizing = computeLotSize({
            spec, entryPrice: fill, stopDistance: result.stopDistance,
            balance, accountCurrency: config.accountCurrency,
            riskPercent: config.riskPercent,
            maxPositionSizePercent: config.maxPositionSizePercent,
            leverage: config.leverage,
            rates: { [spec.symbol]: fill, [`${spec.quote}${config.accountCurrency}`]: 1 },
        });
        if (!sizing.ok) { reject('sizing:' + (sizing.reason || '').slice(0, 40)); continue; }

        const entryCost = sizing.lots * (spreadCostPerLot + commissionPerLot);

        open = {
            entryIndex: i + 1,
            entryTime: nextBar.time,
            direction: result.type,
            entryPrice: fill,
            stopLoss, takeProfit,
            lots: sizing.lots,
            riskAmount: sizing.riskAmount,
            entryCost,
            confidence: result.confidence,
            reasons: result.reasons.slice(0, 4),
        };
        signalsTaken++;
    }

    // Close any runner at the last bar
    if (open && bars.length) {
        const bar = bars[bars.length - 1];
        const priceMove = open.direction === 'BUY' ? bar.close - open.entryPrice : open.entryPrice - bar.close;
        const grossPnl = (priceMove / pip) * spec.pipValuePerLot * open.lots;
        const netPnl = grossPnl - open.entryCost;
        balance += netPnl;
        trades.push({
            entryTime: open.entryTime, exitTime: bar.time, direction: open.direction,
            entryPrice: open.entryPrice, exitPrice: bar.close,
            stopLoss: open.stopLoss, takeProfit: open.takeProfit,
            lots: open.lots, grossPnl, costs: open.entryCost, netPnl,
            rMultiple: open.riskAmount > 0 ? netPnl / open.riskAmount : 0,
            barsHeld: bars.length - 1 - open.entryIndex,
            exitReason: 'END_OF_DATA', confidence: open.confidence, reasons: open.reasons,
        });
    }

    return summarise(symbol, bot, config, bars, trades, balance, maxDdAbs, maxDdPct,
        signalsGenerated, signalsTaken, rejected, equityCurve, barSeconds, warnings);
}

function summarise(
    symbol: string, bot: BotSettings, config: BacktestConfig,
    bars: Candle[], trades: BacktestTrade[], balance: number,
    maxDdAbs: number, maxDdPct: number,
    signalsGenerated: number, signalsTaken: number,
    rejected: Record<string, number>,
    equityCurve: { time: number; equity: number }[],
    barSeconds: number, warnings: string[],
): BacktestResult {

    const wins = trades.filter(t => t.netPnl > 0);
    const losses = trades.filter(t => t.netPnl <= 0);
    const grossProfit = wins.reduce((a, t) => a + t.netPnl, 0);
    const grossLoss = Math.abs(losses.reduce((a, t) => a + t.netPnl, 0));
    const totalCosts = trades.reduce((a, t) => a + t.costs, 0);
    const netPnl = balance - config.initialBalance;

    // Longest losing streak — a strategy's real-world survivability depends on
    // this at least as much as on its win rate.
    let streak = 0, longestStreak = 0;
    for (const t of trades) {
        if (t.netPnl <= 0) { streak++; if (streak > longestStreak) longestStreak = streak; }
        else streak = 0;
    }

    // True Sharpe: mean per-trade return over its standard deviation,
    // annualised by the observed trade frequency.
    const returns = trades.map(t => t.netPnl / config.initialBalance);
    const mean = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const variance = returns.length > 1
        ? returns.reduce((a, r) => a + (r - mean) ** 2, 0) / (returns.length - 1) : 0;
    const sd = Math.sqrt(variance);

    const spanSeconds = bars.length > 1 ? bars[bars.length - 1].time - bars[0].time : 0;
    const years = spanSeconds > 0 ? spanSeconds / (365.25 * 86400) : 0;
    const tradesPerYear = years > 0 ? trades.length / years : 0;
    const sharpe = sd > 0 ? (mean / sd) * Math.sqrt(Math.max(1, tradesPerYear)) : 0;

    const downside = returns.filter(r => r < 0);
    const dsd = downside.length > 1
        ? Math.sqrt(downside.reduce((a, r) => a + r ** 2, 0) / downside.length) : 0;
    const sortino = dsd > 0 ? (mean / dsd) * Math.sqrt(Math.max(1, tradesPerYear)) : 0;

    // Fragility check: how much of the result is one lucky trade?
    const best = trades.reduce((m, t) => (t.netPnl > m ? t.netPnl : m), -Infinity);
    const netExclBest = trades.length ? netPnl - (Number.isFinite(best) ? best : 0) : 0;

    if (trades.length < 30) {
        warnings.push(`Only ${trades.length} trades — too few to draw a conclusion. Aim for 100+.`);
    }
    if (totalCosts > Math.abs(netPnl) && trades.length > 0) {
        warnings.push(`Costs (${totalCosts.toFixed(2)}) exceed net P&L — this strategy is paying the broker, not you.`);
    }
    if (netPnl > 0 && netExclBest <= 0) {
        warnings.push('Removing the single best trade turns this strategy negative — the result is not robust.');
    }

    return {
        symbol, strategy: bot.strategy_type,
        barsProcessed: bars.length,
        signalsGenerated, signalsTaken, signalsRejected: rejected,
        trades,
        totalTrades: trades.length,
        wins: wins.length, losses: losses.length,
        winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
        initialBalance: config.initialBalance,
        finalBalance: balance,
        netPnl,
        returnPercent: (netPnl / config.initialBalance) * 100,
        grossProfit, grossLoss, totalCosts,
        profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0),
        expectancyR: trades.length ? trades.reduce((a, t) => a + t.rMultiple, 0) / trades.length : 0,
        maxDrawdownPercent: maxDdPct,
        maxDrawdownAbsolute: maxDdAbs,
        longestLosingStreak: longestStreak,
        sharpeRatio: sharpe,
        sortinoRatio: sortino,
        netPnlExcludingBestTrade: netExclBest,
        avgWin: wins.length ? grossProfit / wins.length : 0,
        avgLoss: losses.length ? grossLoss / losses.length : 0,
        avgBarsHeld: trades.length ? trades.reduce((a, t) => a + t.barsHeld, 0) / trades.length : 0,
        equityCurve,
        periodStart: bars.length ? bars[0].time : 0,
        periodEnd: bars.length ? bars[bars.length - 1].time : 0,
        warnings,
    };
}

function emptyResult(symbol: string, bot: BotSettings, config: BacktestConfig, warnings: string[]): BacktestResult {
    return summarise(symbol, bot, config, [], [], config.initialBalance, 0, 0, 0, 0, {}, [], 3600, warnings);
}

// ─── Walk-forward ───────────────────────────────────────────────────────────

export interface WalkForwardWindow {
    label: string;
    start: number;
    end: number;
    result: BacktestResult;
}

/**
 * Split the history into sequential out-of-sample windows and test each.
 * A strategy that only works in one window is curve-fitted to that window.
 */
export function walkForward(
    symbol: string, spec: InstrumentSpec,
    candlesByTf: Record<string, Candle[]>,
    entryTf: string, higherTf: string,
    bot: BotSettings, config: BacktestConfig,
    windows = 4,
): { windows: WalkForwardWindow[]; consistent: boolean; summary: string } {

    const bars = candlesByTf[entryTf] || [];
    const out: WalkForwardWindow[] = [];
    if (bars.length < config.warmupBars * 2) {
        return { windows: out, consistent: false, summary: 'Insufficient history for walk-forward.' };
    }

    const usable = bars.length - config.warmupBars;
    const size = Math.floor(usable / windows);

    for (let w = 0; w < windows; w++) {
        const from = config.warmupBars + w * size;
        const to = w === windows - 1 ? bars.length : from + size;
        // Each window keeps the warmup prefix so indicators are seeded, but
        // trading only begins at `from`.
        const windowBars = bars.slice(Math.max(0, from - config.warmupBars), to);
        const slice: Record<string, Candle[]> = { [entryTf]: windowBars };
        for (const tf of Object.keys(candlesByTf)) {
            if (tf === entryTf) continue;
            const startT = windowBars[0]?.time ?? 0;
            const endT = windowBars[windowBars.length - 1]?.time ?? 0;
            slice[tf] = candlesByTf[tf].filter(c => c.time >= startT - 86400 * 30 && c.time <= endT);
        }
        const r = runBacktest(symbol, spec, slice, entryTf, higherTf, bot, config);
        out.push({
            label: `Window ${w + 1}/${windows}`,
            start: windowBars[0]?.time ?? 0,
            end: windowBars[windowBars.length - 1]?.time ?? 0,
            result: r,
        });
    }

    const profitable = out.filter(w => w.result.netPnl > 0).length;
    const consistent = profitable >= Math.ceil(windows * 0.75) && out.every(w => w.result.totalTrades > 0);

    const summary = consistent
        ? `Profitable in ${profitable}/${windows} windows — behaviour is at least consistent across periods.`
        : `Profitable in only ${profitable}/${windows} windows — this looks period-specific rather than a real edge.`;

    return { windows: out, consistent, summary };
}
