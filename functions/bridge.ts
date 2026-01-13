import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

// Enhanced retry with exponential backoff and connection persistence
const withRetry = async (fn, retries = 5, delay = 300) => {
    let lastError;
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            const msg = error.message?.toLowerCase() || "";
            // Retry on fetch, network, timeout, or rate limit errors
            const shouldRetry = msg.includes('fetch') || 
                               msg.includes('network') || 
                               msg.includes('limit') || 
                               msg.includes('timeout') ||
                               msg.includes('econnrefused') ||
                               msg.includes('enotfound');
            
            if (shouldRetry) {
                const isRateLimit = msg.includes('limit');
                // More aggressive backoff: 300ms, 600ms, 1200ms, 2400ms, 4800ms
                const waitTime = isRateLimit ? (500 * Math.pow(2, i)) : (delay * Math.pow(2, i));
                console.warn(`[RETRY ${i + 1}/${retries}] ${error.message}. Waiting ${waitTime}ms...`);
                await new Promise(r => setTimeout(r, waitTime));
            } else {
                throw error; 
            }
        }
    }
    console.error(`[RETRY EXHAUSTED] All ${retries} attempts failed:`, lastError.message);
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

            // CRITICAL: Update heartbeat IMMEDIATELY with enhanced reliability
            try {
                const connections = await withRetry(() => base44.asServiceRole.entities.BrokerConnection.list(1));
                
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
                    await withRetry(() => base44.asServiceRole.entities.BrokerConnection.update(connections[0].id, updateData), 5, 300);
                } else if (account) {
                    await withRetry(() => base44.asServiceRole.entities.BrokerConnection.create({
                        platform: account.platform || 'MT4',
                        server_name: account.server_name || 'MT4 Server',
                        account_number: String(account.account_number || 'Unknown'),
                        ...updateData
                    }), 5, 300);
                }
                
                updateHealth(true);
                console.log(`[✓] Heartbeat synced - Health: ${connectionHealth.consecutiveFailures} failures`);
                
            } catch (err) {
                updateHealth(false);
                console.error(`[✗] Heartbeat failed (${connectionHealth.consecutiveFailures} consecutive):`, err.message);
                
                // Try to mark as degraded but don't fail the request
                try {
                    const connections = await base44.asServiceRole.entities.BrokerConnection.list(1);
                    if (connections.length > 0 && connectionHealth.consecutiveFailures >= 3) {
                        await base44.asServiceRole.entities.BrokerConnection.update(connections[0].id, {
                            connection_status: 'ERROR'
                        });
                    }
                } catch (markErr) {
                    console.error("Could not mark connection as degraded:", markErr.message);
                }
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
                                
                                // Extract bot_id from magic number if available
                                if (t.magic && String(t.magic).length > 5) {
                                    botId = String(t.magic);
                                    console.log(`[Trade ${ticket}] Using magic as bot_id:`, botId);
                                } else {
                                    // Fallback: Try to match with recent signals
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
                                        if (matchingSignal?.bot_id) {
                                            botId = matchingSignal.bot_id;
                                            console.log(`[Trade ${ticket}] Matched to signal bot_id:`, botId);
                                        }
                                    } catch (e) {
                                        console.warn("Signal match failed:", e.message);
                                    }
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

            // Return immediately to prevent EA timeout with health metrics
            return Response.json({ 
                status: "SYNCED", 
                duration_ms: Date.now() - startTime,
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
                // Ultra-lightweight heartbeat - just update last_sync with enhanced reliability
                const connections = await withRetry(() => base44.asServiceRole.entities.BrokerConnection.list(1), 5, 300);
                
                if (connections.length > 0) {
                    await withRetry(() => base44.asServiceRole.entities.BrokerConnection.update(connections[0].id, {
                        connection_status: 'CONNECTED',
                        last_sync: new Date().toISOString()
                    }), 5, 300);
                    updateHealth(true);
                } else {
                    console.warn("[HEAD] No connection record found");
                }
                
                return new Response(null, { 
                    status: 204,
                    headers: {
                        'X-Health-Score': connectionHealth.consecutiveFailures.toString(),
                        'X-Last-Success': connectionHealth.lastSuccessfulSync.toString()
                    }
                });
            } catch (err) {
                updateHealth(false);
                console.error("[HEAD] Heartbeat Error:", err.message);
                return new Response(null, { 
                    status: 503, // Service Unavailable
                    headers: {
                        'Retry-After': '5' // Tell EA to retry after 5 seconds
                    }
                });
            }
        }

        // ---------------------------------------------------------
        // GET: Fetch Signal (Ultra-Lightweight)
        // ---------------------------------------------------------
        if (req.method === 'GET') {
            try {
                // Update connection heartbeat on EVERY GET request with enhanced error handling
                try {
                    const connections = await withRetry(() => base44.asServiceRole.entities.BrokerConnection.list(1), 5, 300);
                    if (connections.length > 0) {
                        await withRetry(() => base44.asServiceRole.entities.BrokerConnection.update(connections[0].id, {
                            connection_status: 'CONNECTED',
                            last_sync: new Date().toISOString()
                        }), 5, 300);
                        updateHealth(true);
                    }
                } catch (heartbeatErr) {
                    updateHealth(false);
                    console.error("[GET] Heartbeat update failed:", heartbeatErr.message);
                    // Continue with signal fetch even if heartbeat fails
                }

                // Fetch only ONE pending signal - sorted by created_date to ensure FIFO execution
                const signals = await withRetry(() => base44.asServiceRole.entities.Signal.filter({ status: 'PENDING' }, 'created_date', 1), 5, 300);

                if (signals && signals.length > 0) {
                    const signal = signals[0];
                    
                    // CRITICAL: Check for duplicate open trades on same pair
                    const openTrades = await withRetry(() => base44.asServiceRole.entities.Trade.filter({ status: 'OPEN', pair: signal.pair }), 3, 200);
                    if (openTrades && openTrades.length > 0) {
                        console.warn(`[DUPLICATE PREVENTION] Signal ${signal.id} skipped - ${signal.pair} already has ${openTrades.length} open trade(s)`);
                        await withRetry(() => base44.asServiceRole.entities.Signal.update(signal.id, { 
                            status: 'SKIPPED',
                            result_pnl: 0 
                        }));
                        return Response.json({ status: "NO_SIGNAL", reason: "PAIR_ALREADY_OPEN" });
                    }

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