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

        console.log('[BRIDGE] Incoming payload:', JSON.stringify(body));

        // Support both flat payload and nested {account: {...}, trades: [...]} format
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
        const open_trades = body.trades || body.open_trades;

        if (!account_number) {
            return Response.json({ error: 'account_number is required' }, {
                status: 400,
                headers: { 'Access-Control-Allow-Origin': '*' }
            });
        }

        // Find existing connection by account_number
        const connections = await base44.asServiceRole.entities.BrokerConnection.filter({ account_number: String(account_number) });

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

        let connection;
        if (connections && connections.length > 0) {
            // Update existing connection
            connection = await base44.asServiceRole.entities.BrokerConnection.update(connections[0].id, updateData);
            console.log('[BRIDGE] Updated connection for account:', account_number);
        } else {
            // Create new connection record
            connection = await base44.asServiceRole.entities.BrokerConnection.create({
                ...updateData,
                account_number: String(account_number),
                server_name: server_name || 'Unknown',
                platform: platform || 'MT4',
            });
            console.log('[BRIDGE] Created new connection for account:', account_number);
        }

        // If open trades provided, sync them
        if (open_trades && Array.isArray(open_trades)) {
            for (const trade of open_trades) {
                if (!trade.ticket) continue;
                const existing = await base44.asServiceRole.entities.Trade.filter({ ticket: trade.ticket });
                if (existing && existing.length > 0) {
                    await base44.asServiceRole.entities.Trade.update(existing[0].id, {
                        pnl: trade.profit ?? 0,
                        status: 'OPEN',
                    });
                } else {
                    await base44.asServiceRole.entities.Trade.create({
                        ticket: trade.ticket,
                        pair: trade.symbol || 'UNKNOWN',
                        type: (trade.type === 0 || trade.type === 'BUY') ? 'BUY' : 'SELL',
                        lot_size: trade.lots ?? 0.01,
                        open_price: trade.open_price ?? 0,
                        pnl: trade.profit ?? 0,
                        status: 'OPEN',
                        is_auto: true,
                        owner_email: connections?.[0]?.created_by || '',
                    });
                }
            }
        }

        return Response.json({
            success: true,
            message: 'Sync successful',
            account: account_number,
            timestamp: new Date().toISOString(),
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