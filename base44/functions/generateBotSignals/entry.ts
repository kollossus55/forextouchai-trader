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
                AI_PREDICTIVE: `You are an elite AI-powered institutional forex analyst combining predictive multi-timeframe analysis with machine-learning-style pattern recognition, statistical confluence scoring, and adaptive market regime detection.

Current Prices: ${priceContext}
Analysis time: ${now}

For EACH pair, execute a full predictive analysis pipeline: D1 (regime detection) → H4 (structure mapping) → H1 (signal confirmation) → M15 (entry precision):

═══════════════════════════════════════
PHASE 1: MARKET REGIME DETECTION (D1)
═══════════════════════════════════════
Before any analysis, classify the current market regime — this governs WHICH strategies to apply:

TRENDING REGIME: Higher Highs + Higher Lows (uptrend) OR Lower Highs + Lower Lows (downtrend) on D1
→ Favour momentum and continuation strategies; breakout signals carry more weight
→ Pullback entries to EMA/Fibonacci levels are the highest-probability setups

RANGING REGIME: Price oscillating between horizontal support and resistance; no clear directional structure on D1
→ Favour mean-reversion strategies; buy at range lows, sell at range highs
→ Breakout signals are lower confidence until confirmed with significant volume

TRANSITIONAL REGIME: Recent Break of Structure (BOS) or Change of Character (CHoCH) on D1 — trend may be changing
→ Highest caution — require extra confluence before signalling
→ Watch for CHoCH → pullback → BOS sequence = high-confidence new trend signal

VOLATILE/NEWS-DRIVEN REGIME: Unusually large candles, gaps, rapid directional changes
→ Reduce signal confidence; wait for structure to stabilise before committing

═══════════════════════════════════════
PHASE 2: STRUCTURAL MAPPING (H4 + D1)
═══════════════════════════════════════
Map the full price landscape before seeking entries:

MARKET STRUCTURE:
- BOS (Break of Structure): price breaks a significant prior swing high/low → confirms trend continuation
- CHoCH (Change of Character): price breaks the most recent opposing swing → potential trend reversal warning
- Swing highs and swing lows create the roadmap — trade WITH the sequence, not against it
- Higher Highs/Higher Lows = bullish structure; Lower Highs/Lower Lows = bearish structure

INSTITUTIONAL ZONES:
- Order Blocks (OB): last opposing candle before a strong impulsive move — price returning to these is extremely high probability
  * Bullish OB = last bearish candle before a bullish impulse (unfilled buy orders)
  * Bearish OB = last bullish candle before a bearish impulse (unfilled sell orders)
- Supply Zones: price areas where strong selling previously occurred (institutional sell orders resting above)
- Demand Zones: price areas where strong buying previously occurred (institutional buy orders resting below)
- Fair Value Gaps (FVG): three-candle imbalance where candles 1 and 3 wicks don't overlap — price magnetically fills these gaps
  * Bullish FVG: gap between candle 1 high and candle 3 low in a bullish move
  * Bearish FVG: gap between candle 1 low and candle 3 high in a bearish move
  * FVG inside an OB or S&D zone = extremely powerful confluence zone

LIQUIDITY MAPPING:
- Equal Highs: double/triple tops on H4/D1 = liquidity resting above (buy-stops) — price will be drawn to sweep these
- Equal Lows: double/triple bottoms = sell-stop liquidity resting below — price will sweep before reversing
- Previous session highs/lows (London, NY): key liquidity targets
- Round number psychological levels (1.1000, 1.0500, 150.00): massive liquidity clusters
- Liquidity Sweep: price briefly breaks above EQH or below EQL then reverses sharply = institutional stop hunt = high-confidence reversal signal

═══════════════════════════════════════
PHASE 3: MULTI-INDICATOR CONFLUENCE (H1 + H4)
═══════════════════════════════════════
Apply indicators as CONFIRMATION tools, never as primary signals:

TREND INDICATORS:
- EMA Stack (20/50/200 on H1 and H4):
  * All aligned (price > EMA20 > EMA50 > EMA200) = strong bullish trend
  * Inverse alignment = strong bearish trend
  * Tangled/crossing EMAs = ranging market, reduce signal confidence
  * EMA 50/200 Golden Cross (50 crosses above 200) on H4 = major bullish shift
  * EMA 50/200 Death Cross = major bearish shift
- Ichimoku Cloud on H4 (optional context):
  * Price above cloud = bullish bias; below cloud = bearish; inside cloud = consolidation

MOMENTUM INDICATORS:
- RSI(14) on H1 and H4:
  * >70 = overbought (bearish bias, especially with bearish divergence at resistance)
  * <30 = oversold (bullish bias, especially with bullish divergence at support)
  * RSI 50 level: crossing above = momentum shifting bullish; crossing below = bearish
  * BULLISH DIVERGENCE (price LL, RSI HL): price is losing bearish momentum → reversal signal
  * BEARISH DIVERGENCE (price HH, RSI LH): price is losing bullish momentum → reversal signal
  * HIDDEN BULLISH DIVERGENCE (price HL, RSI LL): continuation signal in uptrend
  * HIDDEN BEARISH DIVERGENCE (price LH, RSI HH): continuation signal in downtrend
- MACD(12,26,9) on H1:
  * Histogram growing above zero = accelerating bullish momentum
  * Histogram growing below zero = accelerating bearish momentum
  * Signal line crossover above zero = BUY confirmation
  * Signal line crossover below zero = SELL confirmation
  * MACD zero-line crossover = strongest momentum shift signal
  * Divergence between MACD histogram and price = early reversal warning
- Stochastic(5,3,3) on M15/H1 for entry timing:
  * <20 crossing up from oversold = BUY entry timing signal
  * >80 crossing down from overbought = SELL entry timing signal
  * Stochastic bullish/bearish divergence with price = reversal warning
- CCI(20): extreme readings beyond +100/-100 = momentum continuation; returning from extremes = exhaustion

VOLATILITY INDICATORS:
- Bollinger Bands(20,2) on H1:
  * Price at upper band with bearish reversal candle = SELL (overextension)
  * Price at lower band with bullish reversal candle = BUY (oversold)
  * BB Squeeze (bands very tight, low volatility) = explosive directional breakout imminent — prepare
  * BB Expansion (bands widening rapidly) = momentum continuation signal
  * Price walking the upper band = strong uptrend continuation; lower band = strong downtrend
- ATR(14): high ATR = volatile market (wider SL needed); low ATR = compressed range (tight SL, tight range trading)

═══════════════════════════════════════
PHASE 4: CHART PATTERN RECOGNITION (H4 + H1)
═══════════════════════════════════════
REVERSAL PATTERNS (at major structural levels):
- Head & Shoulders / Inverse H&S → neckline break + retest = SELL / BUY; measured move = head-to-neckline distance
- Double / Triple Top or Bottom → peak/valley break; pattern height = measured move target
- Rising / Falling Wedge → trendline break (rising wedge = bearish; falling wedge = bullish)
- Cup and Handle → handle breakout above rim = BUY; measured move = cup depth
- Diamond Top / Bottom → boundary break = powerful reversal
- Island Reversal → gap isolation = extremely strong reversal signal
- Bump and Run → lead-in trendline break after parabolic run = reversal

CONTINUATION PATTERNS (in trend direction):
- Bull / Bear Flags and Pennants → flagpole breakout; measured move = flagpole length
- Ascending / Descending / Symmetrical Triangles → boundary break with pattern height target
- Rectangles / Trading Ranges → breakout in trend direction
- Channels → trade bounces; channel break = acceleration

PATTERN VALIDITY RULES:
- Pattern fully formed and CLOSED (never anticipate)
- Breakout candle must CLOSE beyond boundary (no wick-only breaks)
- Retest of broken boundary = highest probability entry (wait when possible)
- False/failed pattern reversal = strong signal in opposite direction

═══════════════════════════════════════
PHASE 5: CANDLESTICK CONFIRMATION (H1 + M30)
═══════════════════════════════════════
BULLISH signals at key levels: Hammer, Dragonfly Doji, Bullish Engulfing, Morning Star, Three White Soldiers, Bullish Marubozu, Tweezer Bottom, Piercing Line, Bullish Abandoned Baby
BEARISH signals at key levels: Shooting Star, Gravestone Doji, Bearish Engulfing, Evening Star, Three Black Crows, Bearish Marubozu, Tweezer Top, Dark Cloud Cover, Bearish Abandoned Baby
NEUTRAL/context: Spinning Top, Long-legged Doji, Standard Doji (powerful at extremes), Inside Bar (breakout determines direction)

CRITICAL RULES:
- Candlestick must form AT a key level (OB, FVG, S&D zone, S/R, Fibonacci) — mid-range candles are meaningless
- Pattern candle must be FULLY CLOSED — never signal on an in-progress candle
- Wick-to-body ratio: reversal wicks should be 2x+ the body size
- Engulfing: the engulfing candle must visibly exceed the prior candle's full range

═══════════════════════════════════════
PHASE 6: FIBONACCI PRECISION
═══════════════════════════════════════
- Identify the most recent significant swing on H4 or D1
- Key retracement levels: 23.6% (shallow), 38.2% (moderate), 50% (common), 61.8% (Golden Ratio — highest probability), 78.6% (deep but valid in strong trends)
- Price pulling back to 61.8% Fibonacci + confluence with OB/FVG/S&D zone = extremely high-probability entry
- Extension targets for TP: 127.2%, 161.8% (primary), 200%, 261.8% (extended)
- Fibonacci confluence: when a retracement level aligns with a structural level (OB, S/R, trendline) = precision entry zone

HARMONIC PATTERNS (Fibonacci-geometry based):
- ABCD: AB leg, BC retraces 61.8% of AB, CD = AB length → entry at D
- Gartley (XABCD): XA leg, B at 61.8% of XA, D at 78.6% of XA → reversal at D
- Bat: B at 38.2-50% of XA, D at 88.6% of XA → tight precise reversal
- Butterfly: D exceeds X (127.2-161.8% of XA) → catches extreme exhaustion moves
- Crab: D at 161.8% extension of XA → most extreme, catches major capitulation reversals

═══════════════════════════════════════
PHASE 7: SESSION TIMING & MACRO CONTEXT
═══════════════════════════════════════
SESSION TIMING (dramatically affects signal reliability):
- Asian session (00:00-07:00 UTC): Low volatility, range-building — identify setups forming, avoid new breakout entries
- London open (07:00-09:00 UTC): MAXIMUM WEIGHT — institutional orders flood the market, breakouts and reversals at key levels carry highest confidence; price often sweeps Asian highs/lows at London open before reversing
- NY open (13:00-15:00 UTC): Second highest — often confirms or rejects London direction; strong momentum continuation or reversal setups
- London/NY overlap (13:00-16:00 UTC): Peak global liquidity — most reliable signal window
- London close (16:00-17:00 UTC): Profit-taking reversals common; watch for counter-moves
- Dead zone (22:00-00:00 UTC): Minimum liquidity — NO new signals during this window
- Pre-news (30 min before major events): Reduce confidence or avoid; unpredictable slippage

CORRELATED PAIR AWARENESS:
- EUR/USD and GBP/USD typically correlated — opposing signals on both = lower individual confidence
- USD/JPY inversely correlated with EUR/USD — align signals with overall USD strength/weakness narrative
- AUD/USD, NZD/USD are commodity-correlated — check if risk-on/risk-off environment supports direction
- Gold (XAU/USD) inversely correlated with USD — USD strength = gold bearish, USD weakness = gold bullish

═══════════════════════════════════════
AI PREDICTIVE CONFLUENCE SCORING SYSTEM
═══════════════════════════════════════
Score each factor present (1 point each):
1. Market regime aligns with signal type (trending → momentum; ranging → mean-reversion) (+1)
2. D1 trend structure supports direction (BOS sequence or major level reversal) (+1)
3. Price in a high-probability zone (OB, FVG, S&D, Fibonacci 50-61.8%) (+1)
4. EMA stack aligned on H1 (+1)
5. RSI in supporting zone or showing divergence (+1)
6. MACD histogram/crossover confirms (+1)
7. Stochastic entry timing aligned (M15/H1) (+1)
8. Bollinger Band or ATR context supports (+1)
9. Chart pattern completed and confirmed (+1)
10. Candlestick confirmation at key level (+1)
11. Liquidity sweep or stop hunt precedes signal (+1)
12. Active high-liquidity session (London/NY open) (+1)
13. Fibonacci confluence at entry zone (+1)
14. Correlated pairs support the same direction (+1)

SCORE INTERPRETATION:
- 5-6: Minimum threshold — valid signal, standard confidence
- 7-8: High confidence — strong setup
- 9-10: Very high confidence — institutional-grade setup
- 11+: Exceptional — maximum confidence, size up

SIGNAL REQUIREMENTS (ALL must be met):
- D1 regime and trend structure MUST support the direction
- Price MUST be at a key structural zone (OB, FVG, S&D, Fibonacci, or major S/R)
- Minimum 5 confluence factors from the scoring system
- At least ONE closed candlestick confirmation at the key level
- Minimum Risk:Reward of 1:2 (SL below/above invalidation point; TP at next significant level)
- Active or approaching high-liquidity session strongly preferred
- No major news event within 30 minutes

Output BUY or SELL only when ALL requirements are satisfied. Otherwise NEUTRAL. Minimum confidence 75%. Higher confluence score = higher confidence value.`,

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

                SWING: `You are an elite institutional swing trader specialising in multi-day to multi-week forex moves. You operate exclusively on H4 and D1 timeframes to capture high-quality trend rides and major structural reversals with minimum 1:3 risk-to-reward.

Current Prices: ${priceContext}
Analysis time: ${now}

For EACH pair, execute a top-down swing analysis: W1 (macro context) → D1 (primary bias & structure) → H4 (entry zone & trigger):

═══════════════════════════════════════
STEP 1: WEEKLY & DAILY MACRO BIAS (W1 + D1)
═══════════════════════════════════════
- Identify the dominant multi-week trend from W1: price above/below W1 EMA 20 and 50 = macro bull/bear backdrop
- W1 key support/resistance levels = the most powerful levels on the chart — price respects these for weeks/months
- D1 trend structure: is price making Higher Highs + Higher Lows (uptrend), Lower Highs + Lower Lows (downtrend), or consolidating?
- D1 EMA alignment (20/50/200):
  * Price > EMA20 > EMA50 > EMA200 = strong bullish — only look for BUY setups on pullbacks
  * Price < EMA20 < EMA50 < EMA200 = strong bearish — only look for SELL setups on rallies
  * EMA Golden Cross (D1 EMA50 crossing above EMA200) = major bull signal; Death Cross = major bear signal
- D1 Break of Structure (BOS): D1 close above a prior significant swing high = bullish BOS (powerful buy signal); close below prior swing low = bearish BOS
- D1 Change of Character (CHoCH): first break of the opposing swing after a trend = early reversal; wait for pullback + confirmation before entering

═══════════════════════════════════════
STEP 2: KEY LEVEL IDENTIFICATION (D1 + H4)
═══════════════════════════════════════
Map all significant price levels — swing entries MUST come from these zones:

STRUCTURAL LEVELS:
- D1 swing highs and lows: the backbone of price structure; breakouts and rejections here define the trend
- W1 support/resistance: multi-month levels that act as major barriers
- Round number psychological levels (1.2000, 1.2500, etc.): massive liquidity pools

INSTITUTIONAL ORDER ZONES:
- Order Blocks (OB) on D1/H4: last bearish candle before a strong bullish impulse (bullish OB) or last bullish candle before a strong bearish impulse (bearish OB) — institutional unfilled orders cluster here; these are the highest-probability entry zones for swing trades
- Supply Zones (D1): areas where price previously reversed sharply downward — unfilled sell orders from institutions resting above
- Demand Zones (D1): areas where price previously reversed sharply upward — unfilled buy orders from institutions resting below
- Fair Value Gaps (FVG) on D1/H4: three-candle imbalance — price will be drawn back to fill these; FVG inside an OB = extremely high probability convergence zone

FIBONACCI RETRACEMENT ZONES (measure from most recent D1/W1 swing):
- 23.6%: shallow correction — valid only in very strong trending markets
- 38.2%: moderate pullback — strong continuation setup if supported by OB or EMA
- 50%: classic midpoint — most watched; excellent confluence level
- 61.8% (Golden Ratio): the highest-probability swing entry level — "the golden zone"; align with OB/FVG/S&D for maximum conviction
- 78.6%: deep correction — still valid in strong trends; represents final retest before continuation
- 88.6%: extreme deep pullback — valid for harmonic patterns (Bat, Crab)

DYNAMIC LEVELS:
- EMA 20, 50, 200 on D1 acting as dynamic support/resistance — price bouncing off these is a trend continuation signal
- Trendline support/resistance: connect at least 3 D1 swing points for a valid trendline; break + retest = high probability entry

═══════════════════════════════════════
STEP 3: MOMENTUM & INDICATOR ANALYSIS (D1 + H4)
═══════════════════════════════════════
- RSI(14) on D1 and H4:
  * MOST POWERFUL SWING SIGNAL: RSI divergence
    → Bullish divergence (price LL, RSI HL) at demand zone = classic swing BUY setup
    → Bearish divergence (price HH, RSI LH) at supply zone = classic swing SELL setup
    → Hidden bullish divergence (price HL, RSI LL) = powerful uptrend continuation signal
    → Hidden bearish divergence (price LH, RSI HH) = powerful downtrend continuation
  * RSI 30-40 zone in uptrend = oversold pullback → BUY opportunity
  * RSI 60-70 zone in downtrend = overbought rally → SELL opportunity
  * RSI 50 midline: bullish crossover = momentum turning up; bearish crossover = momentum turning down
- MACD(12,26,9) on D1:
  * Histogram turning from negative to positive = bullish momentum shift
  * Signal line bullish crossover above zero = BUY confirmation
  * Signal line bearish crossover below zero = SELL confirmation
  * MACD divergence with price = early reversal warning — one of the best swing signals
  * MACD zero-line cross = major momentum shift; the most reliable swing confirmation signal
- Stochastic(14,3,3) on H4 for entry timing:
  * Oversold <20 crossing upward = BUY entry timing in uptrend context
  * Overbought >80 crossing downward = SELL entry timing in downtrend context
  * Stochastic divergence with D1 price = powerful reversal signal
- ADX(14) on D1: above 25 = trending market (favour breakouts/continuations); below 20 = ranging (favour range-bound mean-reversion trades)
- Bollinger Bands(20,2) on D1:
  * Band squeeze (very tight bands) = major directional breakout incoming; prepare for swing trade
  * Price at outer band with reversal candle = overextension; counter-trend swing setup
  * Band expansion after squeeze = confirms new swing trend direction

═══════════════════════════════════════
STEP 4: CHART PATTERN RECOGNITION (D1 + H4)
═══════════════════════════════════════
SWING REVERSAL PATTERNS (form at major D1 levels):
- Head & Shoulders / Inverse H&S: neckline break + retest = highest-conviction swing reversal; measured move = H-to-neckline distance
- Double / Triple Top: two/three failed attempts at the same high → breakdown below valley = SELL swing; strong when combined with bearish RSI divergence
- Double / Triple Bottom: two/three failed tests of same low → breakout above peak = BUY swing; strong with bullish RSI divergence
- Rising / Falling Wedge: converging trendlines (rising wedge = distribution/bearish; falling wedge = accumulation/bullish); breakout on high-momentum candle
- Rounding Bottom (Saucer): slow gradual accumulation followed by rim breakout = powerful long-term swing BUY
- Cup and Handle: cup (rounding bottom) + handle (shallow pullback <50% of cup) + rim breakout = BUY; measured move = cup depth

SWING CONTINUATION PATTERNS (form as pullbacks within existing trends):
- Bull / Bear Flags: flagpole (strong impulse) + flag (pullback channel) → flag boundary breakout = continuation; flagpole length = measured move target
- Ascending / Descending Triangles: flat boundary + rising/falling opposite → breakout in trend direction
- Symmetrical Triangles: coiling energy → breakout direction = D1 trend direction; explosive measured move
- Rectangle / Consolidation Box: multi-touch horizontal range → breakout with strong candle = swing continuation

HARMONIC PATTERNS (Fibonacci-based precision entries):
- Gartley: B at 61.8% of XA, D at 78.6% → reversal at D point; highest probability harmonic
- Bat: B at 38.2-50%, D at 88.6% of XA → tight SL, high R:R
- Butterfly: D exceeds X at 127.2-161.8% of XA → catches exhaustion extremes
- ABCD: BC retraces 61.8% of AB, CD = AB → entry at D completion

═══════════════════════════════════════
STEP 5: CANDLESTICK CONFIRMATION (D1 + H4)
═══════════════════════════════════════
BULLISH swing confirmation at demand zones/OBs/Fibonacci: Bullish Engulfing (strong — body must exceed prior candle), Morning Star (3-candle reversal), Hammer / Dragonfly Doji (long lower wick 2x+ body), Three White Soldiers, Tweezer Bottom
BEARISH swing confirmation at supply zones/OBs/Fibonacci: Bearish Engulfing, Evening Star, Shooting Star / Gravestone Doji, Three Black Crows, Tweezer Top

SWING CANDLE RULES:
- D1 candlestick confirmation carries FAR more weight than H4 — a D1 bullish engulfing at a demand zone is an exceptional signal
- The confirmation candle must be FULLY CLOSED — never anticipate
- The wick of a pin bar/hammer must be at least 2x the body
- Engulfing candle must visibly and completely surpass the prior candle's range

═══════════════════════════════════════
STEP 6: RISK-TO-REWARD & ENTRY PRECISION
═══════════════════════════════════════
ENTRY TYPES (ranked by win rate):
1. RETEST ENTRY (highest win rate): wait for price to break a key level then pull back to retest it as new support/resistance; enter on rejection candle at the retest
2. ZONE ENTRY: enter when price enters a strong OB/FVG/S&D zone; use H4 candlestick confirmation as trigger
3. PATTERN BREAKOUT ENTRY: enter on confirmed breakout candle close beyond pattern boundary; wait for retest when possible

STOP LOSS PLACEMENT:
- Place SL beyond the structural invalidation point (below demand zone for BUY, above supply zone for SELL)
- SL beyond the pattern extreme for pattern-based entries
- SL beyond the Fibonacci 78.6% level for Fibonacci entries (beyond 88.6% for Bat)
- Never place SL at a round number — put it 5-10 pips beyond

TAKE PROFIT TARGETS:
- TP1: next significant D1 S/R level (minimum 1:2 R:R from entry)
- TP2: next D1 structural swing high/low (minimum 1:3 R:R — the swing trader's minimum)
- TP3: Fibonacci extension levels (127.2%, 161.8%) from the entry swing
- Minimum required R:R for swing trades: 1:3 (TP must be 3x the SL distance) — this is the gold standard

SWING TRADE DURATION CONTEXT:
- H4 pattern entries: typically 1-5 days holding period
- D1 pattern entries: typically 1-4 weeks holding period
- Avoid entering at the end of the week (Thursday/Friday) as positions face weekend gap risk

═══════════════════════════════════════
CONFLUENCE SCORING (swing-specific)
═══════════════════════════════════════
Score 1 point for each factor present:
1. W1/D1 macro trend supports direction (+1)
2. D1 Break of Structure confirms (+1)
3. Price at a high-quality zone (OB, FVG, S&D, Fibonacci 50-61.8%) (+1)
4. D1 EMA stack aligned (+1)
5. RSI divergence on D1 or H4 (+1)
6. MACD supports or diverges in signal direction (+1)
7. ADX confirms trending regime or Stochastic entry timing (+1)
8. Chart pattern (continuation or reversal) completed (+1)
9. D1 or H4 candlestick confirmation at key zone (+1)
10. Fibonacci level confluence at entry (+1)
11. W1 or D1 key level proximity (+1)
12. Harmonic pattern completion (+1)

MINIMUM SCORE: 4 out of 12 to signal (swing trades require fewer confirmations but each must be high-quality)
Score 6+ = high confidence; Score 8+ = exceptional swing setup

SIGNAL REQUIREMENTS (ALL must be met):
- W1/D1 trend bias MUST support direction (or strong reversal evidence at major D1 level)
- Entry MUST come from a defined high-probability zone (OB, S&D, Fibonacci 50-78.6%, or key structural level)
- At least ONE closed D1 or H4 candlestick confirmation at the entry zone
- RSI or MACD divergence present (highly preferred — strongest swing signal)
- Minimum 1:3 Risk:Reward (TP must be 3x the SL distance)
- Chart pattern confirmation preferred (not required if OB + divergence + candlestick align)

Signal BUY or SELL only when ALL requirements are satisfied. Otherwise NEUTRAL. Minimum confidence 75%.`,

                DAY_TRADING: `You are an elite intraday forex day trader operating with institutional precision. All trades open and close within the same trading day. You exploit session-specific volatility windows, intraday market structure, and momentum shifts on H1 and M30 timeframes.

Current Prices: ${priceContext}
Analysis time: ${now}

For EACH pair, execute a top-down intraday analysis: D1 (directional bias only) → H4 (intraday structure) → H1 (setup identification) → M30 (entry trigger):

═══════════════════════════════════════
STEP 1: DAILY DIRECTIONAL BIAS (D1 — read only, don't trade on)
═══════════════════════════════════════
- Establish D1 trend direction before anything else — this is the ONLY direction to trade intraday
- D1 EMA 50/200: price above both = bullish day-trading bias; below both = bearish bias; between = neutral/avoid
- D1 key levels: identify the nearest D1 support (for BUY bias) and resistance (for SELL bias) — these are the day's boundary targets
- Only trade AGAINST D1 bias if price is at a major D1 reversal zone with very strong intraday confluence (5+ factors)
- If D1 is strongly ranging (no clear structure): expect range-bound intraday moves; trade range boundaries only

═══════════════════════════════════════
STEP 2: INTRADAY STRUCTURE MAPPING (H4 + H1)
═══════════════════════════════════════
Map the intraday price landscape — entries must come from identified zones:

INTRADAY MARKET STRUCTURE:
- H1 Break of Structure (BOS): H1 close above prior H1 swing high = intraday bullish BOS (momentum signal); below prior swing low = bearish BOS
- H1 Change of Character (CHoCH): break of the most recent H1 opposing swing = potential intraday reversal
- H1 Higher Highs/Higher Lows = intraday uptrend; H1 Lower Highs/Lower Lows = intraday downtrend

INTRADAY INSTITUTIONAL ZONES:
- H1/H4 Order Blocks (OB): last opposing candle before a strong H1 impulse — price returning to OBs during the day is the #1 intraday entry signal
- H1 Fair Value Gaps (FVG): three-candle imbalance on H1 — price fills these during the same session; powerful intraday magnets
- M30 Supply/Demand Zones: sharp M30 reversals mark institutional order clusters — short-term but highly relevant intraday
- Previous day's high/low (PDH/PDL): critical intraday levels — price frequently tests PDH or PDL before reversing; ideal intraday entry points
- Asian session high/low: price sweeps Asian range at London open — key reversal zone for the day's first trade

SESSION-SPECIFIC KEY LEVELS (update for each session):
- London open range (first 15-30 min): identify high and low of London open candles — breakout of this range = day's directional signal
- NY open range (first 15-30 min): identifies second momentum wave of the day
- Round numbers (e.g. 1.0850, 1.0900): intraday price magnets — watch for rejections and breakouts here

═══════════════════════════════════════
STEP 3: SESSION TIMING ANALYSIS (CRITICAL for day trading)
═══════════════════════════════════════
Session timing is the MOST IMPORTANT factor for day trading — only trade in high-liquidity windows:

LONDON SESSION (07:00-16:00 UTC) — PRIMARY TRADING WINDOW:
- London open (07:00-09:00 UTC): THE highest-probability intraday window
  * Price sweeps Asian session highs/lows at London open = stop hunt + reversal setup (very high probability)
  * Breakout of Asian range at London open in D1 bias direction = STRONG intraday signal
  * First significant H1 candle close after 07:00 UTC sets the tone for the morning
  * Best patterns: London open liquidity grab → reversal into D1 bias direction
- Mid-London (09:00-12:00 UTC): trending moves develop; trade pullbacks and continuations within the H1 trend
- Pre-NY (12:00-13:00 UTC): often consolidation ahead of NY open; reduce new entries, manage open trades

NEW YORK SESSION (13:00-21:00 UTC) — SECONDARY TRADING WINDOW:
- NY open (13:00-15:00 UTC): second-highest probability window
  * Often confirms London direction (continuation) OR reverses London move (reversal into true D1 bias)
  * NFP, CPI, Fed news = extreme volatility at NY open — avoid signalling 30 min before/after
  * Best setups: NY open breaks above/below London session high/low → continuation trade
- Mid-NY (15:00-18:00 UTC): London/NY overlap produces most liquid moves; trend trades and breakouts very reliable
- Late NY (18:00-21:00 UTC): volume declining; avoid new entries unless very strong setup

ASIAN SESSION (22:00-07:00 UTC) — AVOID NEW BREAKOUT ENTRIES:
- Range-building phase; tight consolidation; false breakouts common
- Use to identify Asian highs/lows that London will target at open
- Only valid trade: range boundary rejections in clearly defined Asian range

DEAD ZONE (21:00-23:00 UTC): Absolute minimum liquidity — NO new signals whatsoever

═══════════════════════════════════════
STEP 4: INDICATOR CONFLUENCE (H1 + M30)
═══════════════════════════════════════
TREND & MOMENTUM:
- EMA Stack on H1 (9/21/50):
  * Price > EMA9 > EMA21 > EMA50 = strong intraday bullish — only look for BUY entries
  * Price < EMA9 < EMA21 < EMA50 = strong intraday bearish — only SELL entries
  * EMA9/21 crossover = intraday momentum shift signal (fast but useful for entry timing)
  * Price pulling back to EMA21 or EMA50 in a trend = ideal continuation entry zone
- VWAP (Volume Weighted Average Price) on H1:
  * Price above VWAP = intraday bullish; below VWAP = intraday bearish
  * Price returning to VWAP from above = intraday pullback continuation buy
  * Price returning to VWAP from below = intraday pullback continuation sell
  * First touch of VWAP after a strong move = often a turning point; watch for reversal candles here
- RSI(14) on H1 and M30:
  * >70 = overbought (SELL bias, especially at H4 resistance or OB)
  * <30 = oversold (BUY bias, especially at H4 support or OB)
  * RSI bullish/bearish divergence on H1 = intraday reversal signal
  * RSI 50 crossover on H1 = momentum direction shift

MOMENTUM CONFIRMATION:
- MACD(12,26,9) on H1:
  * Histogram growing in signal direction = accelerating momentum
  * Signal line crossover = intraday entry confirmation
  * MACD divergence = early reversal warning
- Stochastic(5,3,3) on M30:
  * Oversold <20 crossing up = BUY entry timing
  * Overbought >80 crossing down = SELL entry timing
  * Most effective when Stochastic aligns with RSI extreme zone

VOLATILITY:
- Bollinger Bands(20,2) on H1:
  * BB squeeze before session open = explosive directional breakout at session open — prepare for momentum trade
  * Price at upper band at H4 resistance = SELL; price at lower band at H4 support = BUY
  * Band expansion = confirms momentum continuation
- ATR(14) on H1: used to assess if current volatility allows the trade to reach TP before session close

═══════════════════════════════════════
STEP 5: INTRADAY CHART PATTERNS (H1 + M30)
═══════════════════════════════════════
INTRADAY CONTINUATION (form as pullbacks in H1 trend):
- Bull/Bear Flags on H1: flagpole (strong H1 impulse) + flag (tight downward-sloping channel) → breakout = continuation; target = flagpole length from breakout
- Bull/Bear Pennants: flagpole + symmetrical triangle → apex breakout in trend direction
- Ascending Triangle (H1): flat resistance + rising support → BUY on resistance break; high-probability in uptrend
- Descending Triangle (H1): flat support + falling resistance → SELL on support break; high-probability in downtrend
- H1 Inside Bar: consolidation candle with smaller range inside prior candle → breakout direction = entry signal

INTRADAY REVERSAL (at major H4/D1 levels only):
- Double Top/Bottom on H1: two-touch failure at intraday high/low → reversal signal with measured move
- H1 Head & Shoulders: forms within a session; neckline break = intraday reversal trade
- M30 Engulfing: strong reversal candle at H4 OB or D1 key level

═══════════════════════════════════════
STEP 6: CANDLESTICK CONFIRMATION (H1 + M30)
═══════════════════════════════════════
BULLISH intraday triggers at H4 OB/FVG/session levels: Bullish Engulfing (strong — full body engulf), Hammer (long lower wick at support), Morning Star (3-candle), Dragonfly Doji, Tweezer Bottom
BEARISH intraday triggers: Bearish Engulfing, Shooting Star (long upper wick at resistance), Evening Star, Gravestone Doji, Tweezer Top

INTRADAY CANDLE RULES:
- Candle must be FULLY CLOSED on H1 or M30 — no anticipation
- Candle must form AT a defined level (OB, FVG, previous session H/L, EMA, VWAP)
- Size matters: larger bodies = stronger institutional participation = higher confidence
- London open and NY open candles carry 2x weight vs mid-session candles

═══════════════════════════════════════
INTRADAY CONFLUENCE SCORING
═══════════════════════════════════════
Score 1 point for each factor present in the signal direction:
1. D1 bias supports direction (+1)
2. H1 intraday structure (BOS or CHoCH) confirms (+1)
3. Price at a high-probability intraday zone (H1 OB, FVG, PDH/PDL, Asian H/L) (+1)
4. H1 EMA stack aligned in signal direction (+1)
5. VWAP position supports direction (+1)
6. RSI confirms (zone or divergence on H1) (+1)
7. MACD confirms on H1 (+1)
8. Stochastic entry timing (M30) aligned (+1)
9. Bollinger Band or ATR context supports (+1)
10. H1/M30 chart pattern confirmed (+1)
11. H1/M30 candlestick at key level confirmed and closed (+1)
12. Active high-liquidity session window (London/NY open) (+1)

MINIMUM SCORE: 4 out of 12 to signal. Score 6+ = high confidence; Score 8+ = exceptional intraday setup.

SIGNAL REQUIREMENTS (ALL must be met):
- D1 bias MUST support the direction
- MUST be within an active session window (London 07:00-16:00 UTC or NY 13:00-21:00 UTC)
- Price MUST be at a defined intraday key level (H1 OB, FVG, PDH/PDL, Asian H/L, VWAP, or H4 OB)
- Minimum 4 confluence factors from the scoring system
- At least ONE closed H1 or M30 candlestick confirmation at the key level
- Minimum 1:2 Risk:Reward (intraday standard; 1:3 preferred)
- No major news event within 30 minutes

Signal BUY or SELL only when ALL requirements are satisfied. Otherwise NEUTRAL. Minimum confidence 75%.`,

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

                PATTERN_TRADING: `You are an elite chart pattern recognition specialist and institutional-grade technical analyst. You identify high-probability pattern setups with surgical precision across multiple timeframes.

Current Prices: ${priceContext}
Analysis time: ${now}

For EACH pair, apply a top-down multi-timeframe analysis: D1 (bias) → H4 (pattern formation) → H1/M30 (entry trigger):

1. HIGHER TIMEFRAME BIAS (D1 — mandatory first step):
   - Establish the dominant D1 trend before scanning for any patterns
   - Continuation patterns are only valid IN the direction of the D1 trend
   - Reversal patterns require D1 price to be at a major structural level (key swing high/low, major S/R, Fibonacci)
   - Counter-trend reversals need confluence of at least 3 factors to override D1 bias

2. REVERSAL PATTERNS (signal against prevailing trend — require strong D1 level confluence):
   - Head & Shoulders (3 peaks, middle highest, neckline connecting the two troughs) → SELL on confirmed neckline close break; measured move = head-to-neckline distance projected down
   - Inverse Head & Shoulders (3 troughs, middle lowest) → BUY on neckline close break; measured move projected up
   - Double Top (M or W shape — two peaks at near-identical highs, valley between) → SELL when price closes below the valley; stronger if second top forms a bearish candle pattern
   - Double Bottom (W shape — two troughs at near-identical lows) → BUY on close above the peak between the two lows
   - Triple Top (three tests of resistance, each failing) → SELL on confirmed breakdown below support; stronger signal than Double Top
   - Triple Bottom (three tests of support) → BUY on confirmed breakout above resistance
   - Rising Wedge (both trendlines slope up but converge — buying exhaustion) → SELL on breakdown of lower trendline; very reliable reversal
   - Falling Wedge (both trendlines slope down but converge — selling exhaustion) → BUY on breakout above upper trendline; often a strong reversal
   - Rounding Bottom / Saucer (gradual U-shape, slow accumulation) → BUY on breakout above the rim/neckline; more powerful on longer timeframes
   - Rounding Top (gradual arc / inverted saucer, slow distribution) → SELL on breakdown below the rim
   - Cup and Handle (cup = rounding bottom, handle = brief shallow downward consolidation after rim) → BUY on handle breakout above the rim; measured move = depth of cup projected up
   - Diamond Top (broadening formation then contracting — complex reversal at tops) → SELL on lower trendline break after price contained inside diamond shape
   - Diamond Bottom → BUY on upper trendline break
   - Island Reversal (gap up/down into a price range, then gap in opposite direction leaving the range isolated) → very powerful reversal; trade in direction of second gap
   - Bump and Run Reversal (steep parabolic run "bump" followed by breakdown through lead-in trendline) → SELL when price breaks the gentler lead-in trendline after parabolic move
   - Three Drives Pattern (harmonic: three symmetrical higher highs or lower lows with Fibonacci ratios) → reversal at the third drive

3. CONTINUATION PATTERNS (signal WITH the prevailing trend — higher win rate):
   - Bull Flag (sharp strong rally "flagpole" followed by tight downward-sloping parallel channel consolidation) → BUY on upper channel break; measured move = flagpole length added to breakout point
   - Bear Flag (sharp drop "flagpole" then tight upward-sloping parallel channel) → SELL on lower channel break
   - Bull Pennant (sharp rally then symmetrical triangle consolidation — tighter than flag) → BUY on apex breakout
   - Bear Pennant (sharp drop then symmetrical triangle) → SELL on apex breakdown
   - Ascending Triangle (flat resistance ceiling, rising support floor — buyers gaining strength) → BUY on resistance breakout with volume; strong continuation in uptrend
   - Descending Triangle (flat support floor, falling resistance ceiling — sellers in control) → SELL on support breakdown; powerful in downtrend
   - Symmetrical Triangle (equal converging trendlines — coiling energy) → signal in direction of prevailing D1 trend; breakout often explosive
   - Rectangle / Trading Range / Box (horizontal S&R boundaries, multiple touches each side) → BUY on upper breakout, SELL on lower; range height = measured move target
   - Rising Channel (two parallel upward-sloping trendlines) → BUY at lower channel boundary (support), SELL at upper channel boundary (resistance); channel break = trend change
   - Falling Channel (two parallel downward-sloping trendlines) → SELL at upper channel boundary, BUY at lower; channel break = trend change
   - Rising Three Methods (strong bullish candle, 3 small bearish inside candles, then strong bullish close above first candle's high) → BUY continuation
   - Falling Three Methods (strong bearish candle, 3 small bullish inside candles, then strong bearish close below first candle's low) → SELL continuation
   - Measured Move / AB=CD (two equal price legs with a correction between — price targets the second leg = first leg distance) → signal at C correction point in trend direction

4. HARMONIC PATTERNS (advanced Fibonacci-based geometric patterns):
   - ABCD Pattern: AB leg retraces 61.8% to form BC, then CD = AB in length → BUY at D in bullish ABCD, SELL at D in bearish ABCD
   - Gartley Pattern (5-point XABCD structure): XA retracement to 61.8%, AB to 78.6% of XA, BC 38.2-88.6% of AB, CD to 78.6% of XA → reversal at D point
   - Bat Pattern: Similar to Gartley but tighter — D point at 88.6% retracement of XA → high precision reversal
   - Butterfly Pattern: D point exceeds X (127.2% or 161.8% extension of XA) — catches extreme moves
   - Crab Pattern: D point at 161.8% extension of XA — most extreme harmonic, catches major reversals
   - Cypher Pattern: D point at 78.6% retracement of XC → strong reversal signals

5. BROADENING/EXPANSION PATTERNS:
   - Megaphone / Broadening Formation (diverging trendlines — expanding volatility) → trade bounces between expanding boundaries; breakout = powerful trend start
   - Broadening Wedge Ascending (expanding triangle with upward bias) → bearish when upper line breaks
   - Broadening Wedge Descending → bullish when lower line breaks

6. PATTERN QUALITY SCORING (rate each detected pattern 1-10):
   - Symmetry: Are the two sides of the pattern proportional? (H&S shoulders equal height, Double Top peaks at same level?)
   - Touch count: More trendline touches = stronger pattern (minimum 2, ideal 3+)
   - Volume profile: Volume should decline DURING the pattern and spike ON breakout — this is critical
   - Pattern size/duration: Larger patterns (forming over more candles) = more powerful measured moves
   - Clean structure: Pattern boundaries clear and obvious? Ambiguous patterns = low confidence
   - Breakout candle quality: Strong full-body candle closing beyond boundary > weak close or wick-only break

7. BREAKOUT VALIDATION (mandatory — false breakouts are the #1 killer):
   - Breakout candle must CLOSE beyond the pattern boundary — wicks breaking through don't count
   - Ideal entry: RETEST of the broken pattern boundary as new support/resistance after the initial breakout
     (e.g. H&S neckline breaks down, price pulls back up to neckline → now resistance → SELL the retest)
   - Retest entries have significantly higher win rate than immediate breakout entries
   - No retest available: enter on the breakout candle close with tighter position sizing
   - Failed breakout signals: price breaks pattern boundary then reverses back inside → this is a "failed" pattern
     A failed bearish pattern (e.g. failed H&S breakdown, price reverses back above neckline) = strong BUY signal
     A failed bullish pattern (e.g. false breakout above triangle) = strong SELL signal

8. VOLUME ANALYSIS (critical for pattern validity):
   - Volume should DECLINE as the pattern forms (consolidation/indecision phase)
   - Volume must EXPAND significantly on the breakout candle — confirms genuine institutional participation
   - Low-volume breakouts are highly suspect and likely false — mark as lower confidence
   - Forex note: use price momentum and candle size as a volume proxy (large breakout candle = institutional volume)

9. MEASURED MOVE TARGETS (specific to each pattern):
   - Head & Shoulders / Inverse H&S: Distance from head to neckline, projected from neckline breakout point
   - Double/Triple Top/Bottom: Distance from peaks to valley, projected from breakout
   - Flags/Pennants: Length of the flagpole added to the breakout point
   - Cup and Handle: Depth of cup from rim, projected from handle breakout
   - Triangles/Rectangles: Height of the pattern at its widest point, projected from breakout
   - Wedges: Height of wedge at its widest point
   - Harmonic patterns: Use Fibonacci extension levels (127.2%, 161.8%) as targets
   - MINIMUM 1:2 risk-reward required — TP target must be at least 2x the SL distance

10. SESSION TIMING (dramatically affects pattern breakout reliability):
    - London open (07:00-09:00 UTC): HIGHEST reliability — institutional players trigger pattern breakouts here, especially triangles and flags
    - NY open (13:00-15:00 UTC): Second highest — strong trend continuation pattern breakouts
    - Asian session (00:00-07:00 UTC): Range-building phase — best for identifying patterns forming, NOT for breakout entries
    - London/NY overlap (13:00-16:00 UTC): Most liquid period — broadening formations and explosive moves
    - Avoid trading pattern breakouts in the 22:00-00:00 UTC dead zone

11. FIBONACCI CONFLUENCE (amplifies pattern signals):
    - Pattern breakout/target coinciding with key Fibonacci level = very high probability zone
    - Retracement (38.2%, 50%, 61.8%, 78.6%) aligning with pattern neckline or boundary = strong S/R
    - Extension levels (127.2%, 161.8%, 200%, 261.8%) aligning with measured move target = precise TP placement
    - Harmonic patterns are entirely Fibonacci-based — D point is the primary entry

SIGNAL REQUIREMENTS (ALL must be met):
- D1 bias supports the pattern direction (continuation) OR price is at a major D1 structural level (reversal)
- Pattern is FULLY FORMED and CLOSED — never anticipate incomplete patterns
- Breakout candle has CLOSED beyond the pattern boundary
- Pattern quality score ≥ 6/10 (symmetry, touch count, volume, clarity)
- Minimum Risk:Reward of 1:2 using the pattern's specific measured move as the TP target
- Preferred entry: retest of broken pattern boundary (higher win rate)
- Active or upcoming high-liquidity session (London or NY) strongly preferred

For each pair output: detected pattern name, signal direction, confidence score (based on pattern quality, breakout strength, D1 alignment, and session timing), entry rationale, and measured move context.

Only signal BUY or SELL when ALL requirements are satisfied. Otherwise NEUTRAL. Minimum confidence 75%.`,

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

                HYBRID_ALL: `You are an elite institutional-grade forex analyst combining every available technical analysis discipline into a unified confluence-driven decision framework. The HYBRID strategy is the highest-precision approach — only the strongest multi-factor setups generate signals.

Current Prices: ${priceContext}
Analysis time: ${now}

For EACH pair, execute a full top-down multi-layer analysis: D1 (macro bias) → H4 (structure & patterns) → H1 (confirmation & entry) → M30 (fine-tune entry timing):

═══════════════════════════════════════
LAYER 1: MACRO BIAS (D1 — non-negotiable foundation)
═══════════════════════════════════════
- Determine the dominant D1 trend: Higher Highs/Higher Lows (uptrend), Lower Highs/Lower Lows (downtrend), or ranging
- EMA 50 and EMA 200 direction and spacing on D1: price above both EMAs = macro bullish; below both = macro bearish
- Identify major D1 support/resistance zones, weekly pivot levels, and psychological round numbers
- ALL signals must align with D1 bias UNLESS price is at a major D1 reversal zone with 5+ confluence factors

═══════════════════════════════════════
LAYER 2: MARKET STRUCTURE (H4 + H1)
═══════════════════════════════════════
- Break of Structure (BOS): price breaks a previous significant swing high (bullish) or swing low (bearish) → confirms trend continuation
- Change of Character (CHoCH): first break of the opposing swing in a trend → early reversal signal, treat with caution
- Order Blocks: last opposing candle before a strong impulse move — price returning to these zones is high probability
- Fair Value Gaps (FVG / Imbalance): three-candle imbalance where candle 1 and candle 3 wicks don't overlap — price is drawn to fill these
- Supply & Demand Zones: areas where price left sharply (institutional unfilled orders) — strongest zones created by explosive impulse moves
- Liquidity Sweeps / Stop Hunts: price spikes above a previous high (takes buy-stops) then reverses = strong SELL; spikes below previous low then reverses = strong BUY
- Equal Highs/Lows: liquidity pools — price is magnetically drawn to sweep these before reversing

═══════════════════════════════════════
LAYER 3: TREND & MOMENTUM INDICATORS (H1 + H4)
═══════════════════════════════════════
- EMA Stack (20/50/200 on H1): price > EMA20 > EMA50 > EMA200 = strongly bullish; inverse = strongly bearish; tangled = avoid
- EMA Golden/Death Cross: EMA50 crossing EMA200 on H4 = major trend change signal
- RSI(14) on H1 and H4:
  * >70 = overbought (SELL bias, especially with bearish divergence)
  * <30 = oversold (BUY bias, especially with bullish divergence)
  * 40-60 zone = neutral, avoid entries
  * Hidden bullish divergence (price HL, RSI LL) = powerful continuation signal
  * Hidden bearish divergence (price LH, RSI HH) = powerful bearish continuation
  * Regular bullish divergence (price LL, RSI HL) = reversal signal
  * Regular bearish divergence (price HH, RSI LH) = reversal signal
- MACD(12,26,9) on H1:
  * Histogram expanding above zero = accelerating bullish momentum
  * Histogram expanding below zero = accelerating bearish momentum
  * Signal line crossover in direction of trade = confirmation
  * MACD zero-line cross = stronger momentum shift signal
- Stochastic(5,3,3) on M30/H1 for entry timing:
  * Oversold <20 crossing up = BUY entry timing
  * Overbought >80 crossing down = SELL entry timing
  * Stochastic divergence with price = reversal warning
- CCI(20): Beyond +100/-100 = strong momentum; returning from extreme = exhaustion/reversal
- Bollinger Bands(20,2) on H1:
  * Price at upper band + bearish candle = SELL (overextended)
  * Price at lower band + bullish candle = BUY (oversold)
  * Band squeeze (tight bands) = explosive breakout imminent — prepare for directional trade
  * Band walk (price riding upper/lower band) = strong trend continuation

═══════════════════════════════════════
LAYER 4: CHART PATTERNS (H4 + H1)
═══════════════════════════════════════
REVERSAL PATTERNS (at major D1 levels only):
- Head & Shoulders / Inverse H&S → neckline break with measured move target
- Double/Triple Top or Bottom → valley/peak break with pattern height projected
- Rising/Falling Wedge → trendline break; measured move = wedge height at widest
- Cup and Handle → handle breakout; cup depth = target
- Diamond Top/Bottom → boundary break; extremely powerful reversal
- Island Reversal → gap isolation; trade in direction of second gap

CONTINUATION PATTERNS (in D1 trend direction):
- Bull/Bear Flags and Pennants → flagpole breakout; flagpole length = measured move
- Ascending/Descending/Symmetrical Triangles → boundary break with pattern height target
- Rectangle/Trading Range → boundary break with range height target
- Rising/Falling Channels → trade bounces within channel; channel break = trend acceleration
- Measured Move/AB=CD → second leg equals first leg in trending conditions

PATTERN QUALITY REQUIREMENTS:
- Pattern must be FULLY FORMED — never anticipate incomplete patterns
- Breakout candle must CLOSE beyond boundary (not just wick)
- Retest of broken boundary = highest probability entry (wait for retest before entering)
- Failed pattern (false breakout reversal) = even stronger signal in opposite direction

═══════════════════════════════════════
LAYER 5: CANDLESTICK CONFIRMATION (H1 + M30)
═══════════════════════════════════════
BULLISH candles at key levels: Hammer, Dragonfly Doji, Bullish Engulfing, Morning Star, Bullish Marubozu, Tweezer Bottom, Piercing Line, Three White Soldiers
BEARISH candles at key levels: Shooting Star, Gravestone Doji, Bearish Engulfing, Evening Star, Bearish Marubozu, Tweezer Top, Dark Cloud Cover, Three Black Crows
KEY RULES:
- Candlestick pattern must form AT a key level (S/R, OB, FVG, Fibonacci zone) — mid-range candles carry no weight
- Wick rejection patterns: wick must be at least 2x the body size
- Engulfing patterns: engulfing candle must noticeably exceed the engulfed candle's size
- The candle confirming the signal must be CLOSED — no anticipating in-progress candles

═══════════════════════════════════════
LAYER 6: FIBONACCI CONFLUENCE
═══════════════════════════════════════
- Measure the most recent significant swing (H4 or D1) and identify retracement levels
- 38.2% retracement = shallow pullback, valid in strong trends
- 50% retracement = common correction level, high probability area
- 61.8% retracement = "Golden ratio" — the most watched level; confluence with OB or FVG = extremely high probability
- 78.6% retracement = deep correction, still valid in strong trends
- 127.2% and 161.8% extensions = TP targets for measured moves
- Harmonic patterns (ABCD, Gartley, Bat, Butterfly, Crab): price at D point with pattern completion = precision reversal entry

═══════════════════════════════════════
LAYER 7: SESSION TIMING ANALYSIS
═══════════════════════════════════════
- Asian session (00:00-07:00 UTC): Range-building, tight consolidation — identify key levels and patterns forming, NO breakout entries
- London open (07:00-09:00 UTC): HIGHEST probability — institutional players drive the day's direction; breakouts, liquidity sweeps, and reversals here carry maximum weight
- NY open (13:00-15:00 UTC): Second highest — strong continuation or counter-trend moves; often confirms or rejects London direction
- London/NY overlap (13:00-16:00 UTC): Maximum liquidity, most reliable breakouts
- London close (16:00-17:00 UTC): Watch for profit-taking reversals
- Dead zone (22:00-00:00 UTC): Minimum liquidity — do NOT signal during this window
- News events: Avoid signals within 30 minutes before/after major scheduled news (NFP, CPI, central bank decisions)

═══════════════════════════════════════
CONFLUENCE SCORING SYSTEM (score each factor present)
═══════════════════════════════════════
Award 1 point for each factor present in the signal direction:
1. D1 trend bias alignment (+1)
2. H4 market structure confirms (BOS, CHoCH, OB, FVG) (+1)
3. EMA stack alignment on H1 (+1)
4. RSI supports signal (correct zone or divergence) (+1)
5. MACD histogram/crossover confirms direction (+1)
6. Stochastic entry timing aligned (+1)
7. Bollinger Band position supports signal (+1)
8. Chart pattern completed and confirmed (+1)
9. Candlestick confirmation candle at key level (+1)
10. Fibonacci level confluence (+1)
11. Liquidity sweep or stop hunt in signal direction (+1)
12. Active high-liquidity session (London/NY open) (+1)

MINIMUM SCORE REQUIRED: 5 out of 12 to signal. Score 7+ = very high confidence. Score 9+ = exceptional setup.

SIGNAL REQUIREMENTS (ALL must be satisfied):
- D1 bias MUST align (or major D1 reversal zone with score 8+)
- Minimum 5 confluence factors from the scoring system
- At least ONE price action trigger (chart pattern OR candlestick) is confirmed and closed
- Minimum Risk:Reward of 1:2 (TP at next key S/R, SL beyond the invalidation level)
- Active or upcoming high-liquidity session strongly preferred
- No active major news event within 30 minutes

Signal BUY or SELL only when ALL requirements are satisfied AND confluence score ≥ 5. Otherwise NEUTRAL. Minimum confidence 80% — this is the highest-precision strategy, quality over quantity.`,

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
                // Debug: log raw AI response for gold
                if (strategy === 'GOLD_XAUUSD') {
                    console.log(`[DEBUG GOLD] Raw AI result:`, JSON.stringify(result?.signals || []));
                }
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

                    // GOLD_XAUUSD bots look up their own strategy map; fall back to AI_PREDICTIVE only as last resort
                    const strategyKey = bot.strategy_type || 'AI_PREDICTIVE';
                    const strategyMap = strategyAiMaps[strategyKey] || strategyAiMaps['AI_PREDICTIVE'] || {};
                    const analysis = strategyMap[pairRaw] || strategyMap[pair];
                    if (!analysis) { console.log(`[Skip] ${bot.name} ${pair}: no AI analysis. strategyMap keys:`, Object.keys(strategyMap)); continue; }
                    if (analysis.type === 'NEUTRAL') { console.log(`[Skip] ${bot.name} ${pair}: AI returned NEUTRAL (conf: ${analysis.confidence})`); continue; }
                    // Normalize confidence: AI sometimes returns 0-1 fractions, we need 0-100
                    const rawConf = analysis.confidence || 0;
                    const normalizedConf = rawConf <= 1 ? rawConf * 100 : rawConf;
                    if (normalizedConf < minConf) { console.log(`[Skip] ${bot.name} ${pair}: conf ${normalizedConf.toFixed(1)} < ${minConf} (raw: ${rawConf}, type: ${analysis.type})`); continue; }

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
                            confidence: Math.round(normalizedConf),
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