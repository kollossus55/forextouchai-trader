import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // Fetch all RUNNING bots using service role
        const runningBots = await base44.asServiceRole.entities.BotConfig.filter({ status: 'RUNNING' });
        
        if (runningBots.length === 0) {
            return Response.json({ 
                success: true, 
                message: 'No running bots',
                signals_generated: 0 
            });
        }

        // Fetch all open trades once
        const allTrades = await base44.asServiceRole.entities.Trade.filter({ status: 'OPEN' });
        
        const results = [];
        
        for (const bot of runningBots) {
            try {
                // Check Schedule
                const now = new Date();
                const currentTime = now.getHours() * 60 + now.getMinutes();
                const [startH, startM] = (bot.trading_start_time || "00:00").split(':').map(Number);
                const [endH, endM] = (bot.trading_end_time || "23:59").split(':').map(Number);
                const startTime = startH * 60 + startM;
                const endTime = endH * 60 + endM;

                if (currentTime < startTime || currentTime > endTime) {
                    results.push({ bot: bot.name, status: 'outside_hours', signals: 0 });
                    continue;
                }

                // Check bot's current open trades vs limit
                const botOpenTrades = allTrades.filter(t => t.bot_id === bot.id && t.status === 'OPEN' && t.is_auto === true);
                const maxTrades = bot.max_open_trades || 5;

                if (botOpenTrades.length >= maxTrades) {
                    results.push({ bot: bot.name, status: 'max_trades_reached', signals: 0 });
                    continue;
                }

                // Analyze 2-3 random pairs from bot's config
                const pairs = bot.pairs && bot.pairs.length > 0 ? bot.pairs : ['EUR/USD'];
                const numPairsToCheck = Math.min(3, pairs.length);
                const pairsToCheck = [];
                
                for (let i = 0; i < numPairsToCheck; i++) {
                    const randomPair = pairs[Math.floor(Math.random() * pairs.length)];
                    if (!pairsToCheck.includes(randomPair)) {
                        pairsToCheck.push(randomPair);
                    }
                }

                let signalsGenerated = 0;

                for (const pair of pairsToCheck) {
                    try {
                        // Fetch market data from external API
                        const timeframeMap = {
                            'M1': 1, 'M5': 5, 'M15': 15, 'M30': 30,
                            'H1': 60, 'H4': 240, 'D1': 1440, 'W1': 10080
                        };
                        const minutes = timeframeMap[bot.timeframe] || 60;
                        
                        const response = await fetch(
                            `https://api.polygon.io/v2/aggs/ticker/C:${pair.replace('/', '')}/range/${minutes}/minute/${Date.now() - 7*24*60*60*1000}/${Date.now()}?adjusted=true&sort=asc&limit=200&apiKey=BqiP1PAFeOUvDcMBRLhf29OOlJWs9kCt`
                        );
                        
                        if (!response.ok) {
                            continue;
                        }

                        const data = await response.json();
                        
                        if (!data.results || data.results.length < 50) {
                            continue;
                        }

                        const historicalData = data.results.map(candle => ({
                            timestamp: candle.t,
                            open: candle.o,
                            high: candle.h,
                            low: candle.l,
                            close: candle.c,
                            volume: candle.v
                        }));

                        const realPrice = historicalData[historicalData.length - 1].close;

                        // Simple RSI-based signal generation
                        const closes = historicalData.map(d => d.close);
                        const rsi = calculateRSI(closes, 14);
                        
                        let signal = null;
                        let confidence = 0;

                        if (rsi < 30) {
                            signal = 'BUY';
                            confidence = 70 + (30 - rsi);
                        } else if (rsi > 70) {
                            signal = 'SELL';
                            confidence = 70 + (rsi - 70);
                        }

                        if (signal && confidence >= (bot.min_confidence || 75)) {
                            // Calculate SL/TP
                            const isJpy = pair.includes('JPY');
                            const isGold = pair.includes('XAU');
                            let pipMultiplier = 0.0001;
                            if (isJpy) pipMultiplier = 0.01;
                            if (isGold) pipMultiplier = 0.1;

                            const sl = signal === 'BUY' 
                                ? realPrice - (bot.stop_loss_pips * pipMultiplier) 
                                : realPrice + (bot.stop_loss_pips * pipMultiplier);

                            const tp = signal === 'BUY' 
                                ? realPrice + (bot.take_profit_pips * pipMultiplier) 
                                : realPrice - (bot.take_profit_pips * pipMultiplier);

                            // Create signal
                            await base44.asServiceRole.entities.Signal.create({
                                pair,
                                type: signal,
                                entry_price: parseFloat(realPrice.toFixed(5)),
                                stop_loss: parseFloat(sl.toFixed(5)),
                                take_profit: parseFloat(tp.toFixed(5)),
                                lot_size: bot.lot_size || 0.01,
                                confidence: Math.round(confidence),
                                strategy: bot.strategy_type,
                                bot_id: bot.id,
                                status: 'PENDING',
                                calculated_indicators: { rsi }
                            });

                            signalsGenerated++;
                        }
                    } catch (pairError) {
                        console.error(`Error analyzing ${pair}:`, pairError);
                    }
                }

                results.push({ 
                    bot: bot.name, 
                    status: 'analyzed', 
                    signals: signalsGenerated 
                });

            } catch (botError) {
                results.push({ 
                    bot: bot.name, 
                    status: 'error', 
                    error: botError.message 
                });
            }
        }

        return Response.json({
            success: true,
            bots_checked: runningBots.length,
            total_signals: results.reduce((sum, r) => sum + (r.signals || 0), 0),
            results
        });

    } catch (error) {
        return Response.json({ 
            success: false, 
            error: error.message 
        }, { status: 500 });
    }
});

// Simple RSI calculation
function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    
    let gains = 0;
    let losses = 0;
    
    for (let i = prices.length - period; i < prices.length; i++) {
        const change = prices[i] - prices[i - 1];
        if (change > 0) gains += change;
        else losses -= change;
    }
    
    const avgGain = gains / period;
    const avgLoss = losses / period;
    
    if (avgLoss === 0) return 100;
    
    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));
    
    return rsi;
}