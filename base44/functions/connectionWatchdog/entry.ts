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

            // ── Unconfirmed closes while the EA is offline ──────────────────
            // This block previously marked such trades CLOSED outright, on the
            // assumption that the position was already gone from the broker.
            //
            // That assumption is unsafe, and it is unsafe in the one direction
            // that costs money. A silent EA is exactly the situation in which we
            // CANNOT know the position's state: the terminal may be shut while
            // the position is still live on the broker's server. Writing CLOSED
            // makes the app show a flat account, stops all monitoring, and
            // records a fabricated P&L — while real money is still exposed.
            //
            // We now alert instead. An unresolved trade the user can see is far
            // better than a resolved one that is a lie.
            try {
                const unconfirmed = await base44.asServiceRole.entities.Trade.filter(
                    { status: 'OPEN', owner_email: acctKey, close_requested: true }, '-created_date', 100
                );
                if (unconfirmed.length > 0) {
                    console.warn(`[WATCHDOG] ${unconfirmed.length} trade(s) on ${acctKey} were flagged to close `
                        + `but the EA has been offline for ${silenceMinutes}m — state UNKNOWN, not auto-closing`);
                    const title = `🚨 Unconfirmed Positions (Acct ${acctKey})`;
                    await base44.asServiceRole.entities.Alert.create({
                        title,
                        message: `${unconfirmed.length} position(s) on account ${acctKey} were flagged to close, but `
                            + `the EA has been offline for ${silenceMinutes} minutes so we cannot confirm whether they `
                            + `actually closed. Tickets: ${unconfirmed.map(t => t.ticket).filter(Boolean).join(', ') || 'unknown'}. `
                            + `CHECK YOUR TERMINAL — these may still be open at the broker. `
                            + `The app will reconcile automatically when the EA reconnects.`,
                        type: 'ERROR', is_read: false,
                    }).catch(e => console.warn('[WATCHDOG] alert failed:', e.message));
                }
            } catch (e) {
                console.warn('[WATCHDOG] unconfirmed-close check error:', e.message);
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