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
const MIN_CALL_INTERVAL_MS = 45_000; // 45 seconds minimum between calls per account

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

// Close-command resend tracker: once a close command is sent for a ticket, don't
// resend it for CLOSE_RESEND_COOLDOWN_MS. This prevents the EA from receiving
// duplicate close commands every heartbeat for tickets that are flagged
// close_requested. If the ticket closes (SL/TP) before the EA processes the
// command, the ticket disappears from the next heartbeat → bridge auto-closes
// the DB record → no resend. Without this cooldown, the EA gets the same close
// command every 30s and spams "ticket not found" errors.
const sentCloseTickets = {}; // keyed by "acctKey:ticket" → timestamp of last send
const CLOSE_RESEND_COOLDOWN_MS = 60_000; // 60 seconds between close-command resends per ticket

// ─── Throttle config ─────────────────────────────────────────────────────────
const TTL = {
    signals:    10_000,  // 10s  — short TTL so expired signals clear fast
    trades:     60_000,  // 60s  — trade list cache
    risk:       60_000,  // 60s — risk settings (short TTL so schedule toggles take effect fast)
    connection: 45_000,  // 45s  — heartbeat throttle (matches min call interval)
    pairMap:   600_000,  // 10min — currency pair map
};

// How often the EA should heartbeat (returned in response so EA can self-throttle)
const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds

function isFresh(entry, ttl) {
    return entry.data !== null && (Date.now() - entry.ts) < ttl;
}

// ─── Main handler ─────────────────────────────────────────────────────────────
// v3: fixed globalRisk reference + ACTIVE signal cooldown bypass + redeploy trigger
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

        // ── API Key validation — reject missing or non-FTAI keys (auth bypass fix) ─
        const authHeader = req.headers.get('Authorization') || '';
        const providedKey = authHeader.replace(/^Bearer\s+/i, '').trim();
        if (!providedKey || !providedKey.startsWith('FTAI-')) {
            return Response.json({ error: 'Missing or invalid API key' }, { status: 401, headers: corsHeaders() });
        }
        let resolvedOwnerEmail = null;
        // Lookup the EaApiKey record to get the owner_email for this key
        try {
            const matchingKeys = await base44.asServiceRole.entities.EaApiKey.filter({ api_key: providedKey });
            if (!matchingKeys || matchingKeys.length === 0) {
                return Response.json({ error: 'Invalid API key' }, { status: 401, headers: corsHeaders() });
            }
            resolvedOwnerEmail = matchingKeys[0].owner_email || null;
        } catch (e) {
            console.warn('[BRIDGE] EaApiKey lookup failed — rejecting request:', e.message);
            return Response.json({ error: 'API key verification unavailable' }, { status: 503, headers: corsHeaders() });
        }
        const now = Date.now();
        const acct = body.account || body;
        const { account_number, server_name, balance, equity, margin, free_margin, margin_level, leverage, currency, platform } = acct;

        if (!account_number) {
            return Response.json({ error: 'account_number is required' }, { status: 400, headers: corsHeaders() });
        }

        const acctKey = String(account_number);

        // ── Ownership check: verify account_number belongs to the API key owner (IDOR fix) ──
        // An attacker with their own API key could otherwise spoof a victim's account_number
        // and read signals / overwrite balances / force-close trades via service-role queries.
        try {
            const existingConns = await base44.asServiceRole.entities.BrokerConnection.filter({ account_number: acctKey });
            const connOwnerEmail = existingConns?.[0]?.owner_email || null;
            if (resolvedOwnerEmail && connOwnerEmail && connOwnerEmail !== resolvedOwnerEmail) {
                console.warn(`[BRIDGE] Ownership mismatch for account ${acctKey}: key owner=${resolvedOwnerEmail}, conn owner=${connOwnerEmail}`);
                return Response.json({ error: 'Account not authorized for this API key' }, { status: 403, headers: corsHeaders() });
            }
        } catch (e) {
            console.warn('[BRIDGE] BrokerConnection ownership lookup failed:', e.message);
        }

        // Detect if this is a Gold EA heartbeat (only sends XAUUSD price).
        // Normalise the symbol (strip '/' and broker suffixes like '.r', '.m', '.raw')
        // so brokers using "XAUUSD.r" are still recognised as a Gold EA.
        const eaPricesRaw = body.prices || acct.prices;
        const _normSym = (s) => { const u = (s || '').toUpperCase().replace('/', ''); const d = u.indexOf('.'); return d === -1 ? u : u.slice(0, d); };
        const isGoldEA = Array.isArray(eaPricesRaw) && eaPricesRaw.length === 1 &&
            ['XAUUSD', 'GOLD', 'XAU'].includes(_normSym(eaPricesRaw[0]?.symbol));

        // Detect if this is a Silver EA heartbeat (only sends XAGUSD price)
        const isSilverEA = Array.isArray(eaPricesRaw) && eaPricesRaw.length === 1 &&
            ['XAGUSD', 'SILVER', 'XAG'].includes(_normSym(eaPricesRaw[0]?.symbol));

        // Gold/Silver EA use a separate rate-limit slot so they're never blocked by the standard EA calling the same account
        const rateLimitKey = isGoldEA ? `${acctKey}:gold` : isSilverEA ? `${acctKey}:silver` : acctKey;

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
        // Small stagger delay after lock acquired to spread DB load across accounts
        await new Promise(r => setTimeout(r, 300));
        // Safety timeout: auto-release lock after 30s if something crashes mid-processing
        lockSafetyTimer = setTimeout(() => {
            if (globalLockOwner === acctKey && globalLockPromise) {
                console.warn(`[BRIDGE] Safety timeout releasing global lock for ${acctKey}`);
                if (releaseLock) { clearTimeout(lockSafetyTimer); releaseLock(); } globalLockPromise = null;
            }
        }, 30_000);

        // ── Rate limit: reject if called too frequently ───────────────────────
        // Gold/Silver EAs are lightweight (1 price, no reconcile) and heartbeats every 30s.
        // The 45s standard rate limit would block them on every other heartbeat, preventing
        // signal dispatch. Use a shorter 15s interval for Gold/Silver so they're never blocked.
        // v2: reduced from 20s to 15s to ensure dispatch on every heartbeat.
        const rateLimitInterval = (isGoldEA || isSilverEA) ? 15_000 : MIN_CALL_INTERVAL_MS;
        const lastCall = lastCallTs[rateLimitKey] || 0;
        const isRateLimited = (now - lastCall) < rateLimitInterval;

        // Always run trade reconcile even when rate-limited — trade sync must not be blocked
        const eaTradesEarly = body.trades || acct.trades;
        const eaPricesEarly = body.prices || acct.prices;
        const livePriceMapEarly = buildPriceMap(eaTradesEarly?.length ? eaPricesEarly : []);
        const isColdStartEarly = !knownTickets[acctKey];
        if (isRateLimited && !isGoldEA && !isSilverEA && Array.isArray(eaTradesEarly) && !reconcileLock[acctKey] && (isColdStartEarly || eaTradesEarly.length > 0)) {
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
                retry_after_ms: rateLimitInterval - (now - lastCall),
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
        // Clean sentCloseTickets entries older than the resend cooldown window
        const closeCutoff = now - CLOSE_RESEND_COOLDOWN_MS * 2;
        for (const key of Object.keys(sentCloseTickets)) {
            if (sentCloseTickets[key] < closeCutoff) delete sentCloseTickets[key];
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
                ...(!isGoldEA && !isSilverEA && Array.isArray(eaTradesForCount) && { open_trade_count: eaTradesForCount.length }),
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
        // Force reconcile on cold start (isolate restart wiped knownTickets) even if lastReconcile looks recent
        const isColdStart = !knownTickets[acctKey];
        const shouldReconcile = !isGoldEA && !isSilverEA && (isColdStart || (now - lastReconcile) > 30_000) && Array.isArray(eaTrades) && !reconcileLock[acctKey];
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
        const accountRisk = (riskSettingsList || []).find(r => r.account_number === acctKey) || null;
        const globalRiskRec = (riskSettingsList || []).find(r => !r.account_number) || null;
        const riskSettings = accountRisk || globalRiskRec;
        const lastRiskCheck = body.last_risk_check || 0;

        // ── Global trading schedule: account overrides global default ──
        // If the account has its own schedule enabled, use it; otherwise inherit the global default.
        const scheduleSettings = (accountRisk?.global_schedule_enabled === true) ? accountRisk : globalRiskRec;
        const scheduleOffNow = isScheduleOff(scheduleSettings, now);
        // Bridge-side profit target check is DISABLED — monitorRiskLimits handles this exclusively
        // to avoid duplicate alerts from two separate code paths.

        // ── 6. Dispatch pending signals to EA ────────────────────────────────
        // When trading is paused, auto/bot signals are blocked but MANUAL_EXECUTION signals
        // (sent from the app) still dispatch — so users can trade manually while auto-trade is off.
        // Two independent blocks on auto/bot signals (manual signals always pass through):
        //  - auto_trade_enabled === false: user turned the auto-trade toggle OFF (manual, not a risk breach)
        //  - is_trading_paused === true:   risk limit / profit target pause (set by monitorRiskLimits)
        const tradingPaused = riskSettings?.is_trading_paused === true;
        const autoTradeOff = riskSettings?.auto_trade_enabled === false;
        const blockAutoSignals = tradingPaused || autoTradeOff;

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
        console.log(`[BRIDGE] ${acctKey} isGoldEA=${isGoldEA} isSilverEA=${isSilverEA} allPending=${(allPendingSignals||[]).length} candidates=${candidateSignals.length} scheduleOff=${scheduleOffNow} blockAuto=${blockAutoSignals}`);
        if (candidateSignals.length > 0) {
            console.log(`[BRIDGE] ${acctKey} candidate signals:`, candidateSignals.map(s => ({id: s.id, pair: s.pair, status: s.status, strat: s.strategy, owner: s.owner_email, created: s.created_date})));
        }

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

        // Build open-pair set from BOTH the DB trades AND the EA's live heartbeat trades.
        // The EA may have just opened a trade that reconcile hasn't persisted yet — without
        // including eaTrades here, the bridge would re-dispatch the same ACTIVE signal and
        // the EA would open a duplicate position on the next heartbeat.
        const openPairs = new Set([
            ...acctOpenTrades.map(t => (t.pair || '').replace('/', '').toUpperCase()),
            ...(eaTrades || []).map(t => ((t.pair || t.symbol || '').replace('/', '').toUpperCase()))
        ]);

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

        // Build map of pair → ACTIVE signal ID for THIS account — isolate-restart-proof check
        // IMPORTANT: scoped to acctKey only, so account B is not blocked by account A's active signals
        // Uses a MAP (not Set) so the SAME active signal can be re-dispatched if the EA missed it;
        // only a DIFFERENT active signal for the same pair blocks dispatch.
        const activePairIds = new Map();
        for (const s of (allPendingSignals || [])) {
            if (s.status === 'ACTIVE' && s.owner_email === acctKey) {
                activePairIds.set((s.pair || '').replace('/', ''), s.id);
            }
        }

        const freshSignals = candidateSignals
            .filter(s => {
                // Skip PENDING signals already dispatched this isolate session (prevents re-dispatch before DB write confirms).
                // ACTIVE signals are allowed through for re-dispatch — if the EA missed the first dispatch (network blip,
                // OrderSend failure), the bridge gives it another chance. The openPairs check below prevents duplicate trades.
                if (s.status === 'PENDING' && dispatchedSignalIds.has(s.id)) return false;

                // Global schedule OFF: block ALL signals (auto + manual) during the off-window
                if (scheduleOffNow) {
                    console.log(`[BRIDGE] Schedule OFF for ${acctKey} — blocking signal ${s.id} (${(s.pair || '').replace('/', '')})`);
                    return false;
                }

                const pairRaw = (s.pair || '').replace('/', '');
                const isManual = s.strategy === 'MANUAL_EXECUTION';

                // Block auto/bot signals when auto-trade is off or risk has paused trading — manual signals still pass through
                if (blockAutoSignals && !isManual) {
                    console.log(`[BRIDGE] Auto signals blocked for ${acctKey} (auto_trade_enabled=${!autoTradeOff}, risk_paused=${tradingPaused}) — skipping auto signal ${s.id} (${pairRaw})`);
                    return false;
                }

                // Manual signals: bypass cooldown & open-pair checks, but STILL respect Gold/Silver EA routing
                // (standard EA filters out Gold symbols in MQL4, so a manual Gold signal must go to the Gold EA)
                if (isManual) {
                    if (s.owner_email && s.owner_email !== acctKey) return false;
                    const isGoldPairM = ['XAUUSD', 'GOLD', 'XAU'].includes(pairRaw.toUpperCase());
                    const isSilverPairM = ['XAGUSD', 'SILVER', 'XAG'].includes(pairRaw.toUpperCase());
                    if (isGoldPairM && !isGoldEA) {
                        console.log(`[BRIDGE] Skipping manual Gold signal for standard EA — Gold EA handles XAUUSD`);
                        return false;
                    }
                    if (isSilverPairM && !isSilverEA) {
                        console.log(`[BRIDGE] Skipping manual Silver signal for ${isGoldEA ? 'Gold' : 'standard'} EA — Silver EA handles XAGUSD`);
                        return false;
                    }
                    if (isGoldEA && !isGoldPairM) {
                        console.log(`[BRIDGE] Gold EA skipping manual non-Gold signal ${pairRaw}`);
                        return false;
                    }
                    if (isSilverEA && !isSilverPairM) {
                        console.log(`[BRIDGE] Silver EA skipping manual non-Silver signal ${pairRaw}`);
                        return false;
                    }
                    // Don't re-dispatch a manual signal if a trade on this pair is already open
                    // (either in the DB or on the EA's live heartbeat). Manual signals bypass the
                    // per-pair COOLDOWN so the user can fire one quickly, but they must NOT bypass
                    // the duplicate guard — otherwise the EA opens a duplicate on every heartbeat
                    // until the reconcile closes the ACTIVE signal.
                    if (openPairs.has(pairRaw.toUpperCase())) {
                        console.log(`[BRIDGE] Manual signal for ${pairRaw} skipped — trade already open on ${acctKey}`);
                        return false;
                    }
                    if (dispatchedPairsThisCycle.has(`manual:${pairRaw}`)) return false;
                    dispatchedPairsThisCycle.add(`manual:${pairRaw}`);
                    console.log(`[BRIDGE] Manual signal for ${pairRaw} — bypassing cooldown (routed to ${isGoldEA ? 'Gold' : isSilverEA ? 'Silver' : 'standard'} EA)`);
                    return true;
                }

                // Detect Gold signals
                const isGoldPair = ['XAUUSD', 'GOLD', 'XAU'].includes(pairRaw.toUpperCase()) || s.strategy === 'GOLD_XAUUSD';
                // Detect Silver signals
                const isSilverPair = ['XAGUSD', 'SILVER', 'XAG'].includes(pairRaw.toUpperCase()) || s.strategy === 'SILVER_XAGUSD';

                // Gold EA: only dispatch Gold signals; Standard EA: skip Gold signals (handled by Gold EA)
                if (isGoldEA && !isGoldPair) return false;
                if (!isGoldEA && isGoldPair) {
                    console.log(`[BRIDGE] Skipping Gold signal for standard EA — Gold EA handles XAUUSD`);
                    return false;
                }
                // Silver EA: only dispatch Silver signals; Standard/Gold EA: skip Silver signals (handled by Silver EA)
                if (isSilverEA && !isSilverPair) return false;
                if (!isSilverEA && isSilverPair) {
                    console.log(`[BRIDGE] Skipping Silver signal for ${isGoldEA ? 'Gold' : 'standard'} EA — Silver EA handles XAGUSD`);
                    return false;
                }

                // If a DIFFERENT signal for this pair is already ACTIVE in DB, skip — trade likely already open.
                // The SAME active signal (EA missed it / isolate restarted) is allowed through for re-dispatch.
                const activeIdForPair = activePairIds.get(pairRaw);
                if (activeIdForPair && activeIdForPair !== s.id) {
                    console.log(`[BRIDGE] Pair ${pairRaw} already has a different ACTIVE signal ${activeIdForPair} — skipping ${s.id}`);
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
                if (openPairs.has(pairRaw.toUpperCase())) return false;
                // Skip if we already queued a signal for this pair this heartbeat cycle
                if (dispatchedPairsThisCycle.has(pairRaw)) return false;
                // Cooldown: only block PENDING signals from rapid re-dispatch.
                // ACTIVE signals MUST bypass cooldown — they're already locked but the EA may have
                // failed to execute (e.g. MT5 error 10030). Re-dispatching gives the EA another chance
                // on every heartbeat. The openPairs check below prevents duplicate trades once the
                // broker position is actually open.
                if (s.status === 'PENDING') {
                    const cooldownKey = `${acctKey}:${pairRaw}`;
                    const lastDispatch = pairDispatchCooldown[cooldownKey] || 0;
                    if (now - lastDispatch < PAIR_COOLDOWN_MS) {
                        console.log(`[BRIDGE] Pair ${pairRaw} cooldown active for ${acctKey} — skipping PENDING signal`);
                        return false;
                    }
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
        console.log(`[BRIDGE] ${acctKey} freshSignals=${freshSignals.length}`, freshSignals.map(s => ({id: s.id, pair: s.pair, status: s.status})));

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

        // When dispatching to a Gold/Silver EA, rewrite the signal pair to match the
        // EA's actual broker symbol (e.g. signal "XAUUSD" → broker "XAUUSD.r").  The EA
        // compares the signal pair against its own configured symbol and skips mismatches,
        // so without this remap a broker suffix would cause the EA to reject the signal.
        const eaBrokerSymbol = (isGoldEA || isSilverEA) && Array.isArray(eaPricesRaw) && eaPricesRaw[0]?.symbol
            ? eaPricesRaw[0].symbol : null;
        const sanitizedSignals = freshSignals.map(s => {
            const sanitized = sanitizeSignal(s, livePriceMap);
            if (eaBrokerSymbol) {
                sanitized.pair = eaBrokerSymbol;
            }
            return sanitized;
        });
        console.log('[BRIDGE]', acctKey, '→', sanitizedSignals.length, 'signals', eaBrokerSymbol ? `(broker symbol: ${eaBrokerSymbol})` : '');

        // ── Global schedule: if OFF now, flag all open trades for close (EA flattens them) ──
        if (scheduleOffNow) {
            try {
                const openForClose = await base44.asServiceRole.entities.Trade.filter(
                    { status: 'OPEN', owner_email: acctKey, close_requested: false }, '-created_date', 100
                );
                if (openForClose?.length > 0) {
                    console.log(`[BRIDGE] Schedule OFF for ${acctKey} — flagging ${openForClose.length} open trade(s) for close`);
                    await Promise.all(openForClose.map(t =>
                        base44.asServiceRole.entities.Trade.update(t.id, { close_requested: true })
                    ));
                }
            } catch (e) { console.warn('[BRIDGE] Schedule close-all error:', e.message); }
        }

        // ── Close commands: OPEN trades this account flagged close_requested ──
        // Set by monitorBotPerformance (bot close-all-at-profit/loss) or schedule OFF.
        // IMPORTANT: Only send close commands for tickets the EA is CURRENTLY reporting
        // as open. If the ticket is gone from the broker (hit SL/TP, manually closed), the
        // EA can't close it and will spam error 4108 (unknown ticket) on every retry.
        // Cross-referencing against eaTrades prevents sending stale close commands.
        let closeCommands = [];
        try {
            const closeReqTrades = await base44.asServiceRole.entities.Trade.filter(
                { status: 'OPEN', owner_email: acctKey, close_requested: true }, '-created_date', 50
            );
            // Build set of tickets the EA is currently reporting as open
            const eaOpenTickets = new Set((eaTrades || []).map(t => t.ticket).filter(Boolean));
            // Only send close commands for tickets the EA reports as open AND that
            // haven't been sent recently (cooldown prevents duplicate close commands
            // that cause "ticket not found" spam when the position hits SL/TP between
            // the heartbeat and the EA's OrderClose attempt).
            closeCommands = (closeReqTrades || [])
                .filter(t => t.ticket && eaOpenTickets.has(t.ticket))
                .filter(t => {
                    const key = `${acctKey}:${t.ticket}`;
                    const lastSent = sentCloseTickets[key] || 0;
                    return (now - lastSent) >= CLOSE_RESEND_COOLDOWN_MS;
                })
                .map(t => {
                    sentCloseTickets[`${acctKey}:${t.ticket}`] = now;
                    return { ticket: t.ticket, pair: t.pair || '' };
                });

            // Auto-close DB trades flagged close_requested but no longer on the broker —
            // the position is already gone, so the close command would fail with 4108.
            const staleCloseFlags = (closeReqTrades || []).filter(t => t.ticket && !eaOpenTickets.has(t.ticket));
            if (staleCloseFlags.length > 0) {
                console.log('[BRIDGE]', acctKey, '→ auto-closing', staleCloseFlags.length, 'stale close_requested trade(s) (ticket gone from broker)');
                await Promise.all(staleCloseFlags.map(t => {
                    delete sentCloseTickets[`${acctKey}:${t.ticket}`]; // clear cooldown tracker
                    return base44.asServiceRole.entities.Trade.update(t.id, {
                        status: 'CLOSED',
                        close_price: t.close_price || 0,
                        pnl: t.pnl || 0,
                    }).catch(e => console.warn('[BRIDGE] Stale close cleanup error:', e.message));
                }));
            }

            if (closeCommands.length > 0) {
                console.log('[BRIDGE]', acctKey, '→', closeCommands.length, 'close command(s)');
            }
        } catch (e) {
            console.warn('[BRIDGE] close_commands fetch error:', e.message);
        }

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
            close_commands: closeCommands,

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

        return Response.json({ error: error.message, bridge_version: 'v3' }, { status: 500, headers: corsHeaders() });
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

function isScheduleOff(riskSettings, now) {
    if (!riskSettings || !riskSettings.global_schedule_enabled) return false;
    const sched = riskSettings.weekly_schedule;
    if (!sched) return false;
    const d = new Date(now);
    const dayKeys = ['sun','mon','tue','wed','thu','fri','sat'];
    const dayKey = dayKeys[d.getUTCDay()];
    const day = sched[dayKey];
    if (!day || !day.on || !day.off) return false;
    const [onH, onM] = String(day.on).split(':').map(Number);
    const [offH, offM] = String(day.off).split(':').map(Number);
    if (isNaN(onH) || isNaN(onM) || isNaN(offH) || isNaN(offM)) return false;
    const curMins = d.getUTCHours() * 60 + d.getUTCMinutes();
    const onMins = onH * 60 + onM;
    // Treat 23:59 as end-of-day (24:00 = 1440 min) so the ON window extends to midnight
    // without a 1-minute OFF gap that would close trades at day boundaries.
    const offMins = (offH === 23 && offM === 59) ? 1440 : offH * 60 + offM;
    // Zero-length window (on == off) → off all day
    if (onMins === offMins) return true;
    if (onMins < offMins) {
        // Normal window: OFF when before ON or at/after OFF
        return curMins < onMins || curMins >= offMins;
    } else {
        // Window wraps midnight: OFF inside the gap between OFF and ON
        return curMins >= offMins && curMins < onMins;
    }
}

function sanitizeSignal(s, livePriceMap) {
    const originalPair = s.pair || ''; // preserve original pair name (e.g. AUS/200) for EA
    const pair = originalPair.replace('/', ''); // bare symbol for price lookups only
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
        const isSilver = pairUpper === 'XAGUSD' || pairUpper === 'SILVER' || pairUpper === 'XAG' || s.strategy === 'SILVER_XAGUSD';
        // Crypto: BTCUSD, ETHUSD, etc. — 24/7 market, percentage-based SL/TP
        const CRYPTO_SYMBOLS = ['BTCUSD', 'BITCOIN', 'BTC', 'ETHUSD', 'ETHEREUM', 'ETH', 'SOLUSD', 'SOL', 'XRPUSD', 'XRP', 'LTCUSD', 'LTC', 'ADAUSD', 'ADA', 'DOGEUSD', 'DOGE', 'AVAXUSD', 'AVAX', 'LINKUSD', 'LINK', 'MATICUSD', 'MATIC', 'DOTUSD', 'DOT'];
        const isCrypto = CRYPTO_SYMBOLS.includes(pairUpper);
        // Indices/CFDs: named instruments like UK100, US30, AUS200, GER40, NAS100, SPX500, etc.
        const INDEX_SYMBOLS = ['UK100', 'US30', 'NAS100', 'SPX500', 'SP500', 'GER40', 'DAX', 'AUS200', 'JPN225', 'NIKKEI', 'HK50', 'FRA40', 'ITA40', 'ESP35', 'STOXX50', 'FTSE', 'DOW', 'DJI', 'NASDAQ'];
        const isIndex = !isCrypto && (INDEX_SYMBOLS.some(idx => pairUpper.includes(idx)) || (!isGold && !isSilver && basePrice > 1000));

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
        } else if (isSilver) {
            // Silver: ATR-based dollar distances (~2% of price)
            const silverAtr = basePrice * 0.02; // ~$0.60-1.60 on Silver at $30-80
            const defaultSlDist = silverAtr * 1.5;  // ~$0.90-2.40
            const defaultTpDist = silverAtr * 3.0;  // ~$1.80-4.80

            if (safeSL === 0) {
                safeSL = type === 'BUY'
                    ? parseFloat((basePrice - defaultSlDist).toFixed(3))
                    : parseFloat((basePrice + defaultSlDist).toFixed(3));
            }
            if (safeTP === 0) {
                safeTP = type === 'BUY'
                    ? parseFloat((basePrice + defaultTpDist).toFixed(3))
                    : parseFloat((basePrice - defaultTpDist).toFixed(3));
            }
            safeSL = parseFloat(safeSL.toFixed(3));
            safeTP = parseFloat(safeTP.toFixed(3));
            console.log(`[BRIDGE] sanitizeSignal ${pair} detected as SILVER — using ATR distances | SL dist: ${defaultSlDist.toFixed(3)} TP dist: ${defaultTpDist.toFixed(3)}`);
        } else if (isCrypto) {
            // Crypto: percentage-based distances (1.5% SL, 3% TP) — crypto H1 ATR is 1.5-3%
            const defaultSlDist = basePrice * 0.015; // 1.5%
            const defaultTpDist = basePrice * 0.030; // 3.0%

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
            console.log(`[BRIDGE] sanitizeSignal ${pair} detected as CRYPTO — using % distances | SL dist: ${defaultSlDist.toFixed(2)} TP dist: ${defaultTpDist.toFixed(2)}`);
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

        const instrumentType = isGold ? '[GOLD]' : isSilver ? '[SILVER]' : isIndex ? '[INDEX]' : '[FOREX]';
        console.log(`[BRIDGE] sanitizeSignal ${pair} ${type} @ ${basePrice} | SL: ${safeSL} | TP: ${safeTP} ${instrumentType}`);
    } else {
        // No price available at all — log and send 0s (EA will reject the signal anyway)
        console.warn(`[BRIDGE] sanitizeSignal: no price for ${pair} — signal ${s.id} sent without SL/TP`);
        safeSL = 0; safeTP = 0;
    }

    // Determine order comment based on strategy/pair — ensures trades are tagged correctly in MT4/MT5
    const isGoldSignal = (pair === 'XAUUSD' || pair === 'GOLD' || pair === 'XAU' || s.strategy === 'GOLD_XAUUSD');
    const isSilverSignal = (pair === 'XAGUSD' || pair === 'SILVER' || pair === 'XAG' || s.strategy === 'SILVER_XAGUSD');
    const orderComment = isGoldSignal ? 'GoldForexTouchAI' : isSilverSignal ? 'SilverForexTouchAI' : 'ForexTouchAI';

    return { id: s.id, pair: originalPair, type, lot_size: s.lot_size || 0.1, stop_loss: safeSL, take_profit: safeTP, entry_price: basePrice || s.entry_price || 0, comment: orderComment };
}

// ─── Reconcile trades ────────────────────────────────────────────────────────
// Per-account last dedup timestamp — only run dedup every 5 minutes to avoid rate limits
const lastDedupTs = {};

async function reconcileTrades(base44, eaTrades, acctKey, livePriceMap = {}) {
    // ── Deduplication cleanup: throttled to once per 5 min per account ──
    const nowTs = Date.now();
    const shouldDedup = !lastDedupTs[acctKey] || (nowTs - lastDedupTs[acctKey]) > 600_000; // 10 min
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
                // Retry up to 3 times with backoff on rate limit
                for (let attempt = 0; attempt < 3; attempt++) {
                    try {
                        const allTrades = await base44.asServiceRole.entities.Trade.filter({ owner_email: acctKey }, '-created_date', 300);
                        allTrades.forEach(t => { if (t.ticket) knownTickets[acctKey].add(t.ticket); });
                        console.log('[BRIDGE] Cold-start init: loaded', knownTickets[acctKey].size, 'tickets for', acctKey);
                        break;
                    } catch (e) {
                        if (attempt < 2) {
                            await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
                        } else {
                            console.warn('[BRIDGE] Cold-start init failed after retries:', e.message);
                            knownTickets[acctKey] = new Set();
                        }
                    }
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
            { owner_email: acctKey, status: 'CLOSED' }, '-updated_date', 100
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

                // Find the matching ACTIVE signal for this account+pair BEFORE creating the trade,
                // so we can propagate the signal's bot_id onto the trade record for per-bot attribution.
                let matchedBotId = null;
                const pairNorm = sym.toUpperCase();
                try {
                    const matchingSignals = await base44.asServiceRole.entities.Signal.filter({
                        status: 'ACTIVE',
                        owner_email: acctKey,
                    }, '-created_date', 10);
                    const matchedSignal = matchingSignals.find(s =>
                        (s.pair || '').replace('/', '').toUpperCase() === pairNorm
                    );
                    if (matchedSignal) {
                        matchedBotId = matchedSignal.bot_id || null;
                        await base44.asServiceRole.entities.Signal.update(matchedSignal.id, { status: 'CLOSED' });
                        console.log('[BRIDGE] Auto-closed signal', matchedSignal.id, 'for', pairNorm, acctKey);
                    }
                } catch (sigErr) {
                    console.warn('[BRIDGE] Signal auto-close error:', sigErr.message);
                }

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
                    ...(matchedBotId ? { bot_id: matchedBotId } : {}),
                });
                createdTickets.push(t.ticket);
                console.log('[BRIDGE] Created ticket', t.ticket, 'for', acctKey, matchedBotId ? `(bot_id: ${matchedBotId})` : '');

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

    // ── Update PnL + patch open_price (only if changed to reduce DB writes) ───
    const toUpdatePnl = existingDbTrades.filter(t => {
        if (!t.ticket || !eaTicketSet.has(t.ticket)) return false;
        const ea = eaTrades.find(et => et.ticket === t.ticket);
        if (!ea) return false;
        const pnlChanged = Math.abs((t.pnl || 0) - (ea.pnl || ea.profit || 0)) > 1.0;
        const eaOpenPrice = ea.open_price || ea.price || 0;
        const needsOpenPrice = (!t.open_price || t.open_price === 0) && eaOpenPrice > 0;
        return pnlChanged || needsOpenPrice;
    });
    for (let i = 0; i < toUpdatePnl.length; i += 2) {
        await Promise.all(toUpdatePnl.slice(i, i + 2).map(t => {
            const ea = eaTrades.find(et => et.ticket === t.ticket);
            const eaOpenPrice = ea.open_price || ea.price || 0;
            const patch = { pnl: ea.pnl || ea.profit || 0 };
            if ((!t.open_price || t.open_price === 0) && eaOpenPrice > 0) {
                patch.open_price = eaOpenPrice;
            }
            return base44.asServiceRole.entities.Trade.update(t.id, patch);
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