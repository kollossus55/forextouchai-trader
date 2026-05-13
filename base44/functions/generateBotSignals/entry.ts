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

        // Build map: owner email → list of connected account numbers
        const ownerAccountMap = {};
        for (const conn of brokerConnections) {
            const email = conn.created_by;
            if (!email || !conn.account_number) continue;
            if (!ownerAccountMap[email]) ownerAccountMap[email] = [];
            ownerAccountMap[email].push(conn.account_number);
        }

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

        // Build price map from CurrencyPair table — use all available prices
        // Note: bridge updates these periodically; we trust whatever is in the DB
        const priceMap = {};
        for (const p of pairsList) {
            if (p.symbol && p.current_price) {
                priceMap[p.symbol] = p.current_price;
                priceMap[p.symbol.replace('/', '')] = p.current_price;
            }
        }
        console.log(`[generateBotSignals] Loaded ${Object.keys(priceMap).length / 2} pairs from DB`);

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

        // Build strategy groups — each unique strategy type gets its own AI prompt
        const strategyGroups = {};
        for (const bot of bots) {
            const strategy = bot.strategy_type || 'AI_PREDICTIVE';
            if (!strategyGroups[strategy]) strategyGroups[strategy] = new Set();
            for (const pair of (bot.pairs || [])) {
                if (priceMap[pair] || priceMap[pair.replace('/', '')]) strategyGroups[strategy].add(pair);
            }
        }

        // Strategy-specific AI prompts
        function buildPrompt(strategy, pairs, priceMap) {
            const priceContext = pairs.map(pair => {
                const price = priceMap[pair] || priceMap[pair.replace('/', '')];
                return `${pair}: ${price}`;
            }).join(', ');
            const now = new Date().toUTCString();

            const prompts = {
                AI_PREDICTIVE: `You are an elite multi-timeframe forex analyst. Analyze each currency pair using a confluence approach across M15, H1, H4, and D1 timeframes.

Current Prices: ${priceContext}
Analysis time: ${now}

For EACH pair, evaluate ALL of the following and only signal when they ALIGN across at least 3 timeframes:
1. PRICE ACTION: Higher highs/lows (uptrend) or lower highs/lows (downtrend), key support/resistance levels, breakouts or rejections.
2. CHART PATTERNS: Head & Shoulders, Double Top/Bottom, Triangles (ascending/descending/symmetrical), Flags, Wedges, Channels.
3. CANDLESTICK PATTERNS: Engulfing (bullish/bearish), Pin Bars, Doji at key levels, Morning/Evening Star, Hammer, Shooting Star.
4. MULTI-TIMEFRAME CONFLUENCE: Higher timeframe (H4/D1) sets the bias; lower timeframe (M15/H1) provides the entry trigger.

Only recommend BUY or SELL when ALL three analysis types (price action, chart pattern, candlestick pattern) align with the higher timeframe trend. Otherwise NEUTRAL. Minimum confidence 75%.`,

                SCALPING: `You are a scalping forex specialist focused on short-term momentum and tight range movements.

Current Prices: ${priceContext}
Analysis time: ${now}

For EACH pair, analyze on M1 and M5 timeframes:
- Momentum bursts and micro-trend direction
- RSI extremes (above 70 = overbought/SELL, below 30 = oversold/BUY)
- Bollinger Band touches and squeezes
- MACD histogram direction on M5
- Bid/ask spread suitability for scalping

Only signal BUY or SELL on strong short-term momentum with tight risk. Otherwise NEUTRAL. Minimum confidence 75%.`,

                SWING: `You are a swing trading forex analyst focused on multi-day moves.

Current Prices: ${priceContext}
Analysis time: ${now}

For EACH pair, analyze on H4 and D1 timeframes:
- Major trend direction (200 EMA position)
- Fibonacci retracement levels (38.2%, 50%, 61.8%) as entry zones
- RSI divergence (price makes new high/low but RSI does not)
- Key weekly support/resistance levels
- Volume-confirmed breakouts

Only signal BUY or SELL on high-probability swing setups with clear risk/reward of at least 1:2. Otherwise NEUTRAL. Minimum confidence 75%.`,

                DAY_TRADING: `You are a day trading forex analyst focused on intraday opportunities.

Current Prices: ${priceContext}
Analysis time: ${now}

For EACH pair, analyze on M30 and H1 timeframes:
- London/New York session breakouts and trends
- EMA 9/21 crossovers on H1
- VWAP position (price above = bullish bias, below = bearish)
- Inside bar breakouts and range expansions
- News-driven momentum (economic session timing)

Only signal BUY or SELL on clear intraday setups with defined session context. Otherwise NEUTRAL. Minimum confidence 75%.`,

                PRICE_ACTION: `You are a pure price action forex trader. No indicators — only what the chart shows.

Current Prices: ${priceContext}
Analysis time: ${now}

For EACH pair, analyze on H1 and H4 timeframes using ONLY price action:
- Key horizontal support and resistance levels
- Trendline breaks and retests
- Pin bars, engulfing candles, and inside bars at key levels
- Market structure: trending (HH/HL or LH/LL) vs ranging
- Order blocks and fair value gaps

Only signal BUY or SELL when price is at a key level with a confirmed price action trigger. Otherwise NEUTRAL. Minimum confidence 75%.`,

                PATTERN_TRADING: `You are a chart pattern specialist forex analyst.

Current Prices: ${priceContext}
Analysis time: ${now}

For EACH pair, scan for high-probability chart patterns on H1 and H4:
- Continuation patterns: Flags, Pennants, Rectangles, Triangles
- Reversal patterns: Head & Shoulders, Double/Triple Tops & Bottoms, Rounding Bottom
- Breakout confirmation: volume surge, candle close beyond pattern boundary
- Pattern measured move targets for TP calculation
- Failed pattern signals (traps) to avoid

Only signal BUY or SELL on confirmed pattern breakouts with clear measured move targets. Otherwise NEUTRAL. Minimum confidence 75%.`,

                CANDLESTICK: `You are a candlestick pattern expert and price action forex analyst.

Current Prices: ${priceContext}
Analysis time: ${now}

For EACH pair, analyze candlestick formations on M30 and H1 at key levels:
- Single candle patterns: Pin Bar, Hammer, Shooting Star, Marubozu, Doji
- Multi-candle patterns: Engulfing (bullish/bearish), Morning/Evening Star, Three White Soldiers/Black Crows, Harami
- Context: pattern must form at key support/resistance, trendline, or Fibonacci level
- Confirmation: next candle must confirm the pattern direction
- Candle body-to-wick ratio for signal strength

Only signal BUY or SELL when a high-probability candlestick pattern forms at a significant level with context confirmation. Otherwise NEUTRAL. Minimum confidence 75%.`,

                HYBRID_ALL: `You are a comprehensive forex analyst using ALL available technical analysis methods.

Current Prices: ${priceContext}
Analysis time: ${now}

For EACH pair, use a full confluence approach:
- Trend: EMA 50/200 alignment across H1 and H4
- Momentum: RSI, MACD, Stochastic across timeframes
- Price Action: Support/resistance, trendlines, market structure
- Chart Patterns: Any forming or completed patterns
- Candlestick Patterns: Confirmation candles at key levels
- Volume: Breakout volume confirmation

Signal BUY or SELL only when 4+ confluence factors align. Otherwise NEUTRAL. Minimum confidence 80% for this strategy.`,
            };

            return prompts[strategy] || prompts['AI_PREDICTIVE'];
        }

        // Run AI calls per strategy group in parallel
        console.log(`[generateBotSignals] Running ${Object.keys(strategyGroups).length} strategy-specific AI calls`);

        const strategyAiMaps = {};
        await Promise.all(Object.entries(strategyGroups).map(async ([strategy, pairSet]) => {
            const pairs = [...pairSet];
            if (!pairs.length) return;
            try {
                const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
                    prompt: buildPrompt(strategy, pairs, priceMap),
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
                const map = {};
                for (const s of (result?.signals || [])) {
                    if (s.pair) map[s.pair.replace('/', '')] = s;
                }
                strategyAiMaps[strategy] = map;
                console.log(`[generateBotSignals] ${strategy}: AI analyzed ${Object.keys(map).length} pairs`);
            } catch (e) {
                console.error(`[generateBotSignals] AI call failed for ${strategy}:`, e.message);
                strategyAiMaps[strategy] = {};
            }
        }));

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
                // --- Trading hours check (UTC) ---
                if (bot.trading_start_time && bot.trading_end_time) {
                    const nowUtc = new Date();
                    const [startH, startM] = bot.trading_start_time.split(':').map(Number);
                    const [endH, endM] = bot.trading_end_time.split(':').map(Number);
                    const nowMins = nowUtc.getUTCHours() * 60 + nowUtc.getUTCMinutes();
                    const startMins = startH * 60 + startM;
                    const endMins = endH * 60 + endM;
                    const inWindow = startMins <= endMins
                        ? nowMins >= startMins && nowMins < endMins   // same-day window e.g. 07:00–23:00
                        : nowMins >= startMins || nowMins < endMins;  // overnight window e.g. 22:00–06:00
                    if (!inWindow) {
                        console.log(`[generateBotSignals] Bot "${bot.name}" outside trading hours (${bot.trading_start_time}–${bot.trading_end_time} UTC, now ${nowUtc.getUTCHours()}:${String(nowUtc.getUTCMinutes()).padStart(2,'0')} UTC) — skipping`);
                        continue;
                    }
                }

                const botOpenTrades = userOpenTrades.filter(t => t.bot_id === bot.id);
                const maxOpen = bot.max_open_trades || 5;
                if (botOpenTrades.length >= maxOpen) continue;

                const minConf = bot.min_confidence || 75;

                for (const pair of (bot.pairs || [])) {
                    if (botOpenTrades.length + allSignalsToCreate.filter(s => s.bot_id === bot.id).length >= maxOpen) break;
                    if (userOpenTrades.length + allSignalsToCreate.filter(s => s.owner_email === ownerEmail).length >= maxGlobal) break;

                    const pairRaw = pair.replace('/', '');
                    // Cross-bot check: skip if ANY bot already has an open trade or pending signal on this pair for this user
                    if (userOpenTrades.some(t => t.pair === pair || t.pair === pairRaw)) continue;
                    if (userPendingSignals.some(s => s.pair === pair || s.pair === pairRaw)) continue;
                    if (allSignalsToCreate.some(s => s.pair === pair || s.pair === pairRaw)) continue;

                    const currentPrice = priceMap[pair] || priceMap[pairRaw];
                    if (!currentPrice) { console.log(`[Skip] ${bot.name} ${pair}: no price`); continue; }

                    const strategyMap = strategyAiMaps[bot.strategy_type || 'AI_PREDICTIVE'] || {};
                    const analysis = strategyMap[pairRaw];
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

                    // Get account numbers for this owner — create one signal per account
                    const accountNumbers = ownerAccountMap[ownerEmail] || [];
                    if (accountNumbers.length === 0) {
                        console.log(`[Skip] ${bot.name} ${pair}: no broker account for ${ownerEmail}`);
                        continue;
                    }

                    console.log(`[Signal] ${ownerEmail} | ${bot.name} -> ${analysis.type} ${pair} @ ${currentPrice.toFixed(5)} (${analysis.confidence}%) → ${accountNumbers.length} account(s)`);

                    for (const acctNum of accountNumbers) {
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
                            owner_email: acctNum,  // Bridge matches on account_number
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