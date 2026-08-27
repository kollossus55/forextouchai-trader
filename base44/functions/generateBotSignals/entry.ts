// ════════════════════════════════════════════════════════════════════════════
// generateBotSignals — v2.1 (confidence formula fix)
// ════════════════════════════════════════════════════════════════════════════
// WHAT CHANGED AND WHY
//
// The previous version sent a language model one line of text — "EURUSD: 1.0843"
// — plus ~1,300 lines of prompt asking it to detect D1 regime, map H4 order
// blocks, find fair value gaps, read the EMA 20/50/200 stack and return an RSI
// value. With no candles, no highs, no lows and no history, every one of those
// outputs was invented. The `rsi` stored in calculated_indicators was not a
// calculation.
//
// This version computes all of it from real OHLC using the shared engine in
// ../_shared. The language model is now OPTIONAL and, when enabled, receives
// only COMPUTED values to weigh — it is never asked to imagine data, it cannot
// change the direction, and it can only LOWER confidence, never raise it.
//
// Also fixed here:
//   • Position size derives from risk % and the real stop distance, so
//     `risk_per_trade_percent` finally does something. It was previously read
//     nowhere in the automated path despite having a UI slider.
//   • max_daily_trades counts the actual day, not the last 30 minutes.
//   • Correlation-aware exposure limits — ten USD-quoted longs are one large
//     short-USD position, not ten independent trades.
//   • The "orphan account" fallback is DELETED. It assigned the same unclaimed
//     live account to every bot owner lacking a connection, so one user's bot
//     could place trades in another user's broker account.
//   • ATR is a real Wilder ATR, not `price * 0.007`.
// ════════════════════════════════════════════════════════════════════════════

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.43';
import { Candle } from './indicators.ts';
import { getInstrumentSpec, normalizeSymbol, isKnownInstrument } from './instruments.ts';
import { buildMarketSnapshot, MarketSnapshot } from './analysis.ts';
import { evaluateStrategy, BotSettings, StrategyResult } from './strategies.ts';
import {
    computeLotSize, checkExposureLimits, validateStops,
    OpenPosition, ExposureLimits, DEFAULT_EXPOSURE_LIMITS,
} from './risk.ts';
import { fetchCandlesDetailed } from './marketData.ts';

const HIGHER_TF: Record<string, string> = {
    M1: 'M15', M5: 'M30', M15: 'H1', M30: 'H4',
    H1: 'H4', H4: 'D1', D1: 'W1', W1: 'W1',
};

interface SignalDraft {
    pair: string;
    type: 'BUY' | 'SELL';
    entry_price: number;
    stop_loss: number;
    take_profit: number;
    confidence: number;
    lot_size: number;
    strategy: string;
    bot_id: string;
    status: string;
    result_pnl: number;
    owner_email: string;
    risk_amount: number;
    stop_pips: number;
    data_source: string;
    calculated_indicators: Record<string, unknown>;
}

Deno.serve(async (req) => {
    const startedAt = Date.now();
    const diagnostics: string[] = [];

    try {
        const base44 = createClientFromRequest(req);

        // ── Auth: admin only (everything below runs with service-role) ──────
        let caller: any;
        try { caller = await base44.auth.me(); }
        catch { return Response.json({ error: 'Unauthorized' }, { status: 401 }); }
        if (!caller || caller.role !== 'admin') {
            return Response.json({ error: 'Forbidden — admin only' }, { status: 403 });
        }

        const [bots, openTrades, pendingSignals, activeSignals, riskSettingsList, brokerConnections] =
            await Promise.all([
                base44.asServiceRole.entities.BotConfig.filter({ status: 'RUNNING' }, '-created_date', 50),
                base44.asServiceRole.entities.Trade.filter({ status: 'OPEN' }, '-created_date', 200),
                base44.asServiceRole.entities.Signal.filter({ status: 'PENDING' }, '-created_date', 200),
                base44.asServiceRole.entities.Signal.filter({ status: 'ACTIVE' }, '-created_date', 200),
                base44.asServiceRole.entities.RiskManagementSettings.list('-created_date', 100),
                base44.asServiceRole.entities.BrokerConnection.list('-updated_date', 50),
            ]);

        if (!bots.length) {
            return Response.json({ success: true, message: 'No running bots', signals_created: 0 });
        }

        // ── Expire stale signals ────────────────────────────────────────────
        const nowMs = Date.now();
        const twentyMinAgo = new Date(nowMs - 20 * 60_000).toISOString();
        const thirtyMinAgo = new Date(nowMs - 30 * 60_000).toISOString();
        const toExpire = [
            ...activeSignals.filter((s: any) => s.created_date < twentyMinAgo),
            ...pendingSignals.filter((s: any) => s.created_date < thirtyMinAgo),
        ];
        if (toExpire.length) {
            await Promise.all(toExpire.map((s: any) =>
                base44.asServiceRole.entities.Signal.update(s.id, { status: 'EXPIRED' })
                    .catch((e: any) => console.warn('[gen] expire failed', s.id, e.message))));
            diagnostics.push(`Expired ${toExpire.length} stale signal(s)`);
        }

        // ── Risk settings per account ───────────────────────────────────────
        const globalRisk = riskSettingsList.find((r: any) => !r.account_number) || {};
        const riskByAccount: Record<string, any> = {};
        for (const r of riskSettingsList) if (r.account_number) riskByAccount[r.account_number] = r;
        const riskFor = (acct: string) => riskByAccount[acct] || globalRisk || {};

        // ── Live accounts, strictly owned ───────────────────────────────────
        // A connection counts only if it is CONNECTED, recently synced, AND has
        // an explicit owner_email. Unowned live accounts are REPORTED, never
        // used. Ownership of a live trading account is never inferred.
        const fiveMinAgo = new Date(nowMs - 5 * 60_000);
        const accountsByOwner: Record<string, string[]> = {};
        const connByAccount: Record<string, any> = {};
        const unownedLive: string[] = [];

        for (const conn of brokerConnections) {
            if (!conn.account_number) continue;
            connByAccount[conn.account_number] = conn;
            const live = conn.connection_status === 'CONNECTED'
                && conn.last_sync && new Date(conn.last_sync) >= fiveMinAgo;
            if (!live) continue;
            const owner = conn.owner_email;
            if (!owner || String(owner).includes('service+')) {
                unownedLive.push(conn.account_number);
                continue;
            }
            (accountsByOwner[owner] ||= []).push(conn.account_number);
        }

        if (unownedLive.length) {
            diagnostics.push(
                `${unownedLive.length} live account(s) have no owner_email and were SKIPPED: ` +
                `${unownedLive.join(', ')}. Claim them in Settings — ownership is never inferred.`,
            );
        }

        // ── Group bots by owner ─────────────────────────────────────────────
        const botsByOwner: Record<string, any[]> = {};
        for (const bot of bots) {
            const owner = bot.owner_email || bot.created_by;
            if (owner) (botsByOwner[owner] ||= []).push(bot);
        }

        // ── Today's signal count per bot (real day, not last 30 minutes) ────
        // The old code intersected "since midnight" with a list already filtered
        // to the last 20–30 minutes, so max_daily_trades never limited anything:
        // a bot capped at 5/day could fire 5 every half hour, ~240 per day.
        const todayStart = new Date();
        todayStart.setUTCHours(0, 0, 0, 0);
        const todayStartIso = todayStart.toISOString();

        let todaysSignals: any[] = [];
        try {
            todaysSignals = await base44.asServiceRole.entities.Signal
                .filter({ created_date: { $gte: todayStartIso } }, '-created_date', 1000);
        } catch {
            const recent = await base44.asServiceRole.entities.Signal.list('-created_date', 1000);
            todaysSignals = recent.filter((s: any) => s.created_date >= todayStartIso);
        }

        const dailyCount: Record<string, number> = {};
        for (const s of todaysSignals) {
            if (s.status === 'EXPIRED') continue;
            if (s.bot_id) dailyCount[s.bot_id] = (dailyCount[s.bot_id] || 0) + 1;
        }

        // ── Work out which instruments we need candles for ──────────────────
        const needed = new Map<string, { tf: string; higher: string }>();
        for (const bot of bots) {
            const tf = bot.timeframe || 'H1';
            for (const pair of (bot.pairs || [])) {
                const sym = normalizeSymbol(pair);
                if (!isKnownInstrument(sym)) {
                    diagnostics.push(`Unknown instrument "${pair}" on bot "${bot.name}" — skipped rather than guessed`);
                    continue;
                }
                const key = `${sym}|${tf}`;
                if (!needed.has(key)) needed.set(key, { tf, higher: HIGHER_TF[tf] || 'H4' });
            }
        }

        if (!needed.size) {
            return Response.json({
                success: true, signals_created: 0,
                message: 'No recognised instruments across running bots',
                diagnostics,
            });
        }

        // ── Fetch OHLC ──────────────────────────────────────────────────────
        const candleCache = new Map<string, Record<string, Candle[]>>();
        const sourceByKey = new Map<string, string>();

        await Promise.all([...needed.entries()].map(async ([key, { tf, higher }]) => {
            const sym = key.split('|')[0];
            const byTf: Record<string, Candle[]> = {};
            const wanted = Array.from(new Set([tf, higher, 'D1']));
            const results = await Promise.all(
                wanted.map(t => fetchCandlesDetailed(base44, sym, t)
                    .catch(() => ({ candles: [] as Candle[], source: 'NONE' as const, warning: null }))),
            );
            wanted.forEach((t, i) => { if (results[i].candles.length) byTf[t] = results[i].candles; });

            const entryResult = results[wanted.indexOf(tf)];
            sourceByKey.set(key, entryResult?.source || 'NONE');
            if (entryResult?.warning) diagnostics.push(entryResult.warning);

            if (!byTf[tf] || byTf[tf].length < 210) {
                diagnostics.push(`${sym} ${tf}: only ${byTf[tf]?.length ?? 0} bars — need 210 for EMA200`);
                return;
            }
            candleCache.set(key, byTf);
        }));

        // ── Build snapshots and evaluate ────────────────────────────────────
        const drafts: SignalDraft[] = [];
        const skipLog: string[] = [];

        for (const [ownerEmail, ownerBots] of Object.entries(botsByOwner)) {
            const accounts = accountsByOwner[ownerEmail] || [];
            if (!accounts.length) {
                skipLog.push(`${ownerEmail}: no live, owned broker connection`);
                continue;
            }

            const activeAccounts = accounts.filter(acct => {
                const r = riskFor(acct);
                if (r.auto_trade_enabled === false) { skipLog.push(`${acct}: auto-trade off`); return false; }
                if (r.is_trading_paused === true) { skipLog.push(`${acct}: paused by risk limits`); return false; }
                return true;
            });
            if (!activeAccounts.length) continue;

            for (const bot of ownerBots) {
                const tf = bot.timeframe || 'H1';
                const higher = HIGHER_TF[tf] || 'H4';

                if (!withinTradingHours(bot)) { skipLog.push(`${bot.name}: outside trading hours`); continue; }

                const maxDaily = bot.max_daily_trades || 0;
                if (maxDaily > 0) {
                    const queued = drafts.filter(d => d.bot_id === bot.id).length;
                    if ((dailyCount[bot.id] || 0) + queued >= maxDaily) {
                        skipLog.push(`${bot.name}: max_daily_trades ${maxDaily} reached for today`);
                        continue;
                    }
                }

                for (const rawPair of (bot.pairs || [])) {
                    const sym = normalizeSymbol(rawPair);
                    const key = `${sym}|${tf}`;
                    const byTf = candleCache.get(key);
                    if (!byTf) continue;

                    const spec = getInstrumentSpec(sym);
                    const snap = buildMarketSnapshot(sym, spec, byTf, tf, higher);
                    if (!snap) { skipLog.push(`${bot.name} ${sym}: snapshot unavailable`); continue; }

                    let result = evaluateStrategy(snap, bot as BotSettings);

                    if (bot.use_llm_confirmation === true && result.type !== 'NEUTRAL') {
                        try {
                            result = await applyLlmConfirmation(base44, snap, result);
                        } catch (e: any) {
                            console.warn('[gen] LLM confirmation failed; keeping deterministic result:', e.message);
                        }
                    }

                    if (result.type === 'NEUTRAL') {
                        skipLog.push(`${bot.name} ${sym}: ${result.blockedBy[0] || 'no directional confluence'}`);
                        continue;
                    }

                    const minConf = bot.min_confidence ?? 60;
                    if (result.confidence < minConf) {
                        skipLog.push(`${bot.name} ${sym}: confidence ${result.confidence} < ${minConf}`);
                        continue;
                    }
                    if (result.stopDistance === null || result.targetDistance === null) {
                        skipLog.push(`${bot.name} ${sym}: no stop distance available`);
                        continue;
                    }

                    const entry = snap.price;
                    const sl = result.type === 'BUY' ? entry - result.stopDistance : entry + result.stopDistance;
                    const tp = result.type === 'BUY' ? entry + result.targetDistance : entry - result.targetDistance;

                    const stopCheck = validateStops(spec, entry, sl, tp, result.type);
                    if (!stopCheck.ok) { skipLog.push(`${bot.name} ${sym}: ${stopCheck.reason}`); continue; }

                    for (const acct of activeAccounts) {
                        const conn = connByAccount[acct] || {};
                        const acctRisk = riskFor(acct);

                        const balance = Number(conn.balance) || 0;
                        if (balance <= 0) {
                            skipLog.push(`${acct}: no balance reported — refusing to size a trade`);
                            continue;
                        }

                        const acctOpen = openTrades.filter((t: any) => t.owner_email === acct);
                        const acctQueued = drafts.filter(d => d.owner_email === acct);

                        const maxConcurrent = acctRisk.max_concurrent_trades || 10;
                        if (acctOpen.length + acctQueued.length >= maxConcurrent) {
                            skipLog.push(`${acct}: at max_concurrent_trades (${maxConcurrent})`);
                            continue;
                        }

                        const botOpen = acctOpen.filter((t: any) => t.bot_id === bot.id).length
                            + acctQueued.filter(d => d.bot_id === bot.id).length;
                        if (botOpen >= (bot.max_open_trades || 5)) continue;

                        const perPair = acctOpen.filter((t: any) => normalizeSymbol(t.pair || '') === sym).length
                            + acctQueued.filter(d => normalizeSymbol(d.pair) === sym).length
                            + pendingSignals.filter((s: any) => s.owner_email === acct
                                && normalizeSymbol(s.pair || '') === sym).length;
                        if (perPair >= (bot.max_trades_per_pair || 1)) continue;

                        // ── Risk-based sizing ───────────────────────────────
                        const rates = buildRateMap(candleCache);
                        const botRiskPercent = Number(bot.risk_per_trade_percent) || 0;
                        const sizing = computeLotSize({
                            spec,
                            entryPrice: entry,
                            stopDistance: result.stopDistance,
                            balance,
                            accountCurrency: conn.currency || 'USD',
                            riskPercent: botRiskPercent > 0
                                ? botRiskPercent
                                : (acctRisk.risk_per_trade_percent ?? 1),
                            maxPositionSizePercent: acctRisk.max_position_size_percent ?? 10,
                            leverage: parseLeverage(conn.leverage),
                            rates,
                            minLot: conn.min_lot || 0.01,
                            maxLot: conn.max_lot || 100,
                            lotStep: conn.lot_step || 0.01,
                        });
                        if (!sizing.ok) { skipLog.push(`${bot.name} ${sym} @${acct}: ${sizing.reason}`); continue; }

                        // ── Correlation-aware exposure ──────────────────────
                        const existing: OpenPosition[] = [
                            ...acctOpen.map((t: any) => ({
                                symbol: normalizeSymbol(t.pair || ''),
                                direction: (t.type === 'SELL' ? 'SELL' : 'BUY') as 'BUY' | 'SELL',
                                riskAmount: Number(t.risk_amount)
                                    || balance * ((acctRisk.risk_per_trade_percent ?? 1) / 100),
                            })),
                            ...acctQueued.map(d => ({
                                symbol: normalizeSymbol(d.pair),
                                direction: d.type,
                                riskAmount: d.risk_amount,
                            })),
                        ];
                        const limits: ExposureLimits = {
                            maxPerCurrency: acctRisk.max_trades_per_currency
                                ?? DEFAULT_EXPOSURE_LIMITS.maxPerCurrency,
                            maxRiskPercentPerCurrency: acctRisk.max_risk_percent_per_currency
                                ?? DEFAULT_EXPOSURE_LIMITS.maxRiskPercentPerCurrency,
                            maxTotalRiskPercent: acctRisk.max_total_risk_percent
                                ?? DEFAULT_EXPOSURE_LIMITS.maxTotalRiskPercent,
                        };
                        const exposure = checkExposureLimits(
                            { symbol: sym, direction: result.type, riskAmount: sizing.riskAmount },
                            existing, balance, (s) => getInstrumentSpec(s), limits,
                        );
                        if (!exposure.allowed) {
                            skipLog.push(`${bot.name} ${sym} @${acct}: ${exposure.reason}`);
                            continue;
                        }

                        drafts.push({
                            pair: rawPair,
                            type: result.type,
                            entry_price: round(entry, spec.digits),
                            stop_loss: round(sl, spec.digits),
                            take_profit: round(tp, spec.digits),
                            confidence: Math.round(result.confidence),
                            lot_size: sizing.lots,
                            strategy: bot.strategy_type || 'AI_PREDICTIVE',
                            bot_id: bot.id,
                            status: 'PENDING',
                            result_pnl: 0,
                            owner_email: acct,
                            risk_amount: Math.round(sizing.riskAmount * 100) / 100,
                            stop_pips: Math.round(sizing.stopPips * 10) / 10,
                            data_source: sourceByKey.get(key) || 'UNKNOWN',
                            calculated_indicators: {
                                // Every value below is COMPUTED from real candles.
                                rsi: snap.entry.rsi,
                                ema_trend: snap.entry.emaStack,
                                adx: snap.entry.adx,
                                atr: snap.entry.atr,
                                macd_histogram: snap.entry.macdHistogram,
                                regime: snap.entry.regime,
                                structure: snap.entry.structure.state,
                                last_structure_event: snap.entry.structure.lastEvent,
                                htf_bias: snap.htfBias,
                                session: snap.session,
                                patterns: snap.entry.patterns.map(p => p.name),
                                timeframe: tf,
                                bars_analysed: snap.entry.barCount,
                                last_bar_time: new Date(snap.generatedAt * 1000).toISOString(),
                                data_source: sourceByKey.get(key) || 'UNKNOWN',
                                stop_basis: result.stopBasis,
                                risk_amount: sizing.riskAmount,
                                data_degraded: snap.dataQuality.degraded,
                                reason: result.reasons.slice(0, 6).join(' | '),
                            },
                        });
                    }
                }
            }
        }

        if (drafts.length) {
            await base44.asServiceRole.entities.Signal.bulkCreate(drafts);
        }

        return Response.json({
            success: true,
            signals_created: drafts.length,
            bots_processed: bots.length,
            instruments_analysed: candleCache.size,
            elapsed_ms: Date.now() - startedAt,
            diagnostics: diagnostics.slice(0, 40),
            skipped: skipLog.slice(0, 60),
            signals: drafts.map(d => ({
                pair: d.pair, type: d.type, confidence: d.confidence,
                lots: d.lot_size, stop_pips: d.stop_pips,
                risk: d.risk_amount, account: d.owner_email, source: d.data_source,
            })),
        });

    } catch (error: any) {
        console.error('[generateBotSignals ERROR]', error.message, error.stack);
        return Response.json({ success: false, error: error.message, diagnostics }, { status: 500 });
    }
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function round(v: number, digits: number): number {
    return parseFloat(v.toFixed(Math.max(0, Math.min(8, digits))));
}

function parseLeverage(raw: unknown): number {
    const m = String(raw ?? '').match(/1\s*:\s*(\d+)/);
    if (m) return parseInt(m[1], 10);
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 100;
}

function withinTradingHours(bot: any): boolean {
    if (!bot.trading_start_time || !bot.trading_end_time) return true;
    const pairs: string[] = bot.pairs || [];
    if (pairs.length > 0 && pairs.every(p => getInstrumentSpec(p).tradesWeekends)) return true;

    const now = new Date();
    const [sh, sm] = String(bot.trading_start_time).split(':').map(Number);
    const [eh, em] = String(bot.trading_end_time).split(':').map(Number);
    if ([sh, sm, eh, em].some(n => !Number.isFinite(n))) return true;
    const cur = now.getUTCHours() * 60 + now.getUTCMinutes();
    const start = sh * 60 + sm, end = eh * 60 + em;
    return start <= end ? (cur >= start && cur < end) : (cur >= start || cur < end);
}

/** Latest close per symbol, used for quote→account currency conversion. */
function buildRateMap(cache: Map<string, Record<string, Candle[]>>): Record<string, number> {
    const rates: Record<string, number> = {};
    for (const [key, byTf] of cache.entries()) {
        const sym = key.split('|')[0];
        const series = Object.values(byTf)[0];
        if (series?.length) rates[sym] = series[series.length - 1].close;
    }
    for (const [sym, px] of Object.entries({ ...rates })) {
        if (/^[A-Z]{6}$/.test(sym) && px > 0) rates[sym.slice(3) + sym.slice(0, 3)] = 1 / px;
    }
    return rates;
}

/**
 * Optional LLM review layer.
 *
 * The model receives COMPUTED indicator readings and weighs them. It cannot
 * introduce a direction of its own and cannot raise confidence above the
 * deterministic score — only lower it or veto. That keeps the deterministic
 * path as the ceiling, which is what makes the strategy backtestable.
 */
async function applyLlmConfirmation(
    base44: any, snap: MarketSnapshot, result: StrategyResult,
): Promise<StrategyResult> {
    const e = snap.entry;
    const facts = {
        symbol: snap.symbol,
        timeframe: e.timeframe,
        proposed_direction: result.type,
        deterministic_confidence: result.confidence,
        price: snap.price,
        computed_from_real_candles: {
            rsi: e.rsi, adx: e.adx, plus_di: e.plusDI, minus_di: e.minusDI,
            ema20: e.ema20, ema50: e.ema50, ema200: e.ema200, ema_stack: e.emaStack,
            macd_histogram: e.macdHistogram, macd_cross: e.macdCross,
            atr: e.atr, atr_percent: e.atrPercent,
            bollinger_position: e.bbPosition, bollinger_width: e.bbWidth,
            stochastic_k: e.stochK, stochastic_d: e.stochD,
            regime: e.regime,
            structure_state: e.structure.state,
            last_structure_event: e.structure.lastEvent,
            liquidity_sweep: e.structure.liquiditySweep,
            candlestick_patterns: e.patterns.map(p => p.name),
            nearest_support: e.structure.supportLevels.slice(0, 3),
            nearest_resistance: e.structure.resistanceLevels.slice(0, 3),
            higher_timeframe_bias: snap.htfBias,
            session: snap.session,
            bars_analysed: e.barCount,
        },
        weighted_factors: result.factors.map(f => ({
            label: f.label, direction: f.direction, weight: f.weight, detail: f.detail,
        })),
    };

    const prompt =
        `You are reviewing a trade signal that has ALREADY been computed from real market data.\n\n` +
        `Every number below was calculated from OHLC candles. You have NOT seen a chart. Do not ` +
        `estimate, infer or invent any market data that is not present in this payload.\n\n` +
        `${JSON.stringify(facts, null, 2)}\n\n` +
        `Judge only whether these computed readings genuinely support a ${result.type}, or whether ` +
        `they conflict enough that the trade should be skipped.\n\n` +
        `Rules:\n` +
        `- You may CONFIRM (keep the confidence) or REDUCE it. You may NOT increase it.\n` +
        `- You may VETO with approve=false if the readings contradict one another.\n` +
        `- You may NOT change the direction.\n` +
        `- Reason only from the values provided above.`;

    const res = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
            type: 'object',
            properties: {
                approve: { type: 'boolean' },
                adjusted_confidence: { type: 'number', minimum: 0, maximum: 100 },
                rationale: { type: 'string' },
            },
            required: ['approve', 'adjusted_confidence', 'rationale'],
        },
    });

    if (!res || res.approve === false) {
        return {
            ...result, type: 'NEUTRAL', confidence: 0,
            blockedBy: [...result.blockedBy, `LLM veto: ${res?.rationale || 'no rationale given'}`],
        };
    }

    const adjusted = Math.min(result.confidence, Number(res.adjusted_confidence) || result.confidence);
    return { ...result, confidence: adjusted, reasons: [...result.reasons, `LLM review: ${res.rationale}`] };
}