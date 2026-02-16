import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Parse request body for optional bot_id
        const body = await req.json().catch(() => ({}));
        const { bot_id } = body;

        // Get today's date at midnight
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Count trades created today for each bot
        const allTrades = await base44.asServiceRole.entities.Trade.list('-created_date', 500);
        
        const todayTrades = allTrades.filter(trade => {
            const tradeDate = new Date(trade.created_date);
            return tradeDate >= today;
        });

        const botTradeCount = {};
        todayTrades.forEach(trade => {
            if (trade.bot_id) {
                botTradeCount[trade.bot_id] = (botTradeCount[trade.bot_id] || 0) + 1;
            }
        });

        // If bot_id provided, return count for that bot only
        if (bot_id) {
            return Response.json({
                success: true,
                bot_id,
                trades_today: botTradeCount[bot_id] || 0,
                message: `Bot has ${botTradeCount[bot_id] || 0} trades today`
            });
        }

        // Return counts for all bots
        return Response.json({
            success: true,
            date: today.toISOString(),
            total_trades_today: todayTrades.length,
            bot_trade_counts: botTradeCount
        });

    } catch (error) {
        return Response.json({ 
            success: false, 
            error: error.message 
        }, { status: 500 });
    }
});