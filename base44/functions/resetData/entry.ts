import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

async function deleteAll(base44, entityName, batchSize = 200) {
  let deleted = 0;
  while (true) {
    const batch = await base44.asServiceRole.entities[entityName].filter({}, null, batchSize);
    if (!batch || batch.length === 0) break;
    for (const item of batch) {
      await base44.asServiceRole.entities[entityName].delete(item.id);
      deleted++;
    }
    // Small delay between batches to avoid rate limits
    if (batch.length === batchSize) await new Promise(r => setTimeout(r, 500));
  }
  return deleted;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { target } = await req.json().catch(() => ({}));

    const results = {};

    if (!target || target === 'trades') {
      results.trades_deleted = await deleteAll(base44, 'Trade', 100);
    }

    if (!target || target === 'signals') {
      results.signals_deleted = await deleteAll(base44, 'Signal', 100);
    }

    if (!target || target === 'alerts') {
      results.alerts_deleted = await deleteAll(base44, 'Alert', 100);
    }

    if (!target || target === 'risk') {
      let riskCount = 0;
      while (true) {
        const batch = await base44.asServiceRole.entities.RiskManagementSettings.filter({}, null, 50);
        if (!batch || batch.length === 0) break;
        for (const r of batch) {
          await base44.asServiceRole.entities.RiskManagementSettings.update(r.id, {
            daily_loss_current: 0,
            peak_equity: 0,
            last_reset_date: new Date().toISOString().split('T')[0],
            is_trading_paused: false,
            limit_hit_at: null
          });
          riskCount++;
        }
        if (batch.length < 50) break;
        await new Promise(r => setTimeout(r, 500));
      }
      results.risk_reset = riskCount;
    }

    // Always reset broker connection stats so stale balance/equity/sync info is cleared
    if (!target || target === 'connections') {
      let connCount = 0;
      while (true) {
        const batch = await base44.asServiceRole.entities.BrokerConnection.filter({}, null, 50);
        if (!batch || batch.length === 0) break;
        for (const c of batch) {
          await base44.asServiceRole.entities.BrokerConnection.update(c.id, {
            connection_status: 'DISCONNECTED',
            last_sync: null,
            balance: 0,
            equity: 0,
            margin: 0,
            free_margin: 0,
            margin_level: 0,
            open_trade_count: 0,
          });
          connCount++;
        }
        if (batch.length < 50) break;
        await new Promise(r => setTimeout(r, 500));
      }
      results.connections_reset = connCount;
    }

    return Response.json({ success: true, message: 'Data reset complete', results });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});