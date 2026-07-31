import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ─── Rate limiting: prevent 3rd-party signal flooding ──────────────────────
// Per-API-key: min 60s between injections, max 5 signals per 5 minutes
const injectTimestamps = {}; // api_key → [timestamp, ...]
const MIN_INTERVAL_MS = 60_000;     // 1 call per key per minute
const WINDOW_MS = 5 * 60_000;       // 5-minute rolling window
const MAX_PER_WINDOW = 5;           // max 5 injections per 5 min per key

function checkRateLimit(apiKey) {
    const now = Date.now();
    const arr = injectTimestamps[apiKey] || [];
    // Prune entries older than the window
    const recent = arr.filter(ts => now - ts < WINDOW_MS);
    // Min interval check
    if (recent.length > 0 && (now - recent[recent.length - 1]) < MIN_INTERVAL_MS) {
        const waitMs = MIN_INTERVAL_MS - (now - recent[recent.length - 1]);
        return { allowed: false, retryAfterMs: waitMs, reason: 'rate_limited_interval' };
    }
    // Max per window check
    if (recent.length >= MAX_PER_WINDOW) {
        const oldestAge = now - recent[0];
        const waitMs = WINDOW_MS - oldestAge;
        return { allowed: false, retryAfterMs: waitMs, reason: 'rate_limited_max' };
    }
    recent.push(now);
    injectTimestamps[apiKey] = recent;
    return { allowed: true };
}

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

        // ── Rate limit check: prevent 3rd-party flooding ──
        const rateCheck = checkRateLimit(api_key);
        if (!rateCheck.allowed) {
            console.warn(`[injectSignal] Rate limited (${rateCheck.reason}) — retry in ${Math.ceil(rateCheck.retryAfterMs / 1000)}s`);
            return Response.json(
                { error: 'Rate limited', reason: rateCheck.reason, retry_after_ms: Math.ceil(rateCheck.retryAfterMs) },
                { status: 429, headers: { 'Access-Control-Allow-Origin': '*', 'Retry-After': String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
            );
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
        // IDOR fix: verify the requested account_number belongs to this API key owner before targeting it.
        if (account_number) {
            const ownsAccount = userConnections.some(c => String(c.account_number) === String(account_number));
            if (!ownsAccount) {
                return Response.json({ error: 'Unauthorized — account_number does not belong to this API key' }, { status: 403, headers: { 'Access-Control-Allow-Origin': '*' } });
            }
        }
        const targetAccounts = account_number
            ? [String(account_number)]
            : userConnections.map(c => c.account_number).filter(Boolean);

        // ── Deduplication: skip accounts that already have an ACTIVE/PENDING signal for same pair+type within 5 min ──
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const existingSignals = await base44.asServiceRole.entities.Signal.filter({
            pair: formattedPair,
            type: type.toUpperCase(),
            strategy: 'MANUAL_EXECUTION',
        }, '-created_date', 50);

        const recentActiveAccounts = new Set(
            (existingSignals || [])
                .filter(s => ['PENDING', 'ACTIVE'].includes(s.status) && s.created_date >= fiveMinAgo)
                .map(s => s.owner_email)
        );

        const accountsToCreate = targetAccounts.filter(acct => {
            if (recentActiveAccounts.has(acct)) {
                console.log(`[injectSignal] Duplicate suppressed: ${formattedPair} ${type} already ACTIVE/PENDING for ${acct}`);
                return false;
            }
            return true;
        });

        if (accountsToCreate.length === 0) {
            console.log(`[injectSignal] All accounts already have active signal for ${formattedPair} ${type} — skipping`);
            return Response.json(
                { status: 'skipped', reason: 'duplicate', pair: formattedPair, type: type.toUpperCase(), accounts: targetAccounts },
                { status: 200, headers: { 'Access-Control-Allow-Origin': '*' } }
            );
        }

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
            accountsToCreate.map(acct => base44.asServiceRole.entities.Signal.create(buildPayload(acct)))
        );
        console.log(`[injectSignal] Signal queued: ${formattedPair} ${type} → accounts: ${accountsToCreate.join(', ')}`);

        return Response.json(
            { status: 'queued', signal_ids: signals.map(s => s.id), pair: formattedPair, type: type.toUpperCase(), accounts: accountsToCreate },
            { status: 201, headers: { 'Access-Control-Allow-Origin': '*' } }
        );

    } catch (error) {
        console.error('[injectSignal] Error:', error.message);
        return Response.json({ error: error.message }, { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } });
    }
});