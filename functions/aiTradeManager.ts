import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4'; 
import OpenAI from 'npm:openai';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { action, tradeId, riskParams } = await req.json();

        if (!Deno.env.get("OPENAI_API_KEY")) {
            return Response.json({ error: "OpenAI API Key not set" }, { status: 500 });
        }

        const openai = new OpenAI({
            apiKey: Deno.env.get("OPENAI_API_KEY"),
        });

        // Fetch all open trades
        const openTrades = await base44.entities.Trade.filter({ status: 'OPEN' });
        
        if (openTrades.length === 0) {
            return Response.json({ message: "No open trades to manage", adjustments: [] });
        }

        const adjustments = [];
        const alerts = [];

        // Process each open trade
        for (const trade of openTrades) {
            // Skip if specific tradeId requested and this isn't it
            if (tradeId && trade.id !== tradeId) continue;

            // Fetch connection to get account balance for risk calculation
            const connections = await base44.entities.BrokerConnection.list(1);
            const accountBalance = connections[0]?.balance || 10000;

            // Calculate current P&L and trade duration
            const currentPnL = trade.pnl || 0;
            const tradeAge = Date.now() - new Date(trade.created_date).getTime();
            const hoursOpen = tradeAge / (1000 * 60 * 60);

            // Prepare AI prompt for trade analysis
            const prompt = `
            You are an expert AI Trade Manager analyzing an active forex trade.

            Trade Details:
            - Pair: ${trade.pair}
            - Type: ${trade.type}
            - Open Price: ${trade.open_price}
            - Current Price: ${trade.close_price || trade.open_price}
            - Lot Size: ${trade.lot_size}
            - Current P&L: $${currentPnL.toFixed(2)}
            - Hours Open: ${hoursOpen.toFixed(1)}

            Risk Management Parameters:
            - Max Risk Per Trade: ${riskParams?.maxRiskPercent || 2}% of account ($${(accountBalance * (riskParams?.maxRiskPercent || 2) / 100).toFixed(2)})
            - Trailing Stop Distance: ${riskParams?.trailingStopPips || 20} pips
            - Profit Protection: ${riskParams?.profitProtectPercent || 50}% (lock in profit once ${riskParams?.profitProtectPercent || 50}% of TP is reached)
            - Max Hold Time: ${riskParams?.maxHoldHours || 24} hours
            - Use AI Adjustments: ${riskParams?.enableAI !== false}

            Current Market Context:
            - Account Balance: $${accountBalance.toFixed(2)}
            - Risk Exposure: ${((Math.abs(currentPnL) / accountBalance) * 100).toFixed(2)}%

            Task: Analyze this trade and provide recommendations in JSON format:
            {
                "action": "HOLD" | "ADJUST_SL" | "ADJUST_TP" | "CLOSE" | "TRAIL_STOP",
                "reason": "Brief explanation",
                "new_stop_loss": number (if adjusting, must be at least 10 pips away),
                "new_take_profit": number (if adjusting),
                "confidence": number (0-100),
                "alert_type": "INFO" | "WARNING" | "CRITICAL" | null,
                "alert_message": "Message for the user" (if alert needed)
            }

            Decision Criteria:
            1. If P&L exceeds max risk, recommend CLOSE immediately
            2. If trade is in profit > ${riskParams?.profitProtectPercent || 50}% of target, suggest trailing stop
            3. If trade exceeds max hold time with negative P&L, suggest CLOSE
            4. If market shows strong reversal signals, alert user
            5. Consider volatility and market momentum for SL/TP adjustments
            6. Never suggest adjustments that increase risk beyond parameters
            `;

            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: "You are an AI Trade Risk Manager. Provide strictly valid JSON responses." },
                    { role: "user", content: prompt }
                ],
                response_format: { type: "json_object" }
            });

            const decision = JSON.parse(completion.choices[0].message.content);

            // Execute AI decision if AI management is enabled
            if (riskParams?.enableAI !== false && decision.action !== 'HOLD') {
                const adjustment = {
                    tradeId: trade.id,
                    pair: trade.pair,
                    action: decision.action,
                    reason: decision.reason,
                    confidence: decision.confidence,
                    timestamp: new Date().toISOString()
                };

                // Store adjustment details
                if (decision.new_stop_loss) {
                    adjustment.new_stop_loss = decision.new_stop_loss;
                }
                if (decision.new_take_profit) {
                    adjustment.new_take_profit = decision.new_take_profit;
                }

                adjustments.push(adjustment);

                // Create alert if recommended
                if (decision.alert_message) {
                    await base44.entities.Alert.create({
                        title: `AI Trade Manager: ${trade.pair}`,
                        message: decision.alert_message,
                        type: decision.alert_type || 'INFO'
                    });

                    alerts.push({
                        pair: trade.pair,
                        message: decision.alert_message,
                        type: decision.alert_type
                    });
                }

                // Execute close action if recommended
                if (decision.action === 'CLOSE' && decision.confidence > 80) {
                    await base44.entities.Trade.update(trade.id, {
                        status: 'CLOSED',
                        close_price: trade.close_price
                    });
                    
                    await base44.entities.Alert.create({
                        title: `Trade Closed by AI: ${trade.pair}`,
                        message: `AI closed your ${trade.type} trade on ${trade.pair}. Reason: ${decision.reason}`,
                        type: 'WARNING'
                    });
                }
            } else if (decision.action !== 'HOLD') {
                // AI suggestions mode - create alerts but don't execute
                await base44.entities.Alert.create({
                    title: `AI Suggestion: ${trade.pair}`,
                    message: `AI recommends: ${decision.action}. ${decision.reason}`,
                    type: 'INFO'
                });
                
                alerts.push({
                    pair: trade.pair,
                    message: `Suggestion: ${decision.action} - ${decision.reason}`,
                    type: 'INFO'
                });
            }
        }

        return Response.json({
            message: "AI Trade Management complete",
            tradesAnalyzed: openTrades.length,
            adjustments,
            alerts,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error("AI Trade Manager Error:", error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});