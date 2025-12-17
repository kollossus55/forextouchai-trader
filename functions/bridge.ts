import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

// Robust retry with exponential backoff for network/rate-limit errors
const withRetry = async (fn, retries = 3, delay = 200) => {
    let lastError;
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            const msg = error.message?.toLowerCase() || "";
            // Retry on fetch, network, or rate limit errors
            if (msg.includes('fetch') || msg.includes('network') || msg.includes('limit')) {
                const isRateLimit = msg.includes('limit');
                // Aggressive backoff for rate limits (start at 500ms)
                const waitTime = isRateLimit ? (500 * Math.pow(2, i)) : (delay * Math.pow(2, i));
                console.warn(`Attempt ${i + 1} failed: ${error.message}. Retrying in ${waitTime}ms...`);
                await new Promise(r => setTimeout(r, waitTime));
            } else {
                throw error; 
            }
        }
    }
    throw lastError;
};

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // ---------------------------------------------------------
        // POST: Sync Trades & Account (Heavy Logic)
        // ---------------------------------------------------------
        if (req.method === 'POST') {
            let body;
            try {
                body = await req.json();
            } catch (e) {
                return Response.json({ error: "Invalid JSON" }, { status: 400 });
            }
            
            const { trades, account } = body;
            const errors = [];

            // 1. Account Sync (Optimized)
            if (account) {
                try {
                    // Fetch just the first connection to check existence
                    const connections = await withRetry(() => base44.asServiceRole.entities.BrokerConnection.list(1));
                    
                    if (connections.length > 0) {
                        // Only update connection info, don't create duplicates
                        await withRetry(() => base44.asServiceRole.entities.BrokerConnection.update(connections[0].id, {
                            balance: Number(account.balance) || 0,
                            equity: Number(account.equity) || 0,
                            margin: Number(account.margin) || 0,
                            free_margin: Number(account.free_margin) || 0,
                            margin_level: Number(account.margin_level) || 0,
                            connection_status: 'CONNECTED',
                            last_sync: new Date().toISOString()
                        }));
                    } else {
                        // Create initial connection record
                        await withRetry(() => base44.asServiceRole.entities.BrokerConnection.create({
                            platform: 'MT4',
                            server_name: account.server_name || 'MT4 Server',
                            account_number: String(account.account_number || 'Unknown'),
                            connection_status: 'CONNECTED',
                            balance: Number(account.balance) || 0,
                            equity: Number(account.equity) || 0,
                            last_sync: new Date().toISOString()
                        }));
                    }
                } catch (err) {
                    console.error("Account Sync Error:", err.message);
                    errors.push("Account Sync Failed");
                }
            }

            // 2. Trade Sync (Bulk Optimized)
            if (trades && Array.isArray(trades)) {
                try {
                    // Fetch ALL open trades in one go to minimize DB calls
                    const openDbTrades = await withRetry(() => base44.asServiceRole.entities.Trade.filter({ status: 'OPEN' }));
                    const dbTradesMap = new Map(openDbTrades.map(t => [Number(t.ticket), t]));
                    
                    const tradesToCreate = [];
                    const incomingTickets = new Set();

                    // Process payload
                    for (const t of trades) {
                        if (!t.ticket) continue;
                        const ticket = Number(t.ticket);
                        incomingTickets.add(ticket);
                        
                        const existing = dbTradesMap.get(ticket);

                        if (existing) {
                            // Update existing trade (Individual updates are unavoidable but safer than bulk update usually)
                            // We swallow errors here to ensure the loop completes
                            withRetry(() => base44.asServiceRole.entities.Trade.update(existing.id, {
                                pnl: Number(t.pnl),
                                close_price: Number(t.current_price || 0),
                                updated_date: new Date().toISOString()
                            })).catch(e => console.error(`Update failed for ${ticket}:`, e.message));
                        } else {
                            // New trade detected
                            tradesToCreate.push({
                                pair: String(t.symbol || "UNKNOWN"),
                                type: String(t.type || "BUY"),
                                lot_size: Number(t.lots) || 0.01,
                                open_price: Number(t.open_price) || 0,
                                close_price: Number(t.current_price || 0),
                                pnl: Number(t.pnl) || 0,
                                ticket: ticket,
                                status: 'OPEN',
                                is_auto: Boolean(t.magic !== 0),
                                bot_id: t.magic ? String(t.magic) : null
                            });
                        }
                    }

                    // Bulk Create New Trades (One DB call)
                    if (tradesToCreate.length > 0) {
                        try {
                            await withRetry(() => base44.asServiceRole.entities.Trade.bulkCreate(tradesToCreate));
                            console.log(`Bulk created ${tradesToCreate.length} trades`);
                        } catch (e) {
                            console.error("Bulk create failed:", e.message);
                            errors.push("New Trade Sync Failed");
                        }
                    }

                    // Detect Closed Trades
                    const closedTrades = openDbTrades.filter(t => !incomingTickets.has(Number(t.ticket)));
                    for (const t of closedTrades) {
                        withRetry(() => base44.asServiceRole.entities.Trade.update(t.id, {
                            status: 'CLOSED',
                            updated_date: new Date().toISOString()
                        })).catch(e => console.error(`Close failed for ${t.ticket}:`, e.message));
                    }

                } catch (err) {
                    console.error("Trade Sync Critical Error:", err);
                    errors.push(err.message);
                }
            }

            return Response.json({ status: "SYNCED", errors: errors.length ? errors : undefined });
        }

        // ---------------------------------------------------------
        // GET: Fetch Signal (Ultra-Lightweight)
        // ---------------------------------------------------------
        if (req.method === 'GET') {
            try {
                // REMOVED: "Max Trades" check. This was causing double DB load.
                // We trust the EA or Strategy to manage limits, or accept slight overflow to ensure stability.
                
                // Fetch only ONE pending signal
                const signals = await withRetry(() => base44.asServiceRole.entities.Signal.filter({ status: 'PENDING' }, '-created_date', 1));

                if (signals && signals.length > 0) {
                    return Response.json(signals[0]);
                }
                return Response.json({ status: "NO_SIGNAL", id: "" });

            } catch (err) {
                console.error("Signal Fetch Error:", err);
                // Return 200 with NO_SIGNAL to prevent EA from retrying aggressively on error
                return Response.json({ status: "NO_SIGNAL", error: "Backend Error" });
            }
        }

        return Response.json({ error: "Method not allowed" }, { status: 405 });

    } catch (error) {
        console.error("Global Bridge Error:", error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});