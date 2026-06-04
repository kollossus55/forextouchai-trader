import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            }
        });
    }

    if (req.method !== 'POST') {
        return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    try {
        const base44 = createClientFromRequest(req);
        const body = await req.json();

        const { api_key, pair, type, entry_price, stop_loss, take_profit, lot_size, account_number, comment } = body;

        if (!api_key)     return Response.json({ error: 'api_key is required' }, { status: 400 });
        if (!pair)        return Response.json({ error: 'pair is required' }, { status: 400 });
        if (!type)        return Response.json({ error: 'type (BUY|SELL) is required' }, { status: 400 });
        if (!entry_price) return Response.json({ error: 'entry_price is required' }, { status: 400 });

        if (!['BUY', 'SELL'].includes(type.toUpperCase())) {
            return Response.json({ error: 'type must be BUY or SELL' }, { status: 400 });
        }

        // Look up api_key in EaApiKey entity (fully accessible via service role)
        const keyRecords = await base44.asServiceRole.entities.EaApiKey.filter({ api_key });
        const keyRecord = keyRecords && keyRecords.length > 0 ? keyRecords[0] : null;

        if (!keyRecord) {
            console.warn(`[injectSignal] Unauthorized — key not found. Prefix: ${api_key?.slice(0, 8)}...`);
            return Response.json({ error: 'Unauthorized — invalid api_key. Please regenerate your key from the Admin page.' }, { status: 401 });
        }

        // Find broker connections for this user
        const allConnections = await base44.asServiceRole.entities.BrokerConnection.list();
        const userConnections = (allConnections || []).filter(
            c => c.owner_email === keyRecord.owner_email || c.created_by === keyRecord.owner_email
        );

        if (!userConnections || userConnections.length === 0) {
            return Response.json({ error: 'No broker connections found for this API key' }, { status: 404 });
        }

        const normalisedPair = pair.replace('/', '').toUpperCase();
        const formattedPair = normalisedPair.length === 6
            ? `${normalisedPair.slice(0, 3)}/${normalisedPair.slice(3)}`
            : normalisedPair;

        // If account_number specified, target that account only. Otherwise broadcast to ALL connected accounts.
        const targetAccounts = account_number
            ? [String(account_number)]
            : userConnections.map(c => c.account_number).filter(Boolean);

        const buildPayload = (acct) => ({
            pair: formattedPair,
            type: type.toUpperCase(),
            entry_price: parseFloat(entry_price),
            stop_loss: stop_loss ? parseFloat(stop_loss) : 0,
            take_profit: take_profit ? parseFloat(take_profit) : 0,
            lot_size: lot_size ? parseFloat(lot_size) : 0.10,
            confidence: 100,
            strategy: 'MANUAL_EXECUTION',
            status: 'PENDING',
            result_pnl: 0,
            owner_email: acct,
            calculated_indicators: comment ? { source: comment } : undefined,
        });

        const signals = await Promise.all(
            targetAccounts.map(acct => base44.asServiceRole.entities.Signal.create(buildPayload(acct)))
        );
        console.log(`[injectSignal] Signal queued: ${formattedPair} ${type} → accounts: ${targetAccounts.join(', ')}`);

        return Response.json(
            { status: 'queued', signal_ids: signals.map(s => s.id), pair: formattedPair, type: type.toUpperCase(), accounts: targetAccounts },
            { status: 201, headers: { 'Access-Control-Allow-Origin': '*' } }
        );

    } catch (error) {
        console.error('[injectSignal] Error:', error.message);
        return Response.json({ error: error.message }, { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } });
    }
});