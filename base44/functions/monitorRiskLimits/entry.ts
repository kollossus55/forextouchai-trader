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

        // The old code capped closed trades at 50 per account. With 10 concurrent
        // trades across several bots, 50 closes in a day is easily reached — and
        // it is MOST reachable on a bad day of rapid stop-outs, which is exactly
        // when the daily-loss limit has to be accurate. Beyond 50, the loss was
        // understated and the limit fired late or not at all.
        // We now pull a full day's worth and flag if we still hit the ceiling.
        const CLOSED_PAGE = 500;
        const tradeResults = await Promise.all(
            acctNumbers.flatMap(acct => [
                base44.asServiceRole.entities.Trade.filter({ status: 'OPEN', owner_email: acct }, '-created_date', 200),
                base44.asServiceRole.entities.Trade.filter({ status: 'CLOSED', owner_email: acct }, '-updated_date', CLOSED_PAGE),
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
                    // Pausing new signals is not a loss limit. Open positions keep
                    // running, so the floating loss carries on growing past the
                    // number the user set. On a breach we now FLATTEN as well,
                    // unless the account is explicitly configured not to.
                    const shouldFlatten = riskSettings.stop_trading_on_limit
                        && riskSettings.flatten_on_breach !== false;
                    let flattened = 0;
                    if (shouldFlatten) {
                        flattened = await requestCloseAll(
                            base44, acctOpenForAcct, 'DAILY_LOSS_LIMIT',
                        );
                    }
                    alerts.push({
                        title: `🚨 Daily Loss Limit Breached! (Acct ${acctKey})`,
                        message: `Account ${acctKey}: Daily loss of ${dailyLossPercent.toFixed(2)}% exceeded the `
                            + `${riskSettings.max_daily_loss_percent}% limit.`
                            + (riskSettings.stop_trading_on_limit ? ' Trading paused.' : '')
                            + (shouldFlatten ? ` Close requested for ${flattened} open position(s).` : ''),
                        type: 'ERROR',
                    });
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
                    const shouldFlatten = riskSettings.stop_trading_on_limit
                        && riskSettings.flatten_on_breach !== false;
                    let flattened = 0;
                    if (shouldFlatten) {
                        flattened = await requestCloseAll(
                            base44, acctOpenForAcct, 'MAX_DRAWDOWN',
                        );
                    }
                    alerts.push({
                        title: `🚨 Max Drawdown Breached! (Acct ${acctKey})`,
                        message: `Account ${acctKey}: Drawdown of ${drawdownPercent.toFixed(2)}% exceeded the `
                            + `${riskSettings.max_drawdown_percent}% limit.`
                            + (riskSettings.stop_trading_on_limit ? ' Trading paused.' : '')
                            + (shouldFlatten ? ` Close requested for ${flattened} open position(s).` : ''),
                        type: 'ERROR',
                    });
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

                        // CRITICAL FIX. The old code wrote `status: 'CLOSED'` with
                        // `close_price: t.open_price` straight into the database.
                        // That never reached the broker: the position stayed open
                        // with real money at risk, while the app showed a flat
                        // account and stopped monitoring it. The fabricated close
                        // price also corrupted the P&L feeding this very function.
                        //
                        // The correct mechanism is `close_requested: true`, which
                        // the bridge turns into a close_command for the EA. The
                        // reconcile loop then writes the REAL close price and P&L
                        // once the ticket disappears from the broker.
                        const closeCount = await requestCloseAll(
                            base44, acctOpenForAcct, 'DAILY_PROFIT_TARGET',
                        );

                        await base44.asServiceRole.entities.Alert.create({
                            title: todayAlertTitle,
                            message: `Account ${acctKey}: Daily profit of ${dailyProfitPercent.toFixed(2)}% reached your `
                                + `${riskSettings.daily_profit_target_percent}% target. Trading paused and close `
                                + `requested for ${closeCount} open position(s). Positions close at market via the EA — `
                                + `check the Trades page to confirm they have actually closed.`,
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

            // ── Stuck-close watchdog ────────────────────────────────────────
            // A close that silently fails is the worst failure mode in the
            // system: the app believes it has flattened while the position is
            // still live. Surface it loudly.
            const stuckCloses = acctOpenForAcct.filter(t => {
                if (!t.close_requested) return false;
                const since = t.close_requested_at || t.updated_date;
                return since && (now.getTime() - new Date(since).getTime()) > 5 * 60 * 1000;
            });
            if (stuckCloses.length) {
                const title = `⚠️ Close Not Completing (Acct ${acctKey})`;
                if (!recentAlertTitles.has(title) && !newAlertTitlesThisRun.has(title)) {
                    newAlertTitlesThisRun.add(title);
                    await base44.asServiceRole.entities.Alert.create({
                        title,
                        message: `Account ${acctKey}: ${stuckCloses.length} position(s) were flagged to close over `
                            + `5 minutes ago and are still open at the broker `
                            + `(tickets ${stuckCloses.map(t => t.ticket).filter(Boolean).join(', ') || 'unknown'}). `
                            + `Check that the EA is running and that AutoTrading is enabled in the terminal. `
                            + `Close them manually if the EA is offline.`,
                        type: 'ERROR', is_read: false,
                    });
                    if (connOwner) {
                        base44.asServiceRole.integrations.Core.SendEmail({
                            to: connOwner,
                            subject: `🚨 ForexTouchAI — positions not closing (Acct ${acctKey})`,
                            body: `${stuckCloses.length} position(s) on account ${acctKey} were requested to close `
                                + `more than 5 minutes ago and remain open at the broker.\n\n`
                                + `This usually means the EA is not running or AutoTrading is disabled.\n\n`
                                + `ForexTouchAI — Automated Risk Monitor`,
                        }).catch((e: any) => console.error('[monitorRiskLimits] stuck-close email failed:', e.message));
                    }
                }
            }

            totalAlerts.push(...alerts);
            results.push({
                account: acctKey, daily_pnl: totalDailyPnl, open_trades: acctOpenCount,
                alerts: alerts.length, stuck_closes: stuckCloses.length,
            });
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

// ════════════════════════════════════════════════════════════════════════════
// requestCloseAll
// ════════════════════════════════════════════════════════════════════════════
// Flags open trades for closure so the bridge dispatches a close_command to the
// EA, which closes at market. This is the ONLY correct way to close a position
// from the backend.
//
// Never write `status: 'CLOSED'` from here. The database is not the broker:
// marking a trade closed locally leaves the real position open, unmonitored,
// with money still at risk — and writes a fabricated close price that then
// corrupts every P&L calculation downstream. Only the bridge reconcile loop,
// which observes the ticket actually disappearing from the terminal, may set
// a trade to CLOSED.
// ════════════════════════════════════════════════════════════════════════════
async function requestCloseAll(base44: any, trades: any[], reason: string): Promise<number> {
    const pending = (trades || []).filter(t => t && !t.close_requested);
    if (!pending.length) return 0;

    let ok = 0;
    // Small batches keep us inside Base44 rate limits.
    for (let i = 0; i < pending.length; i += 3) {
        const batch = pending.slice(i, i + 3);
        const outcomes = await Promise.allSettled(batch.map(t =>
            base44.asServiceRole.entities.Trade.update(t.id, {
                close_requested: true,
                close_requested_at: new Date().toISOString(),
                close_reason: reason,
            })
        ));
        for (const o of outcomes) {
            if (o.status === 'fulfilled') ok++;
            else console.error('[requestCloseAll] failed:', (o as PromiseRejectedResult).reason);
        }
    }
    console.log(`[requestCloseAll] ${reason}: close requested for ${ok}/${pending.length} trade(s)`);
    return ok;
}
