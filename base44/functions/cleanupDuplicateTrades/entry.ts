import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user || user.role !== 'admin') {
            return Response.json({ error: 'Admin only' }, { status: 403 });
        }

        const accountNumber = '67186277';
        const batchSize = 30; // process 30 at a time to stay under timeout

        const closed = await base44.asServiceRole.entities.Trade.filter(
            { owner_email: accountNumber, status: 'CLOSED' }, '-updated_date', 500
        );

        const bestByTicket = new Map();
        for (const t of closed) {
            if (!t.ticket) continue;
            const existing = bestByTicket.get(t.ticket);
            if (!existing || new Date(t.updated_date) > new Date(existing.updated_date)) {
                bestByTicket.set(t.ticket, t);
            }
        }

        const keepIds = new Set([...bestByTicket.values()].map(t => t.id));
        const toDelete = closed.filter(t => !keepIds.has(t.id)).slice(0, batchSize);

        let deleted = 0;
        const errors = [];
        for (const t of toDelete) {
            try {
                await base44.asServiceRole.entities.Trade.delete(t.id);
                deleted++;
            } catch (e) {
                errors.push(`ticket ${t.ticket}: ${e.message}`);
            }
            await new Promise(r => setTimeout(r, 200));
        }

        return Response.json({
            success: true,
            deleted_this_batch: deleted,
            remaining: Math.max(0, closed.length - bestByTicket.size - deleted),
            errors: errors.length > 0 ? errors.slice(0, 5) : [],
            hint: deleted > 0 ? 'Run this function again to delete the next batch' : 'Nothing left to delete',
        });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});