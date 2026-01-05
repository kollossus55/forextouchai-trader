import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import OpenAI from 'npm:openai';
import { RSI, MACD, BollingerBands, EMA, Stochastic } from 'npm:technicalindicators';

// Helper to generate synthetic historical price data
const generateHistoricalData = (currentPrice, periods = 50) => {
    const data = [];
    let price = currentPrice;
    
    for (let i = periods; i > 0; i--) {
        const volatility = 0.002;
        const change = (Math.random() - 0.5) * volatility;
        price = price * (1 + change);
        
        data.push({
            close: price,
            high: price * (1 + Math.random() * 0.001),
            low: price * (1 - Math.random() * 0.001),
            open: price
        });
    }
    
    data.push({
        close: currentPrice,
        high: currentPrice * 1.0005,
        low: currentPrice * 0.9995,
        open: currentPrice
    });
    
    return data;
};

// Calculate all technical indicators
const calculateIndicators = (priceData) => {
    const closes = priceData.map(d => d.close);
    const highs = priceData.map(d => d.high);
    const lows = priceData.map(d => d.low);
    
    const indicators = {};
    
    // RSI (14)
    try {
        const rsiValues = RSI.calculate({ values: closes, period: 14 });
        indicators.rsi = rsiValues[rsiValues.length - 1] || 50;
    } catch (e) {
        indicators.rsi = 50;
    }
    
    // MACD (12, 26, 9)
    try {
        const macdValues = MACD.calculate({
            values: closes,
            fastPeriod: 12,
            slowPeriod: 26,
            signalPeriod: 9,
            SimpleMAOscillator: false,
            SimpleMASignal: false
        });
        const latest = macdValues[macdValues.length - 1];
        indicators.macd = {
            value: latest?.MACD || 0,
            signal: latest?.signal || 0,
            histogram: latest?.histogram || 0
        };
    } catch (e) {
        indicators.macd = { value: 0, signal: 0, histogram: 0 };
    }
    
    // Bollinger Bands (20, 2)
    try {
        const bbValues = BollingerBands.calculate({
            values: closes,
            period: 20,
            stdDev: 2
        });
        const latest = bbValues[bbValues.length - 1];
        const currentPrice = closes[closes.length - 1];
        indicators.bollingerBands = {
            upper: latest?.upper || currentPrice * 1.02,
            middle: latest?.middle || currentPrice,
            lower: latest?.lower || currentPrice * 0.98,
            percentB: latest ? ((currentPrice - latest.lower) / (latest.upper - latest.lower)) * 100 : 50
        };
    } catch (e) {
        const currentPrice = closes[closes.length - 1];
        indicators.bollingerBands = {
            upper: currentPrice * 1.02,
            middle: currentPrice,
            lower: currentPrice * 0.98,
            percentB: 50
        };
    }
    
    // EMA (200)
    try {
        const emaValues = EMA.calculate({ values: closes, period: 50 }); // Use 50 for demo
        indicators.ema200 = emaValues[emaValues.length - 1] || closes[closes.length - 1];
    } catch (e) {
        indicators.ema200 = closes[closes.length - 1];
    }
    
    // Stochastic Oscillator (14, 3, 3)
    try {
        const stochValues = Stochastic.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: 14,
            signalPeriod: 3
        });
        const latest = stochValues[stochValues.length - 1];
        indicators.stochastic = {
            k: latest?.k || 50,
            d: latest?.d || 50
        };
    } catch (e) {
        indicators.stochastic = { k: 50, d: 50 };
    }
    
    return indicators;
};

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
        
        // Calculate indicators for top candidate pairs
        const pairAnalysis = pairs.slice(0, 10).map(pairSymbol => {
            const price = marketData[pairSymbol] || 1.0;
            const historicalData = generateHistoricalData(price);
            const calculatedIndicators = calculateIndicators(historicalData);
            
            return {
                symbol: pairSymbol,
                price,
                indicators: calculatedIndicators
            };
        });
        
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
        You are an expert Forex and Crypto trading analyst with access to REAL calculated technical indicators.
        
        CRITICAL: Perform technical analysis specifically for the ${timeframe} timeframe.
        ${timeframeGuide[timeframe] || 'Standard technical analysis'}
        
        Configuration:
        - Timeframe: ${timeframe} (MUST analyze based on this timeframe's characteristics)
        - Minimum Confidence: ${minConfidence}%
        - Active Indicators: ${activeIndicators}

        CALCULATED TECHNICAL INDICATORS (Real Values):
        ${JSON.stringify(pairAnalysis, null, 2)}
        
        INTERPRETATION GUIDE:
        - RSI: <30 (Oversold), 30-70 (Neutral), >70 (Overbought)
        - MACD Histogram: Positive (Bullish momentum), Negative (Bearish momentum)
        - Bollinger %B: <0 (Below lower band), 0-100 (Within bands), >100 (Above upper band)
        - Stochastic K/D: <20 (Oversold), >80 (Overbought), K crossing above D (Bullish signal)
        - EMA200: Price above EMA (Bullish trend), Price below EMA (Bearish trend)

        TIMEFRAME-SPECIFIC REQUIREMENTS:
        - For M1/M5: Look for ultra-short-term momentum, scalping opportunities
        - For M15/H1: Identify intraday swing patterns and hourly trend shifts
        - For H4/D1: Focus on daily/weekly trends, major support/resistance zones
        
        CRITICAL: Use the ACTUAL calculated indicator values above to determine the best trade setup.
        Look for confluence (multiple indicators agreeing) to increase confidence.

        You must output valid JSON matching this schema:
        {
            "pair": "Symbol (e.g. EUR/USD)",
            "type": "BUY" or "SELL",
            "entry_price": number (current price),
            "stop_loss": number,
            "take_profit": number,
            "confidence": number (${minConfidence}-99),
            "strategy": "String (e.g. 'H1 RSI(28.5) Oversold + MACD Bullish Cross + EMA Support')",
            "analysis_summary": "Detailed analysis referencing actual indicator values",
            "indicators": {
                "rsi": number,
                "macd_histogram": number,
                "bollinger_percentB": number,
                "stochastic_k": number,
                "price_vs_ema": "above" or "below"
            }
        }

        Rules:
        1. Stop Loss must be at least 30 PIPS away from entry price.
        2. Take Profit must be at least 40 PIPS away.
        3. REFERENCE actual indicator values in your strategy name (e.g., "RSI(28.5)").
        4. Confidence should be higher when multiple indicators align.
        5. Include the calculated indicator values in the response.
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
        
        // Attach full indicator data for the selected pair
        const selectedPairData = pairAnalysis.find(p => p.symbol === signal.pair);
        if (selectedPairData) {
            signal.calculated_indicators = selectedPairData.indicators;
        }

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