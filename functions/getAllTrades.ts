import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Use service role to bypass RLS and get ALL open trades from MT4
        const openTrades = await base44.asServiceRole.entities.Trade.filter({ status: 'OPEN' }, '-updated_date', 100);
        
        return Response.json(openTrades);

    } catch (error) {
        console.error('[getAllTrades ERROR]:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});