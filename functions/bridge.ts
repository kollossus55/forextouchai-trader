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

        // 2. If EA sends open_tickets list, close DB trades not present in it
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

        // Return pending signals for EA to execute
        const pendingSignals = await base44.asServiceRole.entities.Signal.filter({ status: 'PENDING' });
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