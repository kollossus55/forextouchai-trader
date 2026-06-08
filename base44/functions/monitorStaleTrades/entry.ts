import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Thresholds
const FOREX_STALE_HOURS = 24;
const INDEX_STALE_HOURS = 48;
const NEGATIVE_PNL_THRESHOLD = -10; // Only alert if loss exceeds this

// Index pairs (not pip-based, different thresholds)
const INDEX_PAIRS = new Set(['US30', 'SPX500', 'SPX/500', 'JPN225', 'JPN/225', 'GER30', 'HK50', 'AUS200', 'AUS/200', 'ESP35', 'UK100', 'NAS100']);

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        // Allow both scheduled (service role) and manual admin calls
        let isAdmin = false;
        try {
            const user = await base44.auth.me();
            isAdmin = user?.role === 'admin';
        } catch {
            // Called by scheduler without user context — proceed as service
        }

        const openTrades = await base44.asServiceRole.entities.Trade.filter({ status: 'OPEN' }, '-created_date', 500);
        const now = Date.now();

        const staleTrades = openTrades.filter(trade => {
            const openedAt = new Date(trade.created_date).getTime();
            const hoursOpen = (now - openedAt) / (1000 * 60 * 60);
            const pairRaw = (trade.pair || '').replace('/', '').toUpperCase();
            const isIndex = INDEX_PAIRS.has(pairRaw) || INDEX_PAIRS.has(trade.pair || '');
            const threshold = isIndex ? INDEX_STALE_HOURS : FOREX_STALE_HOURS;
            const pnl = trade.pnl || 0;

            // Flag if: open too long AND in negative territory beyond threshold
            return hoursOpen >= threshold && pnl <= NEGATIVE_PNL_THRESHOLD;
        });

        if (staleTrades.length === 0) {
            return Response.json({ success: true, stale_trades: 0, message: 'No stale trades found' });
        }

        // Build alert details
        const tradeDetails = staleTrades.map(t => {
            const hoursOpen = Math.floor((now - new Date(t.created_date).getTime()) / (1000 * 60 * 60));
            return `• ${t.type} ${t.pair} | Account: ${t.owner_email} | Open: ${hoursOpen}h | PnL: $${(t.pnl || 0).toFixed(2)} | Ticket: ${t.ticket || 'N/A'}`;
        }).join('\n');

        // Get unique owner emails to notify
        const ownerEmails = new Set();
        for (const trade of staleTrades) {
            // Find broker connection owner for this account
            const connections = await base44.asServiceRole.entities.BrokerConnection.filter({ account_number: trade.owner_email }, '-created_date', 5);
            for (const conn of connections) {
                const email = conn.owner_email || (conn.created_by && !conn.created_by.includes('service+') ? conn.created_by : null);
                if (email) ownerEmails.add(email);
            }
        }

        // Also notify admins
        const users = await base44.asServiceRole.entities.User.list('-created_date', 50).catch(() => []);
        for (const u of users) {
            if (u.role === 'admin' && u.email) ownerEmails.add(u.email);
        }

        const emailBody = `⚠️ STALE TRADE ALERT — ForexTouchAI\n\nThe following trades have been open for an extended period with significant losses and may require your attention:\n\n${tradeDetails}\n\n---\nThresholds:\n• Forex pairs: ${FOREX_STALE_HOURS}h open + PnL ≤ $${NEGATIVE_PNL_THRESHOLD}\n• Index pairs: ${INDEX_STALE_HOURS}h open + PnL ≤ $${NEGATIVE_PNL_THRESHOLD}\n\nPlease review these trades on your MT4/MT5 platform.\n\nForexTouchAI — Automated Risk Monitor`;

        // Create in-app alerts and send emails
        const alertPromises = [];

        // In-app alert
        alertPromises.push(
            base44.asServiceRole.entities.Alert.create({
                title: `⚠️ ${staleTrades.length} Stale Trade(s) Detected`,
                message: `${staleTrades.length} trade(s) have been open too long with losses exceeding $${Math.abs(NEGATIVE_PNL_THRESHOLD)}. Review: ${staleTrades.map(t => `${t.type} ${t.pair} ($${(t.pnl||0).toFixed(2)})`).join(', ')}`,
                type: 'WARNING',
                is_read: false
            })
        );

        // Email notifications
        for (const email of ownerEmails) {
            alertPromises.push(
                base44.asServiceRole.integrations.Core.SendEmail({
                    to: email,
                    subject: `⚠️ ForexTouchAI — ${staleTrades.length} Stale Trade Alert`,
                    body: emailBody
                }).catch(e => console.error(`Failed to email ${email}:`, e.message))
            );
        }

        await Promise.all(alertPromises);

        console.log(`[monitorStaleTrades] Found ${staleTrades.length} stale trades — notified ${ownerEmails.size} user(s)`);

        return Response.json({
            success: true,
            stale_trades: staleTrades.length,
            notified: [...ownerEmails],
            trades: staleTrades.map(t => ({ pair: t.pair, account: t.owner_email, pnl: t.pnl, ticket: t.ticket }))
        });

    } catch (error) {
        console.error('[monitorStaleTrades ERROR]', error.message);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});