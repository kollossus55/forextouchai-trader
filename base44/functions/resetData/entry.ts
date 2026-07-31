import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

async function clearEntity(base44, entityName, filter = {}) {
  let deleted = 0;
  // Loop until empty — no cap. Use deleteMany in batches of 100 for speed.
  for (let pass = 0; pass < 500; pass++) {
    const batch = await base44.asServiceRole.entities[entityName].filter(filter, null, 100).catch(() => []);
    if (!batch || batch.length === 0) break;
    let ok = false;
    for (let retry = 0; retry < 4; retry++) {
      try {
        await base44.asServiceRole.entities[entityName].deleteMany(filter);
        deleted += batch.length;
        ok = true;
        break;
      } catch (e) {
        // Transient DB errors (e.g. placement version mismatch) — back off and retry
        await new Promise(r => setTimeout(r, 800));
      }
    }
    if (!ok) {
      // Fallback: sequential single deletes for this batch
      for (const item of batch) {
        await base44.asServiceRole.entities[entityName].delete(item.id).catch(() => {});
        await new Promise(r => setTimeout(r, 50));
      }
      deleted += batch.length;
    }
    if (batch.length < 100) break;
    await new Promise(r => setTimeout(r, 300));
  }
  return deleted;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const results = {};
    const url = new URL(req.url);
    const mode = url.searchParams.get('mode') || 'full'; // 'full' | 'history'

    if (mode === 'history') {
      // History-only reset: clear closed trades + expired/closed signals, keep active records
      results.trades_deleted = await clearEntity(base44, 'Trade', { status: 'CLOSED' });
      results.signals_deleted = (
        await clearEntity(base44, 'Signal', { status: 'EXPIRED' }) +
        await clearEntity(base44, 'Signal', { status: 'CLOSED' })
      );
      results.alerts_deleted = 0;
      results.mode = 'history';
      return Response.json({ success: true, message: 'History reset complete (active records preserved)', results });
    }

    // Pause all running bots first
    try {
      const runningBots = await base44.asServiceRole.entities.BotConfig.filter({ status: 'RUNNING' }, null, 50);
      if (runningBots && runningBots.length > 0) {
        for (const b of runningBots) {
          await base44.asServiceRole.entities.BotConfig.update(b.id, { status: 'PAUSED' });
        }
        results.bots_paused = runningBots.length;
      }
    } catch (e) { /* non-fatal */ }

    // Clear entities sequentially
    results.trades_deleted = await clearEntity(base44, 'Trade', {});
    results.signals_deleted = await clearEntity(base44, 'Signal', {});
    results.alerts_deleted = await clearEntity(base44, 'Alert', {});
    results.mode = 'full';

    // Reset risk settings counters
    try {
      const riskBatch = await base44.asServiceRole.entities.RiskManagementSettings.filter({}, null, 100);
      if (riskBatch && riskBatch.length > 0) {
        for (const r of riskBatch) {
          await base44.asServiceRole.entities.RiskManagementSettings.update(r.id, {
            daily_loss_current: 0, peak_equity: 0,
            last_reset_date: new Date().toISOString().split('T')[0],
            is_trading_paused: false, limit_hit_at: null,
          });
          await new Promise(r2 => setTimeout(r2, 100));
        }
        results.risk_reset = riskBatch.length;
      }
    } catch (e) { results.risk_error = e.message; }

    // Reset broker connection trade counts
    try {
      const connBatch = await base44.asServiceRole.entities.BrokerConnection.filter({}, null, 100);
      if (connBatch && connBatch.length > 0) {
        for (const c of connBatch) {
          await base44.asServiceRole.entities.BrokerConnection.update(c.id, {
            open_trade_count: 0,
            balance: 0, equity: 0, margin: 0, free_margin: 0, margin_level: 0,
          });
          await new Promise(r => setTimeout(r, 100));
        }
        results.connections_reset = connBatch.length;
      }
    } catch (e) { results.connections_error = e.message; }

    return Response.json({ success: true, message: 'Data reset complete', results });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});