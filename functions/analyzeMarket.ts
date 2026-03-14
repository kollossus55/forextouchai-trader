import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            }
        });
    }

    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { pairs, marketData, minConfidence = 75, riskLevel = 'MEDIUM', signalSensitivity = 'BALANCED', indicators = [], timeframe = 'H1', botId = null } = body;

        if (!pairs || pairs.length === 0) {
            return Response.json({ error: 'No pairs provided' }, { status: 400 });
        }

        const priceContext = pairs.map(pair => {
            const price = marketData?.[pair] || 0;
            return `${pair}: ${price}`;
        }).join(', ');

        const prompt = `You are a professional forex trading analyst. Analyze the following currency pairs and identify the SINGLE BEST trading opportunity right now.

Current Prices: ${priceContext}
Timeframe: ${timeframe}
Risk Level: ${riskLevel}
Signal Sensitivity: ${signalSensitivity}
Active Indicators: ${indicators.join(', ') || 'RSI, MACD, EMA, Bollinger Bands'}
Minimum Confidence Required: ${minConfidence}%

Analyze market conditions considering trend direction, momentum, support/resistance levels, and risk/reward ratio (minimum 1.5:1).

If no pair meets the minimum confidence of ${minConfidence}%, set the "error" field to "No high-confidence setup found" and leave other fields null.`;

        const signal = await base44.asServiceRole.integrations.Core.InvokeLLM({
            prompt,
            response_json_schema: {
                type: "object",
                properties: {
                    error: { type: "string" },
                    pair: { type: "string" },
                    type: { type: "string", enum: ["BUY", "SELL"] },
                    entry_price: { type: "number" },
                    stop_loss: { type: "number" },
                    take_profit: { type: "number" },
                    confidence: { type: "number" },
                    strategy: { type: "string" },
                    calculated_indicators: {
                        type: "object",
                        properties: {
                            rsi: { type: "number" },
                            macd_signal: { type: "string" },
                            ema_trend: { type: "string" },
                            bb_position: { type: "string" },
                            stochastic: { type: "number" }
                        }
                    }
                }
            }
        });

        console.log('[ANALYZE_MARKET] Signal generated:', signal?.pair, signal?.type, signal?.confidence + '%');

        return Response.json(signal, {
            headers: { 'Access-Control-Allow-Origin': '*' }
        });

    } catch (error) {
        console.error('[ANALYZE_MARKET ERROR]', error.message);
        return Response.json({ error: error.message }, {
            status: 500,
            headers: { 'Access-Control-Allow-Origin': '*' }
        });
    }
});