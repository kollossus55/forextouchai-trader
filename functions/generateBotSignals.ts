import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

// Lightweight signal analysis using simple math
function analyzeSignal(pair, currentPrice, strategy) {
    // Use seeded-ish deterministic values based on price + time bucket
    // This avoids heavy random loops while still varying signals
    const timeBucket = Math.floor(Date.now() / (5 * 60 * 1000)); // changes every 5 min
    const seed = (currentPrice * 1000 + timeBucket) % 100;

    const strat = (strategy || '').toUpperCase();

    // Simulate RSI-like value from price seed
    const rsi = 30 + (seed % 50); // 30-80
    const ema20Offset = (seed % 10 - 5) * 0.0001 * currentPrice;
    const ema50Offset = (seed % 8 - 4) * 0.0001 * currentPrice;
    const ema20 = currentPrice + ema20Offset;
    const ema50 = currentPrice + ema50Offset;

    let bullScore = 0, bearScore = 0;

    if (rsi < 35) bullScore += 3;
    else if (rsi < 45) bullScore += 1;
    else if (rsi > 65) bearScore += 3;
    else if (rsi > 55) bearScore += 1;

    if (ema20 > ema50) bullScore += 2; else bearScore += 2;
    if (currentPrice > ema20) bullScore += 1; else bearScore += 1;

    // Strategy bias using seed
    if (strat.includes('SCALP')) { if (seed % 3 === 0) bullScore++; else bearScore++; }
    if (strat.includes('SWING') || strat.includes('DAY')) { if (seed % 2 === 0) bullScore++; }
    if (strat.includes('PRICE_ACTION') || strat.includes('CANDLESTICK') || strat.includes('PATTERN') || strat.includes('HYBRID')) {
        if (seed % 5 < 2) bullScore++;
        if (seed % 5 >= 3) bearScore++;
    }
    if (strat.includes('AI_PREDICTIVE')) {
        if (seed % 4 < 2) bullScore += 2; else bearScore += 2;
    }

    const total = bullScore + bearScore;
    if (total === 0) return null;

    const type = bullScore > bearScore ? 'BUY' : 'SELL';
    const rawConfidence = Math.max(bullScore, bearScore) / total;
    const confidence = Math.round(72 + rawConfidence * 22);

    return { type, confidence, rsi: parseFloat(rsi.toFixed(2)), ema20: parseFloat(ema20.toFixed(5)), ema50: parseFloat(ema50.toFixed(5)) };
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

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
                if (openTrades.some(t => t.bot_id === bot.id && t.pair === pair)) continue;

                const currentPrice = priceMap[pair] || priceMap[pair.replace('/', '')] || null;
                if (!currentPrice) continue;

                const analysis = analyzeSignal(pair, currentPrice, bot.strategy_type);
                if (!analysis || analysis.confidence < minConf) continue;

                // Calculate SL/TP
                let slPips = bot.stop_loss_pips || 30;
                let tpPips = bot.take_profit_pips || 60;

                if (bot.sl_tp_mode === 'ATR' || bot.use_ai_risk) {
                    const volatilityFactor = currentPrice > 100 ? 0.002 : 0.0015;
                    const atr = currentPrice * volatilityFactor;
                    const pipSize = currentPrice > 10 ? 0.001 : 0.0001;
                    slPips = Math.round((atr * (bot.atr_multiplier_sl || 1.5)) / pipSize);
                    tpPips = Math.round((atr * (bot.atr_multiplier_tp || 3.0)) / pipSize);
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
                        rsi: analysis.rsi,
                        ema20: analysis.ema20,
                        ema50: analysis.ema50
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