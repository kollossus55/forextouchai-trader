import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
    // Handle CORS preflight
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
        const { signal_id, ticket, open_price, lot_size, pair, type, account_number } = body;

        console.log('[CONFIRM] Received execution confirmation:', { signal_id, ticket, pair, type });

        if (!signal_id || !ticket || !open_price) {
            return Response.json({ error: 'signal_id, ticket, and open_price are required' }, {
                status: 400,
                headers: { 'Access-Control-Allow-Origin': '*' }
            });
        }

        // Update the signal to ACTIVE
        await base44.asServiceRole.entities.Signal.update(signal_id, {
            status: 'ACTIVE',
        });

        // Find the owner of the signal
        const signals = await base44.asServiceRole.entities.Signal.filter({ id: signal_id });
        const signal = signals?.[0];

        // Find the broker connection to get owner email
        let ownerEmail = signal?.created_by || null;
        if (account_number) {
            const connections = await base44.asServiceRole.entities.BrokerConnection.filter({ account_number: String(account_number) });
            if (connections?.length > 0) {
                ownerEmail = connections[0].created_by || ownerEmail;
            }
        }

        // Create a Trade record for tracking
        await base44.asServiceRole.entities.Trade.create({
            pair: pair || signal?.pair,
            type: type || signal?.type,
            lot_size: lot_size || signal?.lot_size || 0.1,
            open_price: open_price,
            status: 'OPEN',
            ticket: ticket,
            pnl: 0,
            is_auto: false,
            owner_email: ownerEmail,
        });

        console.log('[CONFIRM] Trade created for ticket:', ticket, 'signal:', signal_id);

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