import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

// Smarter retry with reduced attempts and better error classification
const withRetry = async (fn, retries = 3, delay = 200) => {
    let lastError;
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            const msg = error.message?.toLowerCase() || "";
            // Retry only on transient network/timeout errors
            const shouldRetry = msg.includes('fetch') || 
                               msg.includes('network') || 
                               msg.includes('timeout') ||
                               msg.includes('econnrefused');
            
            if (shouldRetry && i < retries - 1) {
                const waitTime = delay * Math.pow(1.5, i); // Gentler backoff: 200ms, 300ms, 450ms
                console.warn(`[RETRY ${i + 1}/${retries}] ${error.message}. Waiting ${waitTime}ms...`);
                await new Promise(r => setTimeout(r, waitTime));
            } else {
                throw error; 
            }
        }
    }
    throw lastError;
};

// Connection health tracking
let connectionHealth = {
    lastSuccessfulSync: Date.now(),
    consecutiveFailures: 0,
    isHealthy: true
};

// Update connection health
const updateHealth = (success) => {
    if (success) {
        connectionHealth.lastSuccessfulSync = Date.now();
        connectionHealth.consecutiveFailures = 0;
        connectionHealth.isHealthy = true;
    } else {
        connectionHealth.consecutiveFailures++;
        // Mark unhealthy after 3 consecutive failures
        if (connectionHealth.consecutiveFailures >= 3) {
            connectionHealth.isHealthy = false;
        }
    }
};

Deno.serve(async (req) => {
    const startTime = Date.now();
    const method = req.method;
    
    try {
        const base44 = createClientFromRequest(req);
        console.log(`[${method}] Bridge request started`);
        
        // ---------------------------------------------------------
        // POST: Sync Trades & Account (Fast Acknowledgement)
        // ---------------------------------------------------------
        if (req.method === 'POST') {
            let body;
            try {
                body = await req.json();
            } catch (e) {
                console.error("[POST ERROR] Invalid JSON in body:", e.message);
                return Response.json({ error: "Invalid JSON" }, { status: 400 });
            }
            
            const { trades, account } = body;
            console.log(`[POST] Received ${trades?.length || 0} trades, ${account ? 'account data' : 'no account'}`);

            // CRITICAL: Update heartbeat IMMEDIATELY with timeout protection
            let heartbeatSuccess = false;
            try {
                const connections = await withRetry(() => base44.asServiceRole.entities.BrokerConnection.list(1), 2, 200);
                
                const updateData = {
                    connection_status: 'CONNECTED',
                    last_sync: new Date().toISOString(),
                    balance: account ? Number(account.balance) || 0 : (connections[0]?.balance || 0),
                    equity: account ? Number(account.equity) || 0 : (connections[0]?.equity || 0),
                    margin: account ? Number(account.margin) || 0 : (connections[0]?.margin || 0),
                    free_margin: account ? Number(account.free_margin) || 0 : (connections[0]?.free_margin || 0),
                    margin_level: account ? Number(account.margin_level) || 0 : (connections[0]?.margin_level || 0)
                };
                
                if (connections.length > 0) {
                    await withRetry(() => base44.asServiceRole.entities.BrokerConnection.update(connections[0].id, updateData), 2, 200);
                    heartbeatSuccess = true;
                    console.log(`[POST] ✓ Heartbeat updated`);
                } else if (account) {
                    await withRetry(() => base44.asServiceRole.entities.BrokerConnection.create({
                        platform: account.platform || 'MT4',
                        server_name: account.server_name || 'MT4 Server',
                        account_number: String(account.account_number || 'Unknown'),
                        ...updateData
                    }), 2, 200);
                    heartbeatSuccess = true;
                    console.log(`[POST] ✓ Connection created`);
                }
                
                updateHealth(true);
                
            } catch (err) {
                updateHealth(false);
                console.error(`[POST ERROR] Heartbeat failed (attempt ${connectionHealth.consecutiveFailures}):`, err.message, err.stack?.slice(0, 200));
                
                // Fallback: Try minimal last_sync update
                try {
                    const connections = await base44.asServiceRole.entities.BrokerConnection.list(1);
                    if (connections.length > 0) {
                        await base44.asServiceRole.entities.BrokerConnection.update(connections[0].id, {
                            last_sync: new Date().toISOString(),
                            connection_status: connectionHealth.consecutiveFailures >= 5 ? 'ERROR' : 'CONNECTED'
                        });
                        console.log(`[POST] ⚠ Fallback sync (${connectionHealth.consecutiveFailures} failures)`);
                    }
                } catch (fallbackErr) {
                    console.error("[POST ERROR] Fallback failed:", fallbackErr.message);
                }
            }

            // Process trades asynchronously (don't block response)
            if (trades && Array.isArray(trades) && trades.length > 0) {
                // Fire and forget - process trades in background with timeout
                Promise.race([
                    (async () => {
                        try {
                            const openDbTrades = await withRetry(() => base44.asServiceRole.entities.Trade.filter({ status: 'OPEN' }), 2);
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
                                    if (t.magic && String(t.magic).length > 5) {
                                        botId = String(t.magic);
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
                                await Promise.all(tradesToUpdate.slice(0, 20).map(t => 
                                    withRetry(() => base44.asServiceRole.entities.Trade.update(t.id, t._needsUpdate), 1)
                                        .catch(e => console.error(`Update ${t.ticket}:`, e.message))
                                ));
                            }

                            if (tradesToCreate.length > 0) {
                                await withRetry(() => base44.asServiceRole.entities.Trade.bulkCreate(tradesToCreate), 2);
                            }

                            const closedTrades = openDbTrades.filter(t => !incomingTickets.has(Number(t.ticket)));
                            if (closedTrades.length > 0) {
                                console.log(`[POST] Marking ${closedTrades.length} trades as CLOSED: ${closedTrades.map(t => t.ticket).join(', ')}`);
                                await Promise.all(closedTrades.slice(0, 20).map(t =>
                                    withRetry(() => base44.asServiceRole.entities.Trade.update(t.id, {
                                        status: 'CLOSED',
                                        updated_date: new Date().toISOString()
                                    }), 1).catch(e => console.error(`Close ticket ${t.ticket} failed:`, e.message))
                                ));
                            }
                            console.log(`[POST] ✓ Trade sync complete`);
                        } catch (err) {
                            console.error("[POST ERROR] Trade sync:", err.message);
                        }
                    })(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000))
                ]).catch(e => console.error("[POST] Trade processing timeout/error:", e.message));
            }

            // Return immediately to prevent EA timeout
            const duration = Date.now() - startTime;
            console.log(`[POST] Response sent (${duration}ms, heartbeat: ${heartbeatSuccess ? 'OK' : 'FAIL'})`);
            return Response.json({ 
                status: heartbeatSuccess ? "SYNCED" : "PARTIAL",
                duration_ms: duration,
                health: {
                    consecutive_failures: connectionHealth.consecutiveFailures,
                    is_healthy: connectionHealth.isHealthy
                }
            });
        }

        // ---------------------------------------------------------
        // HEAD: Heartbeat/Ping (Fastest - No Signal Check)
        // ---------------------------------------------------------
        if (req.method === 'HEAD') {
            try {
                const connections = await withRetry(() => base44.asServiceRole.entities.BrokerConnection.list(1), 2, 200);
                
                if (connections.length > 0) {
                    await withRetry(() => base44.asServiceRole.entities.BrokerConnection.update(connections[0].id, {
                        connection_status: 'CONNECTED',
                        last_sync: new Date().toISOString()
                    }), 2, 200);
                    updateHealth(true);
                } else {
                    console.warn("[HEAD] No connection found");
                }
                
                return new Response(null, { 
                    status: 204,
                    headers: {
                        'X-Health': connectionHealth.isHealthy ? '1' : '0',
                        'X-Failures': connectionHealth.consecutiveFailures.toString()
                    }
                });
            } catch (err) {
                updateHealth(false);
                console.error("[HEAD ERROR]:", err.message);
                
                // Fallback update
                try {
                    const connections = await base44.asServiceRole.entities.BrokerConnection.list(1);
                    if (connections.length > 0) {
                        await base44.asServiceRole.entities.BrokerConnection.update(connections[0].id, {
                            last_sync: new Date().toISOString()
                        });
                    }
                } catch (fallbackErr) {
                    // Silent fail
                }
                
                return new Response(null, { 
                    status: 503,
                    headers: { 'Retry-After': '5' }
                });
            }
        }

        // ---------------------------------------------------------
        // GET: Fetch Signal (Ultra-Lightweight)
        // ---------------------------------------------------------
        if (req.method === 'GET') {
            try {
                // Quick heartbeat update
                try {
                    const connections = await withRetry(() => base44.asServiceRole.entities.BrokerConnection.list(1), 2, 200);
                    if (connections.length > 0) {
                        await withRetry(() => base44.asServiceRole.entities.BrokerConnection.update(connections[0].id, {
                            connection_status: 'CONNECTED',
                            last_sync: new Date().toISOString()
                        }), 2, 200);
                        updateHealth(true);
                    }
                } catch (heartbeatErr) {
                    updateHealth(false);
                    console.error("[GET ERROR] Heartbeat:", heartbeatErr.message);
                    
                    // Fallback
                    try {
                        const connections = await base44.asServiceRole.entities.BrokerConnection.list(1);
                        if (connections.length > 0) {
                            await base44.asServiceRole.entities.BrokerConnection.update(connections[0].id, {
                                last_sync: new Date().toISOString()
                            });
                        }
                    } catch (fallbackErr) {
                        // Continue
                    }
                }

                // Fetch signal
                const signals = await withRetry(() => base44.asServiceRole.entities.Signal.filter({ status: 'PENDING' }, 'created_date', 1), 2, 200);

                if (signals && signals.length > 0) {
                    const signal = signals[0];
                    
                    // Check for duplicate open trades
                    const openTrades = await withRetry(() => base44.asServiceRole.entities.Trade.filter({ status: 'OPEN', pair: signal.pair }), 2, 200);
                    if (openTrades && openTrades.length > 0) {
                        console.log(`[GET] Signal ${signal.id} skipped - ${signal.pair} has ${openTrades.length} open`);
                        await withRetry(() => base44.asServiceRole.entities.Signal.update(signal.id, { 
                            status: 'SKIPPED',
                            result_pnl: 0 
                        }), 2);
                        return Response.json({ status: "NO_SIGNAL", reason: "PAIR_ALREADY_OPEN" });
                    }

                    // Bot check if signal has bot_id
                    if (signal.bot_id) {
                        try {
                            const allBots = await withRetry(() => base44.asServiceRole.entities.BotConfig.list(), 2);
                            const matchingBot = allBots.find(b => b.id === signal.bot_id);

                            if (matchingBot && matchingBot.status !== 'RUNNING') {
                                console.log(`[GET] Bot ${matchingBot.name} not running, skipping signal`);
                                await withRetry(() => base44.asServiceRole.entities.Signal.update(signal.id, { 
                                    status: 'SKIPPED',
                                    result_pnl: 0 
                                }), 2);
                                return Response.json({ status: "NO_SIGNAL", reason: "BOT_NOT_RUNNING" });
                            }

                            if (matchingBot?.max_open_trades) {
                                const openTrades = await withRetry(() => base44.asServiceRole.entities.Trade.filter({ status: 'OPEN' }), 2);
                                const botTrades = openTrades.filter(t => t.bot_id === String(matchingBot.id));

                                if (botTrades.length >= matchingBot.max_open_trades) {
                                    console.log(`[GET] Bot limit reached (${botTrades.length}/${matchingBot.max_open_trades})`);
                                    await withRetry(() => base44.asServiceRole.entities.Signal.update(signal.id, { 
                                        status: 'SKIPPED',
                                        result_pnl: 0 
                                    }), 2);
                                    return Response.json({ status: "NO_SIGNAL", reason: "BOT_LIMIT_REACHED" });
                                }
                            }
                        } catch (checkErr) {
                            console.error("[GET ERROR] Bot check:", checkErr.message);
                        }
                    }

                    // Mark as ACTIVE
                    await withRetry(() => base44.asServiceRole.entities.Signal.update(signal.id, { 
                        status: 'ACTIVE' 
                    }), 2);

                    // Get bot name
                    let botName = 'Manual';
                    if (signal.bot_id) {
                        try {
                            const allBots = await withRetry(() => base44.asServiceRole.entities.BotConfig.list(), 1);
                            const matchingBot = allBots.find(b => b.id === signal.bot_id);
                            if (matchingBot) botName = matchingBot.name;
                        } catch (e) {
                            // Use default
                        }
                    }

                    console.log(`[GET] ✓ Returning signal ${signal.id} (${signal.pair})`);
                    return Response.json({
                        ...signal,
                        magic: signal.bot_id || 0,
                        comment: botName
                    });
                }
                return Response.json({ status: "NO_SIGNAL", id: "" });

            } catch (err) {
                console.error("[GET ERROR]:", err.message, err.stack?.slice(0, 200));
                return Response.json({ status: "NO_SIGNAL", error: "Backend Error" });
            }
        }

        return Response.json({ error: "Method not allowed" }, { status: 405 });

    } catch (error) {
        console.error(`[${method} FATAL ERROR]:`, error.message);
        console.error("Stack:", error.stack?.slice(0, 300));
        return Response.json({ 
            error: error.message,
            method: method,
            timestamp: new Date().toISOString()
        }, { status: 500 });
    }
});