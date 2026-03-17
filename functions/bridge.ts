import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
    // Handle CORS preflight
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

        // Handle empty body (connection test ping from EA)
        const rawText = await req.text();
        // Strip null bytes and whitespace that MT4 StringToCharArray sometimes pads
        const cleanText = rawText.replace(/\0/g, '').trim();
        if (!cleanText) {
            console.log('[BRIDGE] Connection test ping received');
            return Response.json({ success: true, message: 'Bridge online' }, {
                headers: { 'Access-Control-Allow-Origin': '*' }
            });
        }

        const body = JSON.parse(cleanText);
        const now = Date.now();
        // Only update prices every 30 seconds to avoid rate limits
        const updatePrices = !body.last_price_update || (now - body.last_price_update) > 30000;

        // Support both flat and nested {account:{...}, trades:[...]} format
        const accountData = body.account || body;
        const {
            account_number,
            server_name,
            balance,
            equity,
            margin,
            free_margin,
            margin_level,
            leverage,
            currency,
            platform,
        } = accountData;

        if (!account_number) {
            return Response.json({ error: 'account_number is required' }, {
                status: 400,
                headers: { 'Access-Control-Allow-Origin': '*' }
            });
        }

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

        // Single DB call: find existing connection
        const connections = await base44.asServiceRole.entities.BrokerConnection.filter({ account_number: String(account_number) });

        if (connections && connections.length > 0) {
            await base44.asServiceRole.entities.BrokerConnection.update(connections[0].id, updateData);
            console.log('[BRIDGE] Updated connection for account:', account_number);
        } else {
            await base44.asServiceRole.entities.BrokerConnection.create({
                ...updateData,
                account_number: String(account_number),
                server_name: server_name || 'Unknown',
                platform: platform || 'MT4',
            });
            console.log('[BRIDGE] Created new connection for account:', account_number);
        }

        // Update live prices from EA Market Watch data (throttled to every 30s)
        const eaPrices = body.prices || accountData.prices;
        if (updatePrices && Array.isArray(eaPrices) && eaPrices.length > 0) {
            const existingPairs = await base44.asServiceRole.entities.CurrencyPair.list('-created_date', 100);
            const pairMap = {};
            for (const p of existingPairs) {
                if (p.symbol) pairMap[p.symbol] = p;
            }

            const upsertOps = [];
            for (const price of eaPrices) {
                const sym = price.symbol;
                const bid = price.bid;
                if (!sym || !bid || bid <= 0) continue;

                // Format symbol with slash for display (e.g. EURUSD -> EUR/USD)
                const displaySymbol = sym.length === 6
                    ? sym.slice(0, 3) + '/' + sym.slice(3)
                    : sym;

                const priceData = {
                    symbol: displaySymbol,
                    current_price: bid,
                };

                // Check both raw and display symbol
                const existing = pairMap[displaySymbol] || pairMap[sym];
                if (existing) {
                    upsertOps.push(base44.asServiceRole.entities.CurrencyPair.update(existing.id, priceData));
                } else {
                    upsertOps.push(base44.asServiceRole.entities.CurrencyPair.create({
                        ...priceData,
                        category: 'MAJOR',
                        ai_signal: 'NEUTRAL',
                        ai_confidence: 0,
                    }));
                }
            }

            if (upsertOps.length > 0) {
                // Process in batches of 5 to avoid rate limits
                for (let i = 0; i < upsertOps.length; i += 5) {
                    await Promise.all(upsertOps.slice(i, i + 5));
                }
                console.log('[BRIDGE] Updated', upsertOps.length, 'currency pair prices');
            }
        }

        // Reconcile open trades from EA heartbeat
        const eaTrades = body.trades || accountData.trades;
        if (Array.isArray(eaTrades)) {
            const dbOpenTrades = await base44.asServiceRole.entities.Trade.filter({ status: 'OPEN' });
            const dbTickets = new Set(dbOpenTrades.map(t => t.ticket).filter(Boolean));
            const eaTicketSet = new Set(eaTrades.map(t => t.ticket).filter(Boolean));

            // 1. Create Trade records for tickets from EA not yet in DB
            const newEaTrades = eaTrades.filter(t => t.ticket && !!(t.pair || t.symbol) && !dbTickets.has(t.ticket));
            if (newEaTrades.length > 0) {
                console.log('[BRIDGE] Creating', newEaTrades.length, 'new trades from EA heartbeat');
                const connList = await base44.asServiceRole.entities.BrokerConnection.filter({ account_number: String(account_number) });
                const ownerEmail = connList?.[0]?.created_by || null;
                await Promise.all(newEaTrades.map(t =>
                    base44.asServiceRole.entities.Trade.create({
                        pair: t.pair || t.symbol,
                        type: t.type || 'BUY',
                        lot_size: t.lot_size || t.lots || 0.1,
                        open_price: t.open_price || t.price || 0,
                        pnl: t.pnl || t.profit || 0,
                        status: 'OPEN',
                        ticket: t.ticket,
                        is_auto: false,
                        owner_email: ownerEmail,
                    })
                ));
            }

            // 2. Update PnL on existing open trades (only if changed by > $0.10 to avoid rate limits)
            const existingTrades = dbOpenTrades.filter(t => t.ticket && eaTicketSet.has(t.ticket));
            if (existingTrades.length > 0) {
                const tradesToUpdate = existingTrades.filter(t => {
                    const eaTrade = eaTrades.find(et => et.ticket === t.ticket);
                    if (!eaTrade) return false;
                    const newPnl = eaTrade.pnl || eaTrade.profit || 0;
                    return Math.abs((t.pnl || 0) - newPnl) > 0.10;
                });
                if (tradesToUpdate.length > 0) {
                    // Process in small batches to avoid rate limits
                    for (let i = 0; i < tradesToUpdate.length; i += 3) {
                        const batch = tradesToUpdate.slice(i, i + 3);
                        await Promise.all(batch.map(t => {
                            const eaTrade = eaTrades.find(et => et.ticket === t.ticket);
                            return base44.asServiceRole.entities.Trade.update(t.id, { pnl: eaTrade.pnl || eaTrade.profit || 0 });
                        }));
                    }
                }
            }

            // 3. Close DB trades whose tickets are no longer reported by EA
            const closedTrades = dbOpenTrades.filter(t => t.ticket && !eaTicketSet.has(t.ticket));
            if (closedTrades.length > 0) {
                console.log('[BRIDGE] Closing', closedTrades.length, 'trades no longer in EA');
                await Promise.all(closedTrades.map(t => {
                    // Use the last known PnL (already synced in step 2) as the final pnl
                    // close_price is estimated from pnl since EA doesn't report it on close
                    const finalPnl = t.pnl || 0;
                    const pipValue = (t.open_price > 10) ? 0.001 : 0.0001;
                    const lotMultiplier = (t.lot_size || 0.1) * 100000;
                    const priceMove = lotMultiplier > 0 ? finalPnl / lotMultiplier : 0;
                    const closePrice = t.type === 'BUY'
                        ? t.open_price + priceMove
                        : t.open_price - priceMove;
                    console.log(`[BRIDGE] Closing ticket ${t.ticket}: pnl=${finalPnl}, close_price≈${closePrice.toFixed(5)}`);
                    return base44.asServiceRole.entities.Trade.update(t.id, {
                        status: 'CLOSED',
                        close_price: parseFloat(closePrice.toFixed(5)),
                        pnl: finalPnl
                    });
                }));
            }
        }

        // --- Daily Profit Target Check ---
        const riskSettingsList = await base44.asServiceRole.entities.RiskManagementSettings.list();
        const riskSettings = riskSettingsList?.[0];
        const profitTarget = riskSettings?.daily_profit_target_percent || 0;

        if (profitTarget > 0 && !riskSettings?.is_trading_paused) {
            const accountBalance = balance || 0;
            if (accountBalance > 0) {
                // Calculate today's profit from closed trades
                const today = new Date().toISOString().split('T')[0];
                const todayTrades = await base44.asServiceRole.entities.Trade.filter({ status: 'CLOSED' });
                const todayProfit = todayTrades
                    .filter(t => t.created_date?.startsWith(today))
                    .reduce((sum, t) => sum + (t.pnl || 0), 0);
                // Also add open trade floating PnL
                const currentOpenTrades = await base44.asServiceRole.entities.Trade.filter({ status: 'OPEN' });
                const floatingPnl = currentOpenTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
                const totalDailyProfit = todayProfit + floatingPnl;
                const dailyProfitPercent = (totalDailyProfit / accountBalance) * 100;

                console.log(`[BRIDGE] Daily profit check: ${dailyProfitPercent.toFixed(2)}% vs target ${profitTarget}%`);

                if (dailyProfitPercent >= profitTarget) {
                    console.log(`[BRIDGE] Daily profit target reached (${dailyProfitPercent.toFixed(2)}%) — closing all trades and pausing`);
                    // Close all open trades in DB
                    await Promise.all(currentOpenTrades.map(t =>
                        base44.asServiceRole.entities.Trade.update(t.id, { status: 'CLOSED', close_price: t.open_price, pnl: t.pnl || 0 })
                    ));
                    // Pause trading
                    if (riskSettings?.id) {
                        await base44.asServiceRole.entities.RiskManagementSettings.update(riskSettings.id, { is_trading_paused: true });
                    }
                    // Create alert
                    await base44.asServiceRole.entities.Alert.create({
                        title: '🎯 Daily Profit Target Reached!',
                        message: `Daily profit of ${dailyProfitPercent.toFixed(2)}% reached your ${profitTarget}% target. All trades closed and trading paused.`,
                        type: 'SUCCESS',
                    });
                }
            }
        }

        // Return pending signals for EA to execute (limit to 5 most recent to avoid buffer overflow)
        const allPendingSignals = await base44.asServiceRole.entities.Signal.filter({ status: 'PENDING' }, '-created_date', 100);
        
        // Auto-expire signals older than 5 minutes (they're stale and will never execute)
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const staleSignals = allPendingSignals.filter(s => s.created_date < fiveMinutesAgo);
        if (staleSignals.length > 0) {
            console.log('[BRIDGE] Expiring', staleSignals.length, 'stale pending signals');
            await Promise.all(staleSignals.map(s =>
                base44.asServiceRole.entities.Signal.update(s.id, { status: 'EXPIRED' })
            ));
        }
        
        const pendingSignals = allPendingSignals.filter(s => s.created_date >= fiveMinutesAgo).slice(0, 5);
        console.log('[BRIDGE] Returning', pendingSignals.length, 'pending signals to EA');

        // Sanitize SL/TP and build payload BEFORE marking as ACTIVE
        const sanitizedSignals = pendingSignals.map(s => {
            const pair = (s.pair || '').replace('/', '');
            const type = s.type;
            const sl = s.stop_loss || 0;
            const tp = s.take_profit || 0;
            const entryPrice = s.entry_price || 0;

            let safeSL = sl;
            let safeTP = tp;
            if (sl > 0 && entryPrice > 0) {
                if (type === 'BUY' && sl >= entryPrice) { safeSL = 0; console.log(`[BRIDGE] Zeroing invalid SL for BUY ${pair}: SL ${sl} >= entry ${entryPrice}`); }
                if (type === 'SELL' && sl <= entryPrice) { safeSL = 0; console.log(`[BRIDGE] Zeroing invalid SL for SELL ${pair}: SL ${sl} <= entry ${entryPrice}`); }
            }
            if (tp > 0 && entryPrice > 0) {
                if (type === 'BUY' && tp <= entryPrice) { safeTP = 0; console.log(`[BRIDGE] Zeroing invalid TP for BUY ${pair}: TP ${tp} <= entry ${entryPrice}`); }
                if (type === 'SELL' && tp >= entryPrice) { safeTP = 0; console.log(`[BRIDGE] Zeroing invalid TP for SELL ${pair}: TP ${tp} >= entry ${entryPrice}`); }
            }

            return {
                id: s.id,
                pair,
                type,
                lot_size: s.lot_size || 0.1,
                stop_loss: safeSL,
                take_profit: safeTP,
                entry_price: entryPrice,
            };
        });

        // Mark signals as ACTIVE AFTER sanitization so they are NOT re-sent next heartbeat
        if (sanitizedSignals.length > 0) {
            await Promise.all(sanitizedSignals.map(s =>
                base44.asServiceRole.entities.Signal.update(s.id, { status: 'ACTIVE' })
            ));
        }

        return Response.json({
            success: true,
            message: 'Sync successful',
            account: account_number,
            timestamp: new Date().toISOString(),
            price_update_ts: updatePrices ? now : (body.last_price_update || now),
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