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
    const startTime = Date.now();
    try {
        const base44 = createClientFromRequest(req);
        
        // ---------------------------------------------------------
        // POST: Sync Trades & Account (Fast Acknowledgement)
        // ---------------------------------------------------------
        if (req.method === 'POST') {
            let body;
            try {
                body = await req.json();
            } catch (e) {
                console.error("Invalid JSON in POST body");
                return Response.json({ error: "Invalid JSON" }, { status: 400 });
            }
            
            const { trades, account } = body;
            console.log(`[BRIDGE POST] Received - ${trades?.length || 0} trades, ${account ? 'with account' : 'no account'}`);

            // CRITICAL: Update heartbeat IMMEDIATELY to prevent stale connection
            try {
                const connections = await withRetry(() => base44.asServiceRole.entities.BrokerConnection.list(1));
                if (connections.length > 0) {
                    await withRetry(() => base44.asServiceRole.entities.BrokerConnection.update(connections[0].id, {
                        connection_status: 'CONNECTED',
                        last_sync: new Date().toISOString(),
                        balance: account ? Number(account.balance) || 0 : connections[0].balance,
                        equity: account ? Number(account.equity) || 0 : connections[0].equity,
                        margin: account ? Number(account.margin) || 0 : connections[0].margin,
                        free_margin: account ? Number(account.free_margin) || 0 : connections[0].free_margin,
                        margin_level: account ? Number(account.margin_level) || 0 : connections[0].margin_level
                    }));
                } else if (account) {
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
                console.error("Heartbeat update failed:", err.message);
                // Don't fail entire request on heartbeat error
            }

            // Process trades asynchronously (don't block response)
            if (trades && Array.isArray(trades) && trades.length > 0) {
                // Fire and forget - process trades in background
                (async () => {
                    try {
                        const openDbTrades = await withRetry(() => base44.asServiceRole.entities.Trade.filter({ status: 'OPEN' }));
                        const dbTradesMap = new Map(openDbTrades.map(t => [Number(t.ticket), t]));
                        
                        const tradesToCreate = [];
                        const incomingTickets = new Set();

                        for (const t of trades) {
                            if (!t.ticket) continue;
                            const ticket = Number(t.ticket);
                            incomingTickets.add(ticket);
                            
                            const existing = dbTradesMap.get(ticket);

                            if (existing) {
                                existing._needsUpdate = {
                                    pnl: Number(t.pnl),
                                    close_price: Number(t.current_price || 0),
                                    updated_date: new Date().toISOString()
                                };
                            } else {
                                let botId = null;
                                try {
                                    const recentSignals = await withRetry(() => 
                                        base44.asServiceRole.entities.Signal.filter({ 
                                            status: 'ACTIVE',
                                            pair: String(t.symbol || "").replace("/", "")
                                        }, '-created_date', 10)
                                    );
                                    const matchingSignal = recentSignals.find(s => 
                                        s.type === String(t.type || "BUY") && 
                                        Math.abs(s.entry_price - Number(t.open_price)) < 0.0001
                                    );
                                    if (matchingSignal?.bot_id) botId = matchingSignal.bot_id;
                                } catch (e) {
                                    console.warn("Signal match failed:", e.message);
                                }

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
                                    bot_id: botId
                                });
                            }
                        }

                        const tradesToUpdate = openDbTrades.filter(t => t._needsUpdate);
                        if (tradesToUpdate.length > 0) {
                            const batchSize = 10;
                            for (let i = 0; i < tradesToUpdate.length; i += batchSize) {
                                const batch = tradesToUpdate.slice(i, i + batchSize);
                                await Promise.all(batch.map(t => 
                                    withRetry(() => base44.asServiceRole.entities.Trade.update(t.id, t._needsUpdate))
                                        .catch(e => console.error(`Update failed for ${t.ticket}:`, e.message))
                                ));
                            }
                        }

                        if (tradesToCreate.length > 0) {
                            await withRetry(() => base44.asServiceRole.entities.Trade.bulkCreate(tradesToCreate));
                        }

                        const closedTrades = openDbTrades.filter(t => !incomingTickets.has(Number(t.ticket)));
                        if (closedTrades.length > 0) {
                            await Promise.all(closedTrades.map(t =>
                                withRetry(() => base44.asServiceRole.entities.Trade.update(t.id, {
                                    status: 'CLOSED',
                                    updated_date: new Date().toISOString()
                                })).catch(e => console.error(`Close failed:`, e.message))
                            ));
                        }
                    } catch (err) {
                        console.error("Background trade sync error:", err.message);
                    }
                })();
            }

            // Return immediately to prevent EA timeout
            return Response.json({ status: "SYNCED", duration_ms: Date.now() - startTime });
        }

        // ---------------------------------------------------------
        // HEAD: Heartbeat/Ping (Fastest - No Signal Check)
        // ---------------------------------------------------------
        if (req.method === 'HEAD') {
            try {
                // Ultra-lightweight heartbeat - just update last_sync
                const connections = await withRetry(() => base44.asServiceRole.entities.BrokerConnection.list(1));
                
                if (connections.length > 0) {
                    await withRetry(() => base44.asServiceRole.entities.BrokerConnection.update(connections[0].id, {
                        connection_status: 'CONNECTED',
                        last_sync: new Date().toISOString()
                    }));
                }
                
                return new Response(null, { status: 204 }); // No content
            } catch (err) {
                console.error("Heartbeat Error:", err);
                return new Response(null, { status: 500 });
            }
        }

        // ---------------------------------------------------------
        // GET: Fetch Signal (Ultra-Lightweight)
        // ---------------------------------------------------------
        if (req.method === 'GET') {
            try {
                // Update connection heartbeat on EVERY GET request
                try {
                    const connections = await withRetry(() => base44.asServiceRole.entities.BrokerConnection.list(1));
                    if (connections.length > 0) {
                        await withRetry(() => base44.asServiceRole.entities.BrokerConnection.update(connections[0].id, {
                            connection_status: 'CONNECTED',
                            last_sync: new Date().toISOString()
                        }));
                    }
                } catch (heartbeatErr) {
                    console.error("Heartbeat update failed:", heartbeatErr);
                }

                // Fetch only ONE pending signal
                const signals = await withRetry(() => base44.asServiceRole.entities.Signal.filter({ status: 'PENDING' }, '-created_date', 1));

                if (signals && signals.length > 0) {
                    const signal = signals[0];

                    // AUTO-TRADING CHECK: Only if signal has a bot_id
                    if (signal.bot_id) {
                        try {
                            const allBots = await withRetry(() => base44.asServiceRole.entities.BotConfig.list());
                            const matchingBot = allBots.find(b => b.id === signal.bot_id);

                            if (matchingBot) {
                                // Check if bot is stopped or paused
                                if (matchingBot.status !== 'RUNNING') {
                                    console.warn(`Bot "${matchingBot.name}" is ${matchingBot.status}. Skipping signal ${signal.id}.`);

                                    await withRetry(() => base44.asServiceRole.entities.Signal.update(signal.id, { 
                                        status: 'SKIPPED',
                                        result_pnl: 0 
                                    }));

                                    return Response.json({ status: "NO_SIGNAL", reason: "BOT_NOT_RUNNING" });
                                }

                                // PER-BOT LIMIT CHECK
                                if (matchingBot.max_open_trades) {
                                    const openTrades = await withRetry(() => base44.asServiceRole.entities.Trade.filter({ status: 'OPEN' }));
                                    const botTrades = openTrades.filter(t => t.bot_id === String(matchingBot.id));

                                    if (botTrades.length >= matchingBot.max_open_trades) {
                                        console.warn(`Bot "${matchingBot.name}" limit reached (${botTrades.length}/${matchingBot.max_open_trades}). Skipping signal ${signal.id}.`);

                                        await withRetry(() => base44.asServiceRole.entities.Signal.update(signal.id, { 
                                            status: 'SKIPPED',
                                            result_pnl: 0 
                                        }));

                                        return Response.json({ status: "NO_SIGNAL", reason: "BOT_LIMIT_REACHED" });
                                    }
                                }
                            }
                        } catch (checkErr) {
                            console.error("Auto-trading check failed:", checkErr);
                        }
                    }

                    // Mark signal as ACTIVE to prevent re-execution
                    await withRetry(() => base44.asServiceRole.entities.Signal.update(signal.id, { 
                        status: 'ACTIVE' 
                    }));

                    // Get bot name for trade comment
                    let botName = 'Manual';
                    if (signal.bot_id) {
                        try {
                            const allBots = await withRetry(() => base44.asServiceRole.entities.BotConfig.list());
                            const matchingBot = allBots.find(b => b.id === signal.bot_id);
                            if (matchingBot) {
                                botName = matchingBot.name;
                            }
                        } catch (e) {
                            console.warn("Failed to fetch bot name:", e.message);
                        }
                    }

                    // Return signal with bot_id for MT4 to use as magic number and bot name for comment
                    return Response.json({
                        ...signal,
                        magic: signal.bot_id || 0,
                        comment: botName
                    });
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