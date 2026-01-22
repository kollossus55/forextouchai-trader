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

// Connection health tracking with detailed metrics
let connectionHealth = {
    lastSuccessfulSync: Date.now(),
    consecutiveFailures: 0,
    isHealthy: true,
    totalRequests: 0,
    successfulRequests: 0,
    averageLatency: 0,
    latencyHistory: []
};

// Update connection health with metrics
const updateHealth = (success, latency = 0) => {
    connectionHealth.totalRequests++;
    
    if (success) {
        connectionHealth.lastSuccessfulSync = Date.now();
        connectionHealth.consecutiveFailures = 0;
        connectionHealth.isHealthy = true;
        connectionHealth.successfulRequests++;
        
        // Track latency (keep last 20)
        connectionHealth.latencyHistory.push(latency);
        if (connectionHealth.latencyHistory.length > 20) {
            connectionHealth.latencyHistory.shift();
        }
        connectionHealth.averageLatency = Math.round(
            connectionHealth.latencyHistory.reduce((a, b) => a + b, 0) / connectionHealth.latencyHistory.length
        );
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
        // POST: Sync Trades & Account (Fast Acknowledgement) OR Initial Connection Test
        // ---------------------------------------------------------
        if (req.method === 'POST') {
            let body;
            try {
                body = await req.json();
            } catch (e) {
                console.error("[POST ERROR] Invalid JSON in body:", e.message);
                return Response.json({ error: "Invalid JSON" }, { status: 400 });
            }
            
            // Handle initial connection test from MT4 EA
            if (body.test || body.action === 'test' || body.type === 'test') {
                console.log("[POST] Connection test received");
                try {
                    const connections = await withRetry(() => base44.asServiceRole.entities.BrokerConnection.list(1), 2, 200);
                    if (connections.length > 0) {
                        await withRetry(() => base44.asServiceRole.entities.BrokerConnection.update(connections[0].id, {
                            connection_status: 'CONNECTED',
                            last_sync: new Date().toISOString()
                        }), 2, 200);
                    }
                } catch (err) {
                    console.error("[POST ERROR] Test connection update failed:", err.message);
                }
                return Response.json({ 
                    status: "OK", 
                    message: "ForexTouchAI Bridge Connected",
                    version: "3.0",
                    timestamp: new Date().toISOString()
                });
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
                    const latency = Date.now() - startTime;
                    console.log(`[POST] ✓ Heartbeat updated (${latency}ms)`);
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
                            // Get connection owner for created_by field
                            const connections = await withRetry(() => base44.asServiceRole.entities.BrokerConnection.list(1), 2);
                            const ownerEmail = connections[0]?.created_by || null;
                            
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
                                    // Extract bot_id from magic number OR comment
                                    let botId = null;
                                    
                                    // Method 1: From magic number (if it's a UUID/bot ID)
                                    if (t.magic && String(t.magic).length > 5) {
                                        botId = String(t.magic);
                                    }
                                    
                                    // Method 2: Parse from comment (ForexTouchAI format)
                                    if (!botId && t.comment) {
                                        const comment = String(t.comment);
                                        // Look for ForexTouchAI_ prefix and extract bot ID if present
                                        const idMatch = comment.match(/Bot:([a-f0-9\-]{36})/i);
                                        if (idMatch) {
                                            botId = idMatch[1];
                                        }
                                    }

                                    const newTrade = {
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
                                    };
                                    
                                    // Set created_by to connection owner if available
                                    if (ownerEmail) {
                                        newTrade.created_by = ownerEmail;
                                    }
                                    
                                    tradesToCreate.push(newTrade);
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
                                console.log(`[POST] Creating ${tradesToCreate.length} trades with owner: ${ownerEmail}`);
                                // Use impersonation to create trades as the connection owner
                                if (ownerEmail) {
                                    await withRetry(() => base44.asServiceRole.impersonate(ownerEmail).entities.Trade.bulkCreate(tradesToCreate), 2);
                                } else {
                                    await withRetry(() => base44.asServiceRole.entities.Trade.bulkCreate(tradesToCreate), 2);
                                }
                                console.log(`[POST] ✓ Created ${tradesToCreate.length} new trades`);
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
                    updateHealth(true, Date.now() - startTime);
                    } else {
                    console.warn("[HEAD] No connection found");
                    updateHealth(false);
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
                        updateHealth(true, Date.now() - startTime);
                        }
                        } catch (heartbeatErr) {
                        updateHealth(false, Date.now() - startTime);
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
                    
                    // CRITICAL: For CLOSE signals, verify the ticket still exists in database as OPEN
                    if (signal.type === 'CLOSE' || signal.action === 'CLOSE_TRADE') {
                        const tradeTicket = signal.ticket || signal.trade_ticket;
                        if (tradeTicket) {
                            const existingTrade = await withRetry(() => base44.asServiceRole.entities.Trade.filter({ 
                                ticket: Number(tradeTicket), 
                                status: 'OPEN' 
                            }), 2, 200);
                            
                            if (!existingTrade || existingTrade.length === 0) {
                                console.log(`[GET] CLOSE signal ${signal.id} skipped - ticket ${tradeTicket} not found or already closed`);
                                await withRetry(() => base44.asServiceRole.entities.Signal.update(signal.id, { 
                                    status: 'SKIPPED',
                                    result_pnl: 0 
                                }), 2);
                                return Response.json({ status: "NO_SIGNAL", reason: "TICKET_NOT_FOUND" });
                            }
                        }
                    }
                    
                    // Check for duplicate open trades (for new positions only)
                    if (signal.type === 'BUY' || signal.type === 'SELL') {
                        const openTrades = await withRetry(() => base44.asServiceRole.entities.Trade.filter({ status: 'OPEN', pair: signal.pair }), 2, 200);
                        if (openTrades && openTrades.length > 0) {
                            console.log(`[GET] Signal ${signal.id} skipped - ${signal.pair} has ${openTrades.length} open`);
                            await withRetry(() => base44.asServiceRole.entities.Signal.update(signal.id, { 
                                status: 'SKIPPED',
                                result_pnl: 0 
                            }), 2);
                            return Response.json({ status: "NO_SIGNAL", reason: "PAIR_ALREADY_OPEN" });
                        }
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

                    // Get bot details for MT4 comment - include bot ID for tracking
                    let botComment = 'ForexTouchAI_Manual';
                    if (signal.bot_id) {
                        try {
                            const allBots = await withRetry(() => base44.asServiceRole.entities.BotConfig.list(), 1);
                            const matchingBot = allBots.find(b => b.id === signal.bot_id);
                            if (matchingBot) {
                                // Format: ForexTouchAI_STRATEGY Bot:bot_id (for tracking)
                                const strategy = matchingBot.strategy_type || 'UNKNOWN';
                                botComment = `ForexTouchAI_${strategy} Bot:${signal.bot_id}`;
                            }
                        } catch (e) {
                            // Fallback: at least include bot ID
                            botComment = `ForexTouchAI Bot:${signal.bot_id}`;
                        }
                    }

                    console.log(`[GET] ✓ Returning signal ${signal.id} (${signal.pair}) Comment: ${botComment}`);
                    return Response.json({
                        ...signal,
                        magic: signal.bot_id || 0,
                        comment: botComment
                    });
                }
                return Response.json({ status: "NO_SIGNAL", id: "" });

            } catch (err) {
                console.error("[GET ERROR]:", err.message, err.stack?.slice(0, 200));
                return Response.json({ status: "NO_SIGNAL", error: "Backend Error" });
            }
        }

        // ---------------------------------------------------------
        // OPTIONS: Connection Diagnostics (for debugging)
        // ---------------------------------------------------------
        if (req.method === 'OPTIONS') {
            const uptime = Date.now() - connectionHealth.lastSuccessfulSync;
            const successRate = connectionHealth.totalRequests > 0 
                ? ((connectionHealth.successfulRequests / connectionHealth.totalRequests) * 100).toFixed(2)
                : 0;
            
            return Response.json({
                status: connectionHealth.isHealthy ? 'HEALTHY' : 'UNHEALTHY',
                uptime_ms: uptime,
                consecutive_failures: connectionHealth.consecutiveFailures,
                total_requests: connectionHealth.totalRequests,
                successful_requests: connectionHealth.successfulRequests,
                success_rate: successRate + '%',
                average_latency_ms: connectionHealth.averageLatency,
                last_successful_sync: new Date(connectionHealth.lastSuccessfulSync).toISOString(),
                latency_history: connectionHealth.latencyHistory
            });
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