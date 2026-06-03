import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * injectSignal — Dedicated webhook for 3rd party signal providers
 *
 * POST /
 * Headers: Content-Type: application/json
 *
 * Body:
 * {
 *   "api_key":        "YOUR_EA_API_KEY",   // required — same key used by your MT4 EA (from BrokerConnection or User ea_api_key)
 *   "pair":           "EURUSD",            // required
 *   "type":           "BUY" | "SELL",      // required
 *   "entry_price":    1.08500,             // required
 *   "stop_loss":      1.08200,             // optional
 *   "take_profit":    1.09000,             // optional
 *   "lot_size":       0.10,                // optional
 *   "account_number": "123456",            // optional — route to specific MT4 account
 *   "comment":        "Signal source"      // optional
 * }
 */

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

        // Validate required fields
        if (!api_key)     return Response.json({ error: 'api_key is required' }, { status: 400 });
        if (!pair)        return Response.json({ error: 'pair is required' }, { status: 400 });
        if (!type)        return Response.json({ error: 'type (BUY|SELL) is required' }, { status: 400 });
        if (!entry_price) return Response.json({ error: 'entry_price is required' }, { status: 400 });

        if (!['BUY', 'SELL'].includes(type.toUpperCase())) {
            return Response.json({ error: 'type must be BUY or SELL' }, { status: 400 });
        }

        // ── Step 1: Find broker connection matching this api_key ──
        // BrokerConnection.api_key is set by the user in Settings and is the same key
        // used by the EA bridge — this avoids querying the protected User entity.
        const allConnections = await base44.asServiceRole.entities.BrokerConnection.list();
        console.log(`[injectSignal] Total connections found: ${allConnections?.length || 0}`);

        let matchedConnection = (allConnections || []).find(c => c.api_key === api_key);

        // ── Step 2: Fallback — check User.ea_api_key if no BrokerConnection match ──
        if (!matchedConnection) {
            console.log(`[injectSignal] No BrokerConnection match for key prefix ${api_key?.slice(0, 8)}... — trying User.ea_api_key`);
            try {
                const allUsers = await base44.asServiceRole.entities.User.list();
                const matchedUser = (allUsers || []).find(u => u.ea_api_key === api_key);
                if (matchedUser) {
                    // Find their broker connection by owner_email
                    matchedConnection = (allConnections || []).find(
                        c => c.owner_email === matchedUser.email || c.created_by === matchedUser.email
                    );
                    console.log(`[injectSignal] User ea_api_key match found: ${matchedUser.email}, connection: ${matchedConnection?.account_number}`);
                }
            } catch (userLookupErr) {
                console.warn(`[injectSignal] User lookup failed (expected if User entity is protected): ${userLookupErr.message}`);
            }
        }

        if (!matchedConnection) {
            console.warn(`[injectSignal] Unauthorized — no matching api_key found. Key prefix: ${api_key?.slice(0, 8)}...`);
            console.log(`[injectSignal] Available connection api_keys (prefixes): ${(allConnections || []).map(c => c.api_key?.slice(0, 8)).join(', ')}`);
            return Response.json({ error: 'Unauthorized — invalid api_key. Ensure your api_key matches the one set in your Broker Connection settings.' }, { status: 401 });
        }

        // Normalise pair symbol
        const normalisedPair = pair.replace('/', '').toUpperCase();
        const formattedPair = normalisedPair.length === 6
            ? `${normalisedPair.slice(0, 3)}/${normalisedPair.slice(3)}`
            : normalisedPair;

        // Determine target account
        const targetAccount = account_number
            ? String(account_number)
            : (matchedConnection.account_number || '');

        const signalPayload = {
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
            owner_email: targetAccount,
            calculated_indicators: comment ? { source: comment } : undefined,
        };

        const signal = await base44.asServiceRole.entities.Signal.create(signalPayload);

        console.log(`[injectSignal] Signal queued: ${formattedPair} ${type} lot=${signalPayload.lot_size} account=${targetAccount} id=${signal.id}`);

        return Response.json(
            { status: 'queued', signal_id: signal.id, pair: formattedPair, type: type.toUpperCase(), account: targetAccount },
            { status: 201, headers: { 'Access-Control-Allow-Origin': '*' } }
        );

    } catch (error) {
        console.error('[injectSignal] Error:', error.message);
        return Response.json({ error: error.message }, { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } });
    }
});