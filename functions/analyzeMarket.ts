import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import OpenAI from 'npm:openai';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { pairs, marketData, minConfidence = 80, indicators = [], timeframe = 'H1' } = await req.json();

        if (!Deno.env.get("OPENAI_API_KEY")) {
            return Response.json({ error: "OpenAI API Key not set" }, { status: 500 });
        }

        const openai = new OpenAI({
            apiKey: Deno.env.get("OPENAI_API_KEY"),
        });

        const activeIndicators = indicators.length > 0 ? indicators.join(', ') : 'Price Action, Trend Analysis';
        
        // Timeframe-specific guidance for technical analysis
        const timeframeGuide = {
            'M1': 'Focus on 1-minute scalping patterns, use tight ranges, very short-term momentum',
            'M5': 'Analyze 5-minute momentum shifts, micro trend reversals, quick scalps',
            'M15': '15-minute swing patterns, intraday support/resistance levels',
            'H1': 'Hourly timeframe analysis, medium-term trends, key hourly pivots',
            'H4': '4-hour swing trading setups, daily range analysis, major support/resistance',
            'D1': 'Daily chart analysis, weekly trends, major market structure shifts'
        };

        const prompt = `
        You are an expert Forex and Crypto trading analyst specializing in multi-timeframe technical analysis.
        
        CRITICAL: Perform technical analysis specifically for the ${timeframe} timeframe.
        ${timeframeGuide[timeframe] || 'Standard technical analysis'}
        
        Configuration:
        - Timeframe: ${timeframe} (MUST analyze based on this timeframe's characteristics)
        - Minimum Confidence: ${minConfidence}%
        - Active Indicators to use: ${activeIndicators}

        Current Market Data (Real-time Prices):
        ${JSON.stringify(marketData, null, 2)}
        
        Pairs to consider: ${pairs.join(', ')}

        TIMEFRAME-SPECIFIC REQUIREMENTS:
        - For M1/M5: Look for ultra-short-term momentum, scalping opportunities
        - For M15/H1: Identify intraday swing patterns and hourly trend shifts
        - For H4/D1: Focus on daily/weekly trends, major support/resistance zones
        
        Analyze the selected indicators (${activeIndicators}) in the context of ${timeframe} timeframe.
        Consider how RSI, MACD, EMAs, Bollinger Bands behave differently on each timeframe.

        You must output valid JSON matching this schema:
        {
            "pair": "Symbol (e.g. EUR/USD)",
            "type": "BUY" or "SELL",
            "entry_price": number (current price),
            "stop_loss": number,
            "take_profit": number,
            "confidence": number (${minConfidence}-99),
            "strategy": "String (e.g. 'H1 MACD Bullish Crossover + 200 EMA Support')",
            "analysis_summary": "Timeframe-specific analysis using ${activeIndicators} on ${timeframe}"
        }

        Rules:
        1. Stop Loss must be at least 30 PIPS away from entry price to avoid broker spread errors.
        2. Take Profit must be at least 40 PIPS away.
        3. EXPLICITLY reference the ${timeframe} timeframe and the requested indicators (${activeIndicators}).
        4. Adjust TP/SL ranges based on timeframe (shorter for M1/M5, wider for H4/D1).
        5. Strategy name MUST include timeframe prefix (e.g., "H1 RSI Oversold Bounce").
        6. Only return the JSON object.
        `;

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "You are a professional trading algorithm. Output strictly valid JSON." },
                { role: "user", content: prompt }
            ],
            response_format: { type: "json_object" }
        });

        let signal = JSON.parse(completion.choices[0].message.content);

        // Sanity Check & Normalization
        if (signal.pair && signal.entry_price) {
            const isJpy = signal.pair.includes('JPY');
            const pip = isJpy ? 0.01 : 0.0001;
            const minDist = 30 * pip; // Enforce 30 pips minimum

            if (signal.type === 'BUY') {
                if (signal.stop_loss >= signal.entry_price - minDist) {
                    signal.stop_loss = signal.entry_price - minDist;
                }
                if (signal.take_profit <= signal.entry_price + minDist) {
                    signal.take_profit = signal.entry_price + (minDist * 2);
                }
            } else if (signal.type === 'SELL') {
                if (signal.stop_loss <= signal.entry_price + minDist) {
                    signal.stop_loss = signal.entry_price + minDist;
                }
                if (signal.take_profit >= signal.entry_price - minDist) {
                    signal.take_profit = signal.entry_price - (minDist * 2);
                }
            }

            // Rounding to standard forex precision
            const digits = isJpy ? 3 : 5; 
            signal.entry_price = Number(signal.entry_price.toFixed(digits));
            signal.stop_loss = Number(signal.stop_loss.toFixed(digits));
            signal.take_profit = Number(signal.take_profit.toFixed(digits));
        }

        return Response.json(signal);

    } catch (error) {
        console.error("AI Analysis Error:", error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});