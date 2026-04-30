import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ─── In-memory state (survives across requests within same isolate) ───────────
const cache = {
    signals: { data: null, ts: 0 },
    trades: {},       // keyed by account_number → { data, ts }
    risk: { data: null, ts: 0 },
    connections: {},  // keyed by account_number → { data: true, ts }
    pairMap: { data: null, ts: 0 }, // CurrencyPair symbol → record
};

// Primary duplicate-trade guard: ticket sets persist even when DB calls fail
const knownTickets = {}; // keyed by account_number → Set<ticket>

// Per-account reconcile lock: prevents concurrent reconcile runs
const reconcileLock = {}; // keyed by account_number → boolean

// ─── Throttle config ─────────────────────────────────────────────────────────
const TTL = {
    signals:    20_000,  // 20s  — signals rarely change
    trades:     60_000,  // 60s  — trade list cache
    risk:      120_000,  // 2min — risk settings
    connection: 20_000,  // 20s  — heartbeat throttle
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

    try {
        const base44 = createClientFromRequest(req);

        const rawText = await req.text();
        const cleanText = rawText.replace(/\0/g, '').trim();
        if (!cleanText) {
            return Response.json({ success: true, message: 'Bridge online', heartbeat_interval_ms: HEARTBEAT_INTERVAL_MS }, { headers: corsHeaders() });
        }

        const body = JSON.parse(cleanText);
        const now = Date.now();
        const acct = body.account || body;
        const { account_number, server_name, balance, equity, margin, free_margin, margin_level, leverage, currency, platform } = acct;

        if (!account_number) {
            return Response.json({ error: 'account_number is required' }, { status: 400, headers: corsHeaders() });
        }

        const acctKey = String(account_number);

        // Build live price map from EA heartbeat
        const eaPrices = body.prices || acct.prices;
        const livePriceMap = buildPriceMap(eaPrices);

        // ── 1. Update broker connection (throttled) ──────────────────────────
        const connCache = cache.connections[acctKey] || { data: null, ts: 0 };
        if (!isFresh(connCache, TTL.connection)) {
            cache.connections[acctKey] = { data: true, ts: now };
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
            };
            (async () => {
                const conns = await base44.asServiceRole.entities.BrokerConnection.filter({ account_number: acctKey });
                if (conns?.length > 0) {
                    await base44.asServiceRole.entities.BrokerConnection.update(conns[0].id, updateData);
                } else {
                    await base44.asServiceRole.entities.BrokerConnection.create({
                        ...updateData, account_number: acctKey,
                        server_name: server_name || 'Unknown', platform: platform || 'MT4',
                    });
                }
            })().catch(e => console.error('[BRIDGE] Connection update error:', e.message));
        }

        // ── 2. Fetch signals + risk (cached) ─────────────────────────────────
        const signalsPromise = isFresh(cache.signals, TTL.signals)
            ? Promise.resolve(cache.signals.data)
            : base44.asServiceRole.entities.Signal.filter({ status: 'PENDING' }, '-created_date', 50)
                .then(data => { cache.signals = { data, ts: now }; return data; })
                .catch(() => cache.signals.data || []);

        const riskPromise = isFresh(cache.risk, TTL.risk)
            ? Promise.resolve(cache.risk.data)
            : base44.asServiceRole.entities.RiskManagementSettings.list('-created_date', 1)
                .then(data => { cache.risk = { data, ts: now }; return data; })
                .catch(() => cache.risk.data || []);

        const [allPendingSignals, riskSettingsList] = await Promise.all([signalsPromise, riskPromise]);

        // ── 3. Reconcile trades (server-driven throttle, locked per account) ─
        const eaTrades = body.trades || acct.trades;
        const lastReconcile = body.last_reconcile || 0;
        const shouldReconcile = (now - lastReconcile) > 30_000 && Array.isArray(eaTrades) && !reconcileLock[acctKey];
        if (shouldReconcile) {
            reconcileLock[acctKey] = true;
            reconcileTrades(base44, eaTrades, acctKey, livePriceMap)
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
        const riskSettings = riskSettingsList?.[0];
        const lastRiskCheck = body.last_risk_check || 0;
        if ((now - lastRiskCheck) > 60_000 && riskSettings?.daily_profit_target_percent > 0 && !riskSettings?.is_trading_paused && balance > 0) {
            const dbTrades = cache.trades[acctKey]?.data || [];
            checkDailyProfitTarget(base44, riskSettings, balance, dbTrades)
                .catch(e => console.error('[BRIDGE] Risk check error:', e.message));
        }

        // ── 6. Dispatch pending signals to EA ────────────────────────────────
        const fiveMinutesAgo = new Date(now - 5 * 60 * 1000).toISOString();
        const stale = (allPendingSignals || []).filter(s => s.created_date < fiveMinutesAgo);
        if (stale.length > 0) {
            Promise.all(stale.map(s =>
                base44.asServiceRole.entities.Signal.update(s.id, { status: 'EXPIRED' })
            )).then(() => { cache.signals = { data: null, ts: 0 }; })
              .catch(e => console.error('[BRIDGE] Expire error:', e.message));
        }

        // Fetch this account's current open trades for cross-pair dedup check
        let acctOpenTrades = [];
        let ownerEmail = null;
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
        const openPairs = new Set(acctOpenTrades.map(t => (t.pair || '').replace('/', '')));

        const freshSignals = (allPendingSignals || [])
            .filter(s => {
                if (s.created_date < fiveMinutesAgo) return false;
                // If we know the owner, only dispatch signals for that owner
                if (ownerEmail && s.owner_email && s.owner_email !== ownerEmail) return false;
                // Skip if a trade on this pair is already open on this account
                const pairRaw = (s.pair || '').replace('/', '');
                if (openPairs.has(pairRaw)) return false;
                return true;
            })
            .slice(0, 5);

        // SYNCHRONOUSLY lock signals before returning — prevents duplicate execution
        if (freshSignals.length > 0) {
            try {
                await Promise.all(freshSignals.map(s =>
                    base44.asServiceRole.entities.Signal.update(s.id, { status: 'ACTIVE' })
                ));
            } catch (e) {
                console.error('[BRIDGE] Signal lock error:', e.message);
            }
            cache.signals = { data: null, ts: 0 };
        }

        const sanitizedSignals = freshSignals.map(s => sanitizeSignal(s, livePriceMap));
        console.log('[BRIDGE]', acctKey, '→', sanitizedSignals.length, 'signals');

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
        console.error('[BRIDGE ERROR]', error.message);
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

    let safeSL = s.stop_loss || 0;
    let safeTP = s.take_profit || 0;

    if (refPrice > 0) {
        if (type === 'BUY' && safeSL >= refPrice) safeSL = 0;
        if (type === 'SELL' && safeSL <= refPrice) safeSL = 0;
        if (type === 'BUY' && safeTP <= refPrice) safeTP = 0;
        if (type === 'SELL' && safeTP >= refPrice) safeTP = 0;
        if (safeSL > 0 && safeTP > 0) {
            if (type === 'BUY' && safeSL >= safeTP) { safeSL = 0; safeTP = 0; }
            if (type === 'SELL' && safeSL <= safeTP) { safeSL = 0; safeTP = 0; }
        }
    } else {
        safeSL = 0; safeTP = 0;
    }

    return { id: s.id, pair, type, lot_size: s.lot_size || 0.1, stop_loss: safeSL, take_profit: safeTP, entry_price: refPrice || s.entry_price || 0 };
}

// ─── Reconcile trades ────────────────────────────────────────────────────────
async function reconcileTrades(base44, eaTrades, acctKey, livePriceMap = {}) {
    const eaTicketSet = new Set(eaTrades.map(t => t.ticket).filter(Boolean));

    // Ensure memory ticket set exists
    if (!knownTickets[acctKey]) knownTickets[acctKey] = new Set();
    const memTickets = knownTickets[acctKey];

    // Fetch fresh DB state — fall back to memory-only if rate limited
    let existingDbTrades = [];
    try {
        existingDbTrades = await base44.asServiceRole.entities.Trade.filter(
            { status: 'OPEN', owner_email: acctKey }, '-created_date', 500
        );
        // Sync DB tickets into memory set
        existingDbTrades.forEach(t => { if (t.ticket) memTickets.add(t.ticket); });
    } catch (e) {
        console.warn('[BRIDGE] DB fetch rate-limited, using memory tickets only');
    }

    // ── Create new trades (guarded by memory set) ────────────────────────────
    // For MT5: open_price may be 0 — fall back to live bid price, or store 0 and let PnL updates fill it in
    const toCreate = eaTrades.filter(t => {
        if (!t.ticket || !(t.pair || t.symbol)) return false;
        if (memTickets.has(t.ticket)) return false;
        return true; // Always create — never block on open_price
    });
    if (toCreate.length > 0) {
        console.log('[BRIDGE] Creating', toCreate.length, 'new trades for', acctKey);
        for (let i = 0; i < toCreate.length; i += 3) {
            await Promise.all(toCreate.slice(i, i + 3).map(t => {
                const sym = (t.pair || t.symbol || '').replace('/', '');
                const resolvedPrice = t.open_price || t.price || livePriceMap[sym] || livePriceMap[(t.pair || t.symbol)] || 0;
                return base44.asServiceRole.entities.Trade.create({
                    pair: t.pair || t.symbol,
                    type: t.type || 'BUY',
                    lot_size: t.lot_size || t.lots || 0.1,
                    open_price: resolvedPrice,
                    pnl: t.pnl || t.profit || 0,
                    status: 'OPEN',
                    ticket: t.ticket,
                    is_auto: true,
                    owner_email: acctKey,
                }).then(() => memTickets.add(t.ticket)); // lock immediately
            }));
        }
    }

    // Add all EA tickets to memory (even already-existing ones)
    eaTicketSet.forEach(t => memTickets.add(t));

    if (existingDbTrades.length === 0) return; // rate limited — skip updates/closes

    // ── Update PnL (only if changed by >$1 to reduce DB writes) ─────────────
    const toUpdatePnl = existingDbTrades.filter(t => {
        if (!t.ticket || !eaTicketSet.has(t.ticket)) return false;
        const ea = eaTrades.find(et => et.ticket === t.ticket);
        return ea && Math.abs((t.pnl || 0) - (ea.pnl || ea.profit || 0)) > 1.0;
    });
    for (let i = 0; i < toUpdatePnl.length; i += 3) {
        await Promise.all(toUpdatePnl.slice(i, i + 3).map(t => {
            const ea = eaTrades.find(et => et.ticket === t.ticket);
            return base44.asServiceRole.entities.Trade.update(t.id, { pnl: ea.pnl || ea.profit || 0 });
        })).catch(e => console.warn('[BRIDGE] PnL update error:', e.message));
    }

    // ── Close trades no longer in EA ─────────────────────────────────────────
    const toClose = existingDbTrades.filter(t => t.ticket && !eaTicketSet.has(t.ticket));
    if (toClose.length > 0) {
        console.log('[BRIDGE] Closing', toClose.length, 'trades for', acctKey);
        for (let i = 0; i < toClose.length; i += 3) {
            await Promise.all(toClose.slice(i, i + 3).map(t => {
                const finalPnl = t.pnl || 0;
                const lotMultiplier = (t.lot_size || 0.1) * 100000;
                const priceMove = lotMultiplier > 0 ? finalPnl / lotMultiplier : 0;
                const closePrice = t.type === 'BUY' ? t.open_price + priceMove : t.open_price - priceMove;
                // Remove from memory set so it doesn't block future re-opens of same ticket
                memTickets.delete(t.ticket);
                return base44.asServiceRole.entities.Trade.update(t.id, {
                    status: 'CLOSED',
                    close_price: parseFloat(closePrice.toFixed(5)),
                    pnl: finalPnl,
                });
            })).catch(e => console.warn('[BRIDGE] Close error:', e.message));
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

// ─── Daily profit target check ────────────────────────────────────────────────
async function checkDailyProfitTarget(base44, riskSettings, balance, openTrades) {
    const today = new Date().toISOString().split('T')[0];
    const closedToday = await base44.asServiceRole.entities.Trade.filter({ status: 'CLOSED' });
    const todayProfit = closedToday
        .filter(t => t.created_date?.startsWith(today))
        .reduce((sum, t) => sum + (t.pnl || 0), 0);
    const floatingPnl = openTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const dailyProfitPercent = ((todayProfit + floatingPnl) / balance) * 100;

    if (dailyProfitPercent >= riskSettings.daily_profit_target_percent) {
        console.log(`[BRIDGE] Daily profit target reached: ${dailyProfitPercent.toFixed(2)}%`);
        for (let i = 0; i < openTrades.length; i += 3) {
            await Promise.all(openTrades.slice(i, i + 3).map(t =>
                base44.asServiceRole.entities.Trade.update(t.id, { status: 'CLOSED', close_price: t.open_price, pnl: t.pnl || 0 })
            ));
        }
        await Promise.all([
            base44.asServiceRole.entities.RiskManagementSettings.update(riskSettings.id, { is_trading_paused: true }),
            base44.asServiceRole.entities.Alert.create({
                title: '🎯 Daily Profit Target Reached!',
                message: `Daily profit of ${dailyProfitPercent.toFixed(2)}% reached your ${riskSettings.daily_profit_target_percent}% target. Trading paused.`,
                type: 'SUCCESS',
            }),
        ]);
    }
}