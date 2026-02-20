import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        console.log('[FORCE SYNC] Starting full reconciliation...');

        // Get all OPEN trades from database
        const openDbTrades = await base44.asServiceRole.entities.Trade.filter({ status: 'OPEN' });
        console.log(`[FORCE SYNC] Found ${openDbTrades.length} OPEN trades in database`);

        // Group by age
        const now = Date.now();
        const oldTrades = openDbTrades.filter(t => {
            const age = now - new Date(t.updated_date).getTime();
            return age > 3600000; // > 1 hour old
        });

        console.log(`[FORCE SYNC] ${oldTrades.length} trades are stale (>1 hour old)`);

        // Close all stale trades
        if (oldTrades.length > 0) {
            console.log('[FORCE SYNC] Closing stale trades:', oldTrades.map(t => `#${t.ticket} ${t.pair}`));
            
            for (const trade of oldTrades) {
                await base44.asServiceRole.entities.Trade.update(trade.id, { 
                    status: 'CLOSED'
                });
            }
        }

        // Get fresh count
        const remainingOpen = await base44.asServiceRole.entities.Trade.filter({ status: 'OPEN' });

        return Response.json({ 
            success: true,
            cleaned: oldTrades.length,
            remaining_open: remainingOpen.length,
            stale_tickets: oldTrades.map(t => t.ticket),
            message: `Closed ${oldTrades.length} stale trades. ${remainingOpen.length} active trades remain.`
        });

    } catch (error) {
        console.error('[FORCE SYNC ERROR]:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});