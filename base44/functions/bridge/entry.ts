import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// In-memory cache to reduce DB calls and avoid rate limits
const cache = {
    signals: { data: null, ts: 0 },
    trades: {},       // keyed by account_number, { data, ts }
    risk: { data: null, ts: 0 },
    connections: {},  // keyed by account_number, { data, ts }
};

const CACHE_TTL = {
    signals: 15000,   // 15s — signals change infrequently
    trades: 30000,    // 30s — trades change infrequently
    risk: 60000,      // 60s — risk settings rarely change
    connection: 8000, // 8s — always update connection heartbeat
};

function isFresh(entry, ttl) {
    return entry.data !== null && (Date.now() - entry.ts) < ttl;
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            }
        });
    }

    try {
        const base44 = createClientFromRequest(req);

        const rawText = await req.text();
        const cleanText = rawText.replace(/\0/g, '').trim();
        if (!cleanText) {
            return Response.json({ success: true, message: 'Bridge online' }, {
                headers: { 'Access-Control-Allow-Origin': '*' }
            });
        }

        const body = JSON.parse(cleanText);
        const now = Date.now();
        const accountData = body.account || body;
        const { account_number, server_name, balance, equity, margin, free_margin, margin_level, leverage, currency, platform } = accountData;

        if (!account_number) {
            return Response.json({ error: 'account_number is required' }, {
                status: 400,
                headers: { 'Access-Control-Allow-Origin': '*' }
            });
        }

        // Build live price map from EA heartbeat
        const eaPrices = body.prices || accountData.prices;
        const livePriceMap = {};
        if (Array.isArray(eaPrices)) {
            for (const p of eaPrices) {
                if (p.symbol && p.bid > 0) {
                    livePriceMap[p.symbol] = p.bid;
                    livePriceMap[p.symbol.replace('/', '')] = p.bid;
                    if (p.ask > 0) {
                        livePriceMap[p.symbol + '_ask'] = p.ask;
                        livePriceMap[p.symbol.replace('/', '') + '_ask'] = p.ask;
                    }
                }
            }
        }

        // --- 1. Update broker connection (throttled per account) ---
        const connCache = cache.connections[account_number] || { data: null, ts: 0 };
        const updateData = {
            connection_status: 'CONNECTED',
            last_sync: new Date().toISOString(),
            balance: balance ?? 0,
            equity: equity ?? 0,
            margin: margin ?? 0,
            free_margin: free_margin ?? 0,
            margin_level: margin_level ?? 0,
        };
        if (leverage) updateData.leverage = String(leverage);
        if (currency) updateData.currency = currency;
        if (platform) updateData.platform = platform;
        if (server_name) updateData.server_name = server_name;

        // Always update connection (fire-and-forget to avoid blocking)
        if (!isFresh(connCache, CACHE_TTL.connection)) {
            cache.connections[account_number] = { data: true, ts: now };
            (async () => {
                const connections = await base44.asServiceRole.entities.BrokerConnection.filter({ account_number: String(account_number) });
                if (connections && connections.length > 0) {
                    await base44.asServiceRole.entities.BrokerConnection.update(connections[0].id, updateData);
                } else {
                    await base44.asServiceRole.entities.BrokerConnection.create({
                        ...updateData,
                        account_number: String(account_number),
                        server_name: server_name || 'Unknown',
                        platform: platform || 'MT4',
                    });
                }
            })().catch(e => console.error('[BRIDGE] Connection update error:', e.message));
        }

        // --- 2. Fetch signals, trades, risk from cache ---
        const fetchPromises = [];
        let signalsPromise, tradesPromise, riskPromise;

        if (!isFresh(cache.signals, CACHE_TTL.signals)) {
            signalsPromise = base44.asServiceRole.entities.Signal.filter({ status: 'PENDING' }, '-created_date', 20)
                .then(data => { cache.signals = { data, ts: now }; return data; });
            fetchPromises.push(signalsPromise);
        } else {
            signalsPromise = Promise.resolve(cache.signals.data);
        }

        const tradeCache = cache.trades[account_number] || { data: null, ts: 0 };
        if (!isFresh(tradeCache, CACHE_TTL.trades)) {
            // Fetch all OPEN trades and filter by account_number OR any ownership (catches legacy trades)
            tradesPromise = base44.asServiceRole.entities.Trade.filter({ status: 'OPEN', owner_email: String(account_number) }, '-created_date', 200)
                .then(data => {
                    cache.trades[account_number] = { data, ts: now };
                    return data;
                });
            fetchPromises.push(tradesPromise);
        } else {
            tradesPromise = Promise.resolve(tradeCache.data);
        }

        if (!isFresh(cache.risk, CACHE_TTL.risk)) {
            riskPromise = base44.asServiceRole.entities.RiskManagementSettings.list('-created_date', 1)
                .then(data => { cache.risk = { data, ts: now }; return data; });
            fetchPromises.push(riskPromise);
        } else {
            riskPromise = Promise.resolve(cache.risk.data);
        }

        const [allPendingSignals, dbOpenTrades, riskSettingsList] = await Promise.all([
            signalsPromise, tradesPromise, riskPromise
        ]);

        // --- 3. Reconcile trades (throttled: every 30s, fire-and-forget) ---
        const eaTrades = body.trades || accountData.trades;
        const lastReconcile = body.last_reconcile || 0;
        const shouldReconcile = (now - lastReconcile) > 30000;
        if (shouldReconcile && Array.isArray(eaTrades)) {
            // Invalidate per-account cache after reconcile
            reconcileTrades(base44, eaTrades, dbOpenTrades, account_number).then(() => {
                cache.trades[account_number] = { data: null, ts: 0 };
            }).catch(e => console.error('[BRIDGE] Trade reconcile error:', e.message));
        }

        // --- 4. Update currency pair prices (throttled: every 60s, fire-and-forget) ---
        const lastPriceUpdate = body.last_price_update || 0;
        const shouldUpdatePrices = (now - lastPriceUpdate) > 60000;
        if (shouldUpdatePrices && Array.isArray(eaPrices) && eaPrices.length > 0) {
            updateCurrencyPrices(base44, eaPrices).catch(e =>
                console.error('[BRIDGE] Price update error:', e.message)
            );
        }

        // --- 5. Check risk/daily profit target (throttled: every 60s, fire-and-forget) ---
        const riskSettings = riskSettingsList?.[0];
        const lastRiskCheck = body.last_risk_check || 0;
        const shouldCheckRisk = (now - lastRiskCheck) > 60000;
        if (shouldCheckRisk && riskSettings?.daily_profit_target_percent > 0 && !riskSettings?.is_trading_paused && balance > 0) {
            checkDailyProfitTarget(base44, riskSettings, balance, dbOpenTrades).catch(e =>
                console.error('[BRIDGE] Risk check error:', e.message)
            );
        }

        // --- 6. Process signals for EA ---
        const fiveMinutesAgo = new Date(now - 5 * 60 * 1000).toISOString();

        // Expire stale pending signals (fire-and-forget)
        const stalePending = (allPendingSignals || []).filter(s => s.created_date < fiveMinutesAgo);
        if (stalePending.length > 0) {
            Promise.all(stalePending.map(s =>
                base44.asServiceRole.entities.Signal.update(s.id, { status: 'EXPIRED' })
            )).then(() => {
                cache.signals = { data: null, ts: 0 }; // invalidate
            }).catch(e => console.error('[BRIDGE] Expire error:', e.message));
        }

        const freshSignals = (allPendingSignals || []).filter(s => s.created_date >= fiveMinutesAgo).slice(0, 5);

        // Immediately mark dispatched signals as SKIPPED to prevent duplicate execution on other EAs
        // This is fire-and-forget but happens before returning so the next EA won't get them
        if (freshSignals.length > 0) {
            freshSignals.forEach(s => {
                base44.asServiceRole.entities.Signal.update(s.id, { status: 'ACTIVE' })
                    .catch(e => console.error('[BRIDGE] Signal lock error:', e.message));
            });
            // Invalidate signals cache so next EA gets fresh state
            cache.signals = { data: null, ts: 0 };
        }

        // Sanitize SL/TP using live price from EA
        const sanitizedSignals = freshSignals.map(s => {
            const pair = (s.pair || '').replace('/', '');
            const type = s.type;
            const liveAsk = livePriceMap[pair + '_ask'] || livePriceMap[pair] || 0;
            const liveBid = livePriceMap[pair] || 0;
            const refPrice = type === 'BUY' ? (liveAsk || liveBid) : liveBid;

            let safeSL = s.stop_loss || 0;
            let safeTP = s.take_profit || 0;

            if (refPrice > 0) {
                if (safeSL > 0) {
                    if (type === 'BUY' && safeSL >= refPrice) safeSL = 0;
                    if (type === 'SELL' && safeSL <= refPrice) safeSL = 0;
                }
                if (safeTP > 0) {
                    if (type === 'BUY' && safeTP <= refPrice) safeTP = 0;
                    if (type === 'SELL' && safeTP >= refPrice) safeTP = 0;
                }
                if (safeSL > 0 && safeTP > 0) {
                    if (type === 'BUY' && safeSL >= safeTP) { safeSL = 0; safeTP = 0; }
                    if (type === 'SELL' && safeSL <= safeTP) { safeSL = 0; safeTP = 0; }
                }
            } else {
                safeSL = 0;
                safeTP = 0;
            }

            return {
                id: s.id,
                pair,
                type,
                lot_size: s.lot_size || 0.1,
                stop_loss: safeSL,
                take_profit: safeTP,
                entry_price: refPrice || s.entry_price || 0,
            };
        });

        console.log('[BRIDGE] Returning', sanitizedSignals.length, 'signals to EA');

        return Response.json({
            success: true,
            message: 'Sync successful',
            account: account_number,
            timestamp: new Date().toISOString(),
            price_update_ts: shouldUpdatePrices ? now : lastPriceUpdate,
            last_reconcile: shouldReconcile ? now : lastReconcile,
            last_risk_check: shouldCheckRisk ? now : lastRiskCheck,
            pending_signals: sanitizedSignals,
        }, {
            headers: { 'Access-Control-Allow-Origin': '*' }
        });

    } catch (error) {
        console.error('[BRIDGE ERROR]', error.message);
        return Response.json({ error: error.message }, {
            status: 500,
            headers: { 'Access-Control-Allow-Origin': '*' }
        });
    }
});

async function reconcileTrades(base44, eaTrades, dbOpenTrades, account_number) {
    const eaTicketSet = new Set(eaTrades.map(t => t.ticket).filter(Boolean));

    // Always do a fresh DB query for existing tickets to prevent duplicates across cache misses
    const existingOpenTrades = await base44.asServiceRole.entities.Trade.filter({ status: 'OPEN', owner_email: String(account_number) }, '-created_date', 500);
    const dbTickets = new Set(existingOpenTrades.map(t => t.ticket).filter(Boolean));

    const newEaTrades = eaTrades.filter(t => t.ticket && !!(t.pair || t.symbol) && !dbTickets.has(t.ticket));
    if (newEaTrades.length > 0) {
        console.log('[BRIDGE] Creating', newEaTrades.length, 'new trades for account', account_number);
        for (let i = 0; i < newEaTrades.length; i += 3) {
            await Promise.all(newEaTrades.slice(i, i + 3).map(t =>
                base44.asServiceRole.entities.Trade.create({
                    pair: t.pair || t.symbol,
                    type: t.type || 'BUY',
                    lot_size: t.lot_size || t.lots || 0.1,
                    open_price: t.open_price || t.price || 0,
                    pnl: t.pnl || t.profit || 0,
                    status: 'OPEN',
                    ticket: t.ticket,
                    is_auto: true,
                    owner_email: String(account_number),
                })
            ));
        }
        console.log('[BRIDGE] Created', newEaTrades.length, 'new trades');
    }

    // Use fresh DB data for the rest of reconciliation
    const allDbTrades = existingOpenTrades;

    const toUpdatePnl = allDbTrades.filter(t => {
        if (!t.ticket || !eaTicketSet.has(t.ticket)) return false;
        const eaTrade = eaTrades.find(et => et.ticket === t.ticket);
        if (!eaTrade) return false;
        return Math.abs((t.pnl || 0) - (eaTrade.pnl || 0)) > 0.10;
    });
    for (let i = 0; i < toUpdatePnl.length; i += 3) {
        await Promise.all(toUpdatePnl.slice(i, i + 3).map(t => {
            const eaTrade = eaTrades.find(et => et.ticket === t.ticket);
            return base44.asServiceRole.entities.Trade.update(t.id, { pnl: eaTrade.pnl || 0 });
        }));
    }

    const closedTrades = allDbTrades.filter(t => t.ticket && !eaTicketSet.has(t.ticket));
    if (closedTrades.length > 0) {
        for (let i = 0; i < closedTrades.length; i += 3) {
            await Promise.all(closedTrades.slice(i, i + 3).map(t => {
                const finalPnl = t.pnl || 0;
                const lotMultiplier = (t.lot_size || 0.1) * 100000;
                const priceMove = lotMultiplier > 0 ? finalPnl / lotMultiplier : 0;
                const closePrice = t.type === 'BUY' ? t.open_price + priceMove : t.open_price - priceMove;
                return base44.asServiceRole.entities.Trade.update(t.id, {
                    status: 'CLOSED',
                    close_price: parseFloat(closePrice.toFixed(5)),
                    pnl: finalPnl
                });
            }));
        }
        console.log('[BRIDGE] Closed', closedTrades.length, 'trades');
    }
}

async function updateCurrencyPrices(base44, eaPrices) {
    const existingPairs = await base44.asServiceRole.entities.CurrencyPair.list('-created_date', 100);
    const pairMap = {};
    for (const p of existingPairs) {
        if (p.symbol) pairMap[p.symbol] = p;
    }

    const ops = [];
    for (const price of eaPrices) {
        const sym = price.symbol;
        const bid = price.bid;
        if (!sym || !bid || bid <= 0) continue;
        const displaySymbol = sym.length === 6 ? sym.slice(0, 3) + '/' + sym.slice(3) : sym;
        const priceData = { symbol: displaySymbol, current_price: bid };
        const existing = pairMap[displaySymbol] || pairMap[sym];
        if (existing) {
            ops.push(base44.asServiceRole.entities.CurrencyPair.update(existing.id, priceData));
        } else {
            ops.push(base44.asServiceRole.entities.CurrencyPair.create({ ...priceData, category: 'MAJOR', ai_signal: 'NEUTRAL', ai_confidence: 0 }));
        }
    }

    for (let i = 0; i < ops.length; i += 5) {
        await Promise.all(ops.slice(i, i + 5));
    }
    console.log('[BRIDGE] Updated', ops.length, 'currency pair prices');
}

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