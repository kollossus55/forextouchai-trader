import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import OpenAI from 'npm:openai';

const openai = new OpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY") });

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            }
        });
    }

    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

        const body = await req.json();
        const { action, riskParams } = body;

        const maxRiskPercent = riskParams?.maxRiskPercent || 2;
        const maxHoldHours = riskParams?.maxHoldHours || 24;
        const profitProtectPercent = riskParams?.profitProtectPercent || 50;
        const mode = riskParams?.mode || 'SUGGESTIONS';

        // Fetch open trades for this user
        const openTrades = await base44.entities.Trade.filter({ status: 'OPEN' });

        if (!openTrades.length) {
            return Response.json({ tradesAnalyzed: 0, adjustments: [], message: 'No open trades' });
        }

        const adjustments = [];
        const now = new Date();

        for (const trade of openTrades) {
            const openedAt = new Date(trade.created_date);
            const hoursOpen = (now - openedAt) / (1000 * 60 * 60);
            const pnl = trade.pnl || 0;

            // Check max hold time for losing trades
            if (hoursOpen >= maxHoldHours && pnl < 0) {
                const recommendation = {
                    trade_id: trade.id,
                    ticket: trade.ticket,
                    pair: trade.pair,
                    action: 'CLOSE',
                    reason: `Trade open for ${Math.round(hoursOpen)}h exceeding ${maxHoldHours}h limit while in loss ($${pnl.toFixed(2)})`,
                    pnl
                };
                adjustments.push(recommendation);

                if (mode === 'AUTO_EXECUTE') {
                    await base44.entities.Trade.update(trade.id, { status: 'CLOSED', close_price: trade.open_price });
                    await base44.entities.Alert.create({
                        title: `AI Closed Trade: ${trade.pair}`,
                        message: `AI closed ${trade.pair} after ${Math.round(hoursOpen)}h in loss ($${pnl.toFixed(2)})`,
                        type: 'WARNING',
                    });
                } else {
                    await base44.entities.Alert.create({
                        title: `AI Alert: Consider closing ${trade.pair}`,
                        message: `Trade open ${Math.round(hoursOpen)}h in loss ($${pnl.toFixed(2)}). Consider closing.`,
                        type: 'WARNING',
                    });
                }
                continue;
            }

            // Check profit protection - if TP is set and trade is near TP
            if (pnl > 0 && trade.take_profit && trade.open_price) {
                const tpDistance = Math.abs(trade.take_profit - trade.open_price);
                const currentMove = trade.type === 'BUY'
                    ? (trade.open_price + (pnl / ((trade.lot_size || 0.1) * 100000))) - trade.open_price
                    : trade.open_price - (trade.open_price - (pnl / ((trade.lot_size || 0.1) * 100000)));
                const progressToTP = tpDistance > 0 ? (currentMove / tpDistance) * 100 : 0;

                if (progressToTP >= profitProtectPercent) {
                    adjustments.push({
                        trade_id: trade.id,
                        pair: trade.pair,
                        action: 'PROTECT_PROFIT',
                        reason: `Trade at ${Math.round(progressToTP)}% of TP target. Consider moving SL to breakeven.`,
                        pnl
                    });
                    await base44.entities.Alert.create({
                        title: `Profit Protection: ${trade.pair}`,
                        message: `${trade.pair} is ${Math.round(progressToTP)}% toward TP. Consider locking in profits.`,
                        type: 'INFO',
                    });
                }
            }
        }

        console.log(`[AI Trade Manager] Analyzed ${openTrades.length} trades, found ${adjustments.length} adjustments`);

        return Response.json({
            tradesAnalyzed: openTrades.length,
            adjustments,
            mode,
            message: `Analyzed ${openTrades.length} trades`
        }, {
            headers: { 'Access-Control-Allow-Origin': '*' }
        });

    } catch (error) {
        console.error('[AI Trade Manager ERROR]', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});