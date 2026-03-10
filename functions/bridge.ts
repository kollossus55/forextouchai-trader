import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            }
        });
    }

    try {
        const base44 = createClientFromRequest(req);

        // Handle empty body (connection test ping from EA)
        const rawText = await req.text();
        if (!rawText || rawText.trim() === '') {
            console.log('[BRIDGE] Connection test ping received');
            return Response.json({ success: true, message: 'Bridge online' }, {
                headers: { 'Access-Control-Allow-Origin': '*' }
            });
        }

        const body = JSON.parse(rawText);
        console.log('[BRIDGE] Incoming payload keys:', Object.keys(body));

        // Support both flat and nested {account:{...}, trades:[...]} format
        const accountData = body.account || body;
        const {
            account_number,
            server_name,
            balance,
            equity,
            margin,
            free_margin,
            margin_level,
            leverage,
            currency,
            platform,
        } = accountData;

        if (!account_number) {
            return Response.json({ error: 'account_number is required' }, {
                status: 400,
                headers: { 'Access-Control-Allow-Origin': '*' }
            });
        }

        const updateData = {
            connection_status: 'CONNECTED',
            last_sync: new Date().toISOString(),
            balance: balance ?? 0,
            equity: equity ?? 0,
            margin: margin ?? 0,
            free_margin: free_margin ?? 0,
            margin_level: margin_level ?? 0,
        };
        if (leverage) updateData.leverage = String(leverage);
        if (currency) updateData.currency = currency;
        if (platform) updateData.platform = platform;
        if (server_name) updateData.server_name = server_name;

        // Single DB call: find existing connection
        const connections = await base44.asServiceRole.entities.BrokerConnection.filter({ account_number: String(account_number) });

        if (connections && connections.length > 0) {
            await base44.asServiceRole.entities.BrokerConnection.update(connections[0].id, updateData);
            console.log('[BRIDGE] Updated connection for account:', account_number);
        } else {
            await base44.asServiceRole.entities.BrokerConnection.create({
                ...updateData,
                account_number: String(account_number),
                server_name: server_name || 'Unknown',
                platform: platform || 'MT4',
            });
            console.log('[BRIDGE] Created new connection for account:', account_number);
        }

        // Reconcile open trades from EA heartbeat
        const eaTrades = body.trades || accountData.trades;
        if (Array.isArray(eaTrades)) {
            const dbOpenTrades = await base44.asServiceRole.entities.Trade.filter({ status: 'OPEN' });
            const dbTickets = new Set(dbOpenTrades.map(t => t.ticket).filter(Boolean));
            const eaTicketSet = new Set(eaTrades.map(t => t.ticket).filter(Boolean));

            // 1. Create Trade records for tickets from EA not yet in DB (must have open_price)
            const newEaTrades = eaTrades.filter(t => t.ticket && !dbTickets.has(t.ticket) && (t.open_price || t.price));
            if (newEaTrades.length > 0) {
                console.log('[BRIDGE] Creating', newEaTrades.length, 'new trades from EA heartbeat');
                const connList = await base44.asServiceRole.entities.BrokerConnection.filter({ account_number: String(account_number) });
                const ownerEmail = connList?.[0]?.created_by || null;
                await Promise.all(newEaTrades.map(t =>
                    base44.asServiceRole.entities.Trade.create({
                        pair: t.pair || t.symbol,
                        type: t.type,
                        lot_size: t.lot_size || t.lots || 0.1,
                        open_price: t.open_price || t.price,
                        pnl: t.pnl || t.profit || 0,
                        status: 'OPEN',
                        ticket: t.ticket,
                        is_auto: false,
                        owner_email: ownerEmail,
                    })
                ));
            }

            // 2. Close DB trades whose tickets are no longer reported by EA
            const closedTrades = dbOpenTrades.filter(t => t.ticket && !eaTicketSet.has(t.ticket) && t.open_price > 0);
            if (closedTrades.length > 0) {
                console.log('[BRIDGE] Closing', closedTrades.length, 'trades no longer in EA');
                await Promise.all(closedTrades.map(t =>
                    base44.asServiceRole.entities.Trade.update(t.id, { status: 'CLOSED', close_price: t.open_price })
                ));
            }
        }

        // Return pending signals for EA to execute (limit to 5 most recent to avoid buffer overflow)
        const allPendingSignals = await base44.asServiceRole.entities.Signal.filter({ status: 'PENDING' }, '-created_date', 100);
        
        // Auto-expire signals older than 5 minutes (they're stale and will never execute)
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const staleSignals = allPendingSignals.filter(s => s.created_date < fiveMinutesAgo);
        if (staleSignals.length > 0) {
            console.log('[BRIDGE] Expiring', staleSignals.length, 'stale pending signals');
            await Promise.all(staleSignals.map(s =>
                base44.asServiceRole.entities.Signal.update(s.id, { status: 'EXPIRED' })
            ));
        }
        
        const pendingSignals = allPendingSignals.filter(s => s.created_date >= fiveMinutesAgo).slice(0, 5);
        console.log('[BRIDGE] Returning', pendingSignals.length, 'pending signals to EA');

        // Mark signals as ACTIVE immediately so they are NOT re-sent next heartbeat
        if (pendingSignals.length > 0) {
            await Promise.all(pendingSignals.map(s =>
                base44.asServiceRole.entities.Signal.update(s.id, { status: 'ACTIVE' })
            ));
        }

        return Response.json({
            success: true,
            message: 'Sync successful',
            account: account_number,
            timestamp: new Date().toISOString(),
            pending_signals: pendingSignals.map(s => ({
                id: s.id,
                pair: (s.pair || '').replace('/', ''),
                type: s.type,
                lot_size: s.lot_size || 0.1,
                stop_loss: s.stop_loss || 0,
                take_profit: s.take_profit || 0,
                entry_price: s.entry_price || 0,
            }))
        }, {
            headers: { 'Access-Control-Allow-Origin': '*' }
        });

    } catch (error) {
        console.error('[BRIDGE ERROR]', error.message);
        return Response.json({ error: error.message }, {
            status: 500,
            headers: { 'Access-Control-Allow-Origin': '*' }
        });
    }
});