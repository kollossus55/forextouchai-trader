import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        let deleted = 0;
        let rounds = 0;
        const MAX_ROUNDS = 50;

        while (rounds < MAX_ROUNDS) {
            const alerts = await base44.asServiceRole.entities.Alert.list(undefined, 5);
            if (!alerts || alerts.length === 0) break;

            for (const alert of alerts) {
                await base44.asServiceRole.entities.Alert.delete(alert.id);
                await sleep(300);
            }

            deleted += alerts.length;
            rounds++;

            if (alerts.length < 5) break;
            await sleep(300);
        }

        return Response.json({ success: true, deleted });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});