import { SMA, EMA, RSI, MACD, BollingerBands, ATR, Stochastic } from 'technicalindicators';

class TechnicalAnalysisService {
    /**
     * Fetch historical candlestick data for a pair
     * @param {string} pair - Currency pair (e.g., 'EUR/USD')
     * @param {string} timeframe - Timeframe (e.g., 'H1', 'M15')
     * @returns {Promise<Array>} Array of OHLC data
     */
    async fetchHistoricalData(pair, timeframe = 'H1') {
        try {
            // For crypto pairs (BTC, ETH, etc.)
            if (pair.includes('BTC') || pair.includes('ETH') || pair.includes('SOL')) {
                const symbol = pair.split('/')[0].toLowerCase();
                const response = await fetch(
                    `https://api.coingecko.com/api/v3/coins/${symbol === 'btc' ? 'bitcoin' : symbol === 'eth' ? 'ethereum' : 'solana'}/market_chart?vs_currency=usd&days=30&interval=hourly`
                );
                const data = await response.json();
                
                // Convert to OHLC format (using prices as approximation)
                return data.prices.slice(-100).map((price, i) => {
                    const nextPrice = data.prices[i + 1]?.[1] || price[1];
                    return {
                        time: new Date(price[0]),
                        open: price[1],
                        high: Math.max(price[1], nextPrice),
                        low: Math.min(price[1], nextPrice),
                        close: nextPrice,
                        volume: 1000000
                    };
                });
            }
            
            // For forex pairs - use a simulated historical data based on current price
            // In production, you'd connect to a real forex data provider (Alpha Vantage, OANDA, etc.)
            const currentPrice = await this.getCurrentPrice(pair);
            return this.generateSimulatedHistory(currentPrice, 100);
            
        } catch (error) {
            console.error('Error fetching historical data:', error);
            return [];
        }
    }

    async getCurrentPrice(pair) {
        // Use MarketDataService if available
        if (window.MarketDataService?.getPrice) {
            return window.MarketDataService.getPrice(pair);
        }
        
        // Fallback prices
        const fallbackPrices = {
            'EUR/USD': 1.0850,
            'GBP/USD': 1.2650,
            'USD/JPY': 148.50,
            'AUD/USD': 0.6550,
        };
        return fallbackPrices[pair] || 1.0;
    }

    generateSimulatedHistory(currentPrice, periods) {
        const data = [];
        let price = currentPrice * 0.95; // Start 5% below current
        
        for (let i = 0; i < periods; i++) {
            const change = (Math.random() - 0.5) * 0.02; // ±1% change
            const open = price;
            const close = price * (1 + change);
            const high = Math.max(open, close) * (1 + Math.random() * 0.005);
            const low = Math.min(open, close) * (1 - Math.random() * 0.005);
            
            data.push({
                time: new Date(Date.now() - (periods - i) * 3600000),
                open,
                high,
                low,
                close,
                volume: Math.random() * 1000000
            });
            
            price = close;
        }
        
        return data;
    }

    /**
     * Calculate technical indicators
     */
    calculateIndicators(ohlcData) {
        const closes = ohlcData.map(d => d.close);
        const highs = ohlcData.map(d => d.high);
        const lows = ohlcData.map(d => d.low);
        
        return {
            sma20: SMA.calculate({ period: 20, values: closes }),
            sma50: SMA.calculate({ period: 50, values: closes }),
            ema12: EMA.calculate({ period: 12, values: closes }),
            ema26: EMA.calculate({ period: 26, values: closes }),
            rsi: RSI.calculate({ period: 14, values: closes }),
            macd: MACD.calculate({
                values: closes,
                fastPeriod: 12,
                slowPeriod: 26,
                signalPeriod: 9,
                SimpleMAOscillator: false,
                SimpleMASignal: false
            }),
            bb: BollingerBands.calculate({
                period: 20,
                values: closes,
                stdDev: 2
            }),
            atr: ATR.calculate({
                high: highs,
                low: lows,
                close: closes,
                period: 14
            }),
            stochastic: Stochastic.calculate({
                high: highs,
                low: lows,
                close: closes,
                period: 14,
                signalPeriod: 3
            })
        };
    }

    /**
     * Analyze if conditions are favorable for a trade
     */
    analyzeSignal(ohlcData, strategyType) {
        if (!ohlcData || ohlcData.length < 50) return null;
        
        const indicators = this.calculateIndicators(ohlcData);
        const currentPrice = ohlcData[ohlcData.length - 1].close;
        
        // Get latest indicator values
        const rsi = indicators.rsi[indicators.rsi.length - 1];
        const macd = indicators.macd[indicators.macd.length - 1];
        const bb = indicators.bb[indicators.bb.length - 1];
        const stoch = indicators.stochastic[indicators.stochastic.length - 1];
        const sma20 = indicators.sma20[indicators.sma20.length - 1];
        const sma50 = indicators.sma50[indicators.sma50.length - 1];
        
        let signal = null;
        let confidence = 0;
        
        // SCALPING Strategy
        if (strategyType === 'SCALPING') {
            if (rsi < 30 && macd?.histogram > 0 && currentPrice < bb?.lower) {
                signal = 'BUY';
                confidence = 75 + (30 - rsi);
            } else if (rsi > 70 && macd?.histogram < 0 && currentPrice > bb?.upper) {
                signal = 'SELL';
                confidence = 75 + (rsi - 70);
            }
        }
        
        // SWING Strategy
        else if (strategyType === 'SWING') {
            if (sma20 > sma50 && rsi > 50 && rsi < 70 && macd?.MACD > macd?.signal) {
                signal = 'BUY';
                confidence = 70 + Math.min(20, (macd.MACD - macd.signal) * 10);
            } else if (sma20 < sma50 && rsi < 50 && rsi > 30 && macd?.MACD < macd?.signal) {
                signal = 'SELL';
                confidence = 70 + Math.min(20, (macd.signal - macd.MACD) * 10);
            }
        }
        
        // DAY_TRADING Strategy
        else if (strategyType === 'DAY_TRADING') {
            if (rsi < 40 && stoch?.k < 20 && currentPrice > sma20) {
                signal = 'BUY';
                confidence = 65 + (40 - rsi) + (20 - stoch.k) / 2;
            } else if (rsi > 60 && stoch?.k > 80 && currentPrice < sma20) {
                signal = 'SELL';
                confidence = 65 + (rsi - 60) + (stoch.k - 80) / 2;
            }
        }
        
        // AI_PREDICTIVE / HYBRID_ALL - Combine multiple signals
        else {
            let buyScore = 0;
            let sellScore = 0;
            
            // RSI signals
            if (rsi < 30) buyScore += 25;
            if (rsi > 70) sellScore += 25;
            
            // MACD signals
            if (macd?.MACD > macd?.signal) buyScore += 20;
            if (macd?.MACD < macd?.signal) sellScore += 20;
            
            // Trend signals
            if (sma20 > sma50) buyScore += 15;
            if (sma20 < sma50) sellScore += 15;
            
            // Bollinger Bands
            if (currentPrice < bb?.lower) buyScore += 20;
            if (currentPrice > bb?.upper) sellScore += 20;
            
            // Stochastic
            if (stoch?.k < 20) buyScore += 15;
            if (stoch?.k > 80) sellScore += 15;
            
            if (buyScore > sellScore && buyScore >= 60) {
                signal = 'BUY';
                confidence = Math.min(95, buyScore);
            } else if (sellScore > buyScore && sellScore >= 60) {
                signal = 'SELL';
                confidence = Math.min(95, sellScore);
            }
        }
        
        if (signal) {
            return {
                signal,
                confidence: Math.min(99, Math.max(60, confidence)),
                indicators: {
                    rsi: rsi?.toFixed(2),
                    macd: macd?.MACD?.toFixed(5),
                    macdSignal: macd?.signal?.toFixed(5),
                    sma20: sma20?.toFixed(5),
                    sma50: sma50?.toFixed(5),
                    bb_upper: bb?.upper?.toFixed(5),
                    bb_lower: bb?.lower?.toFixed(5),
                    stochastic: stoch?.k?.toFixed(2)
                }
            };
        }
        
        return null;
    }
}

export const technicalAnalysisService = new TechnicalAnalysisService();