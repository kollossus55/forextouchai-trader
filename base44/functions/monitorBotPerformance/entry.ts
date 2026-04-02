import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        const [bots, closedTrades, openTrades] = await Promise.all([
            base44.asServiceRole.entities.BotConfig.filter({ status: 'RUNNING' }, '-created_date', 50),
            base44.asServiceRole.entities.Trade.filter({ status: 'CLOSED' }, '-created_date', 500),
            base44.asServiceRole.entities.Trade.filter({ status: 'OPEN' }, '-created_date', 100),
        ]);

        if (!bots.length) {
            return Response.json({ success: true, message: 'No running bots to monitor' });
        }

        // Get recent alerts to avoid duplicates
        const recentAlerts = await base44.asServiceRole.entities.Alert.filter({ is_read: false }, '-created_date', 30);

        const alerts = [];
        const results = [];

        for (const bot of bots) {
            const botClosedTrades = closedTrades.filter(t => t.bot_id === bot.id);
            const botOpenTrades = openTrades.filter(t => t.bot_id === bot.id);

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