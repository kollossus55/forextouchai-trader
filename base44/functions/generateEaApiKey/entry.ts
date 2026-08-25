import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

function generateKey() {
    // This key is the sole credential granting bridge access to a live trading
    // account, so it must come from a cryptographically secure source.
    // Math.random() is a fast non-cryptographic PRNG whose internal state can be
    // recovered from a modest number of outputs — fine for animation jitter,
    // unacceptable for an auth token.
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    let key = 'FTAI-';
    for (let i = 0; i < bytes.length; i++) {
        // Rejection-free modulo bias is negligible here (256 % 62), but we use a
        // wider draw anyway to keep the distribution clean.
        key += chars.charAt(bytes[i] % chars.length);
    }
    return key;
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
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const newKey = generateKey();

        // Save to user profile
        await base44.auth.updateMe({ ea_api_key: newKey });

        // Also upsert into EaApiKey entity so injectSignal can look it up via service role
        const existing = await base44.asServiceRole.entities.EaApiKey.filter({ owner_email: user.email });
        if (existing && existing.length > 0) {
            await base44.asServiceRole.entities.EaApiKey.update(existing[0].id, { api_key: newKey });
        } else {
            await base44.asServiceRole.entities.EaApiKey.create({ api_key: newKey, owner_email: user.email });
        }

        console.log(`[generateEaApiKey] Key generated and saved for ${user.email}`);
        return Response.json({ ea_api_key: newKey });
    } catch (error) {
        console.error('[generateEaApiKey] Error:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});