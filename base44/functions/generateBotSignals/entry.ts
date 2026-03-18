import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        // Fetch all required data in parallel
        const [bots, openTrades, pendingSignals, pairsList, riskSettingsList] = await Promise.all([
            base44.asServiceRole.entities.BotConfig.filter({ status: 'RUNNING' }, '-created_date', 20),
            base44.asServiceRole.entities.Trade.filter({ status: 'OPEN' }, '-created_date', 100),
            base44.asServiceRole.entities.Signal.filter({ status: 'PENDING' }, '-created_date', 100),
            base44.asServiceRole.entities.CurrencyPair.list('-updated_date', 100),
            base44.asServiceRole.entities.RiskManagementSettings.list('-created_date', 1),
        ]);

        if (!bots.length) {
            return Response.json({ success: true, message: 'No running bots', signals_created: 0 });
        }

        // Check at least one broker connection is live (updated within last 5 minutes)
        const brokerConnections = await base44.asServiceRole.entities.BrokerConnection.list('-updated_date', 10);
        const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const hasLiveConnection = brokerConnections.some(c => c.connection_status === 'CONNECTED' && c.last_sync >= fiveMinsAgo);
        if (!hasLiveConnection) {
            console.log('[generateBotSignals] No live MT4/MT5 connection — skipping signal generation');
            return Response.json({ success: true, message: 'No live broker connection', signals_created: 0 });
        }

        const globalRisk = riskSettingsList?.[0] || {};
        if (globalRisk.is_trading_paused) {
            return Response.json({ success: true, message: 'Trading paused globally', signals_created: 0 });
        }

        const maxGlobal = globalRisk.max_concurrent_trades || 100;
        if (openTrades.length >= maxGlobal) {
            return Response.json({ success: true, message: `Global trade limit reached (${openTrades.length}/${maxGlobal})`, signals_created: 0 });
        }

        // Build price map from CurrencyPair table — only use prices updated within last 10 minutes (live EA data)
        const priceMap = {};
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        let staleCount = 0;
        for (const p of pairsList) {
            if (p.symbol && p.current_price) {
                // Accept price if updated recently OR if it's a manually seeded pair (no updated_date check)
                const isLive = !p.updated_date || p.updated_date >= tenMinutesAgo;
                if (isLive) {
                    priceMap[p.symbol] = p.current_price;
                    priceMap[p.symbol.replace('/', '')] = p.current_price;
                } else {
                    staleCount++;
                }
            }
        }
        if (staleCount > 0) console.log(`[generateBotSignals] Skipped ${staleCount} pairs with stale prices (>10 min old)`);
        console.log(`[generateBotSignals] ${Object.keys(priceMap).length / 2} pairs with live prices available`);

        // Collect all unique pairs across all running bots that have a known price
        const allPairsSet = new Set();
        for (const bot of bots) {
            for (const pair of (bot.pairs || [])) {
                const price = priceMap[pair] || priceMap[pair.replace('/', '')];
                if (price) allPairsSet.add(pair);
            }
        }

        const allPairs = [...allPairsSet];
        console.log('[generateBotSignals] Price map keys:', Object.keys(priceMap).join(', '));
        console.log('[generateBotSignals] Bot pairs:', bots.map(b => `${b.name}: ${(b.pairs||[]).join(',')}`).join(' | '));
        console.log('[generateBotSignals] Pairs with known prices:', allPairs.join(', '));
        if (!allPairs.length) {
            return Response.json({ success: true, message: 'No pairs with known prices', signals_created: 0 });
        }

        // Build price context for AI
        const priceContext = allPairs.map(pair => {
            const price = priceMap[pair] || priceMap[pair.replace('/', '')];
            return `${pair}: ${price}`;
        }).join(', ');

        // Call Base44 built-in AI once for all pairs
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
        // Build a lookup map from pair -> AI analysis (normalized to raw format e.g. EURUSD)
        const aiMap = {};
        for (const s of aiSignals) {
            if (s.pair) {
                const rawPair = s.pair.replace('/', '');
                aiMap[rawPair] = s;
            }
        }
        console.log('[generateBotSignals] AI returned signals for pairs:', Object.keys(aiMap).join(', '));

        const signalsToCreate = [];

        for (const bot of bots) {
            const botPairs = bot.pairs || [];
            if (!botPairs.length) continue;

            const botOpenTrades = openTrades.filter(t => t.bot_id === bot.id);
            const maxOpen = bot.max_open_trades || 5;
            if (botOpenTrades.length >= maxOpen) continue;

            const minConf = bot.min_confidence || 75;

            for (const pair of botPairs) {
                if (botOpenTrades.length + signalsToCreate.filter(s => s.bot_id === bot.id).length >= maxOpen) break;
                if (openTrades.length + signalsToCreate.length >= maxGlobal) break;

                const pairRaw = pair.replace('/', '');

                // Skip if there's already an open trade for this pair FROM THIS BOT
                if (openTrades.some(t => t.bot_id === bot.id && (t.pair === pair || t.pair === pairRaw))) continue;

                // Skip if there's already a pending/active signal for this pair FROM THIS BOT
                if (pendingSignals.some(s => s.bot_id === bot.id && (s.pair === pair || s.pair === pairRaw))) continue;

                // Skip if we already queued a signal for this pair for this bot in this run
                if (signalsToCreate.some(s => s.bot_id === bot.id && (s.pair === pair || s.pair === pairRaw))) continue;

                const currentPrice = priceMap[pair] || priceMap[pair.replace('/', '')] || null;
                if (!currentPrice) { console.log(`[Skip] ${bot.name} ${pair}: no price in DB`); continue; }

                // Lookup using normalized (slash-free) pair key
                const analysis = aiMap[pair.replace('/', '')];
                if (!analysis) { console.log(`[Skip] ${bot.name} ${pair}: no AI analysis returned`); continue; }
                if (analysis.type === 'NEUTRAL') { console.log(`[Skip] ${bot.name} ${pair}: AI says NEUTRAL (conf=${analysis.confidence})`); continue; }
                if ((analysis.confidence || 0) < minConf) { console.log(`[Skip] ${bot.name} ${pair}: confidence ${analysis.confidence} < ${minConf}`); continue; }

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

                // Pip value: JPY pairs (price ~100+) use 0.01, standard pairs use 0.0001
                const pipValue = currentPrice > 50 ? 0.01 : 0.0001;
                const sl = analysis.type === 'BUY'
                    ? currentPrice - (slPips * pipValue)
                    : currentPrice + (slPips * pipValue);
                const tp = analysis.type === 'BUY'
                    ? currentPrice + (tpPips * pipValue)
                    : currentPrice - (tpPips * pipValue);

                console.log(`[Signal] ${bot.name} -> ${analysis.type} ${pair} @ ${currentPrice.toFixed(5)} (${analysis.confidence}%) | ${analysis.reason || ''}`);

                signalsToCreate.push({
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
                    calculated_indicators: {
                        rsi: analysis.rsi,
                        ema_trend: analysis.ema_trend,
                        momentum: analysis.momentum,
                        reason: analysis.reason
                    }
                });
            }
        }

        if (signalsToCreate.length > 0) {
            await base44.asServiceRole.entities.Signal.bulkCreate(signalsToCreate);
        }

        return Response.json({
            success: true,
            bots_processed: bots.length,
            signals_created: signalsToCreate.length,
            pairs_analyzed: allPairs.length,
            message: `Created ${signalsToCreate.length} signals from ${bots.length} running bots`
        });

    } catch (error) {
        console.error('[generateBotSignals ERROR]', error.message);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});