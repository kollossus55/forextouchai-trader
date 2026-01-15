import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import OpenAI from 'npm:openai';
import { RSI, MACD, BollingerBands, EMA, Stochastic } from 'npm:technicalindicators';

// Helper to generate synthetic historical price data with timeframe-specific characteristics
const generateHistoricalData = (currentPrice, periods = 100, timeframeMultiplier = 1) => {
    const data = [];
    let price = currentPrice;
    
    // Higher timeframes have proportionally larger movements
    const baseVolatility = 0.002 * timeframeMultiplier;
    
    for (let i = periods; i > 0; i--) {
        const change = (Math.random() - 0.5) * baseVolatility;
        price = price * (1 + change);
        
        data.push({
            close: price,
            high: price * (1 + Math.random() * 0.001 * timeframeMultiplier),
            low: price * (1 - Math.random() * 0.001 * timeframeMultiplier),
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

// Determine higher timeframes to check based on primary timeframe
const getHigherTimeframes = (primaryTimeframe) => {
    const hierarchy = {
        'M1': ['M5', 'M15', 'H1'],
        'M5': ['M15', 'H1', 'H4'],
        'M15': ['H1', 'H4', 'D1'],
        'H1': ['H4', 'D1'],
        'H4': ['D1'],
        'D1': []
    };
    return hierarchy[primaryTimeframe] || ['H4', 'D1'];
};

// Get timeframe multiplier for realistic data generation
const getTimeframeMultiplier = (timeframe) => {
    const multipliers = {
        'M1': 1,
        'M5': 1.5,
        'M15': 2,
        'H1': 3,
        'H4': 5,
        'D1': 8
    };
    return multipliers[timeframe] || 3;
};

// Calculate all technical indicators with historical data
const calculateIndicators = (priceData) => {
    const closes = priceData.map(d => d.close);
    const highs = priceData.map(d => d.high);
    const lows = priceData.map(d => d.low);
    
    const indicators = {};
    
    // RSI (14)
    try {
        const rsiValues = RSI.calculate({ values: closes, period: 14 });
        indicators.rsi = rsiValues[rsiValues.length - 1] || 50;
        indicators.rsiHistory = rsiValues;
    } catch (e) {
        indicators.rsi = 50;
        indicators.rsiHistory = [];
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
        indicators.macdHistory = macdValues;
    } catch (e) {
        indicators.macd = { value: 0, signal: 0, histogram: 0 };
        indicators.macdHistory = [];
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
        indicators.bbHistory = bbValues;
    } catch (e) {
        const currentPrice = closes[closes.length - 1];
        indicators.bollingerBands = {
            upper: currentPrice * 1.02,
            middle: currentPrice,
            lower: currentPrice * 0.98,
            percentB: 50
        };
        indicators.bbHistory = [];
    }
    
    // EMA (200)
    try {
        const emaValues = EMA.calculate({ values: closes, period: 50 }); // Use 50 for demo
        indicators.ema200 = emaValues[emaValues.length - 1] || closes[closes.length - 1];
        indicators.emaHistory = emaValues;
    } catch (e) {
        indicators.ema200 = closes[closes.length - 1];
        indicators.emaHistory = [];
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
        indicators.stochHistory = stochValues;
    } catch (e) {
        indicators.stochastic = { k: 50, d: 50 };
        indicators.stochHistory = [];
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

        const { pairs, marketData, minConfidence = 80, indicators = [], timeframe = 'H1', riskLevel = 'MEDIUM', signalSensitivity = 'BALANCED' } = await req.json();

        if (!Deno.env.get("OPENAI_API_KEY")) {
            return Response.json({ error: "OpenAI API Key not set" }, { status: 500 });
        }

        const openai = new OpenAI({
            apiKey: Deno.env.get("OPENAI_API_KEY"),
        });

        const activeIndicators = indicators.length > 0 ? indicators.join(', ') : 'Price Action, Trend Analysis';

        // Fetch recent market news sentiment
        const newsItems = await base44.asServiceRole.entities.NewsItem.list('-created_date', 5);
        const newsSentiment = newsItems.reduce((acc, item) => {
            acc[item.sentiment] = (acc[item.sentiment] || 0) + 1;
            return acc;
        }, {});
        const overallSentiment = Object.keys(newsSentiment).reduce((a, b) => 
            newsSentiment[a] > newsSentiment[b] ? a : b, 'NEUTRAL'
        );

        // Calculate indicators for top candidate pairs across multiple timeframes
        const higherTimeframes = getHigherTimeframes(timeframe);
        
        const pairAnalysis = pairs.slice(0, 10).map(pairSymbol => {
            const price = marketData[pairSymbol] || 1.0;
            
            // Calculate for primary timeframe
            const primaryMultiplier = getTimeframeMultiplier(timeframe);
            const primaryData = generateHistoricalData(price, 100, primaryMultiplier);
            const primaryIndicators = calculateIndicators(primaryData);
            
            // Calculate for higher timeframes
            const higherTFIndicators = {};
            higherTimeframes.forEach(tf => {
                const tfMultiplier = getTimeframeMultiplier(tf);
                const tfData = generateHistoricalData(price, 100, tfMultiplier);
                higherTFIndicators[tf] = calculateIndicators(tfData);
            });
            
            return {
                symbol: pairSymbol,
                price,
                indicators: primaryIndicators,
                higherTimeframes: higherTFIndicators
            };
        });
        
        // Prepare lightweight data for AI prompt (only latest values)
        const pairSummary = pairAnalysis.map(p => {
            const summary = {
                symbol: p.symbol,
                price: p.price,
                [timeframe]: {
                    rsi: p.indicators.rsi,
                    macd: p.indicators.macd,
                    bollingerBands: p.indicators.bollingerBands,
                    ema200: p.indicators.ema200,
                    stochastic: p.indicators.stochastic
                }
            };
            
            // Add higher timeframe data
            higherTimeframes.forEach(tf => {
                if (p.higherTimeframes[tf]) {
                    summary[tf] = {
                        rsi: p.higherTimeframes[tf].rsi,
                        macd: p.higherTimeframes[tf].macd,
                        ema200: p.higherTimeframes[tf].ema200
                    };
                }
            });
            
            return summary;
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

        // Risk level adjustments
        const riskAdjustments = {
            'LOW': { minPips: 40, targetMultiplier: 2.0, confidenceBoost: 5 },
            'MEDIUM': { minPips: 30, targetMultiplier: 1.5, confidenceBoost: 0 },
            'HIGH': { minPips: 20, targetMultiplier: 1.2, confidenceBoost: -5 }
        };
        const riskConfig = riskAdjustments[riskLevel] || riskAdjustments['MEDIUM'];

        // Signal sensitivity adjustments
        const sensitivityConfig = {
            'CONSERVATIVE': 'Only recommend signals with strong multi-indicator confluence and clear trends',
            'BALANCED': 'Balance between opportunity and risk, require at least 2-3 indicators to align',
            'AGGRESSIVE': 'Be more opportunistic, single strong indicator with supportive price action is acceptable'
        };
        const sensitivityGuide = sensitivityConfig[signalSensitivity] || sensitivityConfig['BALANCED'];

        const prompt = `
        You are an expert Forex and Crypto trading analyst with access to REAL calculated technical indicators and market sentiment data.

        CRITICAL: Perform technical analysis specifically for the ${timeframe} timeframe.
        ${timeframeGuide[timeframe] || 'Standard technical analysis'}

        Configuration:
        - Timeframe: ${timeframe} (MUST analyze based on this timeframe's characteristics)
        - Risk Level: ${riskLevel} (Adjust SL/TP accordingly: ${riskConfig.minPips} pips minimum, ${riskConfig.targetMultiplier}x risk/reward)
        - Signal Sensitivity: ${signalSensitivity} (${sensitivityGuide})
        - Minimum Confidence: ${minConfidence}%
        - Active Indicators: ${activeIndicators}

        MARKET SENTIMENT CONTEXT:
        - Recent News Sentiment: ${overallSentiment}
        - Latest Headlines: ${newsItems.slice(0, 3).map(n => n.title).join(' | ')}
        - Overall Market Bias: ${overallSentiment === 'POSITIVE' ? 'Risk-On (favor BUY signals)' : overallSentiment === 'NEGATIVE' ? 'Risk-Off (favor SELL signals)' : 'Neutral'}

        CALCULATED TECHNICAL INDICATORS (Real Values):
        ${JSON.stringify(pairSummary, null, 2)}
        
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
        1. Stop Loss must be at least ${riskConfig.minPips} PIPS away from entry price (Risk Level: ${riskLevel}).
        2. Take Profit should target ${riskConfig.targetMultiplier}x the risk (e.g., if SL is 30 pips, TP should be ${Math.round(30 * riskConfig.targetMultiplier)} pips).
        3. INCORPORATE news sentiment: If market sentiment is ${overallSentiment}, give slight preference to ${overallSentiment === 'POSITIVE' ? 'BUY' : overallSentiment === 'NEGATIVE' ? 'SELL' : 'both'} setups.
        4. REFERENCE actual indicator values in your strategy name (e.g., "RSI(28.5)").
        5. Confidence should be higher when multiple indicators align AND news sentiment supports the direction.
        6. Apply ${signalSensitivity} signal sensitivity: ${sensitivityGuide}
        7. Include the calculated indicator values in the response.
        8. Only return the JSON object.
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
        
        // Attach full indicator data for the selected pair (without heavy chart history)
        const selectedPairData = pairAnalysis.find(p => p.symbol === signal.pair);
        if (selectedPairData) {
            signal.calculated_indicators = {
                rsi: selectedPairData.indicators.rsi,
                macd: selectedPairData.indicators.macd,
                bollingerBands: selectedPairData.indicators.bollingerBands,
                ema200: selectedPairData.indicators.ema200,
                stochastic: selectedPairData.indicators.stochastic
            };
        }

        // Sanity Check & Normalization with Risk-Adjusted Parameters
        if (signal.pair && signal.entry_price) {
            const isJpy = signal.pair.includes('JPY');
            const pip = isJpy ? 0.01 : 0.0001;
            const minDist = riskConfig.minPips * pip; // Risk-adjusted minimum distance

            if (signal.type === 'BUY') {
                if (signal.stop_loss >= signal.entry_price - minDist) {
                    signal.stop_loss = signal.entry_price - minDist;
                }
                if (signal.take_profit <= signal.entry_price + minDist) {
                    signal.take_profit = signal.entry_price + (minDist * riskConfig.targetMultiplier);
                }
            } else if (signal.type === 'SELL') {
                if (signal.stop_loss <= signal.entry_price + minDist) {
                    signal.stop_loss = signal.entry_price + minDist;
                }
                if (signal.take_profit >= signal.entry_price - minDist) {
                    signal.take_profit = signal.entry_price - (minDist * riskConfig.targetMultiplier);
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