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

        const now = new Date();

        // Fetch today's closed trades — sorted by updated_date desc, limit 500
        // HARDENED: sort by updated_date (when trade closed) not created_date, limit to 500
        const closedTrades = await base44.asServiceRole.entities.Trade.filter({ status: 'CLOSED' }, '-updated_date', 500);

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

            // ── Auto-resume: if paused and auto_resume_hours is set, check if cooldown has elapsed ──
            const autoResumeHours = riskSettings.auto_resume_hours || 0;
            const limitHitAt = riskSettings.limit_hit_at ? new Date(riskSettings.limit_hit_at) : null;
            if (riskSettings.is_trading_paused && autoResumeHours > 0 && limitHitAt) {
                const elapsedMs = now.getTime() - limitHitAt.getTime();
                const cooldownMs = autoResumeHours * 60 * 60 * 1000;
                if (elapsedMs >= cooldownMs) {
                    await base44.asServiceRole.entities.RiskManagementSettings.update(riskSettings.id, {
                        is_trading_paused: false,
                        daily_loss_current: 0,
                        last_reset_date: now.toISOString().split('T')[0],
                        limit_hit_at: null,
                    });
                    console.log(`[monitorRiskLimits] Auto-resumed account ${acctKey} after ${autoResumeHours}h cooldown`);

                    // Create alert for auto-resume
                    const resumeTitle = `✅ Trading Auto-Resumed (Acct ${acctKey})`;
                    const recentResumeAlerts = await base44.asServiceRole.entities.Alert.filter({ title: resumeTitle }, '-created_date', 5);
                    const alreadyResumeAlerted = recentResumeAlerts.some(a => {
                        const d = a.created_date || '';
                        return String(d).startsWith(now.toISOString().split('T')[0]);
                    });
                    if (!alreadyResumeAlerted) {
                        await base44.asServiceRole.entities.Alert.create({
                            title: resumeTitle,
                            message: `Account ${acctKey}: Trading has automatically resumed after the ${autoResumeHours}h cooldown period. Risk counters have been reset.`,
                            type: 'SUCCESS',
                        });
                        // Send email notification
                        const connOwner = conn.owner_email || (conn.created_by && !conn.created_by.includes('service+') ? conn.created_by : null);
                        if (connOwner) {
                            await base44.asServiceRole.integrations.Core.SendEmail({
                                to: connOwner,
                                subject: `✅ ForexTouchAI — Trading Auto-Resumed (Acct ${acctKey})`,
                                body: `Account ${acctKey}: Trading has automatically resumed after the ${autoResumeHours}h cooldown period.\n\nAll risk counters have been reset and your bots can now resume trading.\n\nForexTouchAI — Automated Risk Monitor`
                            }).catch(e => console.error(`[monitorRiskLimits] Resume email failed for ${connOwner}:`, e.message));
                        }
                    }

                    // Re-fetch riskSettings after the update so downstream checks use the fresh state
                    const [refreshed] = await base44.asServiceRole.entities.RiskManagementSettings.filter({ account_number: acctKey }, '-created_date', 1);
                    Object.assign(riskSettings, refreshed || { is_trading_paused: false, daily_loss_current: 0 });
                }
            }

            // Reset daily loss counter based on configurable reset hour (UTC)
            // e.g. daily_reset_hour=5 means reset happens at 05:00 UTC each day
            const resetHour = riskSettings.daily_reset_hour ?? 0;
            // Build a "reset period key": YYYY-MM-DD@HH where HH is the reset hour
            // The current period started at the most recent occurrence of resetHour UTC
            const currentPeriodStart = new Date(now);
            currentPeriodStart.setUTCMinutes(0, 0, 0);
            if (now.getUTCHours() < resetHour) {
                // We haven't hit today's reset hour yet — period started yesterday at resetHour
                currentPeriodStart.setUTCDate(currentPeriodStart.getUTCDate() - 1);
            }
            currentPeriodStart.setUTCHours(resetHour);
            const periodKey = `${currentPeriodStart.toISOString().split('T')[0]}@${String(resetHour).padStart(2,'0')}`;

            const lastResetKey = riskSettings.last_reset_date || null;
            const isManualReset = lastResetKey && lastResetKey.includes('T');  // full ISO timestamp = manual reset

            if (isManualReset) {
                // Manual reset: only override if it's from a previous period (stale)
                const manualResetTime = new Date(lastResetKey);
                if (manualResetTime < currentPeriodStart) {
                    await base44.asServiceRole.entities.RiskManagementSettings.update(riskSettings.id, {
                        daily_loss_current: 0,
                        last_reset_date: periodKey,
                        is_trading_paused: false,
                        limit_hit_at: null,
                    });
                    console.log(`[monitorRiskLimits] Stale manual reset for account ${acctKey} replaced with daily reset — period ${periodKey}`);
                }
                // else: keep manual reset — it's the most recent; don't touch last_reset_date or daily_loss_current
            } else if (lastResetKey !== periodKey) {
                await base44.asServiceRole.entities.RiskManagementSettings.update(riskSettings.id, {
                    daily_loss_current: 0,
                    last_reset_date: periodKey,
                    is_trading_paused: false,
                    limit_hit_at: null,
                });
                console.log(`[monitorRiskLimits] Daily reset for account ${acctKey} at hour ${resetHour} UTC — period ${periodKey}`);
            }

            // Update peak equity per account
            const newPeak = Math.max(riskSettings.peak_equity || 0, equity);
            if (newPeak > (riskSettings.peak_equity || 0)) {
                await base44.asServiceRole.entities.RiskManagementSettings.update(riskSettings.id, { peak_equity: newPeak });
            }

            // Filter closed trades since the LAST RESET for this account (either daily reset hour or manual reset)
            const resetHourForFilter = riskSettings.daily_reset_hour ?? 0;
            const periodStartForFilter = new Date(now);
            periodStartForFilter.setUTCMinutes(0, 0, 0);
            if (now.getUTCHours() < resetHourForFilter) {
                periodStartForFilter.setUTCDate(periodStartForFilter.getUTCDate() - 1);
            }
            periodStartForFilter.setUTCHours(resetHourForFilter);
            // If user manually reset counters (last_reset_date is a full ISO timestamp, not just period key),
            // use the later of periodStartForFilter and the manual reset time — this makes the reset stick
            const manualResetTime = riskSettings.last_reset_date && riskSettings.last_reset_date.includes('T')
                ? new Date(riskSettings.last_reset_date)
                : null;
            const effectiveFilterStart = manualResetTime && manualResetTime > periodStartForFilter
                ? manualResetTime
                : periodStartForFilter;
            const todayClosedTrades = closedTrades.filter(t => {
                const d = t.updated_date || t.created_date;
                return d && new Date(d) >= effectiveFilterStart;
            });

            // Calculate PnL for this account — deduplicate closed trades by ticket first
            // (bridge can create duplicate closed records for same ticket; only count each ticket once)
            const rawAcctClosed = todayClosedTrades.filter(t => t.owner_email === acctKey);
            const seenTickets = new Set();
            const dedupedClosed = rawAcctClosed.filter(t => {
                if (t.ticket && seenTickets.has(t.ticket)) return false;
                if (t.ticket) seenTickets.add(t.ticket);
                return true;
            });
            const acctTodayPnl = dedupedClosed.reduce((sum, t) => sum + (t.pnl || 0), 0);
            const acctFloatingPnl = openTrades
                .filter(t => t.owner_email === acctKey)
                .reduce((sum, t) => sum + (t.pnl || 0), 0);
            const totalDailyPnl = acctTodayPnl + acctFloatingPnl;
            console.log(`[monitorRiskLimits] Account ${acctKey}: ${rawAcctClosed.length} raw closed → ${dedupedClosed.length} deduped | todayPnl=$${acctTodayPnl.toFixed(2)} floatingPnl=$${acctFloatingPnl.toFixed(2)}`);
            const acctOpenCount = openTrades.filter(t => t.owner_email === acctKey).length;

            // Update the tracked daily_loss_current so the UI and downstream logic stay in sync
            const trackedLoss = Math.max(0, -totalDailyPnl);
            await base44.asServiceRole.entities.RiskManagementSettings.update(riskSettings.id, {
                daily_loss_current: trackedLoss
            });

            const alerts = [];

            // --- Check: Max Daily Loss ---
            // Use tracked daily_loss_current instead of recalculating — this way
            // an explicit "Reset Counters" (which zeroes daily_loss_current) actually
            // prevents immediate re-pausing.
            if (riskSettings.max_daily_loss_percent > 0 && trackedLoss > 0) {
                const dailyLossPercent = (trackedLoss / balance) * 100;
                const alertThreshold = (riskSettings.alert_threshold_percent || 80) / 100;

                if (dailyLossPercent >= riskSettings.max_daily_loss_percent) {
                    alerts.push({
                        title: `🚨 Daily Loss Limit Breached! (Acct ${acctKey})`,
                        message: `Account ${acctKey}: Daily loss of ${dailyLossPercent.toFixed(2)}% exceeded the ${riskSettings.max_daily_loss_percent}% limit.${riskSettings.stop_trading_on_limit ? ' Trading paused.' : ''}`,
                        type: 'ERROR',
                    });
                    if (riskSettings.stop_trading_on_limit) {
                        await base44.asServiceRole.entities.RiskManagementSettings.update(riskSettings.id, { is_trading_paused: true, limit_hit_at: now.toISOString() });
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
                        message: `Account ${acctKey}: Drawdown of ${drawdownPercent.toFixed(2)}% exceeded the ${riskSettings.max_drawdown_percent}% limit.${riskSettings.stop_trading_on_limit ? ' Trading paused.' : ''}`,
                        type: 'ERROR',
                    });
                    if (riskSettings.stop_trading_on_limit) {
                        await base44.asServiceRole.entities.RiskManagementSettings.update(riskSettings.id, { is_trading_paused: true, limit_hit_at: now.toISOString() });
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
            // Skip entirely if trading is already paused — target was already handled
            if (riskSettings.daily_profit_target_percent > 0 && !riskSettings.is_trading_paused) {
                // Use already-deduped closed trades
                const todayProfit = dedupedClosed.reduce((sum, t) => sum + (t.pnl || 0), 0);
                const dailyProfitPercent = ((todayProfit + acctFloatingPnl) / balance) * 100;
                if (dailyProfitPercent >= riskSettings.daily_profit_target_percent) {
                    console.log(`[monitorRiskLimits] Account ${acctKey}: Daily profit target reached ${dailyProfitPercent.toFixed(2)}%`);

                    // Pause trading FIRST — this is the primary dedup guard.
                    // Any subsequent monitor run will see is_trading_paused=true and skip this block entirely.
                    await base44.asServiceRole.entities.RiskManagementSettings.update(riskSettings.id, { is_trading_paused: true, limit_hit_at: now.toISOString() });

                    // Double-check: don't fire alert if one already exists for today for this account
                    const todayAlertTitle = `🎯 Daily Profit Target Reached! (Acct ${acctKey})`;
                    const recentProfitAlerts = await base44.asServiceRole.entities.Alert.filter({ title: todayAlertTitle }, '-created_date', 5);
                    const alreadyAlerted = recentProfitAlerts.some(a => {
                        const d = a.created_date || '';
                        return String(d).startsWith(today);
                    });

                    if (!alreadyAlerted) {
                        // Close all open trades for this account
                        const acctOpenTrades = openTrades.filter(t => t.owner_email === acctKey);
                        for (let i = 0; i < acctOpenTrades.length; i += 3) {
                            await Promise.all(acctOpenTrades.slice(i, i + 3).map(t =>
                                base44.asServiceRole.entities.Trade.update(t.id, { status: 'CLOSED', close_price: t.open_price, pnl: t.pnl || 0 })
                            ));
                        }

                        await base44.asServiceRole.entities.Alert.create({
                            title: todayAlertTitle,
                            message: `Account ${acctKey}: Daily profit of ${dailyProfitPercent.toFixed(2)}% reached your ${riskSettings.daily_profit_target_percent}% target. Trading paused until tomorrow.`,
                            type: 'SUCCESS',
                        });
                        console.log(`[monitorRiskLimits] Profit target alert fired for ${acctKey}`);
                    } else {
                        console.log(`[monitorRiskLimits] Profit target alert already exists for ${acctKey} today — skipping`);
                    }
                }
            }

            // Create alerts (deduplicate) and send emails
            if (alerts.length > 0) {
                const recentAlerts = await base44.asServiceRole.entities.Alert.filter({ is_read: false }, '-created_date', 20);

                // Get owner email for this account
                const connOwner = conn.owner_email || (conn.created_by && !conn.created_by.includes('service+') ? conn.created_by : null);

                for (const alert of alerts) {
                    const alreadyExists = recentAlerts.some(a => a.title === alert.title);
                    if (!alreadyExists) {
                        await base44.asServiceRole.entities.Alert.create({ ...alert, is_read: false });
                        console.log(`[monitorRiskLimits] Alert for ${acctKey}: ${alert.title}`);

                        // Send email notification
                        if (connOwner) {
                            await base44.asServiceRole.integrations.Core.SendEmail({
                                to: connOwner,
                                subject: `${alert.type === 'ERROR' ? '🚨' : '⚠️'} ForexTouchAI — ${alert.title}`,
                                body: `${alert.message}\n\nPlease log in to ForexTouchAI to review your account and take action if needed.\n\nForexTouchAI — Automated Risk Monitor`
                            }).catch(e => console.error(`[monitorRiskLimits] Email failed for ${connOwner}:`, e.message));
                        }
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