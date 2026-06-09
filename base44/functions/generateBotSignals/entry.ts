import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        // Fetch all running bots, open trades, pending signals, pairs, risk settings in parallel
        const [bots, openTrades, pendingSignals, activeSignals, pairsList, riskSettingsList, brokerConnections] = await Promise.all([
            base44.asServiceRole.entities.BotConfig.filter({ status: 'RUNNING' }, '-created_date', 50),
            base44.asServiceRole.entities.Trade.filter({ status: 'OPEN' }, '-created_date', 200),
            base44.asServiceRole.entities.Signal.filter({ status: 'PENDING' }, '-created_date', 200),
            base44.asServiceRole.entities.Signal.filter({ status: 'ACTIVE' }, '-created_date', 200),
            base44.asServiceRole.entities.CurrencyPair.list('-updated_date', 100),
            base44.asServiceRole.entities.RiskManagementSettings.list('-created_date', 100),
            base44.asServiceRole.entities.BrokerConnection.list('-updated_date', 50),
        ]);

        // Build per-account risk map: account_number → risk settings (account-specific preferred, then global fallback)
        const globalRiskSettings = riskSettingsList.find(r => !r.account_number) || null;
        const accountRiskMap = {};
        for (const r of riskSettingsList) {
            if (r.account_number) accountRiskMap[r.account_number] = r;
        }
        const getRiskForAccount = (acctNum) => accountRiskMap[acctNum] || globalRiskSettings || {};

        if (!bots.length) {
            return Response.json({ success: true, message: 'No running bots', signals_created: 0 });
        }

        const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000);

        // Build a set of all account numbers that are live
        const liveAccountNumbers = new Set();
        for (const conn of brokerConnections) {
            if (!conn.account_number) continue;
            const isConnected = conn.connection_status === 'CONNECTED';
            const lastSync = conn.last_sync ? new Date(conn.last_sync) : null;
            const isRecent = lastSync && lastSync >= fiveMinsAgo;
            if (isConnected && isRecent) {
                liveAccountNumbers.add(conn.account_number);
            }
        }
        console.log(`[generateBotSignals] Live accounts: ${[...liveAccountNumbers].join(', ')}`);

        // Build map: bot owner email → list of broker account numbers
        const ownerAccountMap = {};
        const ownerHasLiveConn = {};
        for (const conn of brokerConnections) {
            if (!conn.account_number) continue;
            const email = conn.created_by && !conn.created_by.includes('service+') ? conn.created_by : null;
            if (!email) continue;
            if (!ownerAccountMap[email]) ownerAccountMap[email] = [];
            ownerAccountMap[email].push(conn.account_number);
            if (liveAccountNumbers.has(conn.account_number)) {
                ownerHasLiveConn[email] = true;
            }
        }

        // For any bot owner who has at least one live connection, also include unclaimed live accounts
        for (const email of Object.keys(ownerHasLiveConn)) {
            const currentAccts = new Set(ownerAccountMap[email] || []);
            for (const acctNum of liveAccountNumbers) {
                if (!currentAccts.has(acctNum)) {
                    const claimedByOther = Object.entries(ownerAccountMap).some(
                        ([otherEmail, accts]) => otherEmail !== email && accts.includes(acctNum)
                    );
                    if (!claimedByOther) {
                        ownerAccountMap[email].push(acctNum);
                        console.log(`[generateBotSignals] Associating orphan account ${acctNum} to ${email}`);
                    }
                }
            }
        }

        // Build set of all account numbers per owner (for open trade lookup)
        const ownerAccountSet = {};
        for (const [email, accts] of Object.entries(ownerAccountMap)) {
            ownerAccountSet[email] = new Set(accts);
        }

        // Build price map from CurrencyPair table
        const priceMap = {};
        for (const p of pairsList) {
            if (p.symbol && p.current_price) {
                priceMap[p.symbol] = p.current_price;
                priceMap[p.symbol.replace('/', '')] = p.current_price;
            }
        }
        console.log(`[generateBotSignals] Loaded ${Object.keys(priceMap).length / 2} pairs from DB`);

        // Group bots by owner
        const botsByOwner = {};
        for (const bot of bots) {
            const owner = bot.owner_email || bot.created_by;
            if (!owner) continue;
            if (!botsByOwner[owner]) botsByOwner[owner] = [];
            botsByOwner[owner].push(bot);
        }

        // FIXED: Assign unclaimed live accounts to ALL bot owners who have no connection yet
        // (not just admin) — this allows users like kollossus60 with service-created connections to trade
        const unclaimedLiveAccounts = [...liveAccountNumbers].filter(acctNum =>
            !Object.values(ownerAccountMap).some(accts => accts.includes(acctNum))
        );
        if (unclaimedLiveAccounts.length > 0) {
            const botOwnerEmails = Object.keys(botsByOwner);
            // Assign orphan accounts to ALL bot owners who don't have a live connection yet
            const unconnectedBotOwners = botOwnerEmails.filter(e => !ownerHasLiveConn[e]);
            if (unconnectedBotOwners.length > 0) {
                for (const targetOwner of unconnectedBotOwners) {
                    if (!ownerAccountMap[targetOwner]) ownerAccountMap[targetOwner] = [];
                    if (!ownerAccountSet[targetOwner]) ownerAccountSet[targetOwner] = new Set();
                    for (const acctNum of unclaimedLiveAccounts) {
                        ownerAccountMap[targetOwner].push(acctNum);
                        ownerAccountSet[targetOwner].add(acctNum);
                    }
                    ownerHasLiveConn[targetOwner] = true;
                    console.log(`[generateBotSignals] Orphan fallback: assigned ${unclaimedLiveAccounts.join(', ')} to ${targetOwner}`);
                }
            } else {
                // All connected — assign to any single bot owner if only one exists
                const allUsers = await base44.asServiceRole.entities.User.list('-created_date', 50).catch(() => []);
                const adminEmails = new Set(allUsers.filter(u => u.role === 'admin').map(u => u.email));
                const adminBotOwners = botOwnerEmails.filter(e => adminEmails.has(e));
                const targetOwner = adminBotOwners.length === 1 ? adminBotOwners[0] : (botOwnerEmails.length === 1 ? botOwnerEmails[0] : null);
                if (targetOwner) {
                    if (!ownerAccountMap[targetOwner]) ownerAccountMap[targetOwner] = [];
                    for (const acctNum of unclaimedLiveAccounts) {
                        ownerAccountMap[targetOwner].push(acctNum);
                        if (!ownerAccountSet[targetOwner]) ownerAccountSet[targetOwner] = new Set();
                        ownerAccountSet[targetOwner].add(acctNum);
                    }
                    ownerHasLiveConn[targetOwner] = true;
                    console.log(`[generateBotSignals] Orphan fallback: assigned ${unclaimedLiveAccounts.join(', ')} to ${targetOwner}`);
                } else {
                    console.log(`[generateBotSignals] Multiple bot owners with no clear admin — skipping orphan fallback`);
                }
            }
        }

        // Collect all unique pairs across ALL bots that have a live price
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

                PRICE_ACTION: `You are an elite pure price action forex trader operating at institutional level. No lagging indicators — only raw price structure, order flow, and market geometry.

Current Prices: ${priceContext}
Analysis time: ${now}

For EACH pair, analyze across D1 (bias) → H4 (structure) → H1 (entry trigger) using the following framework:

1. HIGHER TIMEFRAME BIAS (D1):
   - Determine the dominant trend direction from D1 first — this governs ALL entries
   - Identify D1 key swing highs/lows, major support/resistance zones
   - Only take trades aligned with D1 bias (counter-trend only on strong D1 reversals)

2. MARKET STRUCTURE (H4 + H1):
   - Break of Structure (BOS): price breaks a previous significant high (bullish BOS) or low (bearish BOS) → confirms trend continuation
   - Change of Character (CHoCH): price breaks the most recent swing low in an uptrend or swing high in a downtrend → potential reversal signal
   - Higher Highs / Higher Lows = uptrend; Lower Highs / Lower Lows = downtrend; equal structure = ranging

3. SUPPLY & DEMAND ZONES (institutional order flow):
   - Supply zone: area where price previously dropped sharply from (unfilled sell orders above)
   - Demand zone: area where price previously rallied from sharply (unfilled buy orders below)
   - Strongest zones = those created by a strong impulsive move away from the level
   - Price returning to these zones = high probability reversal area

4. LIQUIDITY CONCEPTS:
   - Liquidity sweep / stop hunt: price briefly breaks above a previous high (takes buy-stop liquidity) then reverses down = SELL signal; breaks below a previous low then reverses up = BUY signal
   - Equal highs/lows = liquidity pools — price is drawn to sweep these before reversing
   - Previous session highs/lows (London, NY) act as key liquidity targets

5. PRICE ACTION TRIGGERS (at key levels only):
   - Pin Bar / Hammer / Shooting Star: long wick rejection of a key level
   - Bullish / Bearish Engulfing candle: full body engulf of previous candle at structure
   - Inside Bar breakout: consolidation followed by directional breakout at key level
   - Trendline break & retest: price breaks trendline then pulls back to retest it as new support/resistance
   - Order Block: last bearish candle before a bullish impulse (bullish OB) or last bullish candle before a bearish impulse (bearish OB) — price returning to these is high probability

6. FIBONACCI CONFLUENCE:
   - 50% and 61.8% retracement of the most recent significant swing aligns with key structure = highest probability entry zone
   - 78.6% retracement = deep retracement but still valid in strong trends

7. FAIR VALUE GAPS (FVG / Imbalance):
   - Three-candle imbalance where candle 1 and candle 3 wicks don't overlap — price is drawn back to fill these gaps
   - FVG inside a demand/supply zone = extremely high probability confluence

8. SESSION TIMING:
   - London open (07:00-09:00 UTC): highest probability breakouts and reversals
   - NY open (13:00-15:00 UTC): second highest probability window
   - Asian session (00:00-07:00 UTC): range-building, avoid breakout signals
   - Avoid signals 30 minutes before/after major news events

SIGNAL REQUIREMENTS (ALL must be met):
- D1 bias aligns with trade direction
- Price at a key level (supply/demand zone, S/R, OB, or FVG)
- At least ONE structural confirmation: BOS, CHoCH, or liquidity sweep
- At least ONE price action trigger candle confirmed (not anticipated)
- Minimum Risk:Reward of 1:2 (TP must be at least 2x the SL distance)
- Active or upcoming high-liquidity session preferred

Only signal BUY or SELL when ALL requirements are met. Otherwise NEUTRAL. Minimum confidence 75%.`,

                PATTERN_TRADING: `You are an expert chart pattern recognition analyst specialising in high-probability pattern setups.

Current Prices: ${priceContext}
Analysis time: ${now}

For EACH pair, scan H1 and H4 timeframes for ALL of the following patterns:

REVERSAL PATTERNS (against the prevailing trend):
- Head & Shoulders (3 peaks, middle highest) → SELL on neckline break
- Inverse Head & Shoulders (3 troughs, middle lowest) → BUY on neckline break
- Double Top (two peaks at similar price) → SELL on support break
- Double Bottom (two troughs at similar price) → BUY on resistance break
- Triple Top (three peaks at resistance) → SELL on confirmed breakdown
- Triple Bottom (three troughs at support) → BUY on confirmed breakout
- Rising Wedge (converging upward trendlines) → SELL (bearish reversal or continuation)
- Falling Wedge (converging downward trendlines) → BUY (bullish reversal or continuation)
- Rounding Bottom / Cup (gradual U-shape accumulation) → BUY on breakout above rim
- Cup and Handle (cup followed by shallow handle consolidation) → BUY on handle breakout
- Rounding Top (gradual arc distribution) → SELL on breakdown below rim

CONTINUATION PATTERNS (with the prevailing trend):
- Bull Flag (sharp rally then tight downward channel) → BUY on upper boundary break
- Bear Flag (sharp drop then tight upward channel) → SELL on lower boundary break
- Bull Pennant (rally then symmetrical triangle) → BUY on breakout
- Bear Pennant (drop then symmetrical triangle) → SELL on breakdown
- Ascending Triangle (flat resistance, rising support) → BUY on resistance breakout
- Descending Triangle (flat support, falling resistance) → SELL on support breakdown
- Symmetrical Triangle (converging trendlines, direction from prevailing trend) → signal in trend direction
- Rectangle / Trading Range (horizontal support & resistance) → signal on breakout direction
- Rising Channel (parallel upward trendlines) → BUY on lower channel touch, SELL on upper
- Falling Channel (parallel downward trendlines) → SELL on upper channel touch, BUY on lower

CONFIRMATION RULES (all must apply before signalling):
1. Pattern must be fully formed — no anticipating incomplete patterns
2. Breakout candle must CLOSE beyond the pattern boundary (no wicks only)
3. Measured move target must give at least 1:2 risk-reward
4. Pattern must align with higher timeframe (H4/D1) trend or be a major reversal with volume confirmation
5. Avoid patterns at very tight consolidations (< 30 pips range) — low reliability

For each pair output: the detected pattern name, signal direction, confidence score (based on pattern clarity, breakout strength, and trend alignment), and a brief reason.

Only signal BUY or SELL on confirmed pattern breakouts. Otherwise NEUTRAL. Minimum confidence 75%.`,

                CANDLESTICK: `You are an elite candlestick pattern analyst and price action forex specialist. You read market sentiment through candle formations with surgical precision.

Current Prices: ${priceContext}
Analysis time: ${now}

For EACH pair, analyze across D1 (bias) → H4 (structure) → H1/M30 (pattern trigger):

1. HIGHER TIMEFRAME BIAS (D1/H4 first — mandatory):
   - Determine D1 trend direction before analyzing any pattern
   - Only take BULLISH candlestick patterns in a D1 uptrend; BEARISH patterns in a D1 downtrend
   - Counter-trend patterns only valid at major D1 support/resistance with very high confluence

2. SINGLE CANDLE PATTERNS (at key levels only):
   BULLISH signals: Hammer (small body, long lower wick at support), Dragonfly Doji (long lower wick, no upper wick), Inverted Hammer (after downtrend, long upper wick), Bullish Belt Hold (strong bullish open, no lower wick), Bullish Marubozu (full body, no wicks — strong momentum)
   BEARISH signals: Shooting Star (small body, long upper wick at resistance), Gravestone Doji (long upper wick, no lower wick), Hanging Man (looks like hammer but at top of uptrend), Bearish Belt Hold (strong bearish open, no upper wick), Bearish Marubozu (full body bearish — strong momentum)
   NEUTRAL/context candles: Spinning Top (small body, equal wicks — indecision), Long-legged Doji (very long equal wicks — major indecision at key level), Standard Doji (open = close — indecision, powerful at extremes)

3. MULTI-CANDLE PATTERNS (stronger signals):
   BULLISH: Bullish Engulfing (large bullish candle fully engulfs prior bearish), Morning Star (bearish + doji/small + strong bullish), Three White Soldiers (3 consecutive strong bullish candles), Bullish Harami (small bullish inside large bearish — reversal warning), Piercing Line (bearish candle followed by bullish closing above 50% of prior), Tweezer Bottom (two candles with equal lows at support), Three Inside Up (harami + confirmation close above), Bullish Abandoned Baby (gap doji between bearish and bullish — rare but very powerful), Rising Three Methods (bullish continuation — strong candle, 3 small pullbacks, strong close)
   BEARISH: Bearish Engulfing (large bearish fully engulfs prior bullish), Evening Star (bullish + doji/small + strong bearish), Three Black Crows (3 consecutive strong bearish candles), Bearish Harami (small bearish inside large bullish), Dark Cloud Cover (bullish candle followed by bearish closing below 50% of prior), Tweezer Top (two candles with equal highs at resistance), Three Inside Down (harami + confirmation close below), Bearish Abandoned Baby (gap doji between bullish and bearish — very powerful reversal), Falling Three Methods (bearish continuation)

4. PATTERN LOCATION (critical — pattern means nothing without context):
   Patterns are only valid at:
   - Key horizontal support/resistance levels
   - Swing highs (for bearish patterns) or swing lows (for bullish patterns)
   - Fibonacci 38.2%, 50%, 61.8% retracement zones
   - Dynamic support/resistance (trendlines, moving average areas)
   - Order blocks (last opposing candle before a strong impulse move)
   - Previous session highs/lows (London/NY open/close levels)
   - Round number psychological levels

5. CANDLE QUALITY SCORING:
   - Body-to-wick ratio: larger body relative to wicks = stronger signal
   - For reversal patterns: wick should be at least 2x the body size (Pin Bar rule)
   - Engulfing candles: the engulfing candle should be noticeably larger than the engulfed candle
   - Volume confirmation: high-volume pattern candle = significantly stronger signal
   - Gap confirmation: patterns with gaps (especially Abandoned Baby) are extremely powerful

6. CONFIRMATION RULES (mandatory before signalling):
   - The pattern candle must be CLOSED — never signal on an incomplete candle
   - The next candle must show initial confirmation in signal direction
   - Pattern must align with D1/H4 trend bias
   - Avoid patterns forming during very low liquidity (22:00-00:00 UTC)

7. SESSION TIMING (dramatically affects pattern reliability):
   - London open (07:00-09:00 UTC): HIGHEST reliability — institutional players active, patterns at this time carry 2x weight
   - NY open (13:00-15:00 UTC): Second highest — strong trend continuation or reversal patterns
   - Asian session (00:00-07:00 UTC): Lower reliability for breakout patterns, better for range patterns (Doji, Harami)
   - London close (16:00-17:00 UTC): Watch for reversal patterns as positions close

SIGNAL REQUIREMENTS (ALL must be met):
- D1/H4 trend bias aligns with pattern direction
- Pattern forms at a significant key level (not in mid-range)
- Pattern candle is fully closed and confirmed
- Minimum Risk:Reward of 1:2 (TP at next key level, SL beyond pattern extreme)
- Active or upcoming high-liquidity session preferred

Only signal BUY or SELL when ALL requirements are satisfied. Otherwise NEUTRAL. Minimum confidence 75%.`,

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

                GOLD_XAUUSD: `You are an elite XAUUSD (Gold) specialist trader with deep expertise in gold market dynamics. You ONLY analyze Gold/XAUUSD.

Current Gold Price: ${priceContext}
Analysis time: ${now}

Gold is highly sensitive to: USD strength/weakness, geopolitical risk, inflation expectations, bond yields, and session-specific liquidity (Asian/London/NY).

Analyze XAUUSD across M15 and H1 timeframes using ALL of the following gold-specific indicators:

1. TREND & STRUCTURE:
   - EMA 20, 50, 200 alignment on H1 (above all EMAs = strong bullish, below all = strong bearish)
   - Market structure: Higher Highs/Higher Lows (uptrend) vs Lower Highs/Lower Lows (downtrend)
   - Key daily/weekly pivot levels (Round numbers like 3200, 3250, 3300 act as major support/resistance)
   - Trendline breaks and channel boundaries

2. MOMENTUM INDICATORS:
   - RSI(14) on M15 and H1: >70 = overbought (SELL bias), <30 = oversold (BUY bias), divergence signals
   - MACD(12,26,9): Histogram direction and signal line crossovers on H1
   - Stochastic(5,3,3): Oversold <20 (BUY) / Overbought >80 (SELL) on M15 for entry timing
   - CCI(20): Extremes beyond +100 / -100 indicate strong momentum continuation or exhaustion

3. VOLATILITY & ATR:
   - Gold ATR is typically $15-40/oz on H1 — use this to size SL/TP appropriately
   - Bollinger Bands(20,2): Price at upper band = potential short, lower band = potential long; squeeze = breakout incoming
   - Average True Range confirms if current move has enough momentum to reach target

4. CANDLESTICK PATTERNS AT KEY LEVELS:
   - Pin bars / hammer / shooting star rejecting major levels → high probability reversal
   - Bullish/bearish engulfing at session open levels
   - Inside bars consolidation followed by breakout direction

5. CHART PATTERNS:
   - Bull/Bear flags on H1 after strong moves (gold makes fast momentum runs)
   - Double tops/bottoms at psychological levels
   - Ascending/descending triangles near key levels

6. SESSION TIMING ANALYSIS (critical for gold):
   - Asian session (00:00-07:00 UTC): Usually tight ranges, set support/resistance for London
   - London open (07:00-09:00 UTC): HIGH volatility, often sets direction for the day — strong breakout signals
   - NY open (13:00-15:00 UTC): Second high-volatility window, often reversal or trend continuation
   - London close (16:00-17:00 UTC): Potential reversals as positions close
   - Avoid signals during very low liquidity (22:00-00:00 UTC)

7. CONFLUENCE REQUIREMENTS (must have at least 4):
   - Higher timeframe trend alignment (H1 EMA direction)
   - RSI supports the signal direction (not in opposing extreme zone)
   - MACD histogram confirms momentum
   - Price at or near a key level (support/resistance, round number, pivot)
   - Candlestick confirmation candle in signal direction
   - Active or upcoming high-liquidity session

Only signal BUY or SELL when 4+ confluence factors strongly align. Otherwise output NEUTRAL.
Minimum confidence threshold: 80%. Gold moves fast — precision over frequency.

Also provide:
- rsi: current RSI value (0-100)
- ema_trend: "BULLISH" / "BEARISH" / "MIXED"
- momentum: "STRONG" / "MODERATE" / "WEAK" / "DIVERGING"
- reason: detailed explanation including which session, key level, and confluences triggered the signal`,
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

        // Process each user's bots in isolation
        const allSignalsToCreate = [];

        for (const [ownerEmail, ownerBots] of Object.entries(botsByOwner)) {
            if (!ownerHasLiveConn[ownerEmail]) {
                console.log(`[generateBotSignals] No live connection for ${ownerEmail} — skipping`);
                continue;
            }

            const acctSet = ownerAccountSet[ownerEmail] || new Set();
            const userOpenTrades = openTrades.filter(t => acctSet.has(t.owner_email));

            const userPendingSignals = [
                ...pendingSignals.filter(s => acctSet.has(s.owner_email)),
                ...activeSignals.filter(s => acctSet.has(s.owner_email)),
            ];

            // Filter out paused accounts
            const activeAcctNums = [...acctSet].filter(acctNum => {
                const risk = getRiskForAccount(acctNum);
                if (risk.is_trading_paused === true) {
                    console.log(`[generateBotSignals] Trading paused for account ${acctNum} — skipping this account only`);
                    return false;
                }
                return true;
            });

            if (activeAcctNums.length === 0) {
                console.log(`[generateBotSignals] All accounts paused for ${ownerEmail} — skipping`);
                continue;
            }

            for (const bot of ownerBots) {
                // Trading hours check (UTC)
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
                        console.log(`[generateBotSignals] Bot "${bot.name}" outside trading hours (${bot.trading_start_time}–${bot.trading_end_time} UTC, now ${nowUtc.getUTCHours()}:${String(nowUtc.getUTCMinutes()).padStart(2,'0')} UTC) — skipping`);
                        continue;
                    }
                }

                const maxOpen = bot.max_open_trades || 15;
                // Only skip this bot if ALL active accounts are already at capacity
                const allAccountsAtCapacity = activeAcctNums.every(acctNum => {
                    const acctCount = openTrades.filter(t => t.owner_email === acctNum).length;
                    return acctCount >= maxOpen;
                });
                if (allAccountsAtCapacity) {
                    const countsByAcct = activeAcctNums.map(a => `${a}:${openTrades.filter(t => t.owner_email === a).length}`).join(', ');
                    console.log(`[Skip] ${bot.name}: all accounts at max_open_trades (${maxOpen}) — [${countsByAcct}]`);
                    continue;
                }

                const minConf = bot.min_confidence || 75;
                const maxPerPair = bot.max_trades_per_pair || 1;

                for (const pair of (bot.pairs || [])) {
                    // Break if ALL accounts are full (including queued signals)
                    const allAcctsFull = activeAcctNums.every(acctNum => {
                        const acctOpen = openTrades.filter(t => t.owner_email === acctNum).length;
                        const acctQueued = allSignalsToCreate.filter(s => s.owner_email === acctNum).length;
                        return acctOpen + acctQueued >= maxOpen;
                    });
                    if (allAcctsFull) break;

                    const pairRaw = pair.replace('/', '');
                    const currentPrice = priceMap[pair] || priceMap[pairRaw];
                    if (!currentPrice) { console.log(`[Skip] ${bot.name} ${pair}: no price`); continue; }

                    const strategyMap = strategyAiMaps[bot.strategy_type || 'AI_PREDICTIVE'] || {};
                    const analysis = strategyMap[pairRaw];
                    if (!analysis) { console.log(`[Skip] ${bot.name} ${pair}: no AI analysis`); continue; }
                    if (analysis.type === 'NEUTRAL') continue;
                    const normalizedConf = (analysis.confidence || 0) <= 1 ? (analysis.confidence || 0) * 100 : (analysis.confidence || 0);
                    if (normalizedConf < minConf) { console.log(`[Skip] ${bot.name} ${pair}: conf ${normalizedConf} < ${minConf}`); continue; }

                    // Calculate SL/TP
                    let slPips = bot.stop_loss_pips || 30;
                    let tpPips = bot.take_profit_pips || 60;

                    // Gold (XAUUSD) uses dollar-based SL/TP, not pips
                    const isGold = pairRaw === 'XAUUSD' || bot.strategy_type === 'GOLD_XAUUSD';

                    // Pre-compute SL/TP for gold (dollar-based, not pips)
                    let goldSl = null, goldTp = null;
                    if (isGold) {
                        const goldAtr = currentPrice * 0.007; // ~0.7% of gold price ≈ typical H1 ATR
                        goldSl = analysis.type === 'BUY'
                            ? currentPrice - (goldAtr * (bot.atr_multiplier_sl || 1.5))
                            : currentPrice + (goldAtr * (bot.atr_multiplier_sl || 1.5));
                        goldTp = analysis.type === 'BUY'
                            ? currentPrice + (goldAtr * (bot.atr_multiplier_tp || 3.0))
                            : currentPrice - (goldAtr * (bot.atr_multiplier_tp || 3.0));
                    }

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

                    console.log(`[Signal] ${ownerEmail} | ${bot.name} -> ${analysis.type} ${pair} @ ${currentPrice.toFixed(5)} (${analysis.confidence}%) → ${activeAcctNums.length} active account(s)`);

                    for (const acctNum of activeAcctNums) {
                        // Per-account max trades check
                        const acctRisk = getRiskForAccount(acctNum);
                        const acctMaxTrades = acctRisk.max_concurrent_trades || 100;
                        const acctOpenCount = openTrades.filter(t => t.owner_email === acctNum).length;
                        const acctPendingCount = allSignalsToCreate.filter(s => s.owner_email === acctNum).length;
                        if (acctOpenCount + acctPendingCount >= acctMaxTrades) {
                            console.log(`[Skip] ${acctNum} at max concurrent trades (${acctOpenCount + acctPendingCount}/${acctMaxTrades})`);
                            continue;
                        }
                        // FIX: Per-account, per-pair check (was previously aggregate across all accounts, blocking valid trades)
                        const acctPairOpen = openTrades.filter(t => t.owner_email === acctNum && (t.pair || '').replace('/', '') === pairRaw).length;
                        const acctPairPending = userPendingSignals.filter(s => s.owner_email === acctNum && (s.pair || '').replace('/', '') === pairRaw).length;
                        const acctPairQueued = allSignalsToCreate.filter(s => s.owner_email === acctNum && (s.pair || '').replace('/', '') === pairRaw).length;
                        if (acctPairOpen + acctPairPending + acctPairQueued >= maxPerPair) {
                            console.log(`[Skip] ${bot.name} ${pair} on ${acctNum}: at max_trades_per_pair (${acctPairOpen + acctPairPending + acctPairQueued}/${maxPerPair})`);
                            continue;
                        }

                        const finalSl = isGold ? parseFloat(goldSl.toFixed(2)) : parseFloat(sl.toFixed(5));
                        const finalTp = isGold ? parseFloat(goldTp.toFixed(2)) : parseFloat(tp.toFixed(5));
                        console.log(`[generateBotSignals] ${pair} ${analysis.type} @ ${currentPrice} | SL: ${finalSl} | TP: ${finalTp}${isGold ? ' [GOLD]' : ''}`);
                        allSignalsToCreate.push({
                            pair,
                            type: analysis.type,
                            entry_price: currentPrice,
                            stop_loss: finalSl,
                            take_profit: finalTp,
                            confidence: normalizedConf,
                            lot_size: bot.lot_size || 0.01,
                            strategy: bot.strategy_type || 'AUTO',
                            bot_id: bot.id,
                            status: 'PENDING',
                            result_pnl: 0,
                            owner_email: acctNum,
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