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
                        // Use Exchange Rate API for reliable forex prices
                        const baseCurrency = pair.split('/')[0];
                        const quoteCurrency = pair.split('/')[1];
                        
                        const priceResponse = await fetch(`https://open.er-api.com/v6/latest/${baseCurrency}`);
                        
                        if (!priceResponse.ok) {
                            console.error(`Failed to fetch price for ${pair}`);
                            continue;
                        }

                        const priceData = await priceResponse.json();
                        const currentPrice = priceData?.rates?.[quoteCurrency] || 1.0;

                        // Call the analyzeMarket function which has full technical analysis
                        const analysisResult = await base44.asServiceRole.functions.invoke('analyzeMarket', {
                            pairs: [pair],
                            marketData: { [pair]: currentPrice },
                            minConfidence: bot.min_confidence || 75,
                            indicators: ['RSI', 'MACD', 'Bollinger Bands', 'EMA', 'Stochastic'],
                            timeframe: bot.timeframe,
                            riskLevel: bot.risk_level || 'MEDIUM',
                            signalSensitivity: 'BALANCED',
                            botId: bot.id
                        });

                        if (!analysisResult.data || !analysisResult.data.pair) {
                            continue;
                        }

                        const analysis = analysisResult.data;
                        const confidence = analysis.confidence || 0;

                        if (confidence >= (bot.min_confidence || 75)) {
                            // Check if signal already exists for this pair/bot in last 5 minutes
                            const recentSignals = await base44.asServiceRole.entities.Signal.filter({
                                pair,
                                bot_id: bot.id,
                                created_date: { $gte: new Date(Date.now() - 5 * 60 * 1000).toISOString() }
                            });

                            if (recentSignals.length > 0) {
                                continue; // Skip duplicate signal
                            }

                            // Calculate SL/TP
                            const isJpy = pair.includes('JPY');
                            const isGold = pair.includes('XAU');
                            let pipMultiplier = 0.0001;
                            if (isJpy) pipMultiplier = 0.01;
                            if (isGold) pipMultiplier = 0.1;

                            const realPrice = analysis.entry_price || currentPrice;
                            const sl = analysis.stop_loss || (analysis.type === 'BUY' 
                                ? realPrice - (bot.stop_loss_pips * pipMultiplier) 
                                : realPrice + (bot.stop_loss_pips * pipMultiplier));

                            const tp = analysis.take_profit || (analysis.type === 'BUY' 
                                ? realPrice + (bot.take_profit_pips * pipMultiplier) 
                                : realPrice - (bot.take_profit_pips * pipMultiplier));

                            // Create signal
                            await base44.asServiceRole.entities.Signal.create({
                                pair: analysis.pair,
                                type: analysis.type,
                                entry_price: parseFloat(realPrice.toFixed(5)),
                                stop_loss: parseFloat(sl.toFixed(5)),
                                take_profit: parseFloat(tp.toFixed(5)),
                                lot_size: bot.lot_size || 0.01,
                                confidence: Math.round(confidence),
                                strategy: bot.strategy_type,
                                bot_id: bot.id,
                                status: 'PENDING',
                                calculated_indicators: analysis.calculated_indicators || analysis.indicators || {}
                            });

                            signalsGenerated++;
                        }
                    } catch (pairError) {
                        console.error(`Error analyzing ${pair}:`, pairError.message);
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