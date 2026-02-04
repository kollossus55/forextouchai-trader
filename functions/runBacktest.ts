import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Generate realistic historical OHLC data
function generateHistoricalData(symbol, bars = 1000, timeframe = 'H1') {
  const data = [];
  let basePrice = 1.0850; // EUR/USD-like
  
  if (symbol.includes('JPY')) basePrice = 145.50;
  else if (symbol.includes('GBP')) basePrice = 1.2650;
  else if (symbol.includes('AUD')) basePrice = 0.6550;
  else if (symbol.includes('XAU')) basePrice = 2050.00;
  
  const volatility = symbol.includes('XAU') ? 15 : 
                     symbol.includes('GBP') ? 0.008 : 0.005;
  
  for (let i = 0; i < bars; i++) {
    const change = (Math.random() - 0.5) * volatility * basePrice;
    const open = basePrice;
    const high = open + Math.abs(change) * (0.5 + Math.random() * 0.5);
    const low = open - Math.abs(change) * (0.5 + Math.random() * 0.5);
    const close = open + change;
    
    data.push({ open, high, low, close, volume: 1000 + Math.random() * 5000 });
    basePrice = close;
  }
  
  return data;
}

// Calculate RSI
function calculateRSI(data, period = 14) {
  const changes = [];
  for (let i = 1; i < data.length; i++) {
    changes.push(data[i].close - data[i - 1].close);
  }
  
  let avgGain = 0, avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;
  
  const rsi = [];
  for (let i = period; i < changes.length; i++) {
    const change = changes[i];
    if (change > 0) {
      avgGain = (avgGain * (period - 1) + change) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.abs(change)) / period;
    }
    
    const rs = avgGain / (avgLoss || 0.0001);
    rsi.push(100 - (100 / (1 + rs)));
  }
  
  return rsi;
}

// Calculate EMA
function calculateEMA(data, period) {
  const ema = [];
  const multiplier = 2 / (period + 1);
  let emaValue = data[0].close;
  
  for (let i = 0; i < data.length; i++) {
    emaValue = (data[i].close - emaValue) * multiplier + emaValue;
    ema.push(emaValue);
  }
  
  return ema;
}

// Strategy logic
function evaluateStrategy(strategyType, data, index, indicators) {
  const current = data[index];
  const rsi = indicators.rsi[index - 14] || 50;
  const ema200 = indicators.ema200[index] || current.close;
  
  let signal = null;
  
  switch (strategyType) {
    case 'SCALPING':
      // Quick mean reversion on RSI
      if (rsi < 30 && current.close < ema200) signal = 'BUY';
      else if (rsi > 70 && current.close > ema200) signal = 'SELL';
      break;
      
    case 'SWING':
      // Trend following with EMA
      if (current.close > ema200 && rsi > 50 && rsi < 70) signal = 'BUY';
      else if (current.close < ema200 && rsi < 50 && rsi > 30) signal = 'SELL';
      break;
      
    case 'DAY_TRADING':
      // Balanced approach
      if (rsi < 35 && current.close < current.open) signal = 'BUY';
      else if (rsi > 65 && current.close > current.open) signal = 'SELL';
      break;
      
    case 'AI_PREDICTIVE':
      // Advanced multi-indicator
      const momentum = current.close - data[Math.max(0, index - 5)].close;
      if (rsi < 40 && momentum > 0 && current.close > ema200) signal = 'BUY';
      else if (rsi > 60 && momentum < 0 && current.close < ema200) signal = 'SELL';
      break;
      
    default:
      // Generic strategy
      if (rsi < 35) signal = 'BUY';
      else if (rsi > 65) signal = 'SELL';
  }
  
  return signal;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const { botId, symbol, timeframe, initialBalance, startDate, endDate } = await req.json();
    
    // Fetch bot config
    const bot = await base44.entities.BotConfig.get(botId);
    if (!bot) {
      return Response.json({ error: 'Bot not found' }, { status: 404 });
    }
    
    // Generate historical data (in production, fetch from real API)
    const historicalData = generateHistoricalData(symbol, 1000, timeframe);
    
    // Calculate indicators
    const rsi = calculateRSI(historicalData);
    const ema200 = calculateEMA(historicalData, 200);
    
    const indicators = { rsi, ema200 };
    
    // Run backtest simulation
    let balance = initialBalance;
    let equity = initialBalance;
    const trades = [];
    let openTrade = null;
    let maxEquity = initialBalance;
    let maxDrawdown = 0;
    
    const lotSize = bot.lot_size || 0.01;
    const pipValue = symbol.includes('JPY') ? 0.01 : 0.0001;
    const contractSize = 100000;
    
    for (let i = 200; i < historicalData.length; i++) {
      const signal = evaluateStrategy(bot.strategy_type, historicalData, i, indicators);
      
      // Close existing trade
      if (openTrade) {
        const currentPrice = historicalData[i].close;
        const priceDiff = openTrade.type === 'BUY' 
          ? (currentPrice - openTrade.entryPrice) 
          : (openTrade.entryPrice - currentPrice);
        const pips = priceDiff / pipValue;
        const profit = pips * pipValue * contractSize * lotSize;
        
        // Check SL/TP
        const hitSL = (openTrade.type === 'BUY' && currentPrice <= openTrade.stopLoss) ||
                      (openTrade.type === 'SELL' && currentPrice >= openTrade.stopLoss);
        const hitTP = (openTrade.type === 'BUY' && currentPrice >= openTrade.takeProfit) ||
                      (openTrade.type === 'SELL' && currentPrice <= openTrade.takeProfit);
        
        if (hitSL || hitTP) {
          const finalProfit = hitTP ? 
            (openTrade.type === 'BUY' ? (openTrade.takeProfit - openTrade.entryPrice) : (openTrade.entryPrice - openTrade.takeProfit)) / pipValue * pipValue * contractSize * lotSize :
            (openTrade.type === 'BUY' ? (openTrade.stopLoss - openTrade.entryPrice) : (openTrade.entryPrice - openTrade.stopLoss)) / pipValue * pipValue * contractSize * lotSize;
          
          balance += finalProfit;
          equity = balance;
          
          trades.push({
            entry: openTrade.entryPrice,
            exit: hitTP ? openTrade.takeProfit : openTrade.stopLoss,
            type: openTrade.type,
            profit: finalProfit,
            result: hitTP ? 'WIN' : 'LOSS'
          });
          
          openTrade = null;
        } else {
          equity = balance + profit;
        }
      }
      
      // Open new trade
      if (!openTrade && signal) {
        const entryPrice = historicalData[i].close;
        const slPips = bot.stop_loss_pips || 30;
        const tpPips = bot.take_profit_pips || 60;
        
        openTrade = {
          type: signal,
          entryPrice,
          stopLoss: signal === 'BUY' ? entryPrice - (slPips * pipValue) : entryPrice + (slPips * pipValue),
          takeProfit: signal === 'BUY' ? entryPrice + (tpPips * pipValue) : entryPrice - (tpPips * pipValue)
        };
      }
      
      // Track drawdown
      if (equity > maxEquity) maxEquity = equity;
      const drawdown = ((maxEquity - equity) / maxEquity) * 100;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }
    
    // Calculate metrics
    const totalTrades = trades.length;
    const winningTrades = trades.filter(t => t.result === 'WIN').length;
    const losingTrades = trades.filter(t => t.result === 'LOSS').length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    
    const grossProfit = trades.filter(t => t.profit > 0).reduce((sum, t) => sum + t.profit, 0);
    const grossLoss = Math.abs(trades.filter(t => t.profit < 0).reduce((sum, t) => sum + t.profit, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;
    
    const totalPnl = balance - initialBalance;
    const returnPercent = (totalPnl / initialBalance) * 100;
    
    // Sharpe ratio (simplified)
    const returns = trades.map(t => t.profit / initialBalance);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / (returns.length || 1);
    const stdDev = Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (returns.length || 1));
    const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;
    
    return Response.json({
      success: true,
      results: {
        totalTrades,
        winRate: Number(winRate.toFixed(1)),
        totalPnl: Number(totalPnl.toFixed(2)),
        profitFactor: Number(profitFactor.toFixed(2)),
        maxDrawdown: Number(maxDrawdown.toFixed(1)),
        sharpeRatio: Number(sharpeRatio.toFixed(2)),
        returnPercent: Number(returnPercent.toFixed(2)),
        winningTrades,
        losingTrades,
        grossProfit: Number(grossProfit.toFixed(2)),
        grossLoss: Number(grossLoss.toFixed(2)),
        trades: trades.slice(-20) // Last 20 trades
      }
    });
    
  } catch (error) {
    console.error('Backtest error:', error);
    return Response.json({ 
      error: error.message || 'Backtest failed' 
    }, { status: 500 });
  }
});