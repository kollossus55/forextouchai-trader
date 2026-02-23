import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        console.log('[FORCE SYNC] Checking MT4 connection status...');

        // CRITICAL: Check if MT4 is actually connected before "syncing"
        const connections = await base44.asServiceRole.entities.BrokerConnection.list(1);
        
        if (connections.length === 0) {
            return Response.json({ 
                error: 'No MT4/MT5 connection found',
                success: false 
            }, { status: 400 });
        }

        const connection = connections[0];
        const now = Date.now();
        const lastSync = connection.last_sync ? new Date(connection.last_sync).getTime() : 0;
        const timeSinceSync = now - lastSync;

        // If last sync was more than 60 seconds ago, MT4 is likely disconnected
        if (timeSinceSync > 60000 || connection.connection_status !== 'CONNECTED') {
            return Response.json({ 
                error: 'MT4/MT5 is disconnected. Cannot sync - no live data available.',
                connection_status: connection.connection_status,
                last_sync: connection.last_sync,
                seconds_since_sync: Math.floor(timeSinceSync / 1000),
                success: false 
            }, { status: 400 });
        }

        console.log('[FORCE SYNC] MT4 connected - starting cleanup...');

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