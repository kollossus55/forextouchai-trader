import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // Handle Trade Sync (POST)
        if (req.method === 'POST') {
            const body = await req.json();
            const { trades, account } = body;

            // 1. Update Account Info if provided
            if (account) {
                 const connections = await base44.asServiceRole.entities.BrokerConnection.list();
                 if (connections.length > 0) {
                     await base44.asServiceRole.entities.BrokerConnection.update(connections[0].id, {
                         balance: account.balance,
                         equity: account.equity,
                         margin: account.margin,
                         free_margin: account.free_margin,
                         margin_level: account.margin_level,
                         last_sync: new Date().toISOString()
                     });
                 }
            }

            // 2. Sync Trades
            if (trades && Array.isArray(trades)) {
                for (const trade of trades) {
                    // Check if trade exists by ticket
                    const existing = await base44.asServiceRole.entities.Trade.filter({ ticket: trade.ticket });
                    
                    if (existing.length > 0) {
                        // Update existing trade PnL
                        await base44.asServiceRole.entities.Trade.update(existing[0].id, {
                            pnl: trade.pnl,
                            close_price: trade.current_price, // Tracking current price as close_price for open trades
                            updated_date: new Date().toISOString()
                        });
                    } else {
                        // Insert new trade (e.g. manual trade from MT4)
                        await base44.asServiceRole.entities.Trade.create({
                            pair: trade.symbol,
                            type: trade.type,
                            lot_size: trade.lots,
                            open_price: trade.open_price,
                            pnl: trade.pnl,
                            ticket: trade.ticket,
                            status: 'OPEN',
                            is_auto: trade.magic !== 0 // Assume magic 0 is manual
                        });
                    }
                }
            }

            return Response.json({ status: "SYNCED" });
        }

        // Handle Signal Fetch (GET)
        const signals = await base44.asServiceRole.entities.Signal.list('-created_date', 1);
        if (signals && signals.length > 0) {
            return Response.json(signals[0]);
        }
        
        return Response.json({ status: "NO_SIGNAL", id: "" });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});