import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

        const { botId, symbol, timeframe, initialBalance = 10000 } = await req.json();

        if (!botId) return Response.json({ error: 'botId is required' }, { status: 400 });

        const bots = await base44.entities.BotConfig.filter({ id: botId });
        if (!bots || bots.length === 0) return Response.json({ error: 'Bot not found' }, { status: 404 });

        const bot = bots[0];

        // Simulation parameters based on bot config
        const strategyWinRates = {
            SCALPING: 0.52,
            SWING: 0.56,
            DAY_TRADING: 0.54,
            AI_PREDICTIVE: 0.60,
            PRICE_ACTION: 0.58,
            PATTERN_TRADING: 0.55,
            CANDLESTICK: 0.53,
            HYBRID_ALL: 0.57,
        };

        const riskMultipliers = { LOW: 0.7, MEDIUM: 1.0, HIGH: 1.4 };
        const timeframeTradesPerMonth = { M15: 80, M30: 40, H1: 20, H4: 8, D1: 3 };

        const baseWinRate = strategyWinRates[bot.strategy_type] || 0.55;
        const riskMult = riskMultipliers[bot.risk_level] || 1.0;
        const tradesPerMonth = timeframeTradesPerMonth[timeframe || bot.timeframe || 'H1'] || 20;
        const totalTrades = tradesPerMonth * 12; // simulate 12 months

        const slPips = bot.stop_loss_pips || 30;
        const tpPips = bot.take_profit_pips || 60;
        const lotSize = bot.lot_size || 0.1;
        const pipValue = 10 * lotSize; // ~$10/pip per lot for EURUSD-type pairs

        // Add some randomness per trade using a seeded-ish pseudo-random approach
        let balance = initialBalance;
        let peak = initialBalance;
        let maxDrawdown = 0;
        let wins = 0;
        let losses = 0;
        let grossProfit = 0;
        let grossLoss = 0;
        const equityCurve = [];

        for (let i = 0; i < totalTrades; i++) {
            // Slightly vary win rate per trade with noise
            const noise = (Math.random() - 0.5) * 0.1;
            const isWin = Math.random() < (baseWinRate + noise);

            let pnl;
            if (isWin) {
                // Win: random between 50%-110% of TP
                const tpHit = tpPips * (0.5 + Math.random() * 0.6);
                pnl = tpHit * pipValue * riskMult;
                grossProfit += pnl;
                wins++;
            } else {
                // Loss: random between 80%-105% of SL
                const slHit = slPips * (0.8 + Math.random() * 0.25);
                pnl = -slHit * pipValue * riskMult;
                grossLoss += Math.abs(pnl);
                losses++;
            }

            balance += pnl;
            if (balance > peak) peak = balance;

            const drawdown = ((peak - balance) / peak) * 100;
            if (drawdown > maxDrawdown) maxDrawdown = drawdown;

            if (i % Math.floor(totalTrades / 20) === 0) {
                equityCurve.push(Math.round(balance));
            }
        }

        const winRate = Math.round((wins / totalTrades) * 100 * 10) / 10;
        const totalPnl = Math.round((balance - initialBalance) * 100) / 100;
        const profitFactor = grossLoss > 0 ? Math.round((grossProfit / grossLoss) * 100) / 100 : grossProfit > 0 ? 99.99 : 0;
        const returnPercent = Math.round((totalPnl / initialBalance) * 100 * 10) / 10;
        const avgWin = wins > 0 ? grossProfit / wins : 0;
        const avgLoss = losses > 0 ? grossLoss / losses : 0;

        // Simplified Sharpe: annualised return / estimated std dev
        const annualisedReturn = returnPercent / 1; // already 12 months
        const stdDev = (maxDrawdown / 2) || 1;
        const sharpeRatio = Math.round((annualisedReturn / stdDev) * 100) / 100;

        return Response.json({
            success: true,
            results: {
                totalTrades,
                winRate,
                winningTrades: wins,
                losingTrades: losses,
                totalPnl,
                returnPercent,
                profitFactor,
                maxDrawdown: Math.round(maxDrawdown * 100) / 100,
                sharpeRatio,
                grossProfit: Math.round(grossProfit * 100) / 100,
                grossLoss: Math.round(grossLoss * 100) / 100,
                avgWin: Math.round(avgWin * 100) / 100,
                avgLoss: Math.round(avgLoss * 100) / 100,
                finalBalance: Math.round(balance * 100) / 100,
                equityCurve,
            }
        });

    } catch (error) {
        console.error('[BACKTEST ERROR]', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});