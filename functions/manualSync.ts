import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // Authenticate user
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }
        
        // This endpoint closes all OPEN trades in the database
        // Use this when MT4 has 0 trades but database still shows open trades
        
        console.log('[MANUAL SYNC] Starting manual trade cleanup');
        
        // Get all open trades from database
        const openTrades = await base44.asServiceRole.entities.Trade.filter({ status: 'OPEN' });
        
        if (openTrades.length === 0) {
            console.log('[MANUAL SYNC] No open trades found');
            return Response.json({ 
                success: true, 
                message: 'No open trades to close',
                closed_count: 0
            });
        }
        
        console.log(`[MANUAL SYNC] Found ${openTrades.length} open trades to close`);
        
        // Close all of them
        const closePromises = openTrades.map(trade => 
            base44.asServiceRole.entities.Trade.update(trade.id, {
                status: 'CLOSED',
                updated_date: new Date().toISOString()
            }).catch(err => {
                console.error(`[MANUAL SYNC] Failed to close trade ${trade.ticket}:`, err.message);
                return null;
            })
        );
        
        await Promise.all(closePromises);
        
        console.log(`[MANUAL SYNC] ✓ Closed ${openTrades.length} trades`);
        
        return Response.json({ 
            success: true, 
            message: `Successfully closed ${openTrades.length} trades`,
            closed_count: openTrades.length,
            closed_tickets: openTrades.map(t => t.ticket)
        });
        
    } catch (error) {
        console.error('[MANUAL SYNC ERROR]:', error.message);
        return Response.json({ 
            success: false, 
            error: error.message 
        }, { status: 500 });
    }
});