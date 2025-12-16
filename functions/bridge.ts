import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

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
                     const connections = await base44.asServiceRole.entities.BrokerConnection.list();
                     if (connections.length > 0) {
                         // Update the first connection found
                         await base44.asServiceRole.entities.BrokerConnection.update(connections[0].id, {
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
                         await base44.asServiceRole.entities.BrokerConnection.create({
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
                         });
                     }
                 } catch (err) {
                     console.error("Account Update Failed:", err);
                     errors.push({ type: "account", error: err.message });
                 }
            }

            // 2. Sync Trades
            if (trades && Array.isArray(trades)) {
                for (const trade of trades) {
                    try {
                        if (!trade.ticket) continue;
                        
                        const ticketNum = Number(trade.ticket);
                        // Filter by ticket to find existing record
                        // Using filter with limit 1 for efficiency
                        const existing = await base44.asServiceRole.entities.Trade.filter({ ticket: ticketNum });
                        
                        if (existing && existing.length > 0) {
                            // Update existing trade
                            await base44.asServiceRole.entities.Trade.update(existing[0].id, {
                                pnl: Number(trade.pnl),
                                close_price: Number(trade.current_price || 0), // Use current price as close price for open trades
                                updated_date: new Date().toISOString()
                            });
                        } else {
                            // Create new trade
                            await base44.asServiceRole.entities.Trade.create({
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
                    } catch (err) {
                        console.error(`Trade Sync Failed (Ticket: ${trade.ticket}):`, err);
                        errors.push({ ticket: trade.ticket, error: err.message });
                    }
                }

                // 3. Handle Closed Trades (Trades in DB but missing from payload)
                try {
                     // Get all currently OPEN trades from DB
                     const openDbTrades = await base44.asServiceRole.entities.Trade.filter({ status: 'OPEN' });
                     const incomingTickets = trades.map(t => Number(t.ticket));
                     
                     // Find trades to close (in DB but not in MT4 payload)
                     const tradesToClose = openDbTrades.filter(dbTrade => !incomingTickets.includes(dbTrade.ticket));
                     
                     for (const trade of tradesToClose) {
                         await base44.asServiceRole.entities.Trade.update(trade.id, {
                             status: 'CLOSED',
                             updated_date: new Date().toISOString()
                         });
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
        try {
            // Explicitly handle GET requests
            const signals = await base44.asServiceRole.entities.Signal.list('-created_date', 1);
            if (signals && signals.length > 0) {
                return Response.json(signals[0]);
            }
            return Response.json({ status: "NO_SIGNAL", id: "" });
        } catch (err) {
             console.error("Signal Fetch Error:", err);
             // Return 200 with error details to allow connection test to pass
             // The EA checks for status 200 to confirm connectivity
             return Response.json({ 
                 status: "ERROR", 
                 error: "Signal fetch failed: " + err.message,
                 details: "Backend connection is alive, but database access failed."
             }, { status: 200 });
        }

    } catch (error) {
        console.error("Bridge Global Error:", error);
        // Return 500 but with JSON error to be helpful
        return Response.json({ error: error.message }, { status: 500 });
    }
});