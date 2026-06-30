import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ─── Global request lock: serialize bridge processing to prevent rate-limit exhaustion ──
// When both MT4 and MT5 call simultaneously, the combined DB operations (10+ per call)
// overwhelm Base44 API rate limits. This lock ensures one account processes at a time.
let globalLockPromise = null; // Promise | null — all requests queue behind this
const GLOBAL_LOCK_TIMEOUT_MS = 15_000; // max wait time before proceeding anyway
let globalLockOwner = null; // account currently holding the lock
let globalLockAcquiredAt = 0;

// ─── Per-account rate limiter (min 10s between full bridge calls) ─────────────
const lastCallTs = {}; // keyed by account_number → timestamp
const MIN_CALL_INTERVAL_MS = 25_000; // 25 seconds minimum between calls per account

// ─── In-memory state (survives across requests within same isolate) ───────────
const cache = {
    signals: { data: null, ts: 0 },
    trades: {},       // keyed by account_number → { data, ts }
    risk: { data: null, ts: 0 },
    connections: {},  // keyed by account_number → { data: true, ts }
    pairMap: { data: null, ts: 0 }, // CurrencyPair symbol → record
};

// Primary duplicate-trade guard: ticket sets persist across requests in same isolate
const knownTickets = {}; // keyed by account_number → Set<ticket>

// Per-account reconcile lock: prevents concurrent reconcile runs within same isolate
const reconcileLock = {}; // keyed by account_number → boolean

// Cold-start init: first reconcile per isolate per account loads all tickets from DB.
// All concurrent requests await the SAME promise — prevents any races.
const initPromise = {}; // keyed by account_number → Promise<void> | null

// Per-ticket create lock: prevents concurrent creates for the same ticket across requests
const ticketCreateLock = {}; // keyed by "acctKey:ticket" → boolean

// Bridge error alert throttle: prevent spamming alerts (max 1 per account per 10 min)
const lastBridgeErrorAlert = {}; // keyed by acctKey → timestamp
const BRIDGE_ERROR_ALERT_THROTTLE_MS = 10 * 60 * 1000; // 10 minutes

// In-flight dispatched signal IDs: prevents re-dispatching a signal before ACTIVE status is written to DB
const dispatchedSignalIds = new Set(); // signal IDs already dispatched this isolate lifetime
const MAX_DISPATCHED_IDS = 500; // cap to prevent unbounded growth

// Per-account per-pair cooldown: prevents re-dispatching to same pair within 5 minutes
// keyed by "acctKey:pairRaw" → timestamp of last dispatch
const pairDispatchCooldown = {}; // e.g. { "1511587:EURUSD": 1716200000000 }
const PAIR_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes (reduced from 10 to allow faster retry after expiry)

// ─── Throttle config ─────────────────────────────────────────────────────────
const TTL = {
    signals:     5_000,  // 5s   — short TTL so expired signals clear fast
    trades:     60_000,  // 60s  — trade list cache
    risk:      180_000,  // 3min — risk settings (was 2min)
    connection: 30_000,  // 30s  — heartbeat throttle (was 20s)
    pairMap:   300_000,  // 5min — currency pair map
};

// How often the EA should heartbeat (returned in response so EA can self-throttle)
const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds

function isFresh(entry, ttl) {
    return entry.data !== null && (Date.now() - entry.ts) < ttl;
}

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders() });
    }

    // MUST be declared before try: if createClientFromRequest throws, the catch block
    // references these and would hit ReferenceError if they're not in scope yet
    let releaseLock = null;
    let lockSafetyTimer = null;

    try {
        const base44 = createClientFromRequest(req);

        const rawText = await req.text();
        const cleanText = rawText.replace(/\0/g, '').trim();

        // Store parsed body early so the catch block can access account_number without re-reading the stream
        let body = {};
        if (!cleanText) {
            return Response.json({ success: true, message: 'Bridge online', heartbeat_interval_ms: HEARTBEAT_INTERVAL_MS }, { headers: corsHeaders() });
        }

        body = JSON.parse(cleanText);

        // ── API Key validation (only enforce if key looks valid, i.e. starts with FTAI-) ─
        const authHeader = req.headers.get('Authorization') || '';
        const providedKey = authHeader.replace(/^Bearer\s+/i, '').trim();
        let resolvedOwnerEmail = null;
        if (providedKey && providedKey.startsWith('FTAI-')) {
            // Lookup the EaApiKey record to get the owner_email for this key
            // Catch rate limits — on 429, skip auth validation and allow the request (backward-compatible)
            try {
                const matchingKeys = await base44.asServiceRole.entities.EaApiKey.filter({ api_key: providedKey });
                if (!matchingKeys || matchingKeys.length === 0) {
                    return Response.json({ error: 'Invalid API key' }, { status: 401, headers: corsHeaders() });
                }
                resolvedOwnerEmail = matchingKeys[0].owner_email || null;
            } catch (e) {
                console.warn('[BRIDGE] EaApiKey lookup rate-limited — skipping auth validation:', e.message);
                // Allow the request without owner_email resolution (backward-compatible fallback)
            }
        }
        // If no key or non-FTAI key provided, allow (backward-compatible)
        const now = Date.now();
        const acct = body.account || body;
        const { account_number, server_name, balance, equity, margin, free_margin, margin_level, leverage, currency, platform } = acct;

        if (!account_number) {
            return Response.json({ error: 'account_number is required' }, { status: 400, headers: corsHeaders() });
        }

        const acctKey = String(account_number);

        // Detect if this is a Gold EA heartbeat (only sends XAUUSD price)
        const eaPricesRaw = body.prices || acct.prices;
        const isGoldEA = Array.isArray(eaPricesRaw) && eaPricesRaw.length === 1 &&
            ['XAUUSD', 'GOLD', 'XAU'].includes((eaPricesRaw[0]?.symbol || '').toUpperCase());

        // Gold EA uses a separate rate-limit slot so it's never blocked by the standard EA calling the same account
        const rateLimitKey = isGoldEA ? `${acctKey}:gold` : acctKey;

        // ── Global request lock: serialize processing to prevent dual-account rate limit exhaustion ──
        // Without this, MT4+MT5 calling simultaneously each trigger 10+ DB ops → Base44 rate limits → 500s
        if (globalLockPromise) {
            const lockAge = now - globalLockAcquiredAt;
            if (globalLockOwner === acctKey && lockAge < 2000) {
                // Same account re-calling within 2s — skip lock, process immediately (EA heartbeat retry)
            } else if (lockAge < GLOBAL_LOCK_TIMEOUT_MS) {
                // Different account or same account after 2s — wait for lock to release
                try {
                    await Promise.race([
                        globalLockPromise,
                        new Promise((_, reject) => setTimeout(() => reject(new Error('lock_timeout')), GLOBAL_LOCK_TIMEOUT_MS - lockAge))
                    ]);
                } catch (_) {
                    // Timeout or lock rejection — proceed anyway with warning
                    console.warn(`[BRIDGE] Global lock timeout for ${acctKey} — proceeding without lock`);
                }
            }
            // Lock released or timed out — continue
        }

        // Acquire the global lock
        globalLockPromise = new Promise(resolve => { releaseLock = resolve; });
        globalLockOwner = acctKey;
        globalLockAcquiredAt = now;
        // Safety timeout: auto-release lock after 30s if something crashes mid-processing
        lockSafetyTimer = setTimeout(() => {
            if (globalLockOwner === acctKey && globalLockPromise) {
                console.warn(`[BRIDGE] Safety timeout releasing global lock for ${acctKey}`);
                if (releaseLock) { clearTimeout(lockSafetyTimer); releaseLock(); } globalLockPromise = null;
            }
        }, 30_000);

        // ── Rate limit: reject if called too frequently ───────────────────────
        const lastCall = lastCallTs[rateLimitKey] || 0;
        const isRateLimited = (now - lastCall) < MIN_CALL_INTERVAL_MS;

        // Always run trade reconcile even when rate-limited — trade sync must not be blocked
        const eaTradesEarly = body.trades || acct.trades;
        const eaPricesEarly = body.prices || acct.prices;
        const livePriceMapEarly = buildPriceMap(eaTradesEarly?.length ? eaPricesEarly : []);
        if (isRateLimited && Array.isArray(eaTradesEarly) && !reconcileLock[acctKey]) {
            reconcileLock[acctKey] = true;
            reconcileTrades(base44, eaTradesEarly, acctKey, livePriceMapEarly)
                .catch(e => console.error('[BRIDGE] Rate-limited reconcile error:', e.message))
                .finally(() => { reconcileLock[acctKey] = false; });
        }

        if (isRateLimited) {
            if (releaseLock) { clearTimeout(lockSafetyTimer); releaseLock(); } globalLockPromise = null;
            return Response.json({
                success: true,
                account: acctKey,
                message: 'rate_limited',
                retry_after_ms: MIN_CALL_INTERVAL_MS - (now - lastCall),
                heartbeat_interval_ms: HEARTBEAT_INTERVAL_MS,
                pending_signals: [],
            }, { status: 200, headers: corsHeaders() });
        }
        lastCallTs[rateLimitKey] = now;

        // ── Periodic memory cleanup (every ~100 calls) to prevent unbounded growth ──
        if (dispatchedSignalIds.size > MAX_DISPATCHED_IDS) {
            // Keep only the most recent 200 IDs (convert to array, slice, back to set)
            const arr = [...dispatchedSignalIds];
            dispatchedSignalIds.clear();
            arr.slice(-200).forEach(id => dispatchedSignalIds.add(id));
            console.log('[BRIDGE] Pruned dispatchedSignalIds to 200 entries');
        }
        // Clean pairDispatchCooldown entries older than the cooldown window
        const cutoff = now - PAIR_COOLDOWN_MS * 2;
        for (const key of Object.keys(pairDispatchCooldown)) {
            if (pairDispatchCooldown[key] < cutoff) delete pairDispatchCooldown[key];
        }

        // Build live price map from EA heartbeat
        const eaPrices = body.prices || acct.prices;
        const livePriceMap = buildPriceMap(eaPrices);

        // ── 1. Update broker connection (throttled) ──────────────────────────
        const connCache = cache.connections[acctKey] || { data: null, ts: 0 };
        if (!isFresh(connCache, TTL.connection)) {
            cache.connections[acctKey] = { data: true, ts: now };
            const eaTradesForCount = body.trades || acct.trades;
            const updateData = {
                connection_status: 'CONNECTED',
                last_sync: new Date().toISOString(),
                balance: balance ?? 0,
                equity: equity ?? 0,
                margin: margin ?? 0,
                free_margin: free_margin ?? 0,
                margin_level: margin_level ?? 0,
                ...(leverage && { leverage: String(leverage) }),
                ...(currency && { currency }),
                ...(platform && { platform }),
                ...(server_name && { server_name }),
                ...(Array.isArray(eaTradesForCount) && { open_trade_count: eaTradesForCount.length }),
            };
            (async () => {
                const conns = await base44.asServiceRole.entities.BrokerConnection.filter({ account_number: acctKey });
                if (conns?.length > 0) {
                    // Backfill owner_email if missing and we resolved it from the API key
                    const patch = { ...updateData };
                    if (!conns[0].owner_email && resolvedOwnerEmail) patch.owner_email = resolvedOwnerEmail;
                    await base44.asServiceRole.entities.BrokerConnection.update(conns[0].id, patch);
                } else {
                    // New connection — set owner_email from the API key lookup
                    await base44.asServiceRole.entities.BrokerConnection.create({
                        ...updateData, account_number: acctKey,
                        server_name: server_name || 'Unknown', platform: platform || 'MT4',
                        ...(resolvedOwnerEmail && { owner_email: resolvedOwnerEmail }),
                    });
                }
            })().catch(e => console.error('[BRIDGE] Connection update error:', e.message));
        }

        // ── 2. Fetch signals + risk (cached) ─────────────────────────────────
        // Fetch both PENDING and ACTIVE signals — ACTIVE means bridge locked them but MT4 hasn't confirmed yet
        const signalsPromise = isFresh(cache.signals, TTL.signals)
            ? Promise.resolve(cache.signals.data)
            : Promise.all([
                base44.asServiceRole.entities.Signal.filter({ status: 'PENDING' }, '-created_date', 50),
                base44.asServiceRole.entities.Signal.filter({ status: 'ACTIVE' }, '-created_date', 50),
              ])
                .then(([pending, active]) => {
                    const combined = [...(pending || []), ...(active || [])];
                    cache.signals = { data: combined, ts: now };
                    return combined;
                })
                .catch(() => cache.signals.data || []);

        const riskPromise = isFresh(cache.risk, TTL.risk)
            ? Promise.resolve(cache.risk.data)
            : base44.asServiceRole.entities.RiskManagementSettings.list('-created_date', 100)
                .then(data => { cache.risk = { data, ts: now }; return data; })
                .catch(() => cache.risk.data || []);

        let allPendingSignals, riskSettingsList;
        try {
            [allPendingSignals, riskSettingsList] = await Promise.all([signalsPromise, riskPromise]);
        } catch (e) {
            console.warn('[BRIDGE] Rate limited on signals/risk fetch — returning empty signals:', e.message);
            if (releaseLock) { clearTimeout(lockSafetyTimer); releaseLock(); } globalLockPromise = null;
            return Response.json({
                success: true,
                account: acctKey,
                timestamp: new Date().toISOString(),
                heartbeat_interval_ms: HEARTBEAT_INTERVAL_MS,
                price_update_ts: body.last_price_update || 0,
                last_reconcile: body.last_reconcile || 0,
                last_risk_check: body.last_risk_check || 0,
                pending_signals: [],
                message: 'rate_limited',
            }, { headers: corsHeaders() });
        }

        // ── 3. Reconcile trades (server-driven throttle, locked per account) ─
        // NOTE: Reconcile runs ALWAYS even when trading is paused, so DB stays in sync with EA
        const eaTrades = body.trades || acct.trades;
        const lastReconcile = body.last_reconcile || 0;
        const shouldReconcile = (now - lastReconcile) > 30_000 && Array.isArray(eaTrades) && !reconcileLock[acctKey];
        if (shouldReconcile) {
            reconcileLock[acctKey] = true;
            await reconcileTrades(base44, eaTrades, acctKey, livePriceMap)
                .catch(e => console.error('[BRIDGE] Reconcile error:', e.message))
                .finally(() => { reconcileLock[acctKey] = false; });
        }

        // ── 4. Update currency pair prices (throttled, cached pair map) ──────
        const lastPriceUpdate = body.last_price_update || 0;
        if ((now - lastPriceUpdate) > 60_000 && Array.isArray(eaPrices) && eaPrices.length > 0) {
            updateCurrencyPrices(base44, eaPrices).catch(e =>
                console.error('[BRIDGE] Price update error:', e.message)
            );
        }

        // ── 5. Risk / daily profit check (throttled) ─────────────────────────
        // NOTE: peak_equity is managed by monitorRiskLimits (which sees ALL accounts combined).
        // The bridge must NOT update peak_equity — doing so from a single account would corrupt the combined total.
        // Find account-specific risk settings first, fall back to global (no account_number)
        const riskSettings = (riskSettingsList || []).find(r => r.account_number === acctKey)
            || (riskSettingsList || []).find(r => !r.account_number)
            || null;
        const lastRiskCheck = body.last_risk_check || 0;
        // Bridge-side profit target check is DISABLED — monitorRiskLimits handles this exclusively
        // to avoid duplicate alerts from two separate code paths.

        // ── 6. Dispatch pending signals to EA ────────────────────────────────
        // Guard: if trading is paused, skip signal dispatch but return success (reconcile already ran above)
        if (riskSettings?.is_trading_paused === true) {
            console.log(`[BRIDGE] Trading paused for ${acctKey} — returning no signals`);
            if (releaseLock) { clearTimeout(lockSafetyTimer); releaseLock(); } globalLockPromise = null;
            return Response.json({
                success: true,
                account: acctKey,
                timestamp: new Date().toISOString(),
                heartbeat_interval_ms: HEARTBEAT_INTERVAL_MS,
                price_update_ts: body.last_price_update || 0,
                last_reconcile: body.last_reconcile || 0,
                last_risk_check: body.last_risk_check || 0,
                pending_signals: [],
                trading_paused: true,
            }, { headers: corsHeaders() });
        }

        const thirtyMinAgo = new Date(now - 30 * 60 * 1000).toISOString(); // 30min expiry window (was 20min — gives EA more time to execute)
        // Also expire ACTIVE signals older than 20 minutes (stuck signals that MT5 never acknowledged)
        // Was 10 minutes — too aggressive, caused valid trades to expire before EA could confirm
        const twentyMinAgo = new Date(now - 20 * 60 * 1000).toISOString();
        const stale = (allPendingSignals || []).filter(s =>
            s.created_date < thirtyMinAgo ||
            (s.status === 'ACTIVE' && s.owner_email === acctKey && s.created_date < twentyMinAgo)
        ); // expire stale signals
        if (stale.length > 0) {
            Promise.all(stale.map(s =>
                base44.asServiceRole.entities.Signal.update(s.id, { status: 'EXPIRED' })
            )).then(() => { cache.signals = { data: null, ts: 0 }; })
              .catch(e => console.error('[BRIDGE] Expire error:', e.message));
        }

        // Only do the expensive open-trades + connection lookup if there are actually signals to dispatch
        const candidateSignals = (allPendingSignals || []).filter(s => s.created_date >= thirtyMinAgo);

        let acctOpenTrades = [];
        let ownerEmail = null;

        if (candidateSignals.length > 0) {
            try {
                const [openTradesResult, connRecords] = await Promise.all([
                    base44.asServiceRole.entities.Trade.filter({ status: 'OPEN', owner_email: acctKey }, '-created_date', 200),
                    base44.asServiceRole.entities.BrokerConnection.filter({ account_number: acctKey })
                ]);
                acctOpenTrades = openTradesResult || [];
                ownerEmail = connRecords?.[0]?.created_by || null;
            } catch (e) {
                console.warn('[BRIDGE] Could not fetch open trades/connection for signal filter:', e.message);
            }
        }

        const openPairs = new Set(acctOpenTrades.map(t => (t.pair || '').replace('/', '')));

        // Load running bot configs for trading-hours enforcement at dispatch time
        let botConfigMap = {}; // bot_id → bot config (for trading hours check)
        if (candidateSignals.length > 0) {
            try {
                const runningBots = await base44.asServiceRole.entities.BotConfig.filter({ status: 'RUNNING' }, '-created_date', 50);
                for (const bot of runningBots) {
                    botConfigMap[bot.id] = bot;
                }
            } catch (e) {
                console.warn('[BRIDGE] Could not fetch bot configs for hour check:', e.message);
            }
        }

        // Route signals: if signal has owner_email set, only dispatch to matching account number
        const dispatchedPairsThisCycle = new Set(); // prevent multi-signal same pair in one heartbeat

        // Build set of pairs that already have an ACTIVE signal for THIS account — isolate-restart-proof check
        // IMPORTANT: scoped to acctKey only, so account B is not blocked by account A's active signals
        const activePairs = new Set(
            (allPendingSignals || []).filter(s => s.status === 'ACTIVE' && s.owner_email === acctKey).map(s => (s.pair || '').replace('/', ''))
        );

        const freshSignals = candidateSignals
            .filter(s => {
                // Skip if already dispatched this isolate session (prevents re-dispatch before DB write confirms)
                if (dispatchedSignalIds.has(s.id)) return false;

                const pairRaw = (s.pair || '').replace('/', '');
                const isManual = s.strategy === 'MANUAL_EXECUTION';

                // Manual signals: only check account targeting and per-cycle dedup — bypass cooldown & open-pair checks
                if (isManual) {
                    if (s.owner_email && s.owner_email !== acctKey) return false;
                    if (dispatchedPairsThisCycle.has(`manual:${pairRaw}`)) return false;
                    dispatchedPairsThisCycle.add(`manual:${pairRaw}`);
                    console.log(`[BRIDGE] Manual signal for ${pairRaw} — bypassing cooldown/open-pair checks`);
                    return true;
                }

                // Detect Gold signals
                const isGoldPair = ['XAUUSD', 'GOLD', 'XAU'].includes(pairRaw.toUpperCase()) || s.strategy === 'GOLD_XAUUSD';

                // Gold EA: only dispatch Gold signals; Standard EA: skip Gold signals (handled by Gold EA)
                if (isGoldEA && !isGoldPair) return false;
                if (!isGoldEA && isGoldPair) {
                    console.log(`[BRIDGE] Skipping Gold signal for standard EA — Gold EA handles XAUUSD`);
                    return false;
                }

                // If a signal for this pair is already ACTIVE in DB, skip — trade likely already open
                if (activePairs.has(pairRaw)) {
                    console.log(`[BRIDGE] Pair ${pairRaw} already has ACTIVE signal — skipping`);
                    return false;
                }
                // If signal is targeted to a specific account number, respect that
                if (s.owner_email) {
                    if (s.owner_email !== acctKey) return false;
                } else {
                    // Un-targeted signal: only dispatch if owner's email matches (legacy flow)
                    if (ownerEmail && s.created_by && s.created_by !== ownerEmail) return false;
                }
                // Skip if a trade on this pair is already open on this account
                if (openPairs.has(pairRaw)) return false;
                // Skip if we already queued a signal for this pair this heartbeat cycle
                if (dispatchedPairsThisCycle.has(pairRaw)) return false;
                // Skip if this pair was dispatched to this account within the last 15 minutes
                const cooldownKey = `${acctKey}:${pairRaw}`;
                const lastDispatch = pairDispatchCooldown[cooldownKey] || 0;
                if (now - lastDispatch < PAIR_COOLDOWN_MS) {
                    console.log(`[BRIDGE] Pair ${pairRaw} cooldown active for ${acctKey} — skipping`);
                    return false;
                }
                // Trading hours check at dispatch time — prevent signals dispatched outside bot's configured window
                if (s.bot_id && botConfigMap[s.bot_id]) {
                    const bot = botConfigMap[s.bot_id];
                    if (bot.trading_start_time && bot.trading_end_time) {
                        const nowUtc = new Date();
                        const [startH, startM] = bot.trading_start_time.split(':').map(Number);
                        const [endH, endM] = bot.trading_end_time.split(':').map(Number);
                        const nowMins = nowUtc.getUTCHours() * 60 + nowUtc.getUTCMinutes();
                        const startMins = startH * 60 + startM;
                        const endMins = endH * 60 + endM;
                        const inWindow = startMins <= endMins
                            ? nowMins >= startMins && nowMins < endMins
                            : nowMins >= startMins || nowMins < endMins;
                        if (!inWindow) {
                            console.log(`[BRIDGE] Bot "${bot.name}" outside trading hours (${bot.trading_start_time}–${bot.trading_end_time} UTC) — skipping signal ${s.id} for ${pairRaw} (will retry when in window)`);
                            // SKIP (not expire) — the signal should be dispatched when the trading window opens
                            return false;
                        }
                    }
                }
                dispatchedPairsThisCycle.add(pairRaw);
                return true;
            })
            .slice(0, 5);

        // Lock PENDING signals to ACTIVE before returning — skip ones already ACTIVE
        // Also register all dispatched IDs immediately to block any concurrent/rapid re-dispatch
        if (freshSignals.length > 0) {
            // Mark as dispatched BEFORE the async DB write to block any concurrent requests
            freshSignals.forEach(s => {
                dispatchedSignalIds.add(s.id);
                // Only set cooldown for non-manual signals — manual trades bypass cooldown entirely
                if (s.strategy !== 'MANUAL_EXECUTION') {
                    const pairRaw = (s.pair || '').replace('/', '');
                    pairDispatchCooldown[`${acctKey}:${pairRaw}`] = now;
                }
            });
            try {
                const toLock = freshSignals.filter(s => s.status === 'PENDING');
                if (toLock.length > 0) {
                    await Promise.all(toLock.map(s =>
                        base44.asServiceRole.entities.Signal.update(s.id, { status: 'ACTIVE' })
                    ));
                }
            } catch (e) {
                console.error('[BRIDGE] Signal lock error:', e.message);
                // On failure, remove from dispatched set so they can retry
                freshSignals.forEach(s => dispatchedSignalIds.delete(s.id));
            }
            cache.signals = { data: null, ts: 0 };
        }

        const sanitizedSignals = freshSignals.map(s => sanitizeSignal(s, livePriceMap));
        console.log('[BRIDGE]', acctKey, '→', sanitizedSignals.length, 'signals');

        if (releaseLock) { clearTimeout(lockSafetyTimer); releaseLock(); } globalLockPromise = null;
        return Response.json({
            success: true,
            account: acctKey,
            timestamp: new Date().toISOString(),
            heartbeat_interval_ms: HEARTBEAT_INTERVAL_MS,  // EA should respect this
            price_update_ts: (now - lastPriceUpdate) > 60_000 ? now : lastPriceUpdate,
            last_reconcile: shouldReconcile ? now : lastReconcile,
            last_risk_check: (now - (body.last_risk_check || 0)) > 60_000 ? now : (body.last_risk_check || 0),
            pending_signals: sanitizedSignals,
        }, { headers: corsHeaders() });

    } catch (error) {
        if (releaseLock) { clearTimeout(lockSafetyTimer); releaseLock(); } globalLockPromise = null;
        console.error('[BRIDGE ERROR]', error.message);

        // Write an alert record (throttled per account to avoid spam)
        try {
            // body is already parsed above — no need to re-read the consumed stream
            const acctKeyForAlert = String((body?.account || body)?.account_number || 'unknown');
            const nowTs = Date.now();
            const lastAlert = lastBridgeErrorAlert[acctKeyForAlert] || 0;
            if (nowTs - lastAlert > BRIDGE_ERROR_ALERT_THROTTLE_MS) {
                lastBridgeErrorAlert[acctKeyForAlert] = nowTs;
                const base44Alert = createClientFromRequest(req);

                // Write in-app alert
                await base44Alert.asServiceRole.entities.Alert.create({
                    title: '⚠️ Bridge Sync Error',
                    message: `MT4/MT5 bridge failed for account ${acctKeyForAlert}: ${error.message}`,
                    type: 'ERROR',
                    is_read: false,
                }).catch(e => console.error('[BRIDGE] Failed to write error alert:', e.message));

                // Send email to account owner
                try {
                    const connRecords = await base44Alert.asServiceRole.entities.BrokerConnection.filter({ account_number: acctKeyForAlert });
                    const ownerEmail = connRecords?.[0]?.owner_email || null;
                    if (ownerEmail) {
                        await base44Alert.asServiceRole.integrations.Core.SendEmail({
                            to: ownerEmail,
                            subject: '⚠️ ForexTouchAI - Bridge Sync Error',
                            body: `Your MT4/MT5 bridge encountered an error for account ${acctKeyForAlert}.\n\nError: ${error.message}\n\nTime: ${new Date().toLocaleString()}\n\nPlease check the Alerts tab in your ForexTouchAI dashboard for more details.`,
                        });
                        console.log('[BRIDGE] Error notification email sent to', ownerEmail);
                    }
                } catch (emailErr) {
                    console.error('[BRIDGE] Failed to send error email:', emailErr.message);
                }
            }
        } catch (_) { /* never let alert logic break the error response */ }

        return Response.json({ error: error.message }, { status: 500, headers: corsHeaders() });
    }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
}

function buildPriceMap(eaPrices) {
    const map = {};
    if (!Array.isArray(eaPrices)) return map;
    for (const p of eaPrices) {
        if (!p.symbol || !(p.bid > 0)) continue;
        const bare = p.symbol.replace('/', '');
        map[p.symbol] = p.bid;
        map[bare] = p.bid;
        if (p.ask > 0) {
            map[p.symbol + '_ask'] = p.ask;
            map[bare + '_ask'] = p.ask;
        }
    }
    return map;
}

function sanitizeSignal(s, livePriceMap) {
    const pair = (s.pair || '').replace('/', '');
    const type = s.type;
    const liveAsk = livePriceMap[pair + '_ask'] || livePriceMap[pair] || 0;
    const liveBid = livePriceMap[pair] || 0;
    const refPrice = type === 'BUY' ? (liveAsk || liveBid) : liveBid;

    // Use the live price as reference, fall back to signal's entry price
    const basePrice = refPrice > 0 ? refPrice : (s.entry_price || 0);

    let safeSL = s.stop_loss || 0;
    let safeTP = s.take_profit || 0;

    if (basePrice > 0) {
        // Instrument classification by symbol name and price range
        const pairUpper = pair.toUpperCase();
        const isGold = pairUpper === 'XAUUSD' || pairUpper === 'GOLD' || pairUpper === 'XAU' || s.strategy === 'GOLD_XAUUSD';
        // Indices/CFDs: named instruments like UK100, US30, AUS200, GER40, NAS100, SPX500, etc.
        const INDEX_SYMBOLS = ['UK100', 'US30', 'NAS100', 'SPX500', 'SP500', 'GER40', 'DAX', 'AUS200', 'JPN225', 'NIKKEI', 'HK50', 'FRA40', 'ITA40', 'ESP35', 'STOXX50', 'FTSE', 'DOW', 'DJI', 'NASDAQ'];
        const isIndex = INDEX_SYMBOLS.some(idx => pairUpper.includes(idx)) || (!isGold && basePrice > 1000);

        // Validate SL direction — reset if wrong side of price
        if (type === 'BUY' && safeSL >= basePrice) safeSL = 0;
        if (type === 'SELL' && safeSL <= basePrice) safeSL = 0;
        if (type === 'BUY' && safeTP <= basePrice) safeTP = 0;
        if (type === 'SELL' && safeTP >= basePrice) safeTP = 0;
        if (safeSL > 0 && safeTP > 0) {
            if (type === 'BUY' && safeSL >= safeTP) { safeSL = 0; safeTP = 0; }
            if (type === 'SELL' && safeSL <= safeTP) { safeSL = 0; safeTP = 0; }
        }

        if (isGold) {
            // Gold: use ATR-based dollar distances (~0.7% of price)
            const goldAtr = basePrice * 0.007; // ~$22-25 on Gold at $3200
            const defaultSlDist = goldAtr * 1.5;  // ~$33
            const defaultTpDist = goldAtr * 3.0;  // ~$67

            if (safeSL === 0) {
                safeSL = type === 'BUY'
                    ? parseFloat((basePrice - defaultSlDist).toFixed(2))
                    : parseFloat((basePrice + defaultSlDist).toFixed(2));
            }
            if (safeTP === 0) {
                safeTP = type === 'BUY'
                    ? parseFloat((basePrice + defaultTpDist).toFixed(2))
                    : parseFloat((basePrice - defaultTpDist).toFixed(2));
            }
            safeSL = parseFloat(safeSL.toFixed(2));
            safeTP = parseFloat(safeTP.toFixed(2));
        } else if (isIndex) {
            // Indices/CFDs: use percentage-based distances (0.5% SL, 1% TP) — wide enough for all brokers
            const defaultSlDist = basePrice * 0.005; // 0.5%
            const defaultTpDist = basePrice * 0.010; // 1.0%

            if (safeSL === 0) {
                safeSL = type === 'BUY'
                    ? parseFloat((basePrice - defaultSlDist).toFixed(2))
                    : parseFloat((basePrice + defaultSlDist).toFixed(2));
            }
            if (safeTP === 0) {
                safeTP = type === 'BUY'
                    ? parseFloat((basePrice + defaultTpDist).toFixed(2))
                    : parseFloat((basePrice - defaultTpDist).toFixed(2));
            }
            safeSL = parseFloat(safeSL.toFixed(2));
            safeTP = parseFloat(safeTP.toFixed(2));
            console.log(`[BRIDGE] sanitizeSignal ${pair} detected as INDEX — using % distances | SL dist: ${defaultSlDist.toFixed(2)} TP dist: ${defaultTpDist.toFixed(2)}`);
        } else {
            // Standard Forex: pip-based SL/TP
            const pipSize = basePrice > 50 ? 0.01 : 0.0001; // JPY pairs use 0.01
            const defaultSlPips = 30;
            const defaultTpPips = 60;

            if (safeSL === 0) {
                safeSL = type === 'BUY'
                    ? parseFloat((basePrice - defaultSlPips * pipSize).toFixed(5))
                    : parseFloat((basePrice + defaultSlPips * pipSize).toFixed(5));
            }
            if (safeTP === 0) {
                safeTP = type === 'BUY'
                    ? parseFloat((basePrice + defaultTpPips * pipSize).toFixed(5))
                    : parseFloat((basePrice - defaultTpPips * pipSize).toFixed(5));
            }
        }

        const instrumentType = isGold ? '[GOLD]' : isIndex ? '[INDEX]' : '[FOREX]';
        console.log(`[BRIDGE] sanitizeSignal ${pair} ${type} @ ${basePrice} | SL: ${safeSL} | TP: ${safeTP} ${instrumentType}`);
    } else {
        // No price available at all — log and send 0s (EA will reject the signal anyway)
        console.warn(`[BRIDGE] sanitizeSignal: no price for ${pair} — signal ${s.id} sent without SL/TP`);
        safeSL = 0; safeTP = 0;
    }

    // Determine order comment based on strategy/pair — ensures trades are tagged correctly in MT4/MT5
    const isGoldSignal = (pair === 'XAUUSD' || pair === 'GOLD' || pair === 'XAU' || s.strategy === 'GOLD_XAUUSD');
    const orderComment = isGoldSignal ? 'GoldForexTouchAI' : 'ForexTouchAI';

    return { id: s.id, pair, type, lot_size: s.lot_size || 0.1, stop_loss: safeSL, take_profit: safeTP, entry_price: basePrice || s.entry_price || 0, comment: orderComment };
}

// ─── Reconcile trades ────────────────────────────────────────────────────────
// Per-account last dedup timestamp — only run dedup every 5 minutes to avoid rate limits
const lastDedupTs = {};

async function reconcileTrades(base44, eaTrades, acctKey, livePriceMap = {}) {
    // ── Deduplication cleanup: throttled to once per 5 min per account ──
    const nowTs = Date.now();
    const shouldDedup = !lastDedupTs[acctKey] || (nowTs - lastDedupTs[acctKey]) > 300_000;
    if (shouldDedup) lastDedupTs[acctKey] = nowTs;

    if (shouldDedup) try {
        const allAcctTrades = await base44.asServiceRole.entities.Trade.filter(
            { owner_email: acctKey, status: 'OPEN' }, '-created_date', 500
        );
        const seenTickets = {};
        const seenPairType = {}; // key: "pair:type" → earliest created_date record
        const toDelete = new Set();
        // First pass: dedup by ticket
        for (const t of allAcctTrades) {
            if (!t.ticket) continue;
            if (seenTickets[t.ticket]) {
                toDelete.add(t.id);
            } else {
                seenTickets[t.ticket] = true;
            }
        }
        // Second pass: dedup by pair+type within 60 seconds (catches manual trade double-fires)
        for (const t of allAcctTrades) {
            if (toDelete.has(t.id)) continue; // already flagged
            const key = `${(t.pair||'').replace('/','').toUpperCase()}:${t.type}`;
            if (seenPairType[key]) {
                const existing = seenPairType[key];
                const diff = Math.abs(new Date(t.created_date).getTime() - new Date(existing.created_date).getTime());
                if (diff < 60_000) {
                    // Keep the one with the higher ticket number (more recent MT4 order), delete the other
                    if ((t.ticket || 0) < (existing.ticket || 0)) {
                        toDelete.add(t.id);
                    } else {
                        toDelete.add(existing.id);
                        seenPairType[key] = t;
                    }
                    console.log(`[BRIDGE] Dedup pair+type: removing duplicate ${key} opened within 60s`);
                } else {
                    // Not a duplicate — keep both (different trades on same pair at different times)
                }
            } else {
                seenPairType[key] = t;
            }
        }
        if (toDelete.size > 0) {
            console.log('[BRIDGE] Dedup: removing', toDelete.size, 'duplicate trade records for', acctKey);
            await Promise.all([...toDelete].map(id => base44.asServiceRole.entities.Trade.delete(id)));
        }
    } catch (e) {
        console.warn('[BRIDGE] Dedup cleanup error:', e.message);
    } // end shouldDedup block

    // ── Cold-start init: populate knownTickets from DB exactly once per isolate ──
    // All concurrent requests await the same promise — no races.
    if (!knownTickets[acctKey]) {
        if (!initPromise[acctKey]) {
            initPromise[acctKey] = (async () => {
                knownTickets[acctKey] = new Set();
                try {
                    // Only load recent trades (last 500) to avoid rate limit on large accounts
                    const allTrades = await base44.asServiceRole.entities.Trade.filter({ owner_email: acctKey }, '-created_date', 500);
                    allTrades.forEach(t => { if (t.ticket) knownTickets[acctKey].add(t.ticket); });
                    console.log('[BRIDGE] Cold-start init: loaded', knownTickets[acctKey].size, 'tickets for', acctKey);
                } catch (e) {
                    console.warn('[BRIDGE] Cold-start init failed:', e.message);
                    knownTickets[acctKey] = new Set(); // empty but set — won't re-init
                }
            })();
        }
        await initPromise[acctKey];
    }

    const memTickets = knownTickets[acctKey];

    // Fetch fresh open-trade DB state for PnL updates and close detection
    let existingDbTrades = [];
    try {
        existingDbTrades = await base44.asServiceRole.entities.Trade.filter(
            { status: 'OPEN', owner_email: acctKey }, '-created_date', 500
        );
        existingDbTrades.forEach(t => { if (t.ticket) memTickets.add(t.ticket); });
    } catch (e) {
        console.warn('[BRIDGE] DB fetch rate-limited, using memory tickets only');
    }

    // ── Create new trades ────────────────────────────────────────────────────────
    // Triple-guarded: (1) in-memory set, (2) per-ticket create lock, (3) DB existence check
    // ALSO: don't create trades for tickets already in the closed DB — prevent duplicate closed records
    let closedTickets = new Set();
    try {
        const recentClosed = await base44.asServiceRole.entities.Trade.filter(
            { owner_email: acctKey, status: 'CLOSED' }, '-updated_date', 200
        );
        recentClosed.forEach(t => { if (t.ticket) { closedTickets.add(t.ticket); memTickets.add(t.ticket); } });
    } catch (e) {
        console.warn('[BRIDGE] Closed ticket fetch error:', e.message);
    }

    const createdTickets = [];
    const toCreate = eaTrades.filter(t => {
        if (!t.ticket || !(t.pair || t.symbol)) return false;
        if (closedTickets.has(t.ticket)) return false; // already closed — don't re-create
        return !memTickets.has(t.ticket);
    });
    if (toCreate.length > 0) {
        console.log('[BRIDGE] Creating', toCreate.length, 'new trades for', acctKey);
        for (const t of toCreate) {
            const lockKey = `${acctKey}:${t.ticket}`;

            // Guard 1: in-memory ticket set (fast path)
            if (memTickets.has(t.ticket)) continue;

            // Guard 2: per-ticket create lock (blocks concurrent requests in same isolate)
            if (ticketCreateLock[lockKey]) {
                console.log('[BRIDGE] Ticket', t.ticket, 'already being created — skipping');
                continue;
            }
            ticketCreateLock[lockKey] = true;

            try {
                // ── Cross-isolate guard: check DB for this ticket before creating ──
                // Without this, two isolates can both see memTickets.has()===false and create duplicates
                const existingWithTicket = await base44.asServiceRole.entities.Trade.filter({ ticket: t.ticket, owner_email: acctKey }, '-created_date', 1);
                if (existingWithTicket.length > 0) {
                    console.log('[BRIDGE] Ticket', t.ticket, 'already exists in DB — skipping creation (cross-isolate guard)');
                    memTickets.add(t.ticket); // mark known so we don't try again
                    continue;
                }
                memTickets.add(t.ticket);
                const sym = (t.pair || t.symbol || '').replace('/', '');
                // Use explicit check (> 0) so we don't skip a valid open_price of 0
                const resolvedPrice = (t.open_price > 0 ? t.open_price : null)
                    ?? (t.price > 0 ? t.price : null)
                    ?? livePriceMap[sym]
                    ?? livePriceMap[(t.pair || t.symbol)]
                    ?? 0;
                await base44.asServiceRole.entities.Trade.create({
                    pair: t.pair || t.symbol,
                    type: t.type || 'BUY',
                    lot_size: t.lot_size || t.lots || 0.1,
                    open_price: resolvedPrice,
                    pnl: t.pnl || t.profit || 0,
                    status: 'OPEN',
                    ticket: t.ticket,
                    is_auto: true,
                    owner_email: acctKey,
                });
                createdTickets.push(t.ticket);
                console.log('[BRIDGE] Created ticket', t.ticket, 'for', acctKey);

                // Auto-close the matching ACTIVE signal for this account+pair
                // This handles the case where EA executes the trade but never calls confirmExecution
                try {
                    const pairNorm = sym.toUpperCase();
                    const pairWithSlash = pairNorm.length === 6 ? pairNorm.slice(0, 3) + '/' + pairNorm.slice(3) : pairNorm;
                    const matchingSignals = await base44.asServiceRole.entities.Signal.filter({
                        status: 'ACTIVE',
                        owner_email: acctKey,
                    }, '-created_date', 10);
                    const matchedSignal = matchingSignals.find(s =>
                        (s.pair || '').replace('/', '').toUpperCase() === pairNorm
                    );
                    if (matchedSignal) {
                        await base44.asServiceRole.entities.Signal.update(matchedSignal.id, { status: 'CLOSED' });
                        console.log('[BRIDGE] Auto-closed signal', matchedSignal.id, 'for', pairNorm, acctKey);
                    }
                } catch (sigErr) {
                    console.warn('[BRIDGE] Signal auto-close error:', sigErr.message);
                }

                // Small delay between creates to avoid 429 rate limiting
                await new Promise(r => setTimeout(r, 200));
            } catch (e) {
                console.error('[BRIDGE] Trade create error ticket', t.ticket, e.message);
                memTickets.delete(t.ticket); // unlock so it can retry next cycle
            } finally {
                delete ticketCreateLock[lockKey]; // always release lock
            }
        }
    }

    // Build EA ticket set for PnL updates and close detection
    const eaTicketSet = new Set(eaTrades.map(t => t.ticket).filter(Boolean));

    // Add all EA tickets to memory (even already-existing ones)
    eaTicketSet.forEach(t => memTickets.add(t));

    if (existingDbTrades.length === 0 && eaTicketSet.size === 0) return; // nothing to do
    if (existingDbTrades.length === 0) return; // DB fetch rate-limited — skip updates/closes

    // ── Update PnL (only if changed by >$1 to reduce DB writes) ─────────────
    const toUpdatePnl = existingDbTrades.filter(t => {
        if (!t.ticket || !eaTicketSet.has(t.ticket)) return false;
        const ea = eaTrades.find(et => et.ticket === t.ticket);
        return ea && Math.abs((t.pnl || 0) - (ea.pnl || ea.profit || 0)) > 1.0;
    });
    for (let i = 0; i < toUpdatePnl.length; i += 2) {
        await Promise.all(toUpdatePnl.slice(i, i + 2).map(t => {
            const ea = eaTrades.find(et => et.ticket === t.ticket);
            return base44.asServiceRole.entities.Trade.update(t.id, { pnl: ea.pnl || ea.profit || 0 });
        })).catch(e => console.warn('[BRIDGE] PnL update error:', e.message));
        if (i + 2 < toUpdatePnl.length) await new Promise(r => setTimeout(r, 150));
    }

    // ── Close trades no longer in EA ─────────────────────────────────────────
    const toClose = existingDbTrades.filter(t => t.ticket && !eaTicketSet.has(t.ticket));
    if (toClose.length > 0) {
        console.log('[BRIDGE] Closing', toClose.length, 'trades for', acctKey);
        for (let i = 0; i < toClose.length; i += 2) {
            await Promise.all(toClose.slice(i, i + 2).map(async (t) => {
                // ── Cross-isolate guard: re-verify trade is still OPEN before closing ──
                // Another isolate may have already closed this trade since we fetched existingDbTrades
                try {
                    const fresh = await base44.asServiceRole.entities.Trade.filter({ id: t.id, status: 'OPEN' }, '-created_date', 1);
                    if (fresh.length === 0) {
                        console.log('[BRIDGE] Ticket', t.ticket, 'already closed by another isolate — skipping');
                        memTickets.delete(t.ticket);
                        return;
                    }
                } catch (_) { /* proceed with close even if verification fails */ }
                const finalPnl = t.pnl || 0;
                let closePrice = 0;
                if (t.open_price > 0) {
                    const lotMultiplier = (t.lot_size || 0.1) * 100000;
                    const priceMove = lotMultiplier > 0 ? finalPnl / lotMultiplier : 0;
                    closePrice = parseFloat((t.type === 'BUY' ? t.open_price + priceMove : t.open_price - priceMove).toFixed(5));
                }
                memTickets.delete(t.ticket);
                return base44.asServiceRole.entities.Trade.update(t.id, {
                    status: 'CLOSED',
                    close_price: closePrice,
                    pnl: finalPnl,
                });
            })).catch(e => console.warn('[BRIDGE] Close error:', e.message));
            if (i + 2 < toClose.length) await new Promise(r => setTimeout(r, 150));
        }
    }
}

// ─── Update currency pair prices (with cached pair map) ───────────────────────
async function updateCurrencyPrices(base44, eaPrices) {
    // Use cached pair map to avoid fetching all pairs every 60s
    if (!isFresh(cache.pairMap, TTL.pairMap)) {
        try {
            const pairs = await base44.asServiceRole.entities.CurrencyPair.list('-created_date', 100);
            const map = {};
            for (const p of pairs) { if (p.symbol) map[p.symbol] = p; }
            cache.pairMap = { data: map, ts: Date.now() };
        } catch (e) {
            console.warn('[BRIDGE] PairMap fetch error:', e.message);
            return;
        }
    }

    const pairMap = cache.pairMap.data;
    const ops = [];
    for (const price of eaPrices) {
        const sym = price.symbol;
        const bid = price.bid;
        if (!sym || !(bid > 0)) continue;
        const displaySymbol = sym.length === 6 ? sym.slice(0, 3) + '/' + sym.slice(3) : sym;
        const existing = pairMap[displaySymbol] || pairMap[sym];
        if (existing) {
            ops.push(base44.asServiceRole.entities.CurrencyPair.update(existing.id, { symbol: displaySymbol, current_price: bid })
                .then(() => { pairMap[displaySymbol] = { ...existing, current_price: bid }; }));
        } else {
            ops.push(base44.asServiceRole.entities.CurrencyPair.create({ symbol: displaySymbol, current_price: bid, category: 'MAJOR', ai_signal: 'NEUTRAL', ai_confidence: 0 })
                .then(created => { pairMap[displaySymbol] = created; }));
        }
    }
    for (let i = 0; i < ops.length; i += 5) {
        await Promise.all(ops.slice(i, i + 5)).catch(e => console.warn('[BRIDGE] Price batch error:', e.message));
    }
    console.log('[BRIDGE] Updated', ops.length, 'prices');
}