import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Get ALL trades (open and closed)
        const allTrades = await base44.asServiceRole.entities.Trade.list('-updated_date', 100);
        const openTrades = allTrades.filter(t => t.status === 'OPEN');
        const closedTrades = allTrades.filter(t => t.status === 'CLOSED');

        // Group by update time
        const now = Date.now();
        const recentlyUpdated = openTrades.filter(t => {
            const age = now - new Date(t.updated_date).getTime();
            return age < 60000; // < 1 minute
        });

        const stale = openTrades.filter(t => {
            const age = now - new Date(t.updated_date).getTime();
            return age > 300000; // > 5 minutes
        });

        return Response.json({
            summary: {
                total_trades: allTrades.length,
                open_trades: openTrades.length,
                closed_trades: closedTrades.length,
                recently_updated: recentlyUpdated.length,
                stale_trades: stale.length
            },
            open_trades_detail: openTrades.map(t => ({
                ticket: t.ticket,
                pair: t.pair,
                type: t.type,
                pnl: t.pnl,
                lot_size: t.lot_size,
                created: t.created_date,
                last_updated: t.updated_date,
                age_minutes: Math.floor((now - new Date(t.updated_date).getTime()) / 60000)
            })),
            stale_trades_detail: stale.map(t => ({
                ticket: t.ticket,
                pair: t.pair,
                age_minutes: Math.floor((now - new Date(t.updated_date).getTime()) / 60000)
            })),
            instructions: "Compare ticket numbers with MT4. Missing tickets mean MT4 hasn't sent them yet."
        });

    } catch (error) {
        console.error('[DIAGNOSE ERROR]:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});