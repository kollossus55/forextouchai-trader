import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * injectSignal — Dedicated webhook for 3rd party signal providers
 *
 * POST /
 * Headers: Content-Type: application/json
 *
 * Body:
 * {
 *   "api_key":      "YOUR_EA_API_KEY",          // required — same key used by your MT4 EA
 *   "pair":         "EURUSD",                    // required — symbol (with or without slash)
 *   "type":         "BUY" | "SELL",              // required
 *   "entry_price":  1.08500,                     // required
 *   "stop_loss":    1.08200,                     // optional (0 = none)
 *   "take_profit":  1.09000,                     // optional (0 = none)
 *   "lot_size":     0.10,                        // optional — defaults to 0.10
 *   "account_number": "123456",                  // optional — route to a specific MT4 account
 *   "comment":      "TradingView alert"          // optional — for your own reference
 * }
 *
 * Responses:
 *   201 { status: "queued", signal_id: "..." }   — signal created, bridge will dispatch on next heartbeat
 *   400 { error: "..." }                         — missing/invalid fields
 *   401 { error: "Unauthorized" }                — bad api_key
 *   500 { error: "..." }                         — server error
 */

Deno.serve(async (req) => {
    // CORS preflight
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

        // ── Validate required fields ──
        if (!api_key)       return Response.json({ error: 'api_key is required' }, { status: 400 });
        if (!pair)          return Response.json({ error: 'pair is required' }, { status: 400 });
        if (!type)          return Response.json({ error: 'type (BUY|SELL) is required' }, { status: 400 });
        if (!entry_price)   return Response.json({ error: 'entry_price is required' }, { status: 400 });

        if (!['BUY', 'SELL'].includes(type.toUpperCase())) {
            return Response.json({ error: 'type must be BUY or SELL' }, { status: 400 });
        }

        // ── Validate api_key against User.ea_api_key (stored in data.ea_api_key) ──
        const allUsers = await base44.asServiceRole.entities.User.list();
        const matchedUser = (allUsers || []).find(u => u.ea_api_key === api_key);

        if (!matchedUser) {
            console.warn(`[injectSignal] Unauthorized attempt with key: ${api_key?.slice(0, 8)}...`);
            return Response.json({ error: 'Unauthorized — invalid api_key' }, { status: 401 });
        }

        // Find broker connections belonging to this user
        let connections = await base44.asServiceRole.entities.BrokerConnection.filter({ created_by: matchedUser.email });
        if (!connections || connections.length === 0) {
            return Response.json({ error: 'No broker connections found for this API key' }, { status: 404 });
        }

        // Normalise pair symbol (strip slash)
        const normalisedPair = pair.replace('/', '').toUpperCase();
        // Re-add slash in standard forex format (e.g. EURUSD → EUR/USD) for display
        const formattedPair = normalisedPair.length === 6
            ? `${normalisedPair.slice(0, 3)}/${normalisedPair.slice(3)}`
            : normalisedPair;

        // ── Build signal payload ──
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
            // Route to specific account number if provided, else use first matched connection's account_number
            // IMPORTANT: owner_email in Signal must be the account_number string (not user email) so the bridge can match it
            owner_email: account_number ? String(account_number) : (connections[0].account_number || ''),
            calculated_indicators: comment ? { source: comment } : undefined,
        };

        const signal = await base44.asServiceRole.entities.Signal.create(signalPayload);

        console.log(`[injectSignal] Signal queued: ${formattedPair} ${type} lot=${lot_size} account=${signalPayload.owner_email} id=${signal.id}`);

        return Response.json(
            { status: 'queued', signal_id: signal.id, pair: formattedPair, type: type.toUpperCase(), account: signalPayload.owner_email },
            { status: 201, headers: { 'Access-Control-Allow-Origin': '*' } }
        );

    } catch (error) {
        console.error('[injectSignal] Error:', error.message);
        return Response.json({ error: error.message }, { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } });
    }
});