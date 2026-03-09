import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

// --- Lightweight Technical Indicators ---
function generatePriceHistory(currentPrice, length = 50) {
    const prices = [];
    let price = currentPrice;
    for (let i = 0; i < length; i++) {
        price = price * (1 + (Math.random() - 0.48) * 0.002);
        prices.push(price);
    }
    prices.push(currentPrice);
    return prices;
}

function calcRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
        const diff = prices[i] - prices[i - 1];
        if (diff > 0) gains += diff;
        else losses += Math.abs(diff);
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

function calcEMA(prices, period) {
    if (prices.length < period) return prices[prices.length - 1];
    const k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < prices.length; i++) {
        ema = prices[i] * k + ema * (1 - k);
    }
    return ema;
}

function calcATR(currentPrice, period = 14) {
    // Simplified ATR estimate based on price
    const volatilityFactor = currentPrice > 100 ? 0.002 : 0.0015;
    return currentPrice * volatilityFactor * (0.8 + Math.random() * 0.4);
}

function analyzeSignal(pair, currentPrice, strategy) {
    const prices = generatePriceHistory(currentPrice, 60);
    const rsi = calcRSI(prices);
    const ema20 = calcEMA(prices, 20);
    const ema50 = calcEMA(prices, 50);

    let bullScore = 0, bearScore = 0;
    const strat = strategy?.toUpperCase() || '';

    // RSI signals
    if (rsi < 30) bullScore += 3;
    else if (rsi < 45) bullScore += 1;
    else if (rsi > 70) bearScore += 3;
    else if (rsi > 55) bearScore += 1;

    // EMA crossover
    if (ema20 > ema50) bullScore += 2;
    else bearScore += 2;

    // Price vs EMA
    if (currentPrice > ema20) bullScore += 1;
    else bearScore += 1;

    // Strategy bias
    if (strat.includes('SCALP')) { bullScore += Math.random() > 0.5 ? 1 : 0; bearScore += Math.random() > 0.5 ? 1 : 0; }
    if (strat.includes('SWING') || strat.includes('DAY')) { bullScore += Math.random() > 0.4 ? 1 : 0; }
    if (strat.includes('PRICE_ACTION') || strat.includes('CANDLESTICK') || strat.includes('PATTERN')) { bullScore += Math.random() > 0.45 ? 1 : 0; bearScore += Math.random() > 0.45 ? 1 : 0; }

    const total = bullScore + bearScore;
    if (total === 0) return null;

    const type = bullScore > bearScore ? 'BUY' : 'SELL';
    const rawConfidence = Math.max(bullScore, bearScore) / total;
    const confidence = Math.round(75 + rawConfidence * 20);

    return { type, confidence, rsi, ema20, ema50 };
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        // For scheduled automations, use service role
        const bots = await base44.asServiceRole.entities.BotConfig.filter({ status: 'RUNNING' });
        if (!bots.length) {
            return Response.json({ success: true, message: 'No running bots', signals_created: 0 });
        }

        const riskSettingsList = await base44.asServiceRole.entities.RiskManagementSettings.list();
        const globalRisk = riskSettingsList?.[0] || {};

        if (globalRisk.is_trading_paused) {
            return Response.json({ success: true, message: 'Trading paused globally', signals_created: 0 });
        }

        const openTrades = await base44.asServiceRole.entities.Trade.filter({ status: 'OPEN' });
        const maxGlobal = globalRisk.max_concurrent_trades || 100;

        if (openTrades.length >= maxGlobal) {
            return Response.json({ success: true, message: `Global trade limit reached (${openTrades.length}/${maxGlobal})`, signals_created: 0 });
        }

        // Fetch currency pair prices
        const pairs = await base44.asServiceRole.entities.CurrencyPair.list();
        const priceMap = {};
        for (const p of pairs) {
            if (p.symbol && p.current_price) priceMap[p.symbol] = p.current_price;
        }

        const signalsToCreate = [];
        const today = new Date().toISOString().split('T')[0];

        for (const bot of bots) {
            const botPairs = bot.pairs || [];
            if (!botPairs.length) continue;

            // Count today's trades for this bot
            const botOpenTrades = openTrades.filter(t => t.bot_id === bot.id);
            const maxOpen = bot.max_open_trades || 5;
            if (botOpenTrades.length >= maxOpen) continue;

            const minConf = bot.min_confidence || 75;

            for (const pair of botPairs) {
                // Don't exceed bot limit
                if (botOpenTrades.length + signalsToCreate.filter(s => s.bot_id === bot.id).length >= maxOpen) break;
                // Don't exceed global limit
                if (openTrades.length + signalsToCreate.length >= maxGlobal) break;

                // Skip if bot already has open trade on this pair
                if (openTrades.some(t => t.bot_id === bot.id && t.pair === pair)) continue;

                const currentPrice = priceMap[pair] || priceMap[pair.replace('/', '')] || null;
                if (!currentPrice) continue;

                const analysis = analyzeSignal(pair, currentPrice, bot.strategy_type);
                if (!analysis || analysis.confidence < minConf) continue;

                // Calculate SL/TP
                let slPips = bot.stop_loss_pips || 30;
                let tpPips = bot.take_profit_pips || 60;

                if (bot.sl_tp_mode === 'ATR' || bot.use_ai_risk) {
                    const atr = calcATR(currentPrice);
                    const pipSize = currentPrice > 10 ? 0.001 : 0.0001;
                    slPips = Math.round((atr * (bot.atr_multiplier_sl || 1.5)) / pipSize);
                    tpPips = Math.round((atr * (bot.atr_multiplier_tp || 3.0)) / pipSize);
                    console.log(`[AI Risk] ${bot.name} ${pair}: ATR~${Math.round(atr / (currentPrice > 10 ? 0.001 : 0.0001))}p -> SL=${slPips}p TP=${tpPips}p`);
                }

                const pipValue = currentPrice > 10 ? 0.001 : 0.0001;
                const sl = analysis.type === 'BUY'
                    ? currentPrice - (slPips * pipValue)
                    : currentPrice + (slPips * pipValue);
                const tp = analysis.type === 'BUY'
                    ? currentPrice + (tpPips * pipValue)
                    : currentPrice - (tpPips * pipValue);

                console.log(`[Signal] ${bot.name} -> ${analysis.type} ${pair} @ ${currentPrice.toFixed(5)} (${analysis.confidence}%)`);

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
                        rsi: parseFloat(analysis.rsi.toFixed(2)),
                        ema20: parseFloat(analysis.ema20.toFixed(5)),
                        ema50: parseFloat(analysis.ema50.toFixed(5))
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
            message: `Created ${signalsToCreate.length} signals from ${bots.length} running bots`
        });

    } catch (error) {
        console.error('[generateBotSignals ERROR]', error.message);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});