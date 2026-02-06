import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // Get all pending signals
        const pendingSignals = await base44.entities.Signal.filter({ status: 'PENDING' });
        
        if (pendingSignals.length === 0) {
            return Response.json({ 
                success: true, 
                message: 'No pending signals',
                executed: 0 
            });
        }

        const results = [];
        
        for (const signal of pendingSignals) {
            try {
                // Create trade from signal
                const trade = await base44.entities.Trade.create({
                    pair: signal.pair,
                    type: signal.type,
                    lot_size: signal.lot_size || 0.01,
                    open_price: signal.entry_price,
                    status: 'OPEN',
                    is_auto: true,
                    bot_id: signal.bot_id,
                    owner_email: signal.created_by
                });

                // Update signal status to ACTIVE
                await base44.entities.Signal.update(signal.id, {
                    status: 'ACTIVE'
                });

                results.push({
                    signal_id: signal.id,
                    trade_id: trade.id,
                    pair: signal.pair,
                    type: signal.type,
                    success: true
                });
            } catch (error) {
                results.push({
                    signal_id: signal.id,
                    pair: signal.pair,
                    success: false,
                    error: error.message
                });
            }
        }

        return Response.json({
            success: true,
            executed: results.filter(r => r.success).length,
            failed: results.filter(r => !r.success).length,
            results
        });

    } catch (error) {
        return Response.json({ 
            success: false, 
            error: error.message 
        }, { status: 500 });
    }
});