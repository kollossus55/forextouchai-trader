import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
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
                             last_sync: new Date().toISOString()
                         });
                     } else {
                         // Optional: Auto-create connection if missing? 
                         // For now, just warn, as user should create it in Settings
                         console.warn("No BrokerConnection found to update");
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
                                pair: String(trade.symbol),
                                type: String(trade.type),
                                lot_size: Number(trade.lots),
                                open_price: Number(trade.open_price),
                                close_price: Number(trade.current_price || 0),
                                pnl: Number(trade.pnl),
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
            }

            return Response.json({ 
                status: "SYNCED", 
                processed_trades: trades?.length || 0,
                errors: errors.length > 0 ? errors : undefined 
            });
        }

        // Handle Signal Fetch (GET)
        try {
            const signals = await base44.asServiceRole.entities.Signal.list('-created_date', 1);
            if (signals && signals.length > 0) {
                return Response.json(signals[0]);
            }
            return Response.json({ status: "NO_SIGNAL", id: "" });
        } catch (err) {
             console.error("Signal Fetch Error:", err);
             return Response.json({ error: "Failed to fetch signals" }, { status: 500 });
        }

    } catch (error) {
        console.error("Bridge Global Error:", error);
        // Return 500 but with JSON error to be helpful
        return Response.json({ error: error.message }, { status: 500 });
    }
});