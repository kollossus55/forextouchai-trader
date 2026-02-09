/**
 * Chart Pattern Recognition Service
 * Detects classic chart patterns like Head & Shoulders, Triangles, etc.
 */

class ChartPatternService {
    /**
     * Analyze price data for chart patterns
     * @param {Array} ohlcData - Array of OHLC candles
     * @returns {Object|null} Pattern details if found
     */
    detectPatterns(ohlcData) {
        if (!ohlcData || ohlcData.length < 20) return null;
        
        const patterns = [
            this.detectHeadAndShoulders(ohlcData),
            this.detectInverseHeadAndShoulders(ohlcData),
            this.detectDoubleTop(ohlcData),
            this.detectDoubleBottom(ohlcData),
            this.detectTriangle(ohlcData),
            this.detectFlag(ohlcData)
        ].filter(p => p !== null);
        
        return patterns.length > 0 ? patterns[0] : null;
    }

    findPeaks(data, lookback = 5) {
        const peaks = [];
        for (let i = lookback; i < data.length - lookback; i++) {
            let isPeak = true;
            for (let j = 1; j <= lookback; j++) {
                if (data[i].high <= data[i - j].high || data[i].high <= data[i + j].high) {
                    isPeak = false;
                    break;
                }
            }
            if (isPeak) peaks.push({ index: i, price: data[i].high });
        }
        return peaks;
    }

    findTroughs(data, lookback = 5) {
        const troughs = [];
        for (let i = lookback; i < data.length - lookback; i++) {
            let isTrough = true;
            for (let j = 1; j <= lookback; j++) {
                if (data[i].low >= data[i - j].low || data[i].low >= data[i + j].low) {
                    isTrough = false;
                    break;
                }
            }
            if (isTrough) troughs.push({ index: i, price: data[i].low });
        }
        return troughs;
    }

    /**
     * Head and Shoulders - Bearish reversal
     */
    detectHeadAndShoulders(ohlcData) {
        const peaks = this.findPeaks(ohlcData, 3);
        if (peaks.length < 3) return null;
        
        // Get last 3 peaks
        const recentPeaks = peaks.slice(-3);
        const [leftShoulder, head, rightShoulder] = recentPeaks;
        
        // Check if middle peak (head) is higher than shoulders
        if (head.price > leftShoulder.price * 1.02 && 
            head.price > rightShoulder.price * 1.02 &&
            Math.abs(leftShoulder.price - rightShoulder.price) / leftShoulder.price < 0.03) {
            
            return {
                pattern: 'HEAD_AND_SHOULDERS',
                signal: 'SELL',
                confidence: 85,
                description: 'Head and Shoulders pattern - bearish reversal'
            };
        }
        return null;
    }

    /**
     * Inverse Head and Shoulders - Bullish reversal
     */
    detectInverseHeadAndShoulders(ohlcData) {
        const troughs = this.findTroughs(ohlcData, 3);
        if (troughs.length < 3) return null;
        
        const recentTroughs = troughs.slice(-3);
        const [leftShoulder, head, rightShoulder] = recentTroughs;
        
        if (head.price < leftShoulder.price * 0.98 && 
            head.price < rightShoulder.price * 0.98 &&
            Math.abs(leftShoulder.price - rightShoulder.price) / leftShoulder.price < 0.03) {
            
            return {
                pattern: 'INVERSE_HEAD_AND_SHOULDERS',
                signal: 'BUY',
                confidence: 85,
                description: 'Inverse Head and Shoulders - bullish reversal'
            };
        }
        return null;
    }

    /**
     * Double Top - Bearish reversal
     */
    detectDoubleTop(ohlcData) {
        const peaks = this.findPeaks(ohlcData, 4);
        if (peaks.length < 2) return null;
        
        const [first, second] = peaks.slice(-2);
        const priceDiff = Math.abs(first.price - second.price) / first.price;
        
        // Two peaks at similar levels
        if (priceDiff < 0.02 && second.index - first.index > 5) {
            return {
                pattern: 'DOUBLE_TOP',
                signal: 'SELL',
                confidence: 82,
                description: 'Double Top pattern - bearish reversal'
            };
        }
        return null;
    }

    /**
     * Double Bottom - Bullish reversal
     */
    detectDoubleBottom(ohlcData) {
        const troughs = this.findTroughs(ohlcData, 4);
        if (troughs.length < 2) return null;
        
        const [first, second] = troughs.slice(-2);
        const priceDiff = Math.abs(first.price - second.price) / first.price;
        
        if (priceDiff < 0.02 && second.index - first.index > 5) {
            return {
                pattern: 'DOUBLE_BOTTOM',
                signal: 'BUY',
                confidence: 82,
                description: 'Double Bottom pattern - bullish reversal'
            };
        }
        return null;
    }

    /**
     * Triangle Pattern - Continuation or reversal depending on breakout
     */
    detectTriangle(ohlcData) {
        if (ohlcData.length < 20) return null;
        
        const recent = ohlcData.slice(-20);
        const highs = recent.map(d => d.high);
        const lows = recent.map(d => d.low);
        
        // Calculate trend lines
        const highSlope = this.calculateSlope(highs);
        const lowSlope = this.calculateSlope(lows);
        
        // Ascending Triangle (flat top, rising bottom)
        if (Math.abs(highSlope) < 0.0001 && lowSlope > 0.0001) {
            return {
                pattern: 'ASCENDING_TRIANGLE',
                signal: 'BUY',
                confidence: 75,
                description: 'Ascending Triangle - bullish breakout expected'
            };
        }
        
        // Descending Triangle (falling top, flat bottom)
        if (highSlope < -0.0001 && Math.abs(lowSlope) < 0.0001) {
            return {
                pattern: 'DESCENDING_TRIANGLE',
                signal: 'SELL',
                confidence: 75,
                description: 'Descending Triangle - bearish breakout expected'
            };
        }
        
        // Symmetrical Triangle (converging lines)
        if (highSlope < -0.0001 && lowSlope > 0.0001) {
            const currentTrend = this.detectOverallTrend(ohlcData.slice(-30, -20));
            return {
                pattern: 'SYMMETRICAL_TRIANGLE',
                signal: currentTrend === 'UP' ? 'BUY' : 'SELL',
                confidence: 70,
                description: 'Symmetrical Triangle - breakout in trend direction'
            };
        }
        
        return null;
    }

    /**
     * Flag Pattern - Continuation pattern
     */
    detectFlag(ohlcData) {
        if (ohlcData.length < 15) return null;
        
        const recent = ohlcData.slice(-15);
        const strongMove = ohlcData.slice(-20, -15);
        
        // Check for strong prior move (pole)
        const poleMove = (strongMove[strongMove.length - 1].close - strongMove[0].close) / strongMove[0].close;
        
        if (Math.abs(poleMove) > 0.03) {
            const flagSlope = this.calculateSlope(recent.map(d => d.close));
            
            // Bull Flag (upward pole, slight downward flag)
            if (poleMove > 0 && flagSlope < -0.0005 && flagSlope > -0.002) {
                return {
                    pattern: 'BULL_FLAG',
                    signal: 'BUY',
                    confidence: 78,
                    description: 'Bull Flag - bullish continuation'
                };
            }
            
            // Bear Flag (downward pole, slight upward flag)
            if (poleMove < 0 && flagSlope > 0.0005 && flagSlope < 0.002) {
                return {
                    pattern: 'BEAR_FLAG',
                    signal: 'SELL',
                    confidence: 78,
                    description: 'Bear Flag - bearish continuation'
                };
            }
        }
        
        return null;
    }

    calculateSlope(values) {
        const n = values.length;
        let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
        
        for (let i = 0; i < n; i++) {
            sumX += i;
            sumY += values[i];
            sumXY += i * values[i];
            sumXX += i * i;
        }
        
        return (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    }

    detectOverallTrend(ohlcData) {
        if (ohlcData.length < 5) return 'NEUTRAL';
        
        const firstPrice = ohlcData[0].close;
        const lastPrice = ohlcData[ohlcData.length - 1].close;
        const change = (lastPrice - firstPrice) / firstPrice;
        
        if (change > 0.01) return 'UP';
        if (change < -0.01) return 'DOWN';
        return 'NEUTRAL';
    }
}

export const chartPatternService = new ChartPatternService();