import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            }
        });
    }

    try {
        const base44 = createClientFromRequest(req);

        const body = await req.json();
        // Support both open_price and price (EA may send either)
        const { signal_id, ticket, pair, type, account_number, lot_size } = body;
        const open_price = body.open_price || body.price || 0;

        console.log('[CONFIRM] Received execution confirmation:', { signal_id, ticket, pair, type, open_price });

        if (!signal_id || !ticket) {
            return Response.json({ error: 'signal_id and ticket are required' }, {
                status: 400,
                headers: { 'Access-Control-Allow-Origin': '*' }
            });
        }

        // Fetch signal and broker connection in parallel (all via service role — EA has no user token)
        const [signals, connections] = await Promise.all([
            base44.asServiceRole.entities.Signal.filter({ id: signal_id }),
            account_number
                ? base44.asServiceRole.entities.BrokerConnection.filter({ account_number: String(account_number) })
                : Promise.resolve([]),
        ]);

        const signal = signals?.[0];
        // Use account_number as owner_email (matches bridge reconciliation key)
        // Fall back to connection's account_number, then signal owner
        const connAccountNumber = connections?.[0]?.account_number;
        const tradeOwner = connAccountNumber ? String(connAccountNumber) : (connections?.[0]?.created_by || signal?.created_by || null);

        // Check if trade with this ticket already exists to prevent duplicates
        const existingTrades = await base44.asServiceRole.entities.Trade.filter({ ticket: ticket });
        if (existingTrades && existingTrades.length > 0) {
            console.log('[CONFIRM] Trade already exists for ticket:', ticket, '- skipping duplicate');
            await base44.asServiceRole.entities.Signal.update(signal_id, { status: 'ACTIVE' });
            return Response.json({ success: true, message: 'Already confirmed', ticket }, {
                headers: { 'Access-Control-Allow-Origin': '*' }
            });
        }

        // Update signal status + create trade record in parallel
        await Promise.all([
            base44.asServiceRole.entities.Signal.update(signal_id, { status: 'ACTIVE' }),
            base44.asServiceRole.entities.Trade.create({
                pair: pair || signal?.pair,
                type: type || signal?.type,
                lot_size: lot_size || signal?.lot_size || 0.1,
                open_price: open_price,
                status: 'OPEN',
                ticket: ticket,
                pnl: 0,
                is_auto: true,
                bot_id: signal?.bot_id || null,
                owner_email: tradeOwner,
            }),
        ]);

        console.log('[CONFIRM] Trade created for ticket:', ticket, 'signal:', signal_id, 'owner:', ownerEmail);

        return Response.json({
            success: true,
            message: 'Execution confirmed',
            ticket,
        }, {
            headers: { 'Access-Control-Allow-Origin': '*' }
        });

    } catch (error) {
        console.error('[CONFIRM ERROR]', error.message);
        return Response.json({ error: error.message }, {
            status: 500,
            headers: { 'Access-Control-Allow-Origin': '*' }
        });
    }
});