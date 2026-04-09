import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

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

        // Build live price map from EA heartbeat FIRST — used for SL/TP validation
        const eaPrices = body.prices || accountData.prices;
        const livePriceMap = {};
        if (Array.isArray(eaPrices)) {
            for (const p of eaPrices) {
                if (p.symbol && p.bid > 0) {
                    livePriceMap[p.symbol] = p.bid;
                    livePriceMap[p.symbol.replace('/', '')] = p.bid;
                    // Also store ask for BUY trades
                    if (p.ask > 0) {
                        livePriceMap[p.symbol + '_ask'] = p.ask;
                        livePriceMap[p.symbol.replace('/', '') + '_ask'] = p.ask;
                    }
                }
            }
        }

        // --- 1. Update broker connection (fast, always needed) ---
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

        // --- 2. Fetch pending signals + open trades in parallel (critical path) ---
        const [allPendingSignals, dbOpenTrades, riskSettingsList] = await Promise.all([
            base44.asServiceRole.entities.Signal.filter({ status: 'PENDING' }, '-created_date', 20),
            base44.asServiceRole.entities.Trade.filter({ status: 'OPEN' }),
            base44.asServiceRole.entities.RiskManagementSettings.list('-created_date', 1),
        ]);

        // --- 3. Reconcile trades (throttled: every 30s) ---
        const eaTrades = body.trades || accountData.trades;
        const lastReconcile = body.last_reconcile || 0;
        const shouldReconcile = (now - lastReconcile) > 30000;
        if (shouldReconcile && Array.isArray(eaTrades)) {
            reconcileTrades(base44, eaTrades, dbOpenTrades, account_number, connections).catch(e =>
                console.error('[BRIDGE] Trade reconcile error:', e.message)
            );
        }

        // --- 4. Update currency pair prices (throttled: every 60s) ---
        const shouldUpdatePrices = !body.last_price_update || (now - body.last_price_update) > 60000;
        if (shouldUpdatePrices && Array.isArray(eaPrices) && eaPrices.length > 0) {
            updateCurrencyPrices(base44, eaPrices).catch(e =>
                console.error('[BRIDGE] Price update error:', e.message)
            );
        }

        // --- 5. Check risk/daily profit target (throttled: every 60s) ---
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
        const stalePending = allPendingSignals.filter(s => s.created_date < fiveMinutesAgo);
        if (stalePending.length > 0) {
            Promise.all(stalePending.map(s =>
                base44.asServiceRole.entities.Signal.update(s.id, { status: 'EXPIRED' })
            )).catch(e => console.error('[BRIDGE] Expire error:', e.message));
        }

        const freshSignals = allPendingSignals.filter(s => s.created_date >= fiveMinutesAgo).slice(0, 5);

        // Sanitize SL/TP using LIVE price from EA (not signal entry_price)
        const sanitizedSignals = freshSignals.map(s => {
            const pair = (s.pair || '').replace('/', '');
            const type = s.type;

            // Use live EA price as reference — most accurate for validation
            const liveAsk = livePriceMap[pair + '_ask'] || livePriceMap[pair] || 0;
            const liveBid = livePriceMap[pair] || 0;
            const refPrice = type === 'BUY' ? (liveAsk || liveBid) : liveBid;

            let safeSL = s.stop_loss || 0;
            let safeTP = s.take_profit || 0;

            if (refPrice > 0) {
                // Validate SL direction
                if (safeSL > 0) {
                    if (type === 'BUY' && safeSL >= refPrice) {
                        console.log(`[BRIDGE] Invalid BUY SL zeroed for ${pair}: SL=${safeSL} >= price=${refPrice}`);
                        safeSL = 0;
                    }
                    if (type === 'SELL' && safeSL <= refPrice) {
                        console.log(`[BRIDGE] Invalid SELL SL zeroed for ${pair}: SL=${safeSL} <= price=${refPrice}`);
                        safeSL = 0;
                    }
                }
                // Validate TP direction
                if (safeTP > 0) {
                    if (type === 'BUY' && safeTP <= refPrice) {
                        console.log(`[BRIDGE] Invalid BUY TP zeroed for ${pair}: TP=${safeTP} <= price=${refPrice}`);
                        safeTP = 0;
                    }
                    if (type === 'SELL' && safeTP >= refPrice) {
                        console.log(`[BRIDGE] Invalid SELL TP zeroed for ${pair}: TP=${safeTP} >= price=${refPrice}`);
                        safeTP = 0;
                    }
                }

                // If SL/TP still set, cross-check they don't conflict with each other
                if (safeSL > 0 && safeTP > 0) {
                    if (type === 'BUY' && safeSL >= safeTP) { safeSL = 0; safeTP = 0; }
                    if (type === 'SELL' && safeSL <= safeTP) { safeSL = 0; safeTP = 0; }
                }
            } else {
                // No live price available — zero out SL/TP to avoid Error 130
                console.log(`[BRIDGE] No live price for ${pair} — zeroing SL/TP to be safe`);
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

        // NOTE: Do NOT mark signals as ACTIVE here — only confirmExecution does that
        // This ensures ALL connected EAs (MT4 + MT5) can receive the same pending signals

        console.log('[BRIDGE] Returning', sanitizedSignals.length, 'signals to EA');

        return Response.json({
            success: true,
            message: 'Sync successful',
            account: account_number,
            timestamp: new Date().toISOString(),
            price_update_ts: shouldUpdatePrices ? now : (body.last_price_update || now),
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

// --- Helper: Reconcile trades (runs async, doesn't block response) ---
async function reconcileTrades(base44, eaTrades, dbOpenTrades, account_number, connections) {
    const dbTickets = new Set(dbOpenTrades.map(t => t.ticket).filter(Boolean));
    const eaTicketSet = new Set(eaTrades.map(t => t.ticket).filter(Boolean));

    // Create new trades from EA
    const newEaTrades = eaTrades.filter(t => t.ticket && !!(t.pair || t.symbol) && !dbTickets.has(t.ticket));
    if (newEaTrades.length > 0) {
        const ownerEmail = connections?.[0]?.created_by || null;
        await Promise.all(newEaTrades.map(t =>
            base44.asServiceRole.entities.Trade.create({
                pair: t.pair || t.symbol,
                type: t.type || 'BUY',
                lot_size: t.lot_size || t.lots || 0.1,
                open_price: t.open_price || t.price || 0,
                pnl: t.pnl || t.profit || 0,
                status: 'OPEN',
                ticket: t.ticket,
                is_auto: true,
                owner_email: ownerEmail,
            })
        ));
        console.log('[BRIDGE] Created', newEaTrades.length, 'new trades');
    }

    // Update PnL on existing open trades (only if changed > $0.10)
    const toUpdatePnl = dbOpenTrades.filter(t => {
        if (!t.ticket || !eaTicketSet.has(t.ticket)) return false;
        const eaTrade = eaTrades.find(et => et.ticket === t.ticket);
        if (!eaTrade) return false;
        return Math.abs((t.pnl || 0) - (eaTrade.pnl || 0)) > 0.10;
    });
    for (let i = 0; i < toUpdatePnl.length; i += 2) {
        await Promise.all(toUpdatePnl.slice(i, i + 2).map(t => {
            const eaTrade = eaTrades.find(et => et.ticket === t.ticket);
            return base44.asServiceRole.entities.Trade.update(t.id, { pnl: eaTrade.pnl || 0 });
        }));
    }

    // Close DB trades no longer in EA
    const closedTrades = dbOpenTrades.filter(t => t.ticket && !eaTicketSet.has(t.ticket));
    if (closedTrades.length > 0) {
        await Promise.all(closedTrades.map(t => {
            const finalPnl = t.pnl || 0;
            const pipValue = (t.open_price > 10) ? 0.001 : 0.0001;
            const lotMultiplier = (t.lot_size || 0.1) * 100000;
            const priceMove = lotMultiplier > 0 ? finalPnl / lotMultiplier : 0;
            const closePrice = t.type === 'BUY' ? t.open_price + priceMove : t.open_price - priceMove;
            return base44.asServiceRole.entities.Trade.update(t.id, {
                status: 'CLOSED',
                close_price: parseFloat(closePrice.toFixed(5)),
                pnl: finalPnl
            });
        }));
        console.log('[BRIDGE] Closed', closedTrades.length, 'trades');
    }
}

// --- Helper: Update currency pair prices (runs async, doesn't block response) ---
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

    for (let i = 0; i < ops.length; i += 10) {
        await Promise.all(ops.slice(i, i + 10));
    }
    console.log('[BRIDGE] Updated', ops.length, 'currency pair prices');
}

// --- Helper: Check daily profit target ---
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
        await Promise.all([
            ...openTrades.map(t => base44.asServiceRole.entities.Trade.update(t.id, { status: 'CLOSED', close_price: t.open_price, pnl: t.pnl || 0 })),
            base44.asServiceRole.entities.RiskManagementSettings.update(riskSettings.id, { is_trading_paused: true }),
            base44.asServiceRole.entities.Alert.create({
                title: '🎯 Daily Profit Target Reached!',
                message: `Daily profit of ${dailyProfitPercent.toFixed(2)}% reached your ${riskSettings.daily_profit_target_percent}% target. Trading paused.`,
                type: 'SUCCESS',
            }),
        ]);
    }
}