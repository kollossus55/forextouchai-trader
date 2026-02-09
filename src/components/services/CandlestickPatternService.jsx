/**
 * Candlestick Pattern Recognition Service
 * Detects common candlestick patterns for trading signals
 */

class CandlestickPatternService {
    /**
     * Analyze recent candles for patterns
     * @param {Array} ohlcData - Array of OHLC candles
     * @returns {Object|null} Pattern details if found
     */
    detectPatterns(ohlcData) {
        if (!ohlcData || ohlcData.length < 3) return null;
        
        const patterns = [
            this.detectDoji(ohlcData),
            this.detectHammer(ohlcData),
            this.detectShootingStar(ohlcData),
            this.detectEngulfing(ohlcData),
            this.detectMorningStar(ohlcData),
            this.detectEveningStar(ohlcData),
            this.detectThreeWhiteSoldiers(ohlcData),
            this.detectThreeBlackCrows(ohlcData)
        ].filter(p => p !== null);
        
        return patterns.length > 0 ? patterns[0] : null;
    }

    getCandleBody(candle) {
        return Math.abs(candle.close - candle.open);
    }

    getCandleRange(candle) {
        return candle.high - candle.low;
    }

    isBullish(candle) {
        return candle.close > candle.open;
    }

    isBearish(candle) {
        return candle.close < candle.open;
    }

    /**
     * Doji - Indecision pattern (reversal potential)
     */
    detectDoji(ohlcData) {
        const candle = ohlcData[ohlcData.length - 1];
        const body = this.getCandleBody(candle);
        const range = this.getCandleRange(candle);
        
        // Doji: body is less than 10% of total range
        if (body / range < 0.1) {
            const prevTrend = this.detectTrend(ohlcData.slice(-10, -1));
            return {
                pattern: 'DOJI',
                signal: prevTrend === 'UP' ? 'SELL' : 'BUY',
                confidence: 70,
                description: 'Doji candle indicates indecision and potential reversal'
            };
        }
        return null;
    }

    /**
     * Hammer - Bullish reversal at bottom
     */
    detectHammer(ohlcData) {
        const candle = ohlcData[ohlcData.length - 1];
        const body = this.getCandleBody(candle);
        const range = this.getCandleRange(candle);
        const lowerWick = Math.min(candle.open, candle.close) - candle.low;
        const upperWick = candle.high - Math.max(candle.open, candle.close);
        
        // Hammer: small body at top, long lower wick
        if (lowerWick > body * 2 && upperWick < body * 0.5 && body / range < 0.3) {
            const prevTrend = this.detectTrend(ohlcData.slice(-10, -1));
            if (prevTrend === 'DOWN') {
                return {
                    pattern: 'HAMMER',
                    signal: 'BUY',
                    confidence: 80,
                    description: 'Hammer pattern indicates bullish reversal'
                };
            }
        }
        return null;
    }

    /**
     * Shooting Star - Bearish reversal at top
     */
    detectShootingStar(ohlcData) {
        const candle = ohlcData[ohlcData.length - 1];
        const body = this.getCandleBody(candle);
        const range = this.getCandleRange(candle);
        const upperWick = candle.high - Math.max(candle.open, candle.close);
        const lowerWick = Math.min(candle.open, candle.close) - candle.low;
        
        // Shooting Star: small body at bottom, long upper wick
        if (upperWick > body * 2 && lowerWick < body * 0.5 && body / range < 0.3) {
            const prevTrend = this.detectTrend(ohlcData.slice(-10, -1));
            if (prevTrend === 'UP') {
                return {
                    pattern: 'SHOOTING_STAR',
                    signal: 'SELL',
                    confidence: 80,
                    description: 'Shooting Star indicates bearish reversal'
                };
            }
        }
        return null;
    }

    /**
     * Bullish/Bearish Engulfing
     */
    detectEngulfing(ohlcData) {
        if (ohlcData.length < 2) return null;
        
        const prev = ohlcData[ohlcData.length - 2];
        const curr = ohlcData[ohlcData.length - 1];
        
        // Bullish Engulfing
        if (this.isBearish(prev) && this.isBullish(curr) &&
            curr.open < prev.close && curr.close > prev.open) {
            return {
                pattern: 'BULLISH_ENGULFING',
                signal: 'BUY',
                confidence: 85,
                description: 'Bullish engulfing pattern - strong buy signal'
            };
        }
        
        // Bearish Engulfing
        if (this.isBullish(prev) && this.isBearish(curr) &&
            curr.open > prev.close && curr.close < prev.open) {
            return {
                pattern: 'BEARISH_ENGULFING',
                signal: 'SELL',
                confidence: 85,
                description: 'Bearish engulfing pattern - strong sell signal'
            };
        }
        
        return null;
    }

    /**
     * Morning Star - Bullish reversal (3 candles)
     */
    detectMorningStar(ohlcData) {
        if (ohlcData.length < 3) return null;
        
        const first = ohlcData[ohlcData.length - 3];
        const second = ohlcData[ohlcData.length - 2];
        const third = ohlcData[ohlcData.length - 1];
        
        if (this.isBearish(first) && 
            this.getCandleBody(second) < this.getCandleBody(first) * 0.3 &&
            this.isBullish(third) &&
            third.close > (first.open + first.close) / 2) {
            return {
                pattern: 'MORNING_STAR',
                signal: 'BUY',
                confidence: 90,
                description: 'Morning Star - powerful bullish reversal'
            };
        }
        return null;
    }

    /**
     * Evening Star - Bearish reversal (3 candles)
     */
    detectEveningStar(ohlcData) {
        if (ohlcData.length < 3) return null;
        
        const first = ohlcData[ohlcData.length - 3];
        const second = ohlcData[ohlcData.length - 2];
        const third = ohlcData[ohlcData.length - 1];
        
        if (this.isBullish(first) && 
            this.getCandleBody(second) < this.getCandleBody(first) * 0.3 &&
            this.isBearish(third) &&
            third.close < (first.open + first.close) / 2) {
            return {
                pattern: 'EVENING_STAR',
                signal: 'SELL',
                confidence: 90,
                description: 'Evening Star - powerful bearish reversal'
            };
        }
        return null;
    }

    /**
     * Three White Soldiers - Strong bullish continuation
     */
    detectThreeWhiteSoldiers(ohlcData) {
        if (ohlcData.length < 3) return null;
        
        const candles = ohlcData.slice(-3);
        
        if (candles.every(c => this.isBullish(c)) &&
            candles[1].close > candles[0].close &&
            candles[2].close > candles[1].close &&
            candles.every(c => this.getCandleBody(c) > this.getCandleRange(c) * 0.6)) {
            return {
                pattern: 'THREE_WHITE_SOLDIERS',
                signal: 'BUY',
                confidence: 88,
                description: 'Three White Soldiers - strong bullish momentum'
            };
        }
        return null;
    }

    /**
     * Three Black Crows - Strong bearish continuation
     */
    detectThreeBlackCrows(ohlcData) {
        if (ohlcData.length < 3) return null;
        
        const candles = ohlcData.slice(-3);
        
        if (candles.every(c => this.isBearish(c)) &&
            candles[1].close < candles[0].close &&
            candles[2].close < candles[1].close &&
            candles.every(c => this.getCandleBody(c) > this.getCandleRange(c) * 0.6)) {
            return {
                pattern: 'THREE_BLACK_CROWS',
                signal: 'SELL',
                confidence: 88,
                description: 'Three Black Crows - strong bearish momentum'
            };
        }
        return null;
    }

    /**
     * Detect overall trend direction
     */
    detectTrend(ohlcData) {
        if (ohlcData.length < 5) return 'NEUTRAL';
        
        const closes = ohlcData.map(d => d.close);
        const firstHalf = closes.slice(0, Math.floor(closes.length / 2));
        const secondHalf = closes.slice(Math.floor(closes.length / 2));
        
        const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
        const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
        
        if (avgSecond > avgFirst * 1.005) return 'UP';
        if (avgSecond < avgFirst * 0.995) return 'DOWN';
        return 'NEUTRAL';
    }
}

export const candlestickPatternService = new CandlestickPatternService();