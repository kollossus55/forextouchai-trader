import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        const [riskSettingsList, openTrades, brokerConnections] = await Promise.all([
            base44.asServiceRole.entities.RiskManagementSettings.list('-created_date', 100),
            base44.asServiceRole.entities.Trade.filter({ status: 'OPEN' }, '-created_date', 500),
            base44.asServiceRole.entities.BrokerConnection.list('-updated_date', 50),
        ]);

        const connectedAccounts = brokerConnections.filter(c => c.connection_status === 'CONNECTED');
        if (connectedAccounts.length === 0) {
            return Response.json({ success: true, message: 'No connected broker accounts — skipping' });
        }

        const today = new Date().toISOString().split('T')[0];

        // Fetch today's closed trades once
        const closedTrades = await base44.asServiceRole.entities.Trade.filter({ status: 'CLOSED' }, '-created_date', 1000);
        const todayClosedTrades = closedTrades.filter(t => {
            const d = t.updated_date || t.created_date;
            return d && d.startsWith(today);
        });

        // Build a map: account_number → risk settings (prefer account-specific, fall back to global)
        const globalSettings = riskSettingsList.find(r => !r.account_number) || null;
        const accountSettingsMap = {};
        for (const r of riskSettingsList) {
            if (r.account_number) accountSettingsMap[r.account_number] = r;
        }

        const totalAlerts = [];
        const results = [];

        for (const conn of connectedAccounts) {
            const acctKey = conn.account_number;
            if (!acctKey) continue;

            // Use account-specific settings if exists, else global, else skip
            const riskSettings = accountSettingsMap[acctKey] || globalSettings;
            if (!riskSettings) continue;

            const balance = conn.balance || 0;
            const equity = conn.equity || 0;
            if (!balance) continue;

            // Reset daily loss counter if new day
            const lastResetDate = riskSettings.last_reset_date ? riskSettings.last_reset_date.split('T')[0] : null;
            if (lastResetDate !== today) {
                await base44.asServiceRole.entities.RiskManagementSettings.update(riskSettings.id, {
                    daily_loss_current: 0,
                    last_reset_date: today,
                });
                console.log(`[monitorRiskLimits] Daily loss counter reset for account ${acctKey}`);
            }

            // Update peak equity per account
            const newPeak = Math.max(riskSettings.peak_equity || 0, equity);
            if (newPeak > (riskSettings.peak_equity || 0)) {
                await base44.asServiceRole.entities.RiskManagementSettings.update(riskSettings.id, { peak_equity: newPeak });
            }

            // Calculate PnL for this account
            const acctTodayPnl = todayClosedTrades
                .filter(t => t.owner_email === acctKey)
                .reduce((sum, t) => sum + (t.pnl || 0), 0);
            const acctFloatingPnl = openTrades
                .filter(t => t.owner_email === acctKey)
                .reduce((sum, t) => sum + (t.pnl || 0), 0);
            const totalDailyPnl = acctTodayPnl + acctFloatingPnl;
            const acctOpenCount = openTrades.filter(t => t.owner_email === acctKey).length;

            const alerts = [];

            // --- Check: Max Daily Loss ---
            if (riskSettings.max_daily_loss_percent > 0 && totalDailyPnl < 0) {
                const dailyLossPercent = Math.abs(totalDailyPnl / balance) * 100;
                const alertThreshold = (riskSettings.alert_threshold_percent || 80) / 100;

                if (dailyLossPercent >= riskSettings.max_daily_loss_percent) {
                    alerts.push({
                        title: `🚨 Daily Loss Limit Breached! (Acct ${acctKey})`,
                        message: `Account ${acctKey}: Daily loss of ${dailyLossPercent.toFixed(2)}% exceeded the ${riskSettings.max_daily_loss_percent}% limit. Trading paused for this account.`,
                        type: 'ERROR',
                    });
                    if (riskSettings.stop_trading_on_limit) {
                        await base44.asServiceRole.entities.RiskManagementSettings.update(riskSettings.id, { is_trading_paused: true });
                    }
                } else if (dailyLossPercent >= riskSettings.max_daily_loss_percent * alertThreshold) {
                    alerts.push({
                        title: `⚠️ Daily Loss Warning (Acct ${acctKey})`,
                        message: `Account ${acctKey}: Daily loss at ${dailyLossPercent.toFixed(2)}% — approaching the ${riskSettings.max_daily_loss_percent}% limit.`,
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
                        title: `🚨 Max Drawdown Breached! (Acct ${acctKey})`,
                        message: `Account ${acctKey}: Drawdown of ${drawdownPercent.toFixed(2)}% exceeded the ${riskSettings.max_drawdown_percent}% limit. Trading paused for this account.`,
                        type: 'ERROR',
                    });
                    if (riskSettings.stop_trading_on_limit) {
                        await base44.asServiceRole.entities.RiskManagementSettings.update(riskSettings.id, { is_trading_paused: true });
                    }
                } else if (drawdownPercent >= riskSettings.max_drawdown_percent * alertThreshold) {
                    alerts.push({
                        title: `⚠️ Drawdown Warning (Acct ${acctKey})`,
                        message: `Account ${acctKey}: Drawdown at ${drawdownPercent.toFixed(2)}% — approaching the ${riskSettings.max_drawdown_percent}% limit.`,
                        type: 'WARNING',
                    });
                }
            }

            // --- Check: Max Concurrent Trades ---
            if (riskSettings.max_concurrent_trades > 0 && acctOpenCount >= riskSettings.max_concurrent_trades) {
                alerts.push({
                    title: `⚠️ Max Trades Reached (Acct ${acctKey})`,
                    message: `Account ${acctKey}: ${acctOpenCount} trades open — at the limit of ${riskSettings.max_concurrent_trades}.`,
                    type: 'WARNING',
                });
            }

            // --- Check: Daily Profit Target ---
            if (riskSettings.daily_profit_target_percent > 0) {
                const acctAllTodayTrades = todayClosedTrades.filter(t => t.owner_email === acctKey);
                const todayProfit = acctAllTodayTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
                const dailyProfitPercent = ((todayProfit + acctFloatingPnl) / balance) * 100;
                if (dailyProfitPercent >= riskSettings.daily_profit_target_percent) {
                    console.log(`[monitorRiskLimits] Account ${acctKey}: Daily profit target reached ${dailyProfitPercent.toFixed(2)}%`);
                    const acctOpenTrades = openTrades.filter(t => t.owner_email === acctKey);
                    for (let i = 0; i < acctOpenTrades.length; i += 3) {
                        await Promise.all(acctOpenTrades.slice(i, i + 3).map(t =>
                            base44.asServiceRole.entities.Trade.update(t.id, { status: 'CLOSED', close_price: t.open_price, pnl: t.pnl || 0 })
                        ));
                    }
                    await Promise.all([
                        base44.asServiceRole.entities.RiskManagementSettings.update(riskSettings.id, { is_trading_paused: true }),
                        base44.asServiceRole.entities.Alert.create({
                            title: `🎯 Daily Profit Target Reached! (Acct ${acctKey})`,
                            message: `Account ${acctKey}: Daily profit of ${dailyProfitPercent.toFixed(2)}% reached your ${riskSettings.daily_profit_target_percent}% target. Trading paused for this account.`,
                            type: 'SUCCESS',
                        }),
                    ]);
                }
            }

            // Create alerts (deduplicate)
            if (alerts.length > 0) {
                const recentAlerts = await base44.asServiceRole.entities.Alert.filter({ is_read: false }, '-created_date', 20);
                for (const alert of alerts) {
                    const alreadyExists = recentAlerts.some(a => a.title === alert.title);
                    if (!alreadyExists) {
                        await base44.asServiceRole.entities.Alert.create({ ...alert, is_read: false });
                        console.log(`[monitorRiskLimits] Alert for ${acctKey}: ${alert.title}`);
                    }
                }
            }

            totalAlerts.push(...alerts);
            results.push({ account: acctKey, daily_pnl: totalDailyPnl, open_trades: acctOpenCount, alerts: alerts.length });
        }

        return Response.json({
            success: true,
            accounts_checked: connectedAccounts.length,
            total_alerts: totalAlerts.length,
            results,
            message: `Per-account risk check complete. ${totalAlerts.length} alert(s) created.`,
        });

    } catch (error) {
        console.error('[monitorRiskLimits ERROR]', error.message);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});