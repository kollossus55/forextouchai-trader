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
            // Retry on network errors or Rate Limits
            if (error.message && (error.message.includes('Fetch') || error.message.includes('network') || error.message.includes('Limit') || error.message.includes('limit'))) {
                 const isRateLimit = error.message.toLowerCase().includes('limit');
                 const waitTime = isRateLimit ? (delay * 2) * Math.pow(2, i) : delay * Math.pow(2, i); // Double wait for limits
                 console.warn(`Attempt ${i + 1} failed: ${error.message}. Retrying in ${waitTime}ms...`);
                 await new Promise(r => setTimeout(r, waitTime));
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
                try {
                    // Optimization: Fetch all OPEN trades ONCE to prevent N+1 queries and Rate Limit errors
                    const openDbTrades = await withRetry(() => base44.asServiceRole.entities.Trade.filter({ status: 'OPEN' }));
                    const dbTradesMap = new Map(openDbTrades.map(t => [t.ticket, t]));
                    
                    const newTrades = [];
                    const incomingTickets = new Set();

                    // Process incoming trades
                    for (const trade of trades) {
                        if (!trade.ticket) continue;
                        const ticketNum = Number(trade.ticket);
                        incomingTickets.add(ticketNum);
                        
                        const existing = dbTradesMap.get(ticketNum);

                        if (existing) {
                            // Update existing trade
                            try {
                                await withRetry(() => base44.asServiceRole.entities.Trade.update(existing.id, {
                                    pnl: Number(trade.pnl),
                                    close_price: Number(trade.current_price || 0),
                                    updated_date: new Date().toISOString()
                                }));
                            } catch (err) {
                                console.error(`Update Failed (Ticket: ${ticketNum}):`, err.message);
                            }
                        } else {
                            // Collect for bulk creation
                            newTrades.push({
                                pair: String(trade.symbol || "UNKNOWN"),
                                type: String(trade.type || "BUY"),
                                lot_size: Number(trade.lots) || 0.01,
                                open_price: Number(trade.open_price) || 0,
                                close_price: Number(trade.current_price || 0),
                                pnl: Number(trade.pnl) || 0,
                                ticket: ticketNum,
                                status: 'OPEN',
                                is_auto: Boolean(trade.magic !== 0)
                            });
                        }
                    }

                    // Bulk Create New Trades (1 Call instead of N calls)
                    if (newTrades.length > 0) {
                        try {
                            await withRetry(() => base44.asServiceRole.entities.Trade.bulkCreate(newTrades));
                            console.log(`Bulk created ${newTrades.length} new trades`);
                        } catch (err) {
                            console.error("Bulk Create Failed:", err.message);
                            errors.push({ error: "Bulk Create Failed" });
                        }
                    }

                    // 3. Handle Closed Trades (Trades in DB but not in payload)
                    const tradesToClose = openDbTrades.filter(dbTrade => !incomingTickets.has(dbTrade.ticket));

                    for (const trade of tradesToClose) {
                        try {
                            await withRetry(() => base44.asServiceRole.entities.Trade.update(trade.id, {
                                status: 'CLOSED',
                                updated_date: new Date().toISOString()
                            }));
                            console.log(`Marked trade ${trade.ticket} as CLOSED`);
                        } catch (err) {
                            console.error(`Close Failed (Ticket: ${trade.ticket}):`, err.message);
                        }
                    }

                } catch (err) {
                    console.error("Critical Sync Error:", err);
                    errors.push({ error: "Sync Logic Failed: " + err.message });
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
                // 1. Safety Check: Count Open Trades to prevent overload
                const openTrades = await withRetry(() => base44.asServiceRole.entities.Trade.filter({ status: 'OPEN' }));
                const MAX_CONCURRENT_TRADES = 5; // Hard limit to protect MT4

                if (openTrades.length >= MAX_CONCURRENT_TRADES) {
                    console.log(`Skipping signal fetch: Max trades reached (${openTrades.length}/${MAX_CONCURRENT_TRADES})`);
                    return Response.json({ status: "NO_SIGNAL", id: "", reason: "MAX_TRADES_LIMIT" });
                }

                // 2. Optimized: Fetch only PENDING signals to ensure we don't resend old/analysis ones
                const signals = await withRetry(() => base44.asServiceRole.entities.Signal.filter({ status: 'PENDING' }, '-created_date', 1));

                if (signals && signals.length > 0) {
                    const signal = signals[0];

                    // Optional: Mark as ACTIVE immediately so it's not picked up again by next poll?
                    // For now, we assume the EA executes it quickly.
                    // Better: The EA should send a trade sync which creates the trade, then we close the signal logic.

                    return Response.json(signal);
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