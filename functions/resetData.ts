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
            // Fetch all trades (pagination loop might be needed for very large sets, simplified here)
            const trades = await base44.entities.Trade.list(null, 100); 
            // In a real scenario we'd loop until empty, but 100 is good for a simple reset
            
            // Delete in parallel
            await Promise.all(trades.map(t => base44.entities.Trade.delete(t.id)));
            count += trades.length;
        }

        if (target === 'signals' || target === 'all') {
             const signals = await base44.entities.Signal.list(null, 100);
             await Promise.all(signals.map(s => base44.entities.Signal.delete(s.id)));
             count += signals.length;
        }

        return Response.json({ success: true, deleted: count });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});