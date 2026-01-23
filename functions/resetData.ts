import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { target = 'trades' } = await req.json().catch(() => ({}));

        let count = 0;
        
        if (target === 'trades' || target === 'all') {
            // Use service role to delete all trades regardless of ownership
            const trades = await base44.asServiceRole.entities.Trade.list(null, 100); 
            
            // Delete in parallel using service role
            await Promise.all(trades.map(t => base44.asServiceRole.entities.Trade.delete(t.id)));
            count += trades.length;
        }

        if (target === 'signals' || target === 'all') {
             const signals = await base44.asServiceRole.entities.Signal.list(null, 100);
             await Promise.all(signals.map(s => base44.asServiceRole.entities.Signal.delete(s.id)));
             count += signals.length;
        }

        return Response.json({ success: true, deleted: count });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});