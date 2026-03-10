import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import OpenAI from 'npm:openai';

const openai = new OpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY") });

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

        // Build price context
        const priceContext = pairs.map(pair => {
            const price = marketData?.[pair] || 0;
            return `${pair}: ${price}`;
        }).join(', ');

        const prompt = `You are a professional forex trading analyst. Analyze the following currency pairs and market data, then identify the SINGLE BEST trading opportunity.

Current Prices: ${priceContext}
Timeframe: ${timeframe}
Risk Level: ${riskLevel}
Signal Sensitivity: ${signalSensitivity}
Active Indicators: ${indicators.join(', ') || 'RSI, MACD, EMA, Bollinger Bands'}
Minimum Confidence Required: ${minConfidence}%

Analyze the market conditions and return the best trading signal. Consider:
- Trend direction and momentum
- Support/resistance levels
- Risk/reward ratio (minimum 1.5:1)
- Current market volatility

Return ONLY a JSON object (no markdown, no explanation) with this exact structure:
{
  "pair": "EUR/USD",
  "type": "BUY" or "SELL",
  "entry_price": 1.08450,
  "stop_loss": 1.08100,
  "take_profit": 1.08975,
  "confidence": 82,
  "strategy": "EMA Crossover + RSI Oversold",
  "calculated_indicators": {
    "rsi": 42,
    "macd_signal": "bullish",
    "ema_trend": "uptrend",
    "bb_position": "lower_band",
    "stochastic": 28
  },
  "historicalData": []
}

If no signal meets the minimum confidence of ${minConfidence}%, return: {"error": "No high-confidence setup found"}`;

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.3,
            max_tokens: 500,
        });

        const content = response.choices[0].message.content.trim();
        
        let signal;
        try {
            signal = JSON.parse(content);
        } catch {
            // Try to extract JSON from response
            const match = content.match(/\{[\s\S]*\}/);
            if (match) {
                signal = JSON.parse(match[0]);
            } else {
                return Response.json({ error: 'Failed to parse AI response' }, { status: 500 });
            }
        }

        console.log('[ANALYZE_MARKET] Signal generated:', signal.pair, signal.type, signal.confidence + '%');

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