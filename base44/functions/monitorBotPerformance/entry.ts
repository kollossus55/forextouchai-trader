import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        const [bots, closedTrades, openTrades, brokerConnections] = await Promise.all([
            base44.asServiceRole.entities.BotConfig.filter({ status: 'RUNNING' }, '-created_date', 50),
            base44.asServiceRole.entities.Trade.filter({ status: 'CLOSED' }, '-created_date', 500),
            base44.asServiceRole.entities.Trade.filter({ status: 'OPEN' }, '-created_date', 100),
            base44.asServiceRole.entities.BrokerConnection.list('-updated_date', 50),
        ]);

        if (!bots.length) {
            return Response.json({ success: true, message: 'No running bots to monitor' });
        }

        // Account number → balance (for close-all-at-profit/loss % calculations)
        const accountBalanceMap = {};
        for (const conn of brokerConnections) {
            if (conn.account_number && conn.balance > 0) {
                accountBalanceMap[conn.account_number] = conn.balance;
            }
        }

        // Get recent alerts to avoid duplicates
        const recentAlerts = await base44.asServiceRole.entities.Alert.filter({ is_read: false }, '-created_date', 30);

        const alerts = [];
        const results = [];

        for (const bot of bots) {
            const botClosedTrades = closedTrades.filter(t => t.bot_id === bot.id);
            const botOpenTrades = openTrades.filter(t => t.bot_id === bot.id);

            // ── Close-all-at-profit / close-all-at-loss enforcement (per account) ──
            // Runs BEFORE the closed-trade skip below so brand-new bots that haven't
            // closed a trade yet can still have their open trades closed on threshold breach.
            const profitThreshold = bot.close_all_at_profit_percent || 0;
            const lossThreshold = bot.close_all_at_loss_percent || 0;
            if ((profitThreshold > 0 || lossThreshold > 0) && botOpenTrades.length > 0) {
                const tradesByAccount = {};
                for (const t of botOpenTrades) {
                    const acct = t.owner_email;
                    if (!acct) continue;
                    if (!tradesByAccount[acct]) tradesByAccount[acct] = [];
                    tradesByAccount[acct].push(t);
                }
                for (const [acct, trades] of Object.entries(tradesByAccount)) {
                    const balance = accountBalanceMap[acct] || 0;
                    if (balance <= 0) continue;
                    const floatingPnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
                    const pnlPercent = (floatingPnl / balance) * 100;

                    const hitProfit = profitThreshold > 0 && floatingPnl > 0 && pnlPercent >= profitThreshold;
                    const hitLoss = lossThreshold > 0 && floatingPnl < 0 && pnlPercent <= -lossThreshold;

                    if (hitProfit || hitLoss) {
                        const reason = hitProfit
                            ? `Bot "${bot.name}" floating profit ${pnlPercent.toFixed(2)}% reached the ${profitThreshold}% close-all target`
                            : `Bot "${bot.name}" floating loss ${Math.abs(pnlPercent).toFixed(2)}% reached the ${lossThreshold}% close-all limit`;
                        console.log(`[monitorBotPerformance] CLOSE-ALL: ${reason} (acct ${acct}, ${trades.length} trades)`);
                        for (let i = 0; i < trades.length; i += 3) {
                            await Promise.all(trades.slice(i, i + 3).map(t =>
                                base44.asServiceRole.entities.Trade.update(t.id, {
                                    status: 'CLOSED',
                                    close_price: t.open_price || 0,
                                    pnl: t.pnl || 0,
                                })
                            ));
                        }
                        const closeTitle = hitProfit
                            ? `🎯 Close-All Profit Reached: ${bot.name} (Acct ${acct})`
                            : `🛑 Close-All Loss Limit Hit: ${bot.name} (Acct ${acct})`;
                        if (!recentAlerts.some(a => a.title === closeTitle)) {
                            alerts.push({
                                title: closeTitle,
                                message: `${reason}. Closed ${trades.length} open trade(s) on account ${acct}.`,
                                type: hitProfit ? 'SUCCESS' : 'WARNING',
                            });
                        }
                    }
                }
            }

            if (botClosedTrades.length === 0) continue;

            // Win rate calculation
            const winners = botClosedTrades.filter(t => (t.pnl || 0) > 0);
            const winRate = (winners.length / botClosedTrades.length) * 100;

            // Total PnL
            const totalPnl = botClosedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
            const floatingPnl = botOpenTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);

            // Consecutive losses (most recent streak)
            const sorted = [...botClosedTrades].sort((a, b) => new Date(b.updated_date) - new Date(a.updated_date));
            let consecutiveLosses = 0;
            for (const t of sorted) {
                if ((t.pnl || 0) < 0) consecutiveLosses++;
                else break;
            }

            results.push({
                bot_id: bot.id,
                bot_name: bot.name,
                total_trades: botClosedTrades.length,
                win_rate: winRate,
                total_pnl: totalPnl,
                floating_pnl: floatingPnl,
                consecutive_losses: consecutiveLosses,
            });

            // Alert: Low win rate (below 40% with at least 10 trades)
            if (botClosedTrades.length >= 10 && winRate < 40) {
                const title = `⚠️ Low Win Rate: ${bot.name}`;
                if (!recentAlerts.some(a => a.title === title)) {
                    alerts.push({
                        title,
                        message: `Bot "${bot.name}" win rate is ${winRate.toFixed(1)}% across ${botClosedTrades.length} trades. Consider reviewing strategy settings.`,
                        type: 'WARNING',
                    });
                }
            }

            // Alert: Consecutive losses (5+)
            if (consecutiveLosses >= 5) {
                const title = `🚨 Consecutive Losses: ${bot.name}`;
                if (!recentAlerts.some(a => a.title === title)) {
                    alerts.push({
                        title,
                        message: `Bot "${bot.name}" has ${consecutiveLosses} consecutive losing trades. Consider pausing this bot.`,
                        type: 'ERROR',
                    });
                }
            }

            // Alert: Negative total PnL (significant loss)
            if (totalPnl < -100) {
                const title = `⚠️ Negative PnL: ${bot.name}`;
                if (!recentAlerts.some(a => a.title === title)) {
                    alerts.push({
                        title,
                        message: `Bot "${bot.name}" has a total PnL of $${totalPnl.toFixed(2)}. Review performance.`,
                        type: 'WARNING',
                    });
                }
            }
        }

        // Create alerts in DB
        for (const alert of alerts) {
            await base44.asServiceRole.entities.Alert.create({ ...alert, is_read: false });
            console.log(`[monitorBotPerformance] Created alert: ${alert.title}`);
        }

        return Response.json({
            success: true,
            bots_monitored: results.length,
            alerts_created: alerts.length,
            results,
            message: `Monitored ${results.length} bots. ${alerts.length} alert(s) created.`,
        });

    } catch (error) {
        console.error('[monitorBotPerformance ERROR]', error.message);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});