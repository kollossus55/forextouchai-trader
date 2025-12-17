import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

// Helper for robust DB calls with exponential backoff
const withRetry = async (fn, retries = 3, delay = 200) => {
    let lastError;
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            // Only retry on fetch/network errors
            if (error.message && (error.message.includes('Fetch') || error.message.includes('network'))) {
                 console.warn(`Attempt ${i + 1} failed: ${error.message}. Retrying...`);
                 await new Promise(r => setTimeout(r, delay * Math.pow(2, i)));
            } else {
                throw error; // Don't retry logic errors
            }
        }
    }
    throw lastError;
};

Deno.serve(async (req) => {
    try {
        // Initialize client - if Authorization header is garbage/custom, it might throw, 
        // so we use X-Connect-Token in the EA now to keep Authorization clean (anonymous).
        const base44 = createClientFromRequest(req);
        
        // Handle Trade Sync (POST)
        if (req.method === 'POST') {
            let body;
            try {
                body = await req.json();
            } catch (e) {
                console.error("JSON Parse Error:", e);
                return Response.json({ error: "Invalid JSON body" }, { status: 400 });
            }
            
            const { trades, account } = body;
            const errors = [];

            // 1. Update Account Info if provided
            if (account) {
                 try {
                     const connections = await withRetry(() => base44.asServiceRole.entities.BrokerConnection.list());
                     if (connections.length > 0) {
                         // Update the first connection found
                         await withRetry(() => base44.asServiceRole.entities.BrokerConnection.update(connections[0].id, {
                             balance: Number(account.balance) || 0,
                             equity: Number(account.equity) || 0,
                             margin: Number(account.margin) || 0,
                             free_margin: Number(account.free_margin) || 0,
                             margin_level: Number(account.margin_level) || 0,
                             connection_status: 'CONNECTED',
                             last_sync: new Date().toISOString()
                         }));
                             balance: Number(account.balance) || 0,
                             equity: Number(account.equity) || 0,
                             margin: Number(account.margin) || 0,
                             free_margin: Number(account.free_margin) || 0,
                             margin_level: Number(account.margin_level) || 0,
                             connection_status: 'CONNECTED',
                             last_sync: new Date().toISOString()
                         });
                     } else {
                         // Auto-create connection if missing
                         console.log("Creating new BrokerConnection from heartbeat");
                         await withRetry(() => base44.asServiceRole.entities.BrokerConnection.create({
                             platform: 'MT4',
                             server_name: 'Auto-Detected',
                             account_number: 'Syncing...',
                             connection_status: 'CONNECTED',
                             balance: Number(account.balance) || 0,
                             equity: Number(account.equity) || 0,
                             margin: Number(account.margin) || 0,
                             free_margin: Number(account.free_margin) || 0,
                             margin_level: Number(account.margin_level) || 0,
                             last_sync: new Date().toISOString()
                         }));
                     }
                 } catch (err) {
                     console.error("Account Update Failed:", err);
                     errors.push({ type: "account", error: err.message });
                 }
            }

            // 2. Sync Trades
            if (trades && Array.isArray(trades)) {
                // Process trades in parallel batches to avoid timeouts/async issues
                await Promise.all(trades.map(async (trade) => {
                    try {
                        if (!trade.ticket) return;
                        
                        const ticketNum = Number(trade.ticket);
                        // Filter by ticket to find existing record
                        const existing = await base44.asServiceRole.entities.Trade.filter({ ticket: ticketNum });
                        
                        if (existing && existing.length > 0) {
                            // Update existing trade
                            await withRetry(() => base44.asServiceRole.entities.Trade.update(existing[0].id, {
                                pnl: Number(trade.pnl),
                                close_price: Number(trade.current_price || 0),
                                updated_date: new Date().toISOString()
                            }));
                        } else {
                            // Create new trade
                            await withRetry(() => base44.asServiceRole.entities.Trade.create({
                                pair: String(trade.symbol || "UNKNOWN"),
                                type: String(trade.type || "BUY"),
                                lot_size: Number(trade.lots) || 0.01,
                                open_price: Number(trade.open_price) || 0,
                                close_price: Number(trade.current_price || 0),
                                pnl: Number(trade.pnl) || 0,
                                ticket: ticketNum,
                                status: 'OPEN',
                                is_auto: Boolean(trade.magic !== 0)
                            }));
                        }
                    } catch (err) {
                        console.error(`Trade Sync Failed (Ticket: ${trade.ticket}):`, err);
                        errors.push({ ticket: trade.ticket, error: err.message });
                    }
                }));

                // 3. Handle Closed Trades (Trades in DB but missing from payload)
                try {
                     // Get all currently OPEN trades from DB
                     const openDbTrades = await withRetry(() => base44.asServiceRole.entities.Trade.filter({ status: 'OPEN' }));
                     const incomingTickets = trades.map(t => Number(t.ticket));

                     // Find trades to close (in DB but not in MT4 payload)
                     const tradesToClose = openDbTrades.filter(dbTrade => !incomingTickets.includes(dbTrade.ticket));

                     for (const trade of tradesToClose) {
                         await withRetry(() => base44.asServiceRole.entities.Trade.update(trade.id, {
                             status: 'CLOSED',
                             updated_date: new Date().toISOString()
                         }));
                         console.log(`Marked trade ${trade.ticket} as CLOSED`);
                     }
                } catch (err) {
                    console.error("Closed Trade Sync Failed:", err);
                }
            }

            return Response.json({ 
                status: "SYNCED", 
                processed_trades: trades?.length || 0,
                errors: errors.length > 0 ? errors : undefined 
            });
        }

        // Handle Signal Fetch (GET)
        if (req.method === 'GET') {
            try {
                // Optimized: Fetch only the latest 1 signal sorted by created_date descending
                // using retry logic to handle transient "expectedAsyncWrap" fetch errors
                const signals = await withRetry(() => base44.asServiceRole.entities.Signal.list('-created_date', 1));

                if (signals && signals.length > 0) {
                    return Response.json(signals[0]);
                }
                return Response.json({ status: "NO_SIGNAL", id: "" });
            } catch (err) {
                console.error("Signal Fetch Error:", err);
                return Response.json({ 
                    status: "ERROR", 
                    error: "Fetch Error: " + (err.message || "Unknown")
                }, { status: 200 });
            }
        }

        return Response.json({ error: "Method not allowed" }, { status: 405 });

    } catch (error) {
        console.error("Bridge Global Error:", error);
        // Return 500 but with JSON error to be helpful
        return Response.json({ error: error.message }, { status: 500 });
    }
});