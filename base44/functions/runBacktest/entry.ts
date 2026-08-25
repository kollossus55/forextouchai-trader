// ════════════════════════════════════════════════════════════════════════════
// runBacktest — v2
// ════════════════════════════════════════════════════════════════════════════
// The previous version never loaded a candle. It had hardcoded win rates per
// strategy name (AI_PREDICTIVE: 0.60) and generated P&L with Math.random().
// At a 60% win rate and 2:1 reward:risk that is +0.8R of expectancy per trade,
// so it could not produce a losing result — and the UI exported it as a
// "ForexTouchAI Backtest Report" with a download button.
//
// This version replays real OHLC bar by bar through the SAME strategy code the
// live signal generator uses, with no lookahead and full cost modelling.
// Expect materially worse — and finally meaningful — numbers.
// ════════════════════════════════════════════════════════════════════════════

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.43';
import { Candle } from '../_shared/indicators.ts';
import { getInstrumentSpec, normalizeSymbol, isKnownInstrument } from '../_shared/instruments.ts';
import { runBacktest, walkForward, DEFAULT_COSTS, BacktestConfig } from '../_shared/backtest.ts';
import { fetchCandlesDetailed } from '../_shared/marketData.ts';
import { BotSettings } from '../_shared/strategies.ts';

const HIGHER_TF: Record<string, string> = {
    M1: 'M15', M5: 'M30', M15: 'H1', M30: 'H4',
    H1: 'H4', H4: 'D1', D1: 'W1', W1: 'W1',
};

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

        const body = await req.json();
        const {
            botId,
            symbol,
            timeframe,
            initialBalance = 10000,
            riskPercent,
            walkForwardWindows = 4,
            costs: costOverrides,
        } = body;

        if (!botId) return Response.json({ error: 'botId is required' }, { status: 400 });

        const bots = await base44.entities.BotConfig.filter({ id: botId });
        if (!bots?.length) return Response.json({ error: 'Bot not found' }, { status: 404 });
        const bot = bots[0];

        const rawSymbol = symbol || (bot.pairs || [])[0];
        if (!rawSymbol) return Response.json({ error: 'No symbol on this bot to test' }, { status: 400 });

        const sym = normalizeSymbol(rawSymbol);
        if (!isKnownInstrument(sym)) {
            return Response.json({
                error: `Unknown instrument "${rawSymbol}". Add it to the instrument table in ` +
                       `_shared/instruments.ts before backtesting — pip size cannot be guessed.`,
            }, { status: 400 });
        }

        const spec = getInstrumentSpec(sym);
        const tf = timeframe || bot.timeframe || 'H1';
        const higher = HIGHER_TF[tf] || 'H4';

        // ── Load real history ───────────────────────────────────────────────
        const wanted = Array.from(new Set([tf, higher, 'D1']));
        const fetched = await Promise.all(
            wanted.map(t => fetchCandlesDetailed(base44, sym, t)
                .catch((e: any) => ({ candles: [] as Candle[], source: 'NONE' as const, warning: e.message }))),
        );

        const candlesByTf: Record<string, Candle[]> = {};
        const dataWarnings: string[] = [];
        wanted.forEach((t, i) => {
            if (fetched[i].candles.length) candlesByTf[t] = fetched[i].candles;
            if (fetched[i].warning) dataWarnings.push(fetched[i].warning as string);
        });

        const entryBars = candlesByTf[tf] || [];
        if (entryBars.length < 400) {
            return Response.json({
                error: `Only ${entryBars.length} ${tf} bars available for ${sym}. ` +
                       `A backtest needs at least 400 (250 warmup + 150 tradeable) to mean anything.`,
                dataWarnings,
            }, { status: 422 });
        }

        // ── Risk settings ───────────────────────────────────────────────────
        const riskRows = await base44.entities.RiskManagementSettings.list('-created_date', 20).catch(() => []);
        const risk = riskRows.find((r: any) => !r.account_number) || riskRows[0] || {};

        const config: BacktestConfig = {
            initialBalance: Number(initialBalance) || 10000,
            accountCurrency: 'USD',
            riskPercent: Number(riskPercent) || risk.risk_per_trade_percent || 1,
            maxPositionSizePercent: risk.max_position_size_percent ?? 10,
            leverage: 100,
            costs: {
                // Default to the instrument's own typical spread rather than a
                // flat optimistic number.
                spreadPips: costOverrides?.spreadPips ?? spec.typicalSpread,
                commissionPerLotPerSide: costOverrides?.commissionPerLotPerSide ?? DEFAULT_COSTS.commissionPerLotPerSide,
                swapLongPerLotPerDay: costOverrides?.swapLongPerLotPerDay ?? DEFAULT_COSTS.swapLongPerLotPerDay,
                swapShortPerLotPerDay: costOverrides?.swapShortPerLotPerDay ?? DEFAULT_COSTS.swapShortPerLotPerDay,
                slippagePips: costOverrides?.slippagePips ?? DEFAULT_COSTS.slippagePips,
            },
            minConfidence: bot.min_confidence ?? 60,
            maxConcurrent: 1,
            warmupBars: 250,
        };

        const botSettings = bot as BotSettings;

        // ── Full-period run ─────────────────────────────────────────────────
        const full = runBacktest(sym, spec, candlesByTf, tf, higher, botSettings, config);

        // ── Walk-forward ────────────────────────────────────────────────────
        const wf = walkForward(sym, spec, candlesByTf, tf, higher, botSettings, config,
            Math.max(2, Math.min(6, Number(walkForwardWindows) || 4)));

        const dataSource = fetched[wanted.indexOf(tf)]?.source || 'UNKNOWN';

        return Response.json({
            success: true,
            meta: {
                symbol: sym,
                timeframe: tf,
                higherTimeframe: higher,
                strategy: bot.strategy_type,
                dataSource,
                barsAvailable: entryBars.length,
                periodStart: new Date(full.periodStart * 1000).toISOString(),
                periodEnd: new Date(full.periodEnd * 1000).toISOString(),
                costsApplied: config.costs,
                riskPercent: config.riskPercent,
                simulated: false,
                methodology:
                    'Bar-by-bar replay of the live strategy code. Signals see only closed bars up to ' +
                    'the decision point; fills occur at the next bar open plus spread and slippage. ' +
                    'When a bar contains both stop and target, the stop is assumed hit first.',
            },
            results: {
                totalTrades: full.totalTrades,
                winRate: round2(full.winRate),
                winningTrades: full.wins,
                losingTrades: full.losses,
                totalPnl: round2(full.netPnl),
                returnPercent: round2(full.returnPercent),
                profitFactor: Number.isFinite(full.profitFactor) ? round2(full.profitFactor) : null,
                expectancyR: round2(full.expectancyR),
                maxDrawdown: round2(full.maxDrawdownPercent),
                maxDrawdownAbsolute: round2(full.maxDrawdownAbsolute),
                longestLosingStreak: full.longestLosingStreak,
                sharpeRatio: round2(full.sharpeRatio),
                sortinoRatio: round2(full.sortinoRatio),
                grossProfit: round2(full.grossProfit),
                grossLoss: round2(full.grossLoss),
                totalCosts: round2(full.totalCosts),
                netPnlExcludingBestTrade: round2(full.netPnlExcludingBestTrade),
                avgWin: round2(full.avgWin),
                avgLoss: round2(full.avgLoss),
                avgBarsHeld: round2(full.avgBarsHeld),
                finalBalance: round2(full.finalBalance),
                equityCurve: full.equityCurve,
                signalsGenerated: full.signalsGenerated,
                signalsTaken: full.signalsTaken,
                rejectionReasons: topRejections(full.signalsRejected),
            },
            walkForward: {
                consistent: wf.consistent,
                summary: wf.summary,
                windows: wf.windows.map(w => ({
                    label: w.label,
                    start: w.start ? new Date(w.start * 1000).toISOString().slice(0, 10) : null,
                    end: w.end ? new Date(w.end * 1000).toISOString().slice(0, 10) : null,
                    trades: w.result.totalTrades,
                    winRate: round2(w.result.winRate),
                    returnPercent: round2(w.result.returnPercent),
                    profitFactor: Number.isFinite(w.result.profitFactor) ? round2(w.result.profitFactor) : null,
                    maxDrawdown: round2(w.result.maxDrawdownPercent),
                })),
            },
            trades: full.trades.slice(-200).map(t => ({
                entryTime: new Date(t.entryTime * 1000).toISOString(),
                exitTime: new Date(t.exitTime * 1000).toISOString(),
                direction: t.direction,
                entryPrice: t.entryPrice,
                exitPrice: t.exitPrice,
                lots: t.lots,
                netPnl: round2(t.netPnl),
                costs: round2(t.costs),
                rMultiple: round2(t.rMultiple),
                exitReason: t.exitReason,
                confidence: t.confidence,
                reasons: t.reasons,
            })),
            warnings: [...dataWarnings, ...full.warnings],
        });

    } catch (error: any) {
        console.error('[runBacktest ERROR]', error.message, error.stack);
        return Response.json({ error: error.message }, { status: 500 });
    }
});

function round2(n: number): number {
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function topRejections(map: Record<string, number>): { reason: string; count: number }[] {
    return Object.entries(map)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([reason, count]) => ({ reason, count }));
}
