import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Alert throttle: max 1 alert per account per hour to avoid spam
const lastAlertTs = {}; // keyed by account_number → timestamp
const ALERT_THROTTLE_MS = 60 * 60 * 1000; // 1 hour

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
        if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

        // Forex market is closed Friday 21:00 UTC → Sunday 22:00 UTC.
        // During this window the EA legitimately stops heartbeating, so skip
        // disconnection alerts to avoid weekend noise.
        const _wd = new Date();
        const _wdDay = _wd.getUTCDay(), _wdH = _wd.getUTCHours();
        if (_wdDay === 6 || (_wdDay === 0 && _wdH < 22) || (_wdDay === 5 && _wdH >= 21)) {
            return Response.json({ success: true, weekend: true, message: 'Forex market closed — alerts suppressed' });
        }

        // Fetch all broker connections (service role — sees all accounts)
        const connections = await base44.asServiceRole.entities.BrokerConnection.list('-created_date', 100);

        if (!connections || connections.length === 0) {
            return Response.json({ message: 'No broker connections found', checked: 0 });
        }

        const now = Date.now();
        const SILENCE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes of silence = alert

        const results = [];

        for (const conn of connections) {
            const acctKey = conn.account_number;
            if (!acctKey) continue;

            // Skip accounts with no last_sync ever set
            if (!conn.last_sync) continue;

            const lastSync = new Date(conn.last_sync).getTime();
            const silenceMs = now - lastSync;
            const silenceMinutes = Math.floor(silenceMs / 60000);

            // Only alert if silent for more than 10 minutes
            if (silenceMs < SILENCE_THRESHOLD_MS) {
                results.push({ account: acctKey, status: 'ok', silence_minutes: silenceMinutes });
                continue;
            }

            // ── Ghost-trade cleanup: auto-close trades flagged close_requested ──
            // The bridge's close-command logic only runs during EA heartbeats, so
            // if the EA is offline these trades stay OPEN forever even though the
            // position is already gone from the broker (hit SL/TP or was flattened
            // by the schedule OFF event before the EA disconnected).
            try {
                const ghostTrades = await base44.asServiceRole.entities.Trade.filter(
                    { status: 'OPEN', owner_email: acctKey, close_requested: true }, '-created_date', 100
                );
                if (ghostTrades.length > 0) {
                    console.log(`[WATCHDOG] Auto-closing ${ghostTrades.length} ghost trade(s) for ${acctKey} (EA offline ${silenceMinutes}m)`);
                    await Promise.all(ghostTrades.map(t =>
                        base44.asServiceRole.entities.Trade.update(t.id, {
                            status: 'CLOSED',
                            close_price: t.close_price || 0,
                            pnl: t.pnl || 0,
                        }).catch(e => console.warn('[WATCHDOG] Ghost close error:', e.message))
                    ));
                }
            } catch (e) {
                console.warn('[WATCHDOG] Ghost-trade cleanup error:', e.message);
            }

            // Throttle: skip if we already alerted within the last hour
            const lastAlert = lastAlertTs[acctKey] || 0;
            if (now - lastAlert < ALERT_THROTTLE_MS) {
                results.push({ account: acctKey, status: 'silent_throttled', silence_minutes: silenceMinutes });
                continue;
            }

            lastAlertTs[acctKey] = now;

            const alertTitle = `🔌 EA Disconnected — Account ${acctKey}`;
            const alertMessage = `No heartbeat received from MT4/MT5 EA for account ${acctKey} in ${silenceMinutes} minutes. Last seen: ${new Date(lastSync).toLocaleString()}. Check your Expert Advisor is running and WebRequest is allowed.`;

            // Create in-app alert
            await base44.asServiceRole.entities.Alert.create({
                title: alertTitle,
                message: alertMessage,
                type: 'ERROR',
                is_read: false,
            }).catch(e => console.error('[WATCHDOG] Alert create error:', e.message));

            // Mark connection as DISCONNECTED
            await base44.asServiceRole.entities.BrokerConnection.update(conn.id, {
                connection_status: 'DISCONNECTED',
            }).catch(e => console.error('[WATCHDOG] Connection status update error:', e.message));

            // Send email to account owner
            const ownerEmail = conn.owner_email || null;
            if (ownerEmail) {
                await base44.asServiceRole.integrations.Core.SendEmail({
                    to: ownerEmail,
                    subject: `🔌 ForexTouchAI — EA Disconnected (Account ${acctKey})`,
                    body: `Your MT4/MT5 Expert Advisor has stopped communicating with ForexTouchAI.\n\nAccount: ${acctKey}\nServer: ${conn.server_name || 'Unknown'}\nLast Heartbeat: ${new Date(lastSync).toLocaleString()}\nSilent For: ${silenceMinutes} minutes\n\nPossible causes:\n• MetaTrader was closed or restarted\n• EA was removed from the chart\n• WebRequest URL not whitelisted (Tools → Options → Expert Advisors)\n• Internet connectivity issue\n\nPlease check your MetaTrader terminal and ensure the EA is running on the correct chart.\n\nYou will receive another alert in 1 hour if the issue persists.`,
                }).catch(e => console.error('[WATCHDOG] Email error:', e.message));
                console.log(`[WATCHDOG] Disconnection alert sent to ${ownerEmail} for account ${acctKey} (silent ${silenceMinutes}m)`);
            }

            results.push({ account: acctKey, status: 'alert_sent', silence_minutes: silenceMinutes, owner_email: ownerEmail });
        }

        console.log('[WATCHDOG] Check complete:', JSON.stringify(results));
        return Response.json({ success: true, checked: connections.length, results });

    } catch (error) {
        console.error('[WATCHDOG ERROR]', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});