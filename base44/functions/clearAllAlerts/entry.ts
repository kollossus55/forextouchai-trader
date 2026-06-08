import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Fetch and delete all alerts in batches using service role
        let deleted = 0;
        let hasMore = true;

        while (hasMore) {
            const alerts = await base44.asServiceRole.entities.Alert.list(undefined, 100);
            if (!alerts || alerts.length === 0) {
                hasMore = false;
                break;
            }
            await Promise.all(alerts.map(a => base44.asServiceRole.entities.Alert.delete(a.id)));
            deleted += alerts.length;
            if (alerts.length < 100) {
                hasMore = false;
            }
        }

        return Response.json({ success: true, deleted });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});