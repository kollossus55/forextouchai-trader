import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // Use service role to fetch signals for external MT4 connection
        // (Bypasses need for user login cookie in the EA)
        const signals = await base44.asServiceRole.entities.Signal.list('-created_date', 1);
        
        if (signals && signals.length > 0) {
            // Return the latest signal
            return Response.json(signals[0]);
        }
        
        return Response.json({ status: "NO_SIGNAL", id: "" });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});