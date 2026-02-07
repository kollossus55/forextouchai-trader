import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Configurable thresholds
        const WIN_RATE_THRESHOLD = 40; // %
        const DRAWDOWN_THRESHOLD = 10; // %
        const MONITORING_PERIOD_HOURS = 24;

        // Get all active bots
        const bots = await base44.asServiceRole.entities.BotConfig.filter({ status: 'RUNNING' });
        
        if (bots.length === 0) {
            return Response.json({ message: 'No active bots to monitor', alerts: [] });
        }

        // Get all trades from the last 24 hours
        const cutoffTime = new Date(Date.now() - MONITORING_PERIOD_HOURS * 60 * 60 * 1000).toISOString();
        const allTrades = await base44.asServiceRole.entities.Trade.filter({});
        
        const alerts = [];

        for (const bot of bots) {
            // Filter trades for this specific bot in the monitoring period
            const botTrades = allTrades.filter(t => 
                t.bot_id === String(bot.id) && 
                t.status === 'CLOSED' &&
                new Date(t.updated_date) >= new Date(cutoffTime)
            );

            if (botTrades.length < 5) continue; // Need minimum trades for meaningful analysis

            // Calculate Win Rate
            const winningTrades = botTrades.filter(t => t.pnl > 0);
            const winRate = (winningTrades.length / botTrades.length) * 100;

            // Calculate Drawdown
            let peak = 0;
            let maxDrawdown = 0;
            let cumulative = 0;
            
            botTrades.forEach(trade => {
                cumulative += trade.pnl || 0;
                if (cumulative > peak) peak = cumulative;
                const drawdown = peak - cumulative;
                if (drawdown > maxDrawdown) maxDrawdown = drawdown;
            });

            const drawdownPercent = peak > 0 ? (maxDrawdown / peak) * 100 : 0;

            // Check for alert conditions
            const issues = [];
            
            if (winRate < WIN_RATE_THRESHOLD) {
                issues.push(`Win rate at ${winRate.toFixed(1)}% (below ${WIN_RATE_THRESHOLD}% threshold)`);
            }
            
            if (drawdownPercent > DRAWDOWN_THRESHOLD) {
                issues.push(`Drawdown at ${drawdownPercent.toFixed(1)}% (exceeds ${DRAWDOWN_THRESHOLD}% limit)`);
            }

            if (issues.length > 0) {
                const alertTitle = `⚠️ Bot Performance Alert: ${bot.name}`;
                const alertMessage = `${issues.join(' | ')} over the last ${MONITORING_PERIOD_HOURS} hours. Consider reviewing strategy or pausing the bot.`;
                
                // Create in-app alert for bot owner
                const botOwnerEmail = bot.owner_email || bot.created_by;
                if (botOwnerEmail) {
                    // Get bot owner's user record to set created_by
                    const ownerUsers = await base44.asServiceRole.entities.User.filter({ email: botOwnerEmail });
                    if (ownerUsers.length > 0) {
                        // Create alert with proper ownership
                        await base44.asServiceRole.entities.Alert.create({
                            title: alertTitle,
                            message: alertMessage,
                            type: 'WARNING',
                            is_read: false,
                            created_by: botOwnerEmail
                        });
                    }
                }

                // Send email notification
                try {
                    await base44.asServiceRole.integrations.Core.SendEmail({
                        to: user.email,
                        subject: `ForexTouchAI: ${bot.name} Performance Warning`,
                        body: `
Bot Performance Alert

Bot Name: ${bot.name}
Strategy: ${bot.strategy_type}

Performance Issues:
${issues.map(i => `• ${i}`).join('\n')}

Recent Performance (Last ${MONITORING_PERIOD_HOURS}h):
• Trades: ${botTrades.length}
• Win Rate: ${winRate.toFixed(1)}%
• Max Drawdown: -$${maxDrawdown.toFixed(2)} (${drawdownPercent.toFixed(1)}%)
• Net P&L: $${cumulative.toFixed(2)}

Recommended Actions:
1. Review the bot's trading strategy and parameters
2. Check market conditions - volatility may have changed
3. Consider temporarily pausing the bot while investigating
4. Adjust risk parameters (lot size, SL/TP, confidence threshold)

You can manage this bot in the Auto Trade section of your dashboard.
                        `
                    });
                } catch (emailError) {
                    console.error('Failed to send email:', emailError);
                }

                alerts.push({
                    bot: bot.name,
                    winRate: winRate.toFixed(1),
                    drawdown: drawdownPercent.toFixed(1),
                    trades: botTrades.length,
                    issues
                });
            }
        }

        return Response.json({
            status: 'success',
            monitored_bots: bots.length,
            alerts_triggered: alerts.length,
            alerts
        });

    } catch (error) {
        console.error('Bot monitoring error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});