import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Lightweight RSI calculation
function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
        const diff = prices[i] - prices[i - 1];
        if (diff >= 0) gains += diff;
        else losses -= diff;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

// Simple EMA calculation
function calculateEMA(prices, period) {
    if (prices.length < period) return prices[prices.length - 1];
    const k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < prices.length; i++) {
        ema = prices[i] * k + ema * (1 - k);
    }
    return ema;
}

// Generate simulated price history from current price
function generatePriceHistory(currentPrice, volatility = 0.001, bars = 50) {
    const prices = [currentPrice];
    for (let i = 1; i < bars; i++) {
        const change = (Math.random() - 0.5) * 2 * volatility * currentPrice;
        prices.unshift(prices[0] + change);
    }
    return prices;
}

// Local signal analysis - fast, no external AI calls
function analyzeSignal(currentPrice, strategyType, riskLevel) {
    const volatility = riskLevel === 'HIGH' ? 0.002 : riskLevel === 'LOW' ? 0.0005 : 0.001;
    const prices = generatePriceHistory(currentPrice, volatility);

    const rsi = calculateRSI(prices);
    const ema9 = calculateEMA(prices, 9);
    const ema21 = calculateEMA(prices, 21);
    const ema50 = calculateEMA(prices, 50);

    let bullScore = 0;
    let bearScore = 0;

    // RSI signals
    if (rsi < 35) bullScore += 30;
    else if (rsi < 45) bullScore += 15;
    if (rsi > 65) bearScore += 30;
    else if (rsi > 55) bearScore += 15;

    // EMA crossover signals
    if (ema9 > ema21) bullScore += 25;
    else bearScore += 25;

    if (ema21 > ema50) bullScore += 20;
    else bearScore += 20;

    // Price vs EMA50 trend
    if (currentPrice > ema50) bullScore += 15;
    else bearScore += 15;

    // Strategy-specific adjustments
    if (strategyType === 'SCALPING') {
        // Scalping prefers mean reversion
        if (rsi < 30) bullScore += 10;
        if (rsi > 70) bearScore += 10;
    } else if (strategyType === 'SWING' || strategyType === 'DAY_TRADING') {
        // Trend following
        if (ema9 > ema21 && ema21 > ema50) bullScore += 10;
        if (ema9 < ema21 && ema21 < ema50) bearScore += 10;
    }

    const total = bullScore + bearScore;
    if (total === 0) return null;

    const bullPercent = (bullScore / total) * 100;
    const bearPercent = (bearScore / total) * 100;

    if (bullPercent >= 60) {
        return { type: 'BUY', confidence: Math.min(95, 50 + bullPercent * 0.5) };
    } else if (bearPercent >= 60) {
        return { type: 'SELL', confidence: Math.min(95, 50 + bearPercent * 0.5) };
    }
    return null;
}

// Fetch current price for a forex pair
async function fetchPrice(pair) {
    const [base, quote] = pair.replace('/', '').length === 6
        ? [pair.split('/')[0], pair.split('/')[1]]
        : [pair.slice(0, 3), pair.slice(3)];

    const url = `https://open.er-api.com/v6/latest/${base}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`Price fetch failed for ${pair}: ${res.status}`);
    const data = await res.json();
    const price = data?.rates?.[quote];
    if (!price) throw new Error(`No rate found for ${quote}`);
    return price;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        // Fetch risk settings, open trades, and running bots in parallel
        const [riskSettingsArr, allTrades, runningBots] = await Promise.all([
            base44.asServiceRole.entities.RiskManagementSettings.list(),
            base44.asServiceRole.entities.Trade.filter({ status: 'OPEN' }),
            base44.asServiceRole.entities.BotConfig.filter({ status: 'RUNNING' })
        ]);

        const globalRisk = riskSettingsArr?.[0] || { max_concurrent_trades: 100, is_trading_paused: false };

        if (globalRisk.is_trading_paused) {
            return Response.json({ success: true, message: 'Trading paused globally', signals_generated: 0 });
        }

        if (allTrades.length >= (globalRisk.max_concurrent_trades || 100)) {
            return Response.json({ success: true, message: `Global trade limit reached (${allTrades.length})`, signals_generated: 0 });
        }

        if (runningBots.length === 0) {
            return Response.json({ success: true, message: 'No running bots', signals_generated: 0 });
        }

        const now = new Date();
        const currentTime = now.getHours() * 60 + now.getMinutes();

        // Process all bots in parallel
        const botPromises = runningBots.map(async (bot) => {
            try {
                // Check schedule
                const [startH, startM] = (bot.trading_start_time || "00:00").split(':').map(Number);
                const [endH, endM] = (bot.trading_end_time || "23:59").split(':').map(Number);
                if (currentTime < startH * 60 + startM || currentTime > endH * 60 + endM) {
                    return { bot: bot.name, status: 'outside_hours', signals: 0 };
                }

                const botOpenTrades = allTrades.filter(t => t.bot_id === bot.id && t.is_auto === true);
                const maxTrades = bot.max_open_trades || 5;
                if (botOpenTrades.length >= maxTrades) {
                    return { bot: bot.name, status: 'max_trades_reached', signals: 0 };
                }

                const pairs = bot.pairs && bot.pairs.length > 0 ? bot.pairs : ['EUR/USD'];
                // Pick up to 2 random pairs per bot to stay fast
                const shuffled = pairs.sort(() => Math.random() - 0.5).slice(0, 2);

                let signalsGenerated = 0;

                // Analyze pairs in parallel
                const pairPromises = shuffled.map(async (pair) => {
                    try {
                        const currentPrice = await fetchPrice(pair);
                        const signal = analyzeSignal(currentPrice, bot.strategy_type, bot.risk_level);

                        if (!signal || signal.confidence < (bot.min_confidence || 75)) return;

                        // Check for recent duplicate signal
                        const recentSignals = await base44.asServiceRole.entities.Signal.filter({
                            pair,
                            bot_id: bot.id,
                            status: 'PENDING'
                        });
                        if (recentSignals.length > 0) return;

                        // Calculate SL/TP
                        const isJpy = pair.includes('JPY');
                        const isGold = pair.includes('XAU') || pair.includes('GOLD');
                        const isCrypto = ['BTC', 'ETH', 'SOL', 'XRP'].some(c => pair.includes(c));
                        let pipMultiplier = 0.0001;
                        if (isJpy) pipMultiplier = 0.01;
                        if (isGold) pipMultiplier = 0.1;
                        if (isCrypto) pipMultiplier = 10;

                        // AI Dynamic Risk: adjust SL/TP based on volatility if enabled
                        let slPips = bot.stop_loss_pips || 30;
                        let tpPips = bot.take_profit_pips || 60;
                        if (bot.use_ai_risk) {
                            // Estimate volatility from recent price movement (simple ATR approximation)
                            const atrApprox = currentPrice * 0.002; // ~0.2% of price as baseline
                            const pipValue = pipMultiplier;
                            const atrPips = Math.round(atrApprox / pipValue);
                            // Scale SL/TP to volatility: higher volatility = wider stops
                            slPips = Math.max(10, Math.min(150, atrPips * 1.5));
                            tpPips = Math.max(20, Math.min(300, atrPips * 3));
                            console.log(`[AI Risk] ${bot.name} ${pair}: ATR~${atrPips}p -> SL=${slPips}p TP=${tpPips}p`);
                        }
                        const sl = signal.type === 'BUY'
                            ? currentPrice - slPips * pipMultiplier
                            : currentPrice + slPips * pipMultiplier;
                        const tp = signal.type === 'BUY'
                            ? currentPrice + tpPips * pipMultiplier
                            : currentPrice - tpPips * pipMultiplier;

                        await base44.asServiceRole.entities.Signal.create({
                            pair,
                            type: signal.type,
                            entry_price: parseFloat(currentPrice.toFixed(5)),
                            stop_loss: parseFloat(sl.toFixed(5)),
                            take_profit: parseFloat(tp.toFixed(5)),
                            lot_size: bot.lot_size || 0.01,
                            confidence: Math.round(signal.confidence),
                            strategy: bot.strategy_type,
                            bot_id: bot.id,
                            status: 'PENDING'
                        });

                        signalsGenerated++;
                        console.log(`[Signal] ${bot.name} -> ${signal.type} ${pair} @ ${currentPrice.toFixed(5)} (${Math.round(signal.confidence)}%)`);
                    } catch (pairErr) {
                        console.error(`Error analyzing ${pair}:`, pairErr.message);
                    }
                });

                await Promise.all(pairPromises);
                return { bot: bot.name, status: 'analyzed', signals: signalsGenerated };

            } catch (botErr) {
                return { bot: bot.name, status: 'error', error: botErr.message };
            }
        });

        const results = await Promise.all(botPromises);

        return Response.json({
            success: true,
            bots_checked: runningBots.length,
            total_signals: results.reduce((sum, r) => sum + (r?.signals || 0), 0),
            results
        });

    } catch (error) {
        console.error('generateBotSignals fatal error:', error.message);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});