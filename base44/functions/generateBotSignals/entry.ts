import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        // Fetch all running bots, open trades, pending signals, pairs, risk settings in parallel
        const [bots, openTrades, pendingSignals, pairsList, riskSettingsList, brokerConnections] = await Promise.all([
            base44.asServiceRole.entities.BotConfig.filter({ status: 'RUNNING' }, '-created_date', 50),
            base44.asServiceRole.entities.Trade.filter({ status: 'OPEN' }, '-created_date', 200),
            base44.asServiceRole.entities.Signal.filter({ status: 'PENDING' }, '-created_date', 200),
            base44.asServiceRole.entities.CurrencyPair.list('-updated_date', 100),
            base44.asServiceRole.entities.RiskManagementSettings.list('-created_date', 50),
            base44.asServiceRole.entities.BrokerConnection.list('-updated_date', 50),
        ]);

        if (!bots.length) {
            return Response.json({ success: true, message: 'No running bots', signals_created: 0 });
        }

        // Check at least one broker connection is live (updated within last 5 minutes)
        const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const hasLiveConnection = brokerConnections.some(c => c.connection_status === 'CONNECTED' && c.last_sync >= fiveMinsAgo);
        if (!hasLiveConnection) {
            console.log('[generateBotSignals] No live MT4/MT5 connection — skipping signal generation');
            return Response.json({ success: true, message: 'No live broker connection', signals_created: 0 });
        }

        // Build a map of owner_email -> riskSettings for per-user risk checks
        const riskByOwner = {};
        for (const r of riskSettingsList) {
            if (r.created_by && !riskByOwner[r.created_by]) {
                riskByOwner[r.created_by] = r;
            }
        }

        // Build price map from CurrencyPair table (live prices only, updated within 10 min)
        const priceMap = {};
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        let staleCount = 0;
        for (const p of pairsList) {
            if (p.symbol && p.current_price) {
                const isLive = !p.updated_date || p.updated_date >= tenMinutesAgo;
                if (isLive) {
                    priceMap[p.symbol] = p.current_price;
                    priceMap[p.symbol.replace('/', '')] = p.current_price;
                } else {
                    staleCount++;
                }
            }
        }
        if (staleCount > 0) console.log(`[generateBotSignals] Skipped ${staleCount} stale pairs`);

        // Group bots by owner for isolated per-user processing
        const botsByOwner = {};
        for (const bot of bots) {
            const owner = bot.owner_email || bot.created_by;
            if (!owner) continue;
            if (!botsByOwner[owner]) botsByOwner[owner] = [];
            botsByOwner[owner].push(bot);
        }

        // Collect all unique pairs across ALL bots that have a live price (for single AI call)
        const allPairsSet = new Set();
        for (const bot of bots) {
            for (const pair of (bot.pairs || [])) {
                if (priceMap[pair] || priceMap[pair.replace('/', '')]) allPairsSet.add(pair);
            }
        }
        const allPairs = [...allPairsSet];

        if (!allPairs.length) {
            return Response.json({ success: true, message: 'No pairs with live prices', signals_created: 0 });
        }

        // Single AI call for all pairs (efficient — reuse analysis across users)
        const priceContext = allPairs.map(pair => {
            const price = priceMap[pair] || priceMap[pair.replace('/', '')];
            return `${pair}: ${price}`;
        }).join(', ');

        console.log(`[generateBotSignals] Calling AI for ${allPairs.length} pairs across ${Object.keys(botsByOwner).length} user(s)`);

        const aiResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
            prompt: `You are a professional forex trading analyst. Analyze these currency pairs and their current prices, then provide a trading recommendation for EACH pair.

Current Prices: ${priceContext}
Timeframe: H1
Analysis time: ${new Date().toUTCString()}

For each pair, determine whether to BUY, SELL, or stay NEUTRAL based on technical analysis principles (RSI levels, EMA crossovers, momentum, overbought/oversold conditions).

Only recommend BUY or SELL when confidence is above 70%. Otherwise set type to NEUTRAL.`,
            response_json_schema: {
                type: "object",
                properties: {
                    signals: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                pair: { type: "string" },
                                type: { type: "string", enum: ["BUY", "SELL", "NEUTRAL"] },
                                confidence: { type: "number", minimum: 0, maximum: 100 },
                                rsi: { type: "number" },
                                ema_trend: { type: "string" },
                                momentum: { type: "string" },
                                reason: { type: "string" }
                            }
                        }
                    }
                }
            }
        });

        const aiSignals = aiResult?.signals || [];
        const aiMap = {};
        for (const s of aiSignals) {
            if (s.pair) aiMap[s.pair.replace('/', '')] = s;
        }
        console.log(`[generateBotSignals] AI returned analysis for: ${Object.keys(aiMap).join(', ')}`);

        // Process each user's bots in isolation — signals are scoped to that user's account
        const allSignalsToCreate = [];

        for (const [ownerEmail, ownerBots] of Object.entries(botsByOwner)) {
            // Per-user risk settings
            const riskSettings = riskByOwner[ownerEmail] || {};
            // Explicitly check for boolean true to avoid string/number coercion issues
            if (riskSettings.is_trading_paused === true) {
                console.log(`[generateBotSignals] Trading paused for ${ownerEmail} — skipping`);
                continue;
            }


            // Only this user's open trades and pending signals
            const userOpenTrades = openTrades.filter(t => t.owner_email === ownerEmail || t.created_by === ownerEmail);
            const userPendingSignals = pendingSignals.filter(s => s.created_by === ownerEmail);
            const maxGlobal = riskSettings.max_concurrent_trades || 100;

            if (userOpenTrades.length >= maxGlobal) {
                console.log(`[generateBotSignals] User ${ownerEmail} at global trade limit (${userOpenTrades.length}/${maxGlobal})`);
                continue;
            }

            for (const bot of ownerBots) {
                const botOpenTrades = userOpenTrades.filter(t => t.bot_id === bot.id);
                const maxOpen = bot.max_open_trades || 5;
                if (botOpenTrades.length >= maxOpen) continue;

                const minConf = bot.min_confidence || 75;

                for (const pair of (bot.pairs || [])) {
                    if (botOpenTrades.length + allSignalsToCreate.filter(s => s.bot_id === bot.id).length >= maxOpen) break;
                    if (userOpenTrades.length + allSignalsToCreate.filter(s => s.owner_email === ownerEmail).length >= maxGlobal) break;

                    const pairRaw = pair.replace('/', '');
                    if (userOpenTrades.some(t => t.bot_id === bot.id && (t.pair === pair || t.pair === pairRaw))) continue;
                    if (userPendingSignals.some(s => s.bot_id === bot.id && (s.pair === pair || s.pair === pairRaw))) continue;
                    if (allSignalsToCreate.some(s => s.bot_id === bot.id && (s.pair === pair || s.pair === pairRaw))) continue;

                    const currentPrice = priceMap[pair] || priceMap[pairRaw];
                    if (!currentPrice) { console.log(`[Skip] ${bot.name} ${pair}: no price`); continue; }

                    const analysis = aiMap[pairRaw];
                    if (!analysis) { console.log(`[Skip] ${bot.name} ${pair}: no AI analysis`); continue; }
                    if (analysis.type === 'NEUTRAL') continue;
                    if ((analysis.confidence || 0) < minConf) { console.log(`[Skip] ${bot.name} ${pair}: conf ${analysis.confidence} < ${minConf}`); continue; }

                    // Calculate SL/TP
                    let slPips = bot.stop_loss_pips || 30;
                    let tpPips = bot.take_profit_pips || 60;
                    if (bot.sl_tp_mode === 'ATR' || bot.use_ai_risk) {
                        const volatilityFactor = currentPrice > 100 ? 0.002 : 0.0015;
                        const atr = currentPrice * volatilityFactor;
                        const pipSize = currentPrice > 50 ? 0.01 : 0.0001;
                        slPips = Math.round((atr * (bot.atr_multiplier_sl || 1.5)) / pipSize);
                        tpPips = Math.round((atr * (bot.atr_multiplier_tp || 3.0)) / pipSize);
                    }
                    const pipValue = currentPrice > 50 ? 0.01 : 0.0001;
                    const sl = analysis.type === 'BUY' ? currentPrice - (slPips * pipValue) : currentPrice + (slPips * pipValue);
                    const tp = analysis.type === 'BUY' ? currentPrice + (tpPips * pipValue) : currentPrice - (tpPips * pipValue);

                    console.log(`[Signal] ${ownerEmail} | ${bot.name} -> ${analysis.type} ${pair} @ ${currentPrice.toFixed(5)} (${analysis.confidence}%)`);

                    allSignalsToCreate.push({
                        pair,
                        type: analysis.type,
                        entry_price: currentPrice,
                        stop_loss: parseFloat(sl.toFixed(5)),
                        take_profit: parseFloat(tp.toFixed(5)),
                        confidence: analysis.confidence,
                        lot_size: bot.lot_size || 0.01,
                        strategy: bot.strategy_type || 'AUTO',
                        bot_id: bot.id,
                        status: 'PENDING',
                        result_pnl: 0,
                        owner_email: ownerEmail,
                        calculated_indicators: {
                            rsi: analysis.rsi,
                            ema_trend: analysis.ema_trend,
                            momentum: analysis.momentum,
                            reason: analysis.reason
                        }
                    });
                }
            }
        }

        if (allSignalsToCreate.length > 0) {
            await base44.asServiceRole.entities.Signal.bulkCreate(allSignalsToCreate);
        }

        return Response.json({
            success: true,
            users_processed: Object.keys(botsByOwner).length,
            bots_processed: bots.length,
            signals_created: allSignalsToCreate.length,
            pairs_analyzed: allPairs.length,
            message: `Created ${allSignalsToCreate.length} signals for ${Object.keys(botsByOwner).length} user(s)`
        });

    } catch (error) {
        console.error('[generateBotSignals ERROR]', error.message);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});