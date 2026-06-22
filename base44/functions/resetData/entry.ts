import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Delete a small batch, retry once on rate limit
async function deleteBatch(base44, entityName, ids) {
  for (const id of ids) {
    try {
      await base44.asServiceRole.entities[entityName].delete(id);
    } catch (e) {
      if (e.message?.includes('Rate limit')) {
        await new Promise(r => setTimeout(r, 2000));
        await base44.asServiceRole.entities[entityName].delete(id);
      }
    }
    await new Promise(r => setTimeout(r, 150));
  }
}

async function clearEntity(base44, entityName) {
  let total = 0;
  while (true) {
    let batch;
    try {
      batch = await base44.asServiceRole.entities[entityName].filter({}, null, 10);
    } catch (e) {
      await new Promise(r => setTimeout(r, 3000));
      batch = await base44.asServiceRole.entities[entityName].filter({}, null, 10);
    }
    if (!batch || batch.length === 0) break;
    await deleteBatch(base44, entityName, batch.map(i => i.id));
    total += batch.length;
    if (batch.length < 10) break;
    await new Promise(r => setTimeout(r, 1000));
  }
  return total;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const results = {};

    // Pause all running bots first to stop bridge traffic during reset
    try {
      const runningBots = await base44.asServiceRole.entities.BotConfig.filter({ status: 'RUNNING' }, null, 50);
      if (runningBots && runningBots.length > 0) {
        for (const bot of runningBots) {
          await base44.asServiceRole.entities.BotConfig.update(bot.id, { status: 'PAUSED' });
          await new Promise(r => setTimeout(r, 200));
        }
        results.bots_paused = runningBots.length;
      }
      // Wait for in-flight bridge requests to settle
      await new Promise(r => setTimeout(r, 3000));
    } catch (e) {
      // non-fatal — proceed anyway
    }

    // Clear entities one at a time to minimise concurrent API pressure
    results.trades_deleted = await clearEntity(base44, 'Trade');
    await new Promise(r => setTimeout(r, 1000));
    results.signals_deleted = await clearEntity(base44, 'Signal');
    await new Promise(r => setTimeout(r, 1000));
    results.alerts_deleted = await clearEntity(base44, 'Alert');

    // Reset risk settings
    let riskBatch;
    try {
      riskBatch = await base44.asServiceRole.entities.RiskManagementSettings.filter({}, null, 100);
    } catch (e) {
      await new Promise(r => setTimeout(r, 2000));
      riskBatch = await base44.asServiceRole.entities.RiskManagementSettings.filter({}, null, 100);
    }
    if (riskBatch && riskBatch.length > 0) {
      for (const r of riskBatch) {
        try {
          await base44.asServiceRole.entities.RiskManagementSettings.update(r.id, {
            daily_loss_current: 0, peak_equity: 0,
            last_reset_date: new Date().toISOString().split('T')[0],
            is_trading_paused: false, limit_hit_at: null,
          });
        } catch (e) {
          await new Promise(r => setTimeout(r, 1500));
          await base44.asServiceRole.entities.RiskManagementSettings.update(r.id, {
            daily_loss_current: 0, peak_equity: 0,
            last_reset_date: new Date().toISOString().split('T')[0],
            is_trading_paused: false, limit_hit_at: null,
          });
        }
        await new Promise(r => setTimeout(r, 300));
      }
      results.risk_reset = riskBatch.length;
    }

    // Reset broker connection stats
    let connBatch;
    try {
      connBatch = await base44.asServiceRole.entities.BrokerConnection.filter({}, null, 100);
    } catch (e) {
      await new Promise(r => setTimeout(r, 2000));
      connBatch = await base44.asServiceRole.entities.BrokerConnection.filter({}, null, 100);
    }
    if (connBatch && connBatch.length > 0) {
      for (const c of connBatch) {
        try {
          await base44.asServiceRole.entities.BrokerConnection.update(c.id, {
            connection_status: 'DISCONNECTED', last_sync: null,
            balance: 0, equity: 0, margin: 0, free_margin: 0,
            margin_level: 0, open_trade_count: 0,
          });
        } catch (e) {
          await new Promise(r => setTimeout(r, 1500));
          await base44.asServiceRole.entities.BrokerConnection.update(c.id, {
            connection_status: 'DISCONNECTED', last_sync: null,
            balance: 0, equity: 0, margin: 0, free_margin: 0,
            margin_level: 0, open_trade_count: 0,
          });
        }
        await new Promise(r => setTimeout(r, 300));
      }
      results.connections_reset = connBatch.length;
    }

    return Response.json({ success: true, message: 'Data reset complete', results });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});