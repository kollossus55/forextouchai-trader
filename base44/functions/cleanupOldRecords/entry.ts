import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const oldSignals = await base44.asServiceRole.entities.Signal.filter(
      { status: { $in: ['CLOSED', 'EXPIRED', 'SKIPPED'] }, created_date: { $lt: sevenDaysAgo } },
      null, 200
    );

    const oldTrades = await base44.asServiceRole.entities.Trade.filter(
      { status: 'CLOSED', created_date: { $lt: sevenDaysAgo } },
      null, 200
    );

    let signalsDeleted = 0;
    let tradesDeleted = 0;

    for (const s of (oldSignals || [])) {
      await base44.asServiceRole.entities.Signal.delete(s.id).catch(() => {});
      signalsDeleted++;
    }

    for (const t of (oldTrades || [])) {
      await base44.asServiceRole.entities.Trade.delete(t.id).catch(() => {});
      tradesDeleted++;
    }

    console.log(`[cleanupOldRecords] Deleted ${signalsDeleted} signals, ${tradesDeleted} trades`);

    return Response.json({
      success: true,
      signals_deleted: signalsDeleted,
      trades_deleted: tradesDeleted,
      cutoff: sevenDaysAgo
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});