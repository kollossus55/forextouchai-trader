import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Retry helper for rate-limited operations
async function withRetry(fn, retries = 3, delayMs = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (err) {
            if (err.message?.includes('Rate limit') && i < retries - 1) {
                await new Promise(r => setTimeout(r, delayMs * (i + 1)));
            } else {
                throw err;
            }
        }
    }
}

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

        // ── API Key validation — reject missing or non-FTAI keys (auth bypass fix) ─
        const authHeader = req.headers.get('Authorization') || '';
        const providedKey = authHeader.replace(/^Bearer\s+/i, '').trim();
        if (!providedKey || !providedKey.startsWith('FTAI-')) {
            return Response.json({ error: 'Missing or invalid API key' }, {
                status: 401,
                headers: { 'Access-Control-Allow-Origin': '*' }
            });
        }
        let resolvedOwnerEmail = null;
        let resolvedKeyOwnerId = null;
        try {
            const matchingKeys = await base44.asServiceRole.entities.EaApiKey.filter({ api_key: providedKey });
            if (!matchingKeys || matchingKeys.length === 0) {
                return Response.json({ error: 'Invalid API key' }, {
                    status: 401,
                    headers: { 'Access-Control-Allow-Origin': '*' }
                });
            }
            resolvedOwnerEmail = matchingKeys[0].owner_email || null;
            resolvedKeyOwnerId = matchingKeys[0].created_by_id || null;
        } catch (e) {
            console.warn('[CONFIRM] API key lookup failed:', e.message);
            return Response.json({ error: 'API key verification unavailable' }, {
                status: 503,
                headers: { 'Access-Control-Allow-Origin': '*' }
            });
        }

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
        // Validate trade type
        const tradeType = (body.type || '').toUpperCase();
        if (tradeType && tradeType !== 'BUY' && tradeType !== 'SELL') {
            return Response.json({ error: `Invalid trade type: ${tradeType}` }, {
                status: 400,
                headers: { 'Access-Control-Allow-Origin': '*' }
            });
        }

        // HARDENED: use .get() for signal lookup (correct tool for single record by ID)
        const [signal, connections] = await Promise.all([
            base44.asServiceRole.entities.Signal.get(signal_id).catch(() => null),
            account_number
                ? base44.asServiceRole.entities.BrokerConnection.filter({ account_number: String(account_number) })
                : Promise.resolve([]),
        ]);

        const connAccountNumber = connections?.[0]?.account_number;
        const tradeOwner = connAccountNumber ? String(connAccountNumber) : (connections?.[0]?.created_by || signal?.created_by || null);

        // Verify the account belongs to the authenticated API key owner (prevents account spoofing)
        const connOwnerEmail = connections?.[0]?.owner_email || null;
        if (resolvedOwnerEmail && connOwnerEmail && connOwnerEmail !== resolvedOwnerEmail) {
            return Response.json({ error: 'Account not authorized for this API key' }, {
                status: 403,
                headers: { 'Access-Control-Allow-Origin': '*' }
            });
        }

        // Verify the signal belongs to the API key owner (IDOR fix): the signal_id comes
        // from the request, so without this check a caller could activate another user's signal.
        if (signal && resolvedKeyOwnerId && signal.created_by_id && signal.created_by_id !== resolvedKeyOwnerId) {
            console.warn(`[CONFIRM] Signal ownership mismatch: signal ${signal_id} owner=${signal.created_by_id}, key owner=${resolvedKeyOwnerId}`);
            return Response.json({ error: 'Signal not authorized for this API key' }, {
                status: 403,
                headers: { 'Access-Control-Allow-Origin': '*' }
            });
        }

        // Check if trade with this ticket already exists to prevent duplicates
        const existingTrades = await withRetry(() => base44.asServiceRole.entities.Trade.filter({ ticket: ticket }));
        if (existingTrades && existingTrades.length > 0) {
            console.log('[CONFIRM] Trade already exists for ticket:', ticket, '- skipping duplicate');
            await withRetry(() => base44.asServiceRole.entities.Signal.update(signal_id, { status: 'ACTIVE' }));
            return Response.json({ success: true, message: 'Already confirmed', ticket }, {
                headers: { 'Access-Control-Allow-Origin': '*' }
            });
        }

        // Update signal status + create trade record sequentially to avoid rate limits
        await withRetry(() => base44.asServiceRole.entities.Signal.update(signal_id, { status: 'ACTIVE' }));
        await withRetry(() => base44.asServiceRole.entities.Trade.create({
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
        }));

        console.log('[CONFIRM] Trade created for ticket:', ticket, 'signal:', signal_id, 'owner:', tradeOwner);

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