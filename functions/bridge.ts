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

        // Reconcile open trades
        const dbOpenTrades = await base44.asServiceRole.entities.Trade.filter({ status: 'OPEN' });
        
        // 1. Close any trades with bad data (open_price = 0 are ghost/rogue trades)
        const ghostTrades = dbOpenTrades.filter(t => !t.open_price || t.open_price === 0);
        if (ghostTrades.length > 0) {
            console.log('[BRIDGE] Closing', ghostTrades.length, 'ghost trades with no open price');
            await Promise.all(ghostTrades.map(t =>
                base44.asServiceRole.entities.Trade.update(t.id, { status: 'CLOSED' })
            ));
        }

        // 2. Sync EA's open trades - create missing ones, close removed ones
        const eaTrades = body.trades || accountData.trades;
        if (Array.isArray(eaTrades) && eaTrades.length > 0) {
            const dbTickets = dbOpenTrades.map(t => t.ticket).filter(Boolean);
            
            // Create Trade records for any new tickets from EA not in DB
            const newEaTrades = eaTrades.filter(t => t.ticket && !dbTickets.includes(t.ticket));
            if (newEaTrades.length > 0) {
                console.log('[BRIDGE] Creating', newEaTrades.length, 'new trades from EA heartbeat');
                
                // Get owner email from broker connection
                const connList = await base44.asServiceRole.entities.BrokerConnection.filter({ account_number: String(account_number) });
                const ownerEmail = connList?.[0]?.created_by || null;

                await Promise.all(newEaTrades.map(t =>
                    base44.asServiceRole.entities.Trade.create({
                        pair: t.pair || t.symbol,
                        type: t.type,
                        lot_size: t.lot_size || t.lots || 0.1,
                        open_price: t.open_price || t.price || 0,
                        pnl: t.pnl || t.profit || 0,
                        status: 'OPEN',
                        ticket: t.ticket,
                        is_auto: false,
                        owner_email: ownerEmail,
                    })
                ));

                // Mark corresponding PENDING signals as ACTIVE
                const pendingSignals = await base44.asServiceRole.entities.Signal.filter({ status: 'PENDING' });
                for (const newTrade of newEaTrades) {
                    const matchingSignal = pendingSignals.find(s => 
                        s.pair === (newTrade.pair || newTrade.symbol) && s.type === newTrade.type
                    );
                    if (matchingSignal) {
                        await base44.asServiceRole.entities.Signal.update(matchingSignal.id, { status: 'ACTIVE' });
                        console.log('[BRIDGE] Marked signal ACTIVE for new trade:', newTrade.ticket);
                    }
                }
            }

            // Close DB trades whose tickets are no longer in EA list
            const eaTickets = eaTrades.map(t => t.ticket).filter(Boolean);
            const validOpen = dbOpenTrades.filter(t => t.open_price && t.open_price > 0);
            const rogues = validOpen.filter(t => t.ticket && !eaTickets.includes(t.ticket));
            if (rogues.length > 0) {
                console.log('[BRIDGE] Closing', rogues.length, 'trades closed in EA:', rogues.map(t => t.ticket));
                await Promise.all(rogues.map(t =>
                    base44.asServiceRole.entities.Trade.update(t.id, { status: 'CLOSED', close_price: t.open_price })
                ));
            }
        } else {
            // Fallback: use open_tickets list if EA sends that format
            const openTickets = body.open_tickets || accountData.open_tickets;
            if (Array.isArray(openTickets)) {
                const validOpen = dbOpenTrades.filter(t => t.open_price && t.open_price > 0);
                const rogues = validOpen.filter(t => t.ticket && !openTickets.includes(t.ticket));
                if (rogues.length > 0) {
                    console.log('[BRIDGE] Closing', rogues.length, 'rogue trades not in EA list:', rogues.map(t => t.ticket));
                    await Promise.all(rogues.map(t =>
                        base44.asServiceRole.entities.Trade.update(t.id, { status: 'CLOSED', close_price: t.open_price })
                    ));
                }
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

        return Response.json({
            success: true,
            message: 'Sync successful',
            account: account_number,
            timestamp: new Date().toISOString(),
            pending_signals: pendingSignals.map(s => ({
                id: s.id,
                pair: s.pair,
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