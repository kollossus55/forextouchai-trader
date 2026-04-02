import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        const [riskSettingsList, openTrades, brokerConnections] = await Promise.all([
            base44.asServiceRole.entities.RiskManagementSettings.list('-created_date', 1),
            base44.asServiceRole.entities.Trade.filter({ status: 'OPEN' }, '-created_date', 100),
            base44.asServiceRole.entities.BrokerConnection.list('-updated_date', 10),
        ]);

        const riskSettings = riskSettingsList?.[0];
        if (!riskSettings) {
            return Response.json({ success: true, message: 'No risk settings configured' });
        }

        // Get primary broker connection for balance/equity
        const activeConn = brokerConnections.find(c => c.connection_status === 'CONNECTED') || brokerConnections[0];
        const balance = activeConn?.balance || 0;
        const equity = activeConn?.equity || 0;

        if (!balance) {
            return Response.json({ success: true, message: 'No broker balance available — skipping' });
        }

        const alerts = [];
        const today = new Date().toISOString().split('T')[0];

        // Reset daily loss counter if it's a new day
        if (riskSettings.last_reset_date !== today) {
            await base44.asServiceRole.entities.RiskManagementSettings.update(riskSettings.id, {
                daily_loss_current: 0,
                last_reset_date: today,
            });
            console.log('[monitorRiskLimits] Daily loss counter reset for new day');
        }

        // Calculate today's closed trade PnL
        const closedTrades = await base44.asServiceRole.entities.Trade.filter({ status: 'CLOSED' }, '-created_date', 500);
        const todayPnl = closedTrades
            .filter(t => t.updated_date?.startsWith(today))
            .reduce((sum, t) => sum + (t.pnl || 0), 0);

        const floatingPnl = openTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
        const totalDailyPnl = todayPnl + floatingPnl;

        // Update peak equity
        const newPeak = Math.max(riskSettings.peak_equity || 0, equity);
        if (newPeak > (riskSettings.peak_equity || 0)) {
            await base44.asServiceRole.entities.RiskManagementSettings.update(riskSettings.id, { peak_equity: newPeak });
        }

        // --- Check: Max Daily Loss ---
        if (riskSettings.max_daily_loss_percent > 0 && totalDailyPnl < 0) {
            const dailyLossPercent = Math.abs(totalDailyPnl / balance) * 100;
            const alertThreshold = (riskSettings.alert_threshold_percent || 80) / 100;

            if (dailyLossPercent >= riskSettings.max_daily_loss_percent) {
                alerts.push({
                    title: '🚨 Daily Loss Limit Breached!',
                    message: `Daily loss of ${dailyLossPercent.toFixed(2)}% has exceeded your ${riskSettings.max_daily_loss_percent}% limit. Trading paused.`,
                    type: 'ERROR',
                });
                if (riskSettings.stop_trading_on_limit) {
                    await base44.asServiceRole.entities.RiskManagementSettings.update(riskSettings.id, { is_trading_paused: true });
                }
            } else if (dailyLossPercent >= riskSettings.max_daily_loss_percent * alertThreshold) {
                alerts.push({
                    title: '⚠️ Daily Loss Warning',
                    message: `Daily loss is at ${dailyLossPercent.toFixed(2)}% — approaching your ${riskSettings.max_daily_loss_percent}% limit.`,
                    type: 'WARNING',
                });
            }
        }

        // --- Check: Max Drawdown ---
        if (riskSettings.max_drawdown_percent > 0 && newPeak > 0) {
            const drawdownPercent = ((newPeak - equity) / newPeak) * 100;
            const alertThreshold = (riskSettings.alert_threshold_percent || 80) / 100;

            if (drawdownPercent >= riskSettings.max_drawdown_percent) {
                alerts.push({
                    title: '🚨 Max Drawdown Breached!',
                    message: `Drawdown of ${drawdownPercent.toFixed(2)}% has exceeded your ${riskSettings.max_drawdown_percent}% limit. Trading paused.`,
                    type: 'ERROR',
                });
                if (riskSettings.stop_trading_on_limit) {
                    await base44.asServiceRole.entities.RiskManagementSettings.update(riskSettings.id, { is_trading_paused: true });
                }
            } else if (drawdownPercent >= riskSettings.max_drawdown_percent * alertThreshold) {
                alerts.push({
                    title: '⚠️ Drawdown Warning',
                    message: `Drawdown is at ${drawdownPercent.toFixed(2)}% — approaching your ${riskSettings.max_drawdown_percent}% limit.`,
                    type: 'WARNING',
                });
            }
        }

        // --- Check: Max Concurrent Trades ---
        if (riskSettings.max_concurrent_trades > 0) {
            const tradeCount = openTrades.length;
            if (tradeCount >= riskSettings.max_concurrent_trades) {
                alerts.push({
                    title: '⚠️ Max Concurrent Trades Reached',
                    message: `${tradeCount} trades open — at your limit of ${riskSettings.max_concurrent_trades}.`,
                    type: 'WARNING',
                });
            }
        }

        // Create alerts in DB (avoid duplicates by checking recent alerts)
        if (alerts.length > 0) {
            const recentAlerts = await base44.asServiceRole.entities.Alert.filter({ is_read: false }, '-created_date', 20);
            for (const alert of alerts) {
                const alreadyExists = recentAlerts.some(a => a.title === alert.title);
                if (!alreadyExists) {
                    await base44.asServiceRole.entities.Alert.create({ ...alert, is_read: false });
                    console.log(`[monitorRiskLimits] Created alert: ${alert.title}`);
                }
            }
        }

        return Response.json({
            success: true,
            balance,
            equity,
            daily_pnl: totalDailyPnl,
            open_trades: openTrades.length,
            alerts_created: alerts.length,
            message: `Risk check complete. ${alerts.length} alert(s) created.`,
        });

    } catch (error) {
        console.error('[monitorRiskLimits ERROR]', error.message);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});