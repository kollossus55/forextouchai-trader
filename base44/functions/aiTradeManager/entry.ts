// ════════════════════════════════════════════════════════════════════════════
// aiTradeManager — v2
// ════════════════════════════════════════════════════════════════════════════
// Two things were wrong with the previous version.
//
// 1. It imported and instantiated an OpenAI client that was never used:
//        import OpenAI from 'npm:openai';
//        const openai = new OpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY") });
//    The constructor throws when the key is missing, so without that env var
//    set the whole function returned 500 on every call and trade management
//    silently stopped working with no obvious cause. Both lines are gone.
//
// 2. In AUTO_EXECUTE mode it wrote `status: 'CLOSED'` straight into the
//    database with `close_price: trade.open_price`. That never reached the
//    broker — the position stayed open with real money at risk while the app
//    showed it as closed and stopped monitoring it. It now uses the same
//    `close_requested` mechanism the bridge already implements.
//
// Note on naming: there is still no AI in here, and there does not need to be.
// It is time-based and progress-based position management, which is exactly
// what it should be. The name is kept for compatibility with existing UI.
// ════════════════════════════════════════════════════════════════════════════

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.43';
import { getInstrumentSpec, normalizeSymbol, pipValueInAccountCurrency } from '../_shared/instruments.ts';

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: CORS });

        const body = await req.json().catch(() => ({}));
        const riskParams = body.riskParams || {};
        const maxHoldHours = Number(riskParams.maxHoldHours) || 24;
        const profitProtectPercent = Number(riskParams.profitProtectPercent) || 50;
        const mode = riskParams.mode || 'SUGGESTIONS';

        const openTrades = await base44.entities.Trade.filter({ status: 'OPEN' });
        if (!openTrades.length) {
            return Response.json({ tradesAnalyzed: 0, adjustments: [], message: 'No open trades' }, { headers: CORS });
        }

        const adjustments: any[] = [];
        const now = new Date();
        let closesRequested = 0;

        for (const trade of openTrades) {
            // Already flagged — don't re-request, the bridge has a resend cooldown
            if (trade.close_requested) continue;

            const openedAt = new Date(trade.created_date);
            const hoursOpen = (now.getTime() - openedAt.getTime()) / 3_600_000;
            const pnl = Number(trade.pnl) || 0;

            // ── Max hold time on a losing trade ─────────────────────────────
            if (hoursOpen >= maxHoldHours && pnl < 0) {
                const reason = `Open ${Math.round(hoursOpen)}h (limit ${maxHoldHours}h) while down $${pnl.toFixed(2)}`;
                adjustments.push({
                    trade_id: trade.id, ticket: trade.ticket, pair: trade.pair,
                    action: 'CLOSE', reason, pnl,
                });

                if (mode === 'AUTO_EXECUTE') {
                    // Flag for the bridge → EA closes at market → reconcile
                    // writes the real close price and P&L.
                    await base44.entities.Trade.update(trade.id, {
                        close_requested: true,
                        close_requested_at: now.toISOString(),
                        close_reason: 'AI_MAX_HOLD',
                    });
                    closesRequested++;
                    await base44.entities.Alert.create({
                        title: `Close requested: ${trade.pair}`,
                        message: `${reason}. Close command sent to the EA — the position closes at market. `
                            + `Confirm on the Trades page that it has actually closed.`,
                        type: 'WARNING',
                    });
                } else {
                    await base44.entities.Alert.create({
                        title: `Consider closing ${trade.pair}`,
                        message: `${reason}.`,
                        type: 'WARNING',
                    });
                }
                continue;
            }

            // ── Profit protection ───────────────────────────────────────────
            // Progress toward target is measured from PRICE, not by inverting
            // P&L through a hardcoded 100,000 contract size as the old code did
            // (`pnl / (lot_size * 100000)`), which was wrong for every
            // instrument that is not a standard forex lot — gold, silver,
            // indices and crypto all have different contract sizes.
            if (pnl > 0 && trade.take_profit && trade.open_price && trade.current_price) {
                const entry = Number(trade.open_price);
                const target = Number(trade.take_profit);
                const current = Number(trade.current_price);
                const isBuy = trade.type !== 'SELL';

                const totalDistance = Math.abs(target - entry);
                const moved = isBuy ? current - entry : entry - current;
                const progress = totalDistance > 0 ? (moved / totalDistance) * 100 : 0;

                if (progress >= profitProtectPercent) {
                    const spec = getInstrumentSpec(normalizeSymbol(trade.pair || ''));
                    const suggestion = Number.isFinite(spec.pipSize)
                        ? `Consider moving the stop to breakeven (${entry.toFixed(spec.digits)}).`
                        : 'Consider moving the stop to breakeven.';
                    adjustments.push({
                        trade_id: trade.id, pair: trade.pair, action: 'PROTECT_PROFIT',
                        reason: `${Math.round(progress)}% of the way to target. ${suggestion}`,
                        pnl, progressPercent: Math.round(progress),
                    });
                    await base44.entities.Alert.create({
                        title: `Profit protection: ${trade.pair}`,
                        message: `${trade.pair} is ${Math.round(progress)}% toward target. ${suggestion}`,
                        type: 'INFO',
                    });
                }
            }
        }

        return Response.json({
            tradesAnalyzed: openTrades.length,
            adjustments,
            closesRequested,
            mode,
            message: mode === 'AUTO_EXECUTE' && closesRequested > 0
                ? `Close requested for ${closesRequested} trade(s). These close at the broker via the EA — `
                  + `verify on the Trades page.`
                : `Analysed ${openTrades.length} trade(s)`,
        }, { headers: CORS });

    } catch (error: any) {
        console.error('[aiTradeManager ERROR]', error.message);
        return Response.json({ error: error.message }, { status: 500, headers: CORS });
    }
});
