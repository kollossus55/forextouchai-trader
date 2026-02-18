import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // Get all pending signals using service role to avoid rate limits
        // EXCLUDE manual trades - they must go through MT4 bridge only
        const allPendingSignals = await base44.asServiceRole.entities.Signal.filter({ status: 'PENDING' });
        const pendingSignals = allPendingSignals.filter(s => s.strategy !== 'MANUAL_EXECUTION');
        
        if (pendingSignals.length === 0) {
            return Response.json({ 
                success: true, 
                message: 'No pending signals',
                executed: 0 
            });
        }

        // Fetch all open trades and bots at once to reduce API calls
        const allOpenTrades = await base44.asServiceRole.entities.Trade.filter({ status: 'OPEN' });
        const allBots = await base44.asServiceRole.entities.BotConfig.list();
        
        // Fetch global risk settings
        const riskSettings = await base44.asServiceRole.entities.RiskManagementSettings.list();
        const globalRisk = riskSettings?.[0] || { max_concurrent_trades: 100, is_trading_paused: false };
        
        // Check if trading is paused globally
        if (globalRisk.is_trading_paused) {
            return Response.json({
                success: true,
                message: 'Trading paused due to global risk limits',
                executed: 0,
                skipped: pendingSignals.length
            });
        }
        
        // Check global max concurrent trades
        if (allOpenTrades.length >= globalRisk.max_concurrent_trades) {
            return Response.json({
                success: true,
                message: `Global trade limit reached (${globalRisk.max_concurrent_trades})`,
                executed: 0,
                skipped: pendingSignals.length
            });
        }
        
        const results = [];
        
        for (const signal of pendingSignals) {
            try {
                // RE-FETCH current open trades count to get real-time accurate count
                const currentOpenTrades = await base44.asServiceRole.entities.Trade.filter({ status: 'OPEN' });
                if (currentOpenTrades.length >= globalRisk.max_concurrent_trades) {
                    results.push({
                        signal_id: signal.id,
                        pair: signal.pair,
                        success: false,
                        skipped: true,
                        reason: `Global limit reached (${currentOpenTrades.length}/${globalRisk.max_concurrent_trades})`
                    });
                    // Mark signal as skipped
                    await base44.asServiceRole.entities.Signal.update(signal.id, { status: 'SKIPPED' });
                    continue;
                }
                
                // Find the bot and check its individual limits
                const bot = allBots.find(b => b.id === signal.bot_id);
                if (!bot) {
                    results.push({
                        signal_id: signal.id,
                        pair: signal.pair,
                        success: false,
                        error: 'Bot not found'
                    });
                    continue;
                }
                
                // Check bot's max open trades limit
                const botOpenTrades = allOpenTrades.filter(t => 
                    t.bot_id === signal.bot_id && 
                    t.status === 'OPEN'
                );
                
                if (botOpenTrades.length >= (bot.max_open_trades || 5)) {
                    results.push({
                        signal_id: signal.id,
                        pair: signal.pair,
                        success: false,
                        skipped: true,
                        reason: `Bot ${bot.name} at max trades (${bot.max_open_trades || 5})`
                    });
                    continue;
                }
                
                // Find existing open trades on same pair from same bot
                const existingTrades = allOpenTrades.filter(t => 
                    t.pair === signal.pair && 
                    t.bot_id === signal.bot_id && 
                    t.status === 'OPEN'
                );

                let closedTrades = [];
                
                // Close opposite direction trades
                for (const existingTrade of existingTrades) {
                    if (existingTrade.type !== signal.type) {
                        // Opposite direction - close it
                        const currentPrice = signal.entry_price;
                        const priceDiff = existingTrade.type === 'BUY' 
                            ? currentPrice - existingTrade.open_price
                            : existingTrade.open_price - currentPrice;
                        const pnl = priceDiff * existingTrade.lot_size * 100000;

                        await base44.asServiceRole.entities.Trade.update(existingTrade.id, {
                            status: 'CLOSED',
                            close_price: currentPrice,
                            pnl: pnl
                        });

                        closedTrades.push(existingTrade.id);
                    }
                }

                // DON'T create trade directly - let MT4 EA pick up the signal
                // The signal will be executed by MT4, and MT4 will report back the trade
                // Update signal status to PENDING (ready for MT4 pickup)
                await base44.asServiceRole.entities.Signal.update(signal.id, {
                    status: 'PENDING'
                });

                results.push({
                    signal_id: signal.id,
                    trade_id: trade.id,
                    pair: signal.pair,
                    type: signal.type,
                    closed_opposite_trades: closedTrades,
                    success: true
                });
            } catch (error) {
                results.push({
                    signal_id: signal.id,
                    pair: signal.pair,
                    success: false,
                    error: error.message
                });
            }
        }

        return Response.json({
            success: true,
            executed: results.filter(r => r.success).length,
            skipped: results.filter(r => r.skipped).length,
            failed: results.filter(r => !r.success && !r.skipped).length,
            results
        });

    } catch (error) {
        return Response.json({ 
            success: false, 
            error: error.message 
        }, { status: 500 });
    }
});