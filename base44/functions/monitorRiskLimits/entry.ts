import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
        if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
        const now = new Date();
        const today = now.toISOString().split('T')[0];

        // ── Step 1: Fetch essential data only ──
        const [riskSettingsList, brokerConnections] = await Promise.all([
            base44.asServiceRole.entities.RiskManagementSettings.list('-created_date', 50),
            base44.asServiceRole.entities.BrokerConnection.list('-updated_date', 20),
        ]);

        const connectedAccounts = brokerConnections.filter(c => c.connection_status === 'CONNECTED' && c.balance > 0);
        if (connectedAccounts.length === 0) {
            return Response.json({ success: true, message: 'No connected broker accounts with balance — skipping' });
        }

        // ── Step 2: Fetch trades per connected account (avoids full-table timeout) ──
        const acctNumbers = connectedAccounts.map(c => c.account_number).filter(Boolean);
        const tradeResults = await Promise.all(
            acctNumbers.flatMap(acct => [
                base44.asServiceRole.entities.Trade.filter({ status: 'OPEN', owner_email: acct }, '-created_date', 50),
                base44.asServiceRole.entities.Trade.filter({ status: 'CLOSED', owner_email: acct }, '-updated_date', 50),
            ])
        );
        // Interleaved: [open0, closed0, open1, closed1, ...]
        const openTrades = tradeResults.filter((_, i) => i % 2 === 0).flat();
        const closedTrades = tradeResults.filter((_, i) => i % 2 === 1).flat();

        // Build risk settings maps
        const globalSettings = riskSettingsList.find(r => !r.account_number) || null;
        const accountSettingsMap = {};
        for (const r of riskSettingsList) {
            if (r.account_number) accountSettingsMap[r.account_number] = r;
        }

        // Fetch recent alerts ONCE for all accounts (avoid per-account queries)
        const recentAlerts = await base44.asServiceRole.entities.Alert.filter({ is_read: false }, '-created_date', 50);
        const recentAlertTitles = new Set(recentAlerts.map(a => a.title));
        const newAlertTitlesThisRun = new Set(); // prevent duplicates within same run

        const totalAlerts = [];
        const results = [];

        for (const conn of connectedAccounts) {
            const acctKey = conn.account_number;
            if (!acctKey) continue;

            const riskSettings = accountSettingsMap[acctKey] || globalSettings;
            if (!riskSettings) continue;

            const balance = conn.balance || 0;
            const equity = conn.equity || 0;

            // ── Auto-resume ──
            const autoResumeHours = riskSettings.auto_resume_hours || 0;
            const limitHitAt = riskSettings.limit_hit_at ? new Date(riskSettings.limit_hit_at) : null;
            if (riskSettings.is_trading_paused && autoResumeHours > 0 && limitHitAt) {
                const elapsedMs = now.getTime() - limitHitAt.getTime();
                if (elapsedMs >= autoResumeHours * 60 * 60 * 1000) {
                    await base44.asServiceRole.entities.RiskManagementSettings.update(riskSettings.id, {
                        is_trading_paused: false,
                        daily_loss_current: 0,
                        last_reset_date: today,
                        limit_hit_at: null,
                    });
                    console.log(`[monitorRiskLimits] Auto-resumed account ${acctKey}`);
                    riskSettings.is_trading_paused = false;
                    riskSettings.daily_loss_current = 0;

                    const resumeTitle = `✅ Trading Auto-Resumed (Acct ${acctKey})`;
                    if (!recentAlertTitles.has(resumeTitle) && !newAlertTitlesThisRun.has(resumeTitle)) {
                        newAlertTitlesThisRun.add(resumeTitle);
                        await base44.asServiceRole.entities.Alert.create({
                            title: resumeTitle,
                            message: `Account ${acctKey}: Trading automatically resumed after ${autoResumeHours}h cooldown.`,
                            type: 'SUCCESS',
                        });
                        if (conn.owner_email) {
                            base44.asServiceRole.integrations.Core.SendEmail({
                                to: conn.owner_email,
                                subject: `✅ ForexTouchAI — Trading Auto-Resumed (Acct ${acctKey})`,
                                body: `Account ${acctKey}: Trading resumed after the ${autoResumeHours}h cooldown period.\n\nForexTouchAI — Automated Risk Monitor`
                            }).catch(e => console.error(`[monitorRiskLimits] Resume email failed:`, e.message));
                        }
                    }
                }
            }

            // ── Daily reset ──
            const resetHour = riskSettings.daily_reset_hour ?? 0;
            const currentPeriodStart = new Date(now);
            currentPeriodStart.setUTCMinutes(0, 0, 0);
            if (now.getUTCHours() < resetHour) currentPeriodStart.setUTCDate(currentPeriodStart.getUTCDate() - 1);
            currentPeriodStart.setUTCHours(resetHour);
            const periodKey = `${currentPeriodStart.toISOString().split('T')[0]}@${String(resetHour).padStart(2, '0')}`;
            const lastResetKey = riskSettings.last_reset_date || null;
            const isManualReset = lastResetKey && lastResetKey.includes('T');

            // Daily reset clears ALL pauses (breach-based AND manual) so an account can
            // never get stuck paused without a live breach. Breach pauses also auto-resume
            // earlier via the auto_resume_hours logic above; this is the daily safety net.
            if (isManualReset) {
                const manualResetTime = new Date(lastResetKey);
                if (manualResetTime < currentPeriodStart) {
                    await base44.asServiceRole.entities.RiskManagementSettings.update(riskSettings.id, {
                        daily_loss_current: 0,
                        last_reset_date: periodKey,
                        is_trading_paused: false,
                        limit_hit_at: null,
                    });
                }
            } else if (lastResetKey !== periodKey) {
                await base44.asServiceRole.entities.RiskManagementSettings.update(riskSettings.id, {
                    daily_loss_current: 0,
                    last_reset_date: periodKey,
                    is_trading_paused: false,
                    limit_hit_at: null,
                });
                console.log(`[monitorRiskLimits] Daily reset for ${acctKey} — period ${periodKey} (pause cleared)`);
            }

            // ── Peak equity — only write if changed ──
            const newPeak = Math.max(riskSettings.peak_equity || 0, equity);
            if (newPeak > (riskSettings.peak_equity || 0)) {
                await base44.asServiceRole.entities.RiskManagementSettings.update(riskSettings.id, { peak_equity: newPeak });
            }

            // ── Filter closed trades for this account since last reset ──
            const manualResetTime = isManualReset ? new Date(lastResetKey) : null;
            const effectiveFilterStart = manualResetTime && manualResetTime > currentPeriodStart ? manualResetTime : currentPeriodStart;
            const rawAcctClosed = closedTrades.filter(t => {
                if (t.owner_email !== acctKey) return false;
                const d = t.updated_date || t.created_date;
                return d && new Date(d) >= effectiveFilterStart;
            });
            const seenTickets = new Set();
            const dedupedClosed = rawAcctClosed.filter(t => {
                if (t.ticket && seenTickets.has(t.ticket)) return false;
                if (t.ticket) seenTickets.add(t.ticket);
                return true;
            });

            const acctTodayPnl = dedupedClosed.reduce((sum, t) => sum + (t.pnl || 0), 0);
            const acctOpenForAcct = openTrades.filter(t => t.owner_email === acctKey);
            const acctFloatingPnl = acctOpenForAcct.reduce((sum, t) => sum + (t.pnl || 0), 0);
            const totalDailyPnl = acctTodayPnl + acctFloatingPnl;
            const acctOpenCount = acctOpenForAcct.length;
            const trackedLoss = Math.max(0, -totalDailyPnl);

            // Only write daily_loss_current if it changed by more than $0.50 (reduces DB writes)
            if (Math.abs(trackedLoss - (riskSettings.daily_loss_current || 0)) > 0.5) {
                await base44.asServiceRole.entities.RiskManagementSettings.update(riskSettings.id, { daily_loss_current: trackedLoss });
            }
            console.log(`[monitorRiskLimits] ${acctKey}: todayPnl=$${acctTodayPnl.toFixed(2)} floating=$${acctFloatingPnl.toFixed(2)} loss=$${trackedLoss.toFixed(2)}`);

            const alerts = [];
            const connOwner = conn.owner_email || null;

            // ── Max Daily Loss ──
            if (riskSettings.max_daily_loss_percent > 0 && trackedLoss > 0) {
                const dailyLossPercent = (trackedLoss / balance) * 100;
                const alertThreshold = (riskSettings.alert_threshold_percent || 80) / 100;
                if (dailyLossPercent >= riskSettings.max_daily_loss_percent) {
                    alerts.push({ title: `🚨 Daily Loss Limit Breached! (Acct ${acctKey})`, message: `Account ${acctKey}: Daily loss of ${dailyLossPercent.toFixed(2)}% exceeded the ${riskSettings.max_daily_loss_percent}% limit.${riskSettings.stop_trading_on_limit ? ' Trading paused.' : ''}`, type: 'ERROR' });
                    if (riskSettings.stop_trading_on_limit) {
                        await base44.asServiceRole.entities.RiskManagementSettings.update(riskSettings.id, { is_trading_paused: true, limit_hit_at: now.toISOString() });
                    }
                } else if (dailyLossPercent >= riskSettings.max_daily_loss_percent * alertThreshold) {
                    alerts.push({ title: `⚠️ Daily Loss Warning (Acct ${acctKey})`, message: `Account ${acctKey}: Daily loss at ${dailyLossPercent.toFixed(2)}% — approaching the ${riskSettings.max_daily_loss_percent}% limit.`, type: 'WARNING' });
                }
            }

            // ── Max Drawdown ──
            if (riskSettings.max_drawdown_percent > 0 && newPeak > 0) {
                const drawdownPercent = ((newPeak - equity) / newPeak) * 100;
                const alertThreshold = (riskSettings.alert_threshold_percent || 80) / 100;
                if (drawdownPercent >= riskSettings.max_drawdown_percent) {
                    alerts.push({ title: `🚨 Max Drawdown Breached! (Acct ${acctKey})`, message: `Account ${acctKey}: Drawdown of ${drawdownPercent.toFixed(2)}% exceeded the ${riskSettings.max_drawdown_percent}% limit.${riskSettings.stop_trading_on_limit ? ' Trading paused.' : ''}`, type: 'ERROR' });
                    if (riskSettings.stop_trading_on_limit) {
                        await base44.asServiceRole.entities.RiskManagementSettings.update(riskSettings.id, { is_trading_paused: true, limit_hit_at: now.toISOString() });
                    }
                } else if (drawdownPercent >= riskSettings.max_drawdown_percent * alertThreshold) {
                    alerts.push({ title: `⚠️ Drawdown Warning (Acct ${acctKey})`, message: `Account ${acctKey}: Drawdown at ${drawdownPercent.toFixed(2)}% — approaching the ${riskSettings.max_drawdown_percent}% limit.`, type: 'WARNING' });
                }
            }

            // ── Max Concurrent Trades ──
            if (riskSettings.max_concurrent_trades > 0 && acctOpenCount >= riskSettings.max_concurrent_trades) {
                alerts.push({ title: `⚠️ Max Trades Reached (Acct ${acctKey})`, message: `Account ${acctKey}: ${acctOpenCount} trades open — at the limit of ${riskSettings.max_concurrent_trades}.`, type: 'WARNING' });
            }

            // ── Daily Profit Target ──
            if (riskSettings.daily_profit_target_percent > 0 && !riskSettings.is_trading_paused) {
                const dailyProfitPercent = ((acctTodayPnl + acctFloatingPnl) / balance) * 100;
                if (dailyProfitPercent >= riskSettings.daily_profit_target_percent) {
                    const todayAlertTitle = `🎯 Daily Profit Target Reached! (Acct ${acctKey})`;
                    if (!recentAlertTitles.has(todayAlertTitle) && !newAlertTitlesThisRun.has(todayAlertTitle)) {
                        await base44.asServiceRole.entities.RiskManagementSettings.update(riskSettings.id, { is_trading_paused: true, limit_hit_at: now.toISOString() });
                        newAlertTitlesThisRun.add(todayAlertTitle);
                        // Close open trades in batches
                        for (let i = 0; i < acctOpenForAcct.length; i += 3) {
                            await Promise.all(acctOpenForAcct.slice(i, i + 3).map(t =>
                                base44.asServiceRole.entities.Trade.update(t.id, { status: 'CLOSED', close_price: t.open_price, pnl: t.pnl || 0 })
                            ));
                        }
                        await base44.asServiceRole.entities.Alert.create({
                            title: todayAlertTitle,
                            message: `Account ${acctKey}: Daily profit of ${dailyProfitPercent.toFixed(2)}% reached your ${riskSettings.daily_profit_target_percent}% target. Trading paused.`,
                            type: 'SUCCESS',
                        });
                        console.log(`[monitorRiskLimits] Profit target alert fired for ${acctKey}`);
                    }
                }
            }

            // ── Deduplicated alerts (using in-memory set — no extra DB queries) ──
            for (const alert of alerts) {
                if (!recentAlertTitles.has(alert.title) && !newAlertTitlesThisRun.has(alert.title)) {
                    newAlertTitlesThisRun.add(alert.title);
                    await base44.asServiceRole.entities.Alert.create({ ...alert, is_read: false });
                    console.log(`[monitorRiskLimits] Alert for ${acctKey}: ${alert.title}`);
                    if (connOwner) {
                        base44.asServiceRole.integrations.Core.SendEmail({
                            to: connOwner,
                            subject: `${alert.type === 'ERROR' ? '🚨' : '⚠️'} ForexTouchAI — ${alert.title}`,
                            body: `${alert.message}\n\nLog in to ForexTouchAI to review your account.\n\nForexTouchAI — Automated Risk Monitor`
                        }).catch(e => console.error(`[monitorRiskLimits] Email failed:`, e.message));
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
        });

    } catch (error) {
        console.error('[monitorRiskLimits ERROR]', error.message);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});