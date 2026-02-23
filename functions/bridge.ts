import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

// Aggressive retry with exponential backoff for connection resilience
const withRetry = async (fn, retries = 3, baseDelay = 150) => {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (error) {
            if (i === retries - 1) throw error;
            const msg = error.message?.toLowerCase() || "";
            const shouldRetry = msg.includes('fetch') || msg.includes('network') || msg.includes('timeout') || msg.includes('500') || msg.includes('502') || msg.includes('503');
            if (shouldRetry) {
                // Exponential backoff: 150ms, 300ms, 600ms
                const delay = baseDelay * Math.pow(2, i);
                await new Promise(r => setTimeout(r, delay));
            } else {
                throw error;
            }
        }
    }
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
        // Add request timeout to prevent hanging
        const timeoutMs = 8000; // 8 second max
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Request timeout')), timeoutMs)
        );
        
        return await Promise.race([
            (async () => {
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
            
            // Wrap entire POST logic in try-catch to prevent 500 errors
            let heartbeatSuccess = false;
            let tradesProcessed = false;
            
            try {
                const { trades, account } = body;
                const timestamp = new Date().toISOString();
                console.log(`[POST ${timestamp}] ✓ EA HEARTBEAT - Received ${trades?.length || 0} trades, ${account ? 'WITH ACCOUNT DATA' : 'NO ACCOUNT DATA'}`);

                // CRITICAL: Check if this is a reconnection after disconnect
                const connections = await withRetry(() => base44.asServiceRole.entities.BrokerConnection.list(1), 2);
                const wasDisconnected = connections.length > 0 && connections[0].connection_status === 'DISCONNECTED';

                if (wasDisconnected) {
                    console.log(`[POST] 🔄 RECONNECTION DETECTED - Closing all stale trades before sync`);
                    const allOpenTrades = await withRetry(() => base44.asServiceRole.entities.Trade.filter({ status: 'OPEN' }), 2);
                    if (allOpenTrades.length > 0) {
                        console.log(`[POST] Closing ${allOpenTrades.length} zombie trades from disconnect period`);
                        await Promise.all(allOpenTrades.map(t => 
                            withRetry(() => base44.asServiceRole.entities.Trade.update(t.id, { status: 'CLOSED' }), 1)
                                .catch(e => console.error(`Failed to close ${t.ticket}:`, e.message))
                        ));
                    }
                }

                // CLEANUP: Delete all invalid trades with ticket=null (zombie trades not from MT4)
                try {
                    const zombieTrades = await withRetry(() => base44.asServiceRole.entities.Trade.filter({ 
                        status: 'OPEN',
                        ticket: null 
                    }), 2);

                    if (zombieTrades.length > 0) {
                        console.log(`[POST CLEANUP] Found ${zombieTrades.length} zombie trades (ticket=null) - DELETING`);
                        await Promise.all(zombieTrades.map(t => 
                            withRetry(() => base44.asServiceRole.entities.Trade.delete(t.id), 1)
                                .catch(e => console.error(`Failed to delete zombie ${t.id}:`, e.message))
                        ));
                    }
                } catch (cleanupErr) {
                    console.error("[POST CLEANUP ERROR]:", cleanupErr.message);
                }

                // LOG EVERY SINGLE TRADE RECEIVED FROM MT4
                if (trades && Array.isArray(trades) && trades.length > 0) {
                    console.log(`[POST] 🔥 MT4 SENT ${trades.length} TRADES:`);
                    trades.forEach((t, idx) => {
                        console.log(`  [${idx + 1}] Ticket:${t.ticket} ${t.symbol} ${t.type} Lots:${t.lots} PnL:${t.pnl} Price:${t.current_price}`);
                    });
                } else {
                    console.log(`[POST] ⚠️ MT4 SENT EMPTY TRADES ARRAY OR NO TRADES`);
                }
                
                if (account) {
                    console.log(`[POST] 💰 ACCOUNT: balance=${account.balance}, equity=${account.equity}, margin=${account.margin}, free_margin=${account.free_margin}, margin_level=${account.margin_level}, account_number=${account.account_number}`);
                }

                // CRITICAL: Update heartbeat IMMEDIATELY with extra retries
                try {
                    // Find connection by account_number if provided, otherwise fallback to first
                    const accountNumber = account?.account_number ? String(account.account_number) : null;

                    let connections;
                    if (accountNumber) {
                        connections = await withRetry(() => base44.asServiceRole.entities.BrokerConnection.filter({ 
                            account_number: accountNumber 
                        }), 3);
                    } else {
                        connections = await withRetry(() => base44.asServiceRole.entities.BrokerConnection.list(1), 3);
                    }
                    
                    // Build update object - ONLY update fields that are present in account data
                    const updateData = {
                        connection_status: 'CONNECTED',
                        last_sync: new Date().toISOString()
                    };
                    
                    // Add account fields if present
                    if (account) {
                        if (account.balance !== undefined) updateData.balance = Number(account.balance) || 0;
                        if (account.equity !== undefined) updateData.equity = Number(account.equity) || 0;
                        if (account.margin !== undefined) updateData.margin = Number(account.margin) || 0;
                        if (account.free_margin !== undefined) updateData.free_margin = Number(account.free_margin) || 0;
                        if (account.margin_level !== undefined) updateData.margin_level = Number(account.margin_level) || 0;
                    }
                    
                    if (connections.length > 0) {
                        await withRetry(() => base44.asServiceRole.entities.BrokerConnection.update(connections[0].id, updateData), 3);
                        heartbeatSuccess = true;
                        console.log(`[POST] ✓ Heartbeat ${Date.now() - startTime}ms - Account ${accountNumber} - Updated: balance=${updateData.balance}, equity=${updateData.equity}, margin=${updateData.margin}`);
                    } else if (account && accountNumber) {
                        // Create new connection for this account
                        await withRetry(() => base44.asServiceRole.entities.BrokerConnection.create({
                            platform: account.platform || 'MT4',
                            server_name: account.server_name || 'MT4 Server',
                            account_number: accountNumber,
                            ...updateData
                        }), 3);
                        heartbeatSuccess = true;
                        console.log(`[POST] ✓ Connection created for account ${accountNumber}`);
                    }
                    
                    updateHealth(true);
                    
                } catch (err) {
                    updateHealth(false);
                    console.error(`[POST ERROR] Heartbeat: ${err.message}`);
                    heartbeatSuccess = false;
                }
            } catch (parseErr) {
                console.error(`[POST ERROR] Body parsing: ${parseErr.message}`);
                // Continue to process trades if available
            }

            // Process trades SYNCHRONOUSLY with aggressive error recovery
            try {
                const { trades, account } = body;
                
                // CRITICAL: Log raw data received
                console.log(`[POST] 🔍 RAW DATA: trades=${trades ? `array[${trades.length}]` : 'null'}, account=${account ? JSON.stringify(account) : 'null'}`);
                
                if (trades && Array.isArray(trades) && trades.length > 0) {
                    console.log(`[POST] 📊 Processing ${trades.length} trades from MT4...`);
                    
                    // Get owner email from account if provided, fallback to first connection
                    const accountNumber = account?.account_number ? String(account.account_number) : null;
                    let ownerEmail = null;
                    
                    if (accountNumber) {
                        const accountConnections = await withRetry(() => base44.asServiceRole.entities.BrokerConnection.filter({ 
                            account_number: accountNumber 
                        }), 2);
                        ownerEmail = accountConnections[0]?.created_by || null;
                        console.log(`[POST] Owner for account ${accountNumber}: ${ownerEmail}`);
                    }
                    
                    if (!ownerEmail) {
                        const connections = await withRetry(() => base44.asServiceRole.entities.BrokerConnection.list(1), 2);
                        ownerEmail = connections[0]?.created_by || null;
                        console.log(`[POST] Fallback owner: ${ownerEmail}`);
                    }

                    const openDbTrades = await withRetry(() => base44.asServiceRole.entities.Trade.filter({ status: 'OPEN' }), 2);
                    const dbTradesMap = new Map(openDbTrades.map(t => [Number(t.ticket), t]));

                    const tradesToCreate = [];
                    const tradesToUpdate = [];
                    const incomingTickets = new Set();

                    for (const t of trades) {
                        if (!t.ticket) {
                            console.log(`[POST] ⚠️ SKIPPED - Missing ticket in trade: ${JSON.stringify(t)}`);
                            continue;
                        }
                        const ticket = Number(t.ticket);
                        
                        // LOG EACH TRADE WITH FULL DATA
                        console.log(`[POST] 🔍 Trade ${ticket} RAW: ${JSON.stringify(t)}`);
                        
                        const openPrice = Number(t.open_price);
                        const currentPrice = Number(t.current_price || t.price || 0);
                        const hasValidOpen = openPrice && !isNaN(openPrice) && openPrice > 0;
                        
                        console.log(`[POST] Trade ${ticket}: ${hasValidOpen ? '✓ VALID' : '❌ INVALID'} ${t.symbol} ${t.type} Open:${openPrice} Current:${currentPrice} PnL:${t.pnl} Lots:${t.lots}`);
                        
                        incomingTickets.add(ticket);
                        
                        const existing = dbTradesMap.get(ticket);

                        if (existing) {
                            tradesToUpdate.push({
                                id: existing.id,
                                pnl: Number(t.pnl) || 0,
                                close_price: currentPrice
                            });
                        } else {
                            // More lenient validation - accept if open_price exists and is a number
                            if (!hasValidOpen) {
                                console.log(`[POST] ❌ REJECTED ${ticket} - Invalid open_price: ${t.open_price} (type: ${typeof t.open_price})`);
                                continue;
                            }
                            
                            let botId = null;
                            if (t.magic && String(t.magic).length > 5) botId = String(t.magic);
                            else if (t.comment) {
                                const idMatch = String(t.comment).match(/Bot:([a-f0-9\-]{36})/i);
                                if (idMatch) botId = idMatch[1];
                            }

                            const tradeData = {
                                pair: String(t.symbol || "UNKNOWN"),
                                type: String(t.type || "BUY"),
                                lot_size: Number(t.lots) || 0.01,
                                open_price: openPrice,
                                close_price: currentPrice,
                                pnl: Number(t.pnl) || 0,
                                ticket: ticket,
                                status: 'OPEN',
                                is_auto: Boolean(t.magic !== 0),
                                bot_id: botId,
                                owner_email: ownerEmail
                            };
                            
                            console.log(`[POST] ✅ Will CREATE trade ${ticket}: ${JSON.stringify(tradeData)}`);
                            tradesToCreate.push(tradeData);
                        }
                    }

                    // Batch update existing trades
                    if (tradesToUpdate.length > 0) {
                        console.log(`[POST] 🔄 Updating ${tradesToUpdate.length} trades`);
                        await Promise.all(tradesToUpdate.map(t => 
                            withRetry(() => base44.asServiceRole.entities.Trade.update(t.id, { pnl: t.pnl, close_price: t.close_price }), 1)
                                .catch(e => console.error(`[POST] ⚠️ Update failed for ${t.id}:`, e.message))
                        ));
                    }

                    // Create new trades
                    if (tradesToCreate.length > 0) {
                        console.log(`[POST] 🚀 Creating ${tradesToCreate.length} NEW trades`);
                        await withRetry(() => base44.asServiceRole.entities.Trade.bulkCreate(tradesToCreate), 2)
                            .catch(e => console.error(`[POST] ❌ Bulk create failed:`, e.message));
                    }

                    // Close trades no longer in MT4
                    const closedTrades = openDbTrades.filter(t => !incomingTickets.has(Number(t.ticket)));
                    if (closedTrades.length > 0) {
                        console.log(`[POST] 🔴 Closing ${closedTrades.length} trades no longer in MT4`);
                        await Promise.all(closedTrades.map(t => 
                            withRetry(() => base44.asServiceRole.entities.Trade.update(t.id, { status: 'CLOSED' }), 1)
                                .catch(e => console.error(`[POST] ⚠️ Close failed for ${t.ticket}:`, e.message))
                        ));
                    }

                    console.log(`[POST] ✅ Sync complete: ${tradesToUpdate.length} updated, ${tradesToCreate.length} created, ${closedTrades.length} closed`);
                    tradesProcessed = true;
                }
            } catch (tradesErr) {
                console.error(`[POST ERROR] Trade sync failed: ${tradesErr.message}`);
                // Don't fail the entire request
            }

            // Return immediately to prevent EA timeout (ALWAYS respond, even if errors occurred)
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
        // HEAD: Heartbeat/Ping (Fastest - No Signal Check) + Auto-cleanup stale trades
        // ---------------------------------------------------------
        if (req.method === 'HEAD') {
            try {
                const connections = await withRetry(() => base44.asServiceRole.entities.BrokerConnection.list(1), 3);

                if (connections.length > 0) {
                    await withRetry(() => base44.asServiceRole.entities.BrokerConnection.update(connections[0].id, {
                        connection_status: 'CONNECTED',
                        last_sync: new Date().toISOString()
                    }), 3);
                    updateHealth(true, Date.now() - startTime);

                    // AUTO-CLEANUP: Close trades not updated in 2 minutes (MT4 likely closed them)
                    try {
                        const twoMinutesAgo = new Date(Date.now() - 120000).toISOString();
                        const staleTrades = await base44.asServiceRole.entities.Trade.filter({ 
                            status: 'OPEN',
                            updated_date: { $lt: twoMinutesAgo }
                        });

                        if (staleTrades.length > 0) {
                            console.log(`[HEAD CLEANUP] Closing ${staleTrades.length} stale trades (not updated in 2+ min)`);
                            await Promise.all(staleTrades.map(t => 
                                base44.asServiceRole.entities.Trade.update(t.id, { status: 'CLOSED' })
                                    .catch(e => console.error(`Failed to close ${t.ticket}:`, e.message))
                            ));
                        }
                    } catch (cleanupErr) {
                        console.error("[HEAD CLEANUP ERROR]:", cleanupErr.message);
                    }
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
                    const connections = await withRetry(() => base44.asServiceRole.entities.BrokerConnection.list(1), 3);
                    if (connections.length > 0) {
                        await withRetry(() => base44.asServiceRole.entities.BrokerConnection.update(connections[0].id, {
                            connection_status: 'CONNECTED',
                            last_sync: new Date().toISOString()
                        }), 3);
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
                console.log(`[GET ${new Date().toISOString()}] 🔍 EA CHECKING SIGNALS - Found ${signals?.length || 0} PENDING`);

                if (signals && signals.length > 0) {
                    const signal = signals[0];
                    console.log(`[GET] 📊 SIGNAL FOUND: ${signal.pair} ${signal.type} | Bot: ${signal.bot_id || 'MANUAL'} | Entry: ${signal.entry_price}`);
                    
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
                    
                    // Skip duplicate check - ALLOW manual trades through, only check bot trades
                    if ((signal.type === 'BUY' || signal.type === 'SELL') && signal.bot_id) {
                        const openTrades = await withRetry(() => base44.asServiceRole.entities.Trade.filter({ status: 'OPEN', pair: signal.pair, bot_id: signal.bot_id }), 1);
                        if (openTrades && openTrades.length > 0) {
                            console.log(`[GET] Signal ${signal.id} skipped - Bot ${signal.bot_id} already has ${openTrades.length} open on ${signal.pair}`);
                            await withRetry(() => base44.asServiceRole.entities.Signal.update(signal.id, { 
                                status: 'SKIPPED',
                                result_pnl: 0 
                            }), 1);
                            return Response.json({ status: "NO_SIGNAL", reason: "BOT_PAIR_ALREADY_OPEN" });
                        }
                    }

                    // Bot check if signal has bot_id
                    if (signal.bot_id) {
                        try {
                            const allBots = await withRetry(() => base44.asServiceRole.entities.BotConfig.list(), 2);
                            const matchingBot = allBots.find(b => b.id === signal.bot_id);
                            console.log(`[GET] 🤖 BOT CHECK: Found bot=${matchingBot?.name || 'NOT FOUND'} | Status=${matchingBot?.status || 'N/A'}`);

                            if (!matchingBot) {
                                console.log(`[GET] ❌ Bot ID ${signal.bot_id} not found in database, skipping signal`);
                                await withRetry(() => base44.asServiceRole.entities.Signal.update(signal.id, { 
                                    status: 'SKIPPED',
                                    result_pnl: 0 
                                }), 2);
                                return Response.json({ status: "NO_SIGNAL", reason: "BOT_NOT_FOUND" });
                            }

                            if (matchingBot.status !== 'RUNNING') {
                                console.log(`[GET] ❌ Bot ${matchingBot.name} is ${matchingBot.status}, not RUNNING - skipping signal`);
                                await withRetry(() => base44.asServiceRole.entities.Signal.update(signal.id, { 
                                    status: 'SKIPPED',
                                    result_pnl: 0 
                                }), 2);
                                return Response.json({ status: "NO_SIGNAL", reason: "BOT_NOT_RUNNING" });
                            }
                            console.log(`[GET] ✓ Bot ${matchingBot.name} is RUNNING, proceeding...`);

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

                    console.log(`[GET] ✅ SENDING SIGNAL TO MT4: ${signal.id} | ${signal.pair} ${signal.type} @ ${signal.entry_price} | Lot: ${signal.lot_size} | Comment: ${botComment}`);
                    return Response.json({
                        ...signal,
                        status: "PENDING",
                        id: signal.id,
                        magic: signal.bot_id || 0,
                        comment: botComment
                    });
                }
                console.log(`[GET] ℹ️ No pending signals available`);
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
            })(),
            timeoutPromise
        ]);

    } catch (error) {
        const isTimeout = error.message === 'Request timeout';
        console.error(`[${method} ${isTimeout ? 'TIMEOUT' : 'FATAL ERROR'}]:`, error.message);
        if (!isTimeout) {
            console.error("Stack:", error.stack?.slice(0, 300));
        }

        // Return appropriate status for timeouts vs errors
        return Response.json({ 
            status: isTimeout ? "TIMEOUT" : "ERROR",
            message: isTimeout ? "Request timeout - check database performance" : "Bridge error",
            timestamp: new Date().toISOString()
        }, { status: isTimeout ? 504 : 500 });
    }
});