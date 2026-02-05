import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch risk settings
    const riskSettings = await base44.entities.RiskManagementSettings.filter({
      created_by: user.email
    });

    if (!riskSettings || riskSettings.length === 0) {
      return Response.json({ 
        status: 'no_settings',
        message: 'No risk management settings configured'
      });
    }

    const settings = riskSettings[0];

    // Fetch broker connection for account balance
    const connections = await base44.entities.BrokerConnection.filter({
      created_by: user.email
    });

    if (!connections || connections.length === 0) {
      return Response.json({ 
        status: 'no_connection',
        message: 'No broker connection found'
      });
    }

    const connection = connections[0];
    const accountBalance = connection.balance || 0;
    const accountEquity = connection.equity || 0;

    // Fetch today's trades
    const today = new Date().toISOString().split('T')[0];
    const allTrades = await base44.entities.Trade.filter({
      created_by: user.email
    });

    const todayTrades = allTrades.filter(t => 
      t.created_date?.startsWith(today) && t.status === 'CLOSED'
    );

    const dailyPnL = todayTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const dailyLossPercent = accountBalance > 0 ? Math.abs((dailyPnL / accountBalance) * 100) : 0;

    // Calculate drawdown
    const peakEquity = settings.peak_equity || accountEquity;
    const currentDrawdown = peakEquity > 0 ? ((peakEquity - accountEquity) / peakEquity) * 100 : 0;

    // Count open trades
    const openTrades = allTrades.filter(t => t.status === 'OPEN');
    const openTradesCount = openTrades.length;

    // Check for breaches
    const breaches = [];
    const warnings = [];

    // Daily loss check
    if (dailyLossPercent >= settings.max_daily_loss_percent) {
      breaches.push({
        type: 'daily_loss',
        message: `Daily loss limit breached: ${dailyLossPercent.toFixed(2)}% (limit: ${settings.max_daily_loss_percent}%)`,
        severity: 'critical'
      });
    } else if (dailyLossPercent >= (settings.max_daily_loss_percent * settings.alert_threshold_percent / 100)) {
      warnings.push({
        type: 'daily_loss',
        message: `Daily loss approaching limit: ${dailyLossPercent.toFixed(2)}% (limit: ${settings.max_daily_loss_percent}%)`,
        severity: 'warning'
      });
    }

    // Drawdown check
    if (currentDrawdown >= settings.max_drawdown_percent) {
      breaches.push({
        type: 'drawdown',
        message: `Drawdown limit breached: ${currentDrawdown.toFixed(2)}% (limit: ${settings.max_drawdown_percent}%)`,
        severity: 'critical'
      });
    } else if (currentDrawdown >= (settings.max_drawdown_percent * settings.alert_threshold_percent / 100)) {
      warnings.push({
        type: 'drawdown',
        message: `Drawdown approaching limit: ${currentDrawdown.toFixed(2)}% (limit: ${settings.max_drawdown_percent}%)`,
        severity: 'warning'
      });
    }

    // Open trades check
    if (openTradesCount >= settings.max_concurrent_trades) {
      breaches.push({
        type: 'concurrent_trades',
        message: `Max concurrent trades reached: ${openTradesCount} (limit: ${settings.max_concurrent_trades})`,
        severity: 'critical'
      });
    } else if (openTradesCount >= (settings.max_concurrent_trades * settings.alert_threshold_percent / 100)) {
      warnings.push({
        type: 'concurrent_trades',
        message: `Approaching max concurrent trades: ${openTradesCount} (limit: ${settings.max_concurrent_trades})`,
        severity: 'warning'
      });
    }

    // Create alerts for breaches and warnings
    for (const breach of breaches) {
      await base44.entities.Alert.create({
        title: '⚠️ Risk Limit Breached',
        message: breach.message,
        type: 'ERROR'
      });
    }

    for (const warning of warnings) {
      await base44.entities.Alert.create({
        title: '⚡ Risk Threshold Warning',
        message: warning.message,
        type: 'WARNING'
      });
    }

    // If stop_trading_on_limit is enabled and there are breaches, pause all bots
    if (settings.stop_trading_on_limit && breaches.length > 0 && !settings.is_trading_paused) {
      // Pause all bots
      const userBots = await base44.entities.BotConfig.filter({
        owner_email: user.email,
        status: 'RUNNING'
      });

      for (const bot of userBots) {
        await base44.entities.BotConfig.update(bot.id, { status: 'PAUSED' });
      }

      // Update risk settings to mark as paused
      await base44.entities.RiskManagementSettings.update(settings.id, {
        is_trading_paused: true
      });

      // Send email notification
      await base44.integrations.Core.SendEmail({
        to: user.email,
        subject: '🚨 ForexTouchAI - Trading Paused Due to Risk Limits',
        body: `Trading has been automatically paused due to risk limit breaches:\n\n${breaches.map(b => `- ${b.message}`).join('\n')}\n\nPlease review your risk management settings and account status before resuming trading.`
      });
    }

    // Update peak equity if current is higher
    if (accountEquity > peakEquity) {
      await base44.entities.RiskManagementSettings.update(settings.id, {
        peak_equity: accountEquity
      });
    }

    return Response.json({
      status: 'success',
      metrics: {
        dailyLossPercent: dailyLossPercent.toFixed(2),
        currentDrawdown: currentDrawdown.toFixed(2),
        openTradesCount
      },
      breaches,
      warnings,
      tradingPaused: settings.is_trading_paused || (settings.stop_trading_on_limit && breaches.length > 0)
    });

  } catch (error) {
    console.error('Error monitoring risk limits:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});