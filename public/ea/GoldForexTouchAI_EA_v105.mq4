//+------------------------------------------------------------------+
//|                                    GoldForexTouchAI_EA.mq4      |
//|              Dedicated Gold (XAUUSD) EA for ForexTouchAI        |
//|   Uses MagicNumber 99999 - SEPARATE from standard EA (12345)   |
//|   v1.03: Removed StringReplace normalization - direct symbol match  |
//|   v1.04: Live-account hardening (spread, stops level, lot step norm)|
//|   v1.05: Uploads broker OHLC (required by app v2 signal engine),    |
//|          OrderSend retry on requote, reports failed executions      |
//+------------------------------------------------------------------+
#property copyright "ForexTouchAI"
#property version   "1.05"
#property strict

// --- INPUTS ---
input string BridgeURL      = "https://forex-ai-trader-cc744e2a.base44.app/functions/bridge";
input string ApiKey         = "";      // Paste your API Key from ForexTouchAI Settings page
input int    HeartbeatSec   = 30;      // Poll interval (seconds)
input int    MagicNumber    = 99999;   // MUST differ from standard EA (12345) - Gold only
input int    Slippage       = 100;     // Wide slippage tolerance required for Gold
input double MaxSpreadPips  = 8;       // Max spread in GOLD pips (1 pip = $0.10). Typical is 3; 8 blocks news blowouts. 0 = no check.
input string GoldSymbol     = "XAUUSD"; // Adjust if your broker uses XAUUSDm, XAUUSD. etc.
input int    MaxGoldTrades      = 3;     // Maximum concurrent Gold trades (0 = unlimited)
input bool   EnableTrailing     = false; // Enable trailing stop
input double TrailingStartPoints = 150;  // Profit in points before trailing activates
input double TrailingStopPoints  = 100;  // Trailing stop distance in points

// --- v1.05: candle upload (REQUIRED by the app's v2 signal engine) ---
input bool   UploadCandles     = true;   // Send broker OHLC to the app
input int    BarsToUpload      = 400;    // Bars per timeframe (needs >=210 for EMA200)
input string CandleTimeframes  = "H1,H4,D1"; // Must include your gold bot's timeframe + one above
input int    CandleUploadSecs  = 60;     // Seconds between candle uploads. One timeframe is sent per upload, rotating.
input int    OrderRetries      = 3;      // Retries on requote / off-quotes

// --- GLOBALS ---
datetime lastHeartbeat = 0;

int OnInit() {
    if (StringLen(ApiKey) == 0)
        Print("[GoldEA] WARNING: ApiKey empty - get it from the ForexTouchAI Settings page.");
    if (MarketInfo(GoldSymbol, MODE_BID) <= 0)
        Print("[GoldEA] WARNING: Symbol '", GoldSymbol, "' not in Market Watch. Add it.");
    Print("[GoldEA] Gold EA v1.05 | Symbol: ", GoldSymbol, " | MagicNumber: ", MagicNumber);
    EventSetTimer(1);
    return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) { EventKillTimer(); }

void OnTimer() {
    if (TimeCurrent() - lastHeartbeat < HeartbeatSec) return;
    lastHeartbeat = TimeCurrent();
    SendHeartbeat();
}

void OnTick() { if (EnableTrailing) ManageTrailingStop(); }

void ManageTrailingStop() {
    for (int i = 0; i < OrdersTotal(); i++) {
        if (!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
        if (OrderType() != OP_BUY && OrderType() != OP_SELL) continue;
        if (OrderMagicNumber() != MagicNumber) continue;
        if (OrderSymbol() != GoldSymbol) continue;
        double point = MarketInfo(GoldSymbol, MODE_POINT);
        double trailDist = TrailingStopPoints * point;
        double trailStart = TrailingStartPoints * point;
        if (OrderType() == OP_BUY) {
            double bid = MarketInfo(GoldSymbol, MODE_BID);
            double profit = bid - OrderOpenPrice();
            if (profit >= trailStart) {
                double newSL = NormalizeDouble(bid - trailDist, 2);
                if (newSL > OrderStopLoss() + point)
                    OrderModify(OrderTicket(), OrderOpenPrice(), newSL, OrderTakeProfit(), 0, clrGold);
            }
        } else {
            double ask = MarketInfo(GoldSymbol, MODE_ASK);
            double profit = OrderOpenPrice() - ask;
            if (profit >= trailStart) {
                double newSL = NormalizeDouble(ask + trailDist, 2);
                if (newSL < OrderStopLoss() - point || OrderStopLoss() == 0)
                    OrderModify(OrderTicket(), OrderOpenPrice(), newSL, OrderTakeProfit(), 0, clrOrangeRed);
            }
        }
    }
}

void SendHeartbeat() {
    // Only report Gold trades opened by THIS EA (MagicNumber 99999)
    string tradesJson = "[";
    bool first = true;
    for (int i = 0; i < OrdersTotal(); i++) {
        if (!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
        if (OrderType() != OP_BUY && OrderType() != OP_SELL) continue;
        if (OrderMagicNumber() != MagicNumber) continue;
        if (OrderSymbol() != GoldSymbol) continue;
        if (!first) tradesJson += ",";
        first = false;
        tradesJson += StringFormat(
            "{\"ticket\":%d,\"pair\":\"%s\",\"type\":\"%s\",\"lot_size\":%.2f,\"open_price\":%.2f,\"pnl\":%.2f,\"magic\":%d}",
            OrderTicket(), OrderSymbol(),
            OrderType() == OP_BUY ? "BUY" : "SELL",
            OrderLots(), OrderOpenPrice(), OrderProfit(), OrderMagicNumber()
        );
    }
    tradesJson += "]";

    double bid = MarketInfo(GoldSymbol, MODE_BID);
    double ask = MarketInfo(GoldSymbol, MODE_ASK);
    string pricesJson = bid > 0
        ? StringFormat("[{\"symbol\":\"%s\",\"bid\":%.2f,\"ask\":%.2f}]", GoldSymbol, bid, ask)
        : "[]";

    string payload = StringFormat(
        "{\"account_number\":\"%s\",\"server_name\":\"%s\",\"balance\":%.2f,\"equity\":%.2f,\"margin\":%.2f,\"free_margin\":%.2f,\"margin_level\":%.2f,\"trades\":%s,\"prices\":%s%s}",
        IntegerToString(AccountNumber()), AccountServer(),
        AccountBalance(), AccountEquity(), AccountMargin(), AccountFreeMargin(),
        AccountMargin() > 0 ? AccountEquity() / AccountMargin() * 100 : 0,
        tradesJson, pricesJson, BuildGoldCandlePayload()
    );

    char postData[], result[];
    string resultHeaders;
    StringToCharArray(payload, postData, 0, StringLen(payload));
    string headers = "Content-Type: application/json\r\nAuthorization: Bearer " + ApiKey + "\r\n";

    int res = WebRequest("POST", BridgeURL, headers, 5000, postData, result, resultHeaders);
    if (res == -1) { Print("[GoldEA] WebRequest failed. Add URL to Tools > Options > Expert Advisors"); return; }
    if (res == 403) { Print("[GoldEA] ERROR 403: Invalid ApiKey."); return; }

    string response = CharArrayToString(result);
    Print("[GoldEA] Response: ", StringSubstr(response, 0, 200));
    ProcessSignals(response);
    ProcessCloseCommands(response);
}

int CountOpenGoldTrades() {
    int count = 0;
    for (int i = 0; i < OrdersTotal(); i++) {
        if (!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
        if (OrderType() != OP_BUY && OrderType() != OP_SELL) continue;
        if (OrderMagicNumber() != MagicNumber) continue;
        if (OrderSymbol() != GoldSymbol) continue;
        count++;
    }
    return count;
}

void ProcessSignals(string json) {
    int start = StringFind(json, "\"pending_signals\"");
    if (start == -1) return;
    start = StringFind(json, "[", start);
    if (start == -1) return;
    int end = StringFind(json, "]", start);
    if (end == -1) return;
    string arr = StringSubstr(json, start + 1, end - start - 1);
    if (StringLen(arr) < 5) return;
    int pos = 0;
    while (pos < StringLen(arr)) {
        if (MaxGoldTrades > 0 && CountOpenGoldTrades() >= MaxGoldTrades) {
            Print("[GoldEA] MaxGoldTrades limit reached (", MaxGoldTrades, ") — skipping remaining signals");
            break;
        }
        int objStart = StringFind(arr, "{", pos);
        if (objStart == -1) break;
        int objEnd = StringFind(arr, "}", objStart);
        if (objEnd == -1) break;
        string obj = StringSubstr(arr, objStart, objEnd - objStart + 1);
        string sigPair = ExtractStr(obj, "pair");
        if (sigPair == GoldSymbol) ExecuteSignal(obj);
        pos = objEnd + 1;
    }
}

string ExtractStr(string json, string key) {
    string search = "\"" + key + "\":\"";
    int start = StringFind(json, search);
    if (start == -1) return "";
    start += StringLen(search);
    int end = StringFind(json, "\"", start);
    if (end == -1) return "";
    return StringSubstr(json, start, end - start);
}

double ExtractDbl(string json, string key) {
    string search = "\"" + key + "\":";
    int start = StringFind(json, search);
    if (start == -1) return 0;
    start += StringLen(search);
    int end = start;
    while (end < StringLen(json)) {
        string ch = StringSubstr(json, end, 1);
        if (ch == "," || ch == "}" || ch == " ") break;
        end++;
    }
    return StringToDouble(StringSubstr(json, start, end - start));
}

void ExecuteSignal(string obj) {
    string signalId = ExtractStr(obj, "id");
    string type     = ExtractStr(obj, "type");
    double sigEntry = ExtractDbl(obj, "entry_price");
    double sigLot   = ExtractDbl(obj, "lot_size");
    double sigSL    = ExtractDbl(obj, "stop_loss");
    double sigTP    = ExtractDbl(obj, "take_profit");
    string orderComment = ExtractStr(obj, "comment");
    if (StringLen(orderComment) == 0) orderComment = "GoldForexTouchAI";

    int cmd = (type == "BUY") ? OP_BUY : OP_SELL;
    double price = (cmd == OP_BUY) ? MarketInfo(GoldSymbol, MODE_ASK) : MarketInfo(GoldSymbol, MODE_BID);
    int digits = (int)MarketInfo(GoldSymbol, MODE_DIGITS);
    if (price == 0) { Print("[GoldEA] Cannot get price for ", GoldSymbol); return; }

    // --- Live-account safety checks (demo accounts skip these silently) ---
    // 1. Spread check — live spreads are wider
    double spreadPts = MarketInfo(GoldSymbol, MODE_SPREAD);
    double point     = MarketInfo(GoldSymbol, MODE_POINT);
    // NOTE: the old expression `spreadPts * point * 10` is CORRECT for gold and
    // was left alone. It reduces to (spread in price) / 0.1, and a gold pip IS
    // 0.1, so it produced the right answer on both 2- and 3-digit brokers.
    // (The same expression in the FOREX EA was wrong by 1000x because a forex
    // pip is 0.0001, and would be wrong by 10x for silver at 0.01.)
    // Written explicitly below so the intent survives future edits.
    double goldPip   = 0.1;
    double spreadPips = (point > 0) ? (spreadPts * point) / goldPip : 0;
    if (MaxSpreadPips > 0 && spreadPips > MaxSpreadPips) {
        Print("[GoldEA] REJECTED: Spread ", DoubleToString(spreadPips, 1), " pips > MaxSpreadPips ", MaxSpreadPips);
        return;
    }

    // 2. Minimum stops level — live brokers enforce this (Error 130 if too close)
    double stopsLevel = MarketInfo(GoldSymbol, MODE_STOPLEVEL);
    double minStopDist = stopsLevel * point;
    double goldMinFallback = 5.0;  // Fallback: enforce at least $5 distance for Gold
    if (minStopDist < goldMinFallback) minStopDist = goldMinFallback;

    double finalSL = 0, finalTP = 0;
    if (sigEntry > 0) {
        if (cmd == OP_BUY) {
            if (sigSL > 0) finalSL = NormalizeDouble(price - (sigEntry - sigSL), digits);
            if (sigTP > 0) finalTP = NormalizeDouble(price + (sigTP - sigEntry), digits);
        } else {
            if (sigSL > 0) finalSL = NormalizeDouble(price + (sigSL - sigEntry), digits);
            if (sigTP > 0) finalTP = NormalizeDouble(price - (sigEntry - sigTP), digits);
        }
    } else {
        finalSL = sigSL; finalTP = sigTP;
    }

    // Enforce minimum stops distance
    if (finalSL > 0) {
        if (cmd == OP_BUY && (price - finalSL) < minStopDist) finalSL = NormalizeDouble(price - minStopDist, digits);
        if (cmd == OP_SELL && (finalSL - price) < minStopDist) finalSL = NormalizeDouble(price + minStopDist, digits);
    }
    if (finalTP > 0) {
        if (cmd == OP_BUY && (finalTP - price) < minStopDist) finalTP = NormalizeDouble(price + minStopDist, digits);
        if (cmd == OP_SELL && (price - finalTP) < minStopDist) finalTP = NormalizeDouble(price - minStopDist, digits);
    }

    // 3. Normalize lot size to broker's volume step (live accounts reject unnormalized lots)
    double minVol  = MarketInfo(GoldSymbol, MODE_MINLOT);
    double maxVol  = MarketInfo(GoldSymbol, MODE_MAXLOT);
    double volStep = MarketInfo(GoldSymbol, MODE_LOTSTEP);
    double lot = (sigLot > 0) ? sigLot : 0.01;
    if (volStep > 0) lot = MathFloor(lot / volStep) * volStep;
    if (lot < minVol) lot = minVol;
    if (lot > maxVol) lot = maxVol;
    lot = NormalizeDouble(lot, 2);

    Print("[GoldEA] Executing GOLD ", type, " @ ", price, " SL=", finalSL, " TP=", finalTP, " Lot=", lot, " StopsLevel=", stopsLevel, " SpreadPips=", DoubleToString(spreadPips, 1));

    // Retry transient rejections. Gold requotes far more than forex, and a
    // dropped signal previously sat ACTIVE in the app for 20 minutes before
    // expiring, with nothing to say it had never opened.
    int ticket = -1;
    int lastErr = 0;
    for (int attempt = 0; attempt < MathMax(1, OrderRetries) && ticket <= 0; attempt++) {
        if (attempt > 0) {
            Sleep(400);
            RefreshRates();
            price = (cmd == OP_BUY) ? MarketInfo(GoldSymbol, MODE_ASK) : MarketInfo(GoldSymbol, MODE_BID);
            if (price <= 0) break;
        }
        ticket = OrderSend(GoldSymbol, cmd, lot, price, Slippage, finalSL, finalTP, orderComment, MagicNumber, 0, cmd == OP_BUY ? clrGold : clrOrangeRed);
        if (ticket <= 0) {
            lastErr = GetLastError();
            if (lastErr != 138 && lastErr != 136 && lastErr != 135 && lastErr != 129) break;
            Print("[GoldEA] OrderSend attempt ", attempt + 1, " failed (", lastErr, ") - retrying");
        }
    }

    if (ticket > 0) {
        Print("[GoldEA] Gold order placed! Ticket=", ticket);
        ConfirmExecution(signalId, ticket, type, lot, price);
    } else {
        Print("[GoldEA] OrderSend FAILED after ", OrderRetries, " attempt(s). Error=", lastErr,
              " Lot=", lot, " SpreadPips=", DoubleToString(spreadPips, 1),
              " - check XAUUSD is in Market Watch and margin is sufficient.");
        ReportExecutionFailure(signalId, lastErr);
    }
}

// Derive sibling endpoints from BridgeURL so changing the app domain in one
// input updates everything. Previously this URL was hardcoded, so pointing the
// EA at a new app silently kept confirming to the OLD one.
string FunctionUrl(string fnName) {
    int cut = StringFind(BridgeURL, "/functions/");
    if (cut > 0) return StringSubstr(BridgeURL, 0, cut) + "/functions/" + fnName;
    return BridgeURL;
}

void ConfirmExecution(string signalId, int ticket, string type, double lots, double price) {
    string confirmUrl = FunctionUrl("confirmExecution");
    string payload = StringFormat(
        "{\"signal_id\":\"%s\",\"ticket\":%d,\"pair\":\"%s\",\"type\":\"%s\",\"lot_size\":%.2f,\"open_price\":%.2f,\"account_number\":\"%s\"}",
        signalId, ticket, GoldSymbol, type, lots, price, IntegerToString(AccountNumber())
    );
    char postData[], result[];
    string resultHeaders;
    StringToCharArray(payload, postData, 0, StringLen(payload));
    string headers = "Content-Type: application/json\r\nAuthorization: Bearer " + ApiKey + "\r\n";
    WebRequest("POST", confirmUrl, headers, 5000, postData, result, resultHeaders);
    Print("[GoldEA] Execution confirmed for ticket ", ticket);
}

void ProcessCloseCommands(string json) {
    int start = StringFind(json, "\"close_commands\"");
    if (start == -1) return;
    start = StringFind(json, "[", start);
    if (start == -1) return;
    int end = StringFind(json, "]", start);
    if (end == -1) return;
    string arr = StringSubstr(json, start + 1, end - start - 1);
    if (StringLen(arr) < 5) return;
    int pos = 0;
    while (pos < StringLen(arr)) {
        int objStart = StringFind(arr, "{", pos);
        if (objStart == -1) break;
        int objEnd = StringFind(arr, "}", objStart);
        if (objEnd == -1) break;
        string obj = StringSubstr(arr, objStart, objEnd - objStart + 1);
        int ticket = (int)ExtractDbl(obj, "ticket");
        if (ticket > 0) CloseTicket(ticket);
        pos = objEnd + 1;
    }
}

void CloseTicket(int ticket) {
    if (!OrderSelect(ticket, SELECT_BY_TICKET, MODE_TRADES)) {
        Print("[GoldEA] Close: ticket ", ticket, " not found (may already be closed)");
        return;
    }
    string symbol = OrderSymbol();
    double lots = OrderLots();
    int type = OrderType();
    double price = (type == OP_BUY) ? MarketInfo(symbol, MODE_BID) : MarketInfo(symbol, MODE_ASK);
    if (price <= 0) { Print("[GoldEA] Close: no price for ", symbol); return; }
    bool ok = OrderClose(ticket, lots, price, Slippage, clrYellow);
    if (ok) Print("[GoldEA] Closed ticket ", ticket, " ", symbol, " @ ", price);
    else Print("[GoldEA] OrderClose FAILED ticket ", ticket, " error=", GetLastError());
}
//+------------------------------------------------------------------+

//+------------------------------------------------------------------+
//| Report a failed execution so the signal returns to PENDING       |
//+------------------------------------------------------------------+
void ReportExecutionFailure(string signalId, int errorCode) {
    if (StringLen(signalId) == 0) return;
    string payload = StringFormat(
        "{\"signal_id\":\"%s\",\"account_number\":\"%s\",\"symbol\":\"%s\",\"status\":\"FAILED\",\"error_code\":%d}",
        signalId, IntegerToString(AccountNumber()), GoldSymbol, errorCode
    );
    char postData[], result[];
    string resultHeaders;
    StringToCharArray(payload, postData, 0, StringLen(payload));
    string headers = "Content-Type: application/json\r\nAuthorization: Bearer " + ApiKey + "\r\n";
    int r = WebRequest("POST", FunctionUrl("confirmExecution"), headers, 8000, postData, result, resultHeaders);
    if (r < 0) Print("[GoldEA] Could not report failure: ", GetLastError());
    else Print("[GoldEA] Reported execution failure for signal ", signalId);
}

//+------------------------------------------------------------------+
//| Upload broker OHLC for gold                                      |
//+------------------------------------------------------------------+
// This matters MORE for gold than for forex. Without it the app falls back to
// Yahoo, whose gold symbol (GC=F) is COMEX gold FUTURES, not spot XAUUSD.
// Futures trade tens of dollars away from spot, so indicators, stop distances
// and ATR would all be computed against prices your broker never quoted.
datetime lastCandleUpload = 0;

int GoldTimeframeToPeriod(string tf) {
    if (tf == "M5")  return PERIOD_M5;
    if (tf == "M15") return PERIOD_M15;
    if (tf == "M30") return PERIOD_M30;
    if (tf == "H1")  return PERIOD_H1;
    if (tf == "H4")  return PERIOD_H4;
    if (tf == "D1")  return PERIOD_D1;
    if (tf == "W1")  return PERIOD_W1;
    return 0;
}

string BuildGoldCandleJson(string tfName) {
    int period = GoldTimeframeToPeriod(tfName);
    if (period == 0) return "";

    int available = iBars(GoldSymbol, period);
    if (available < 60) {
        Print("[GoldEA] ", GoldSymbol, " ", tfName, ": only ", available, " bars in terminal. ",
              "Open that chart once and scroll back, or raise Tools > Options > Charts > Max bars.");
        return "";
    }

    int count = MathMin(BarsToUpload, available - 1);   // -1 excludes the forming bar
    if (count < 60) return "";

    string bars = "";
    // Index 0 is the CURRENT, still-open bar. Start at `count` and stop at 1 so
    // only CLOSED candles are sent - indicators on an open bar repaint.
    for (int i = count; i >= 1; i--) {
        if (StringLen(bars) > 0) bars += ",";
        bars += StringFormat("{\"t\":%d,\"o\":%.5f,\"h\":%.5f,\"l\":%.5f,\"c\":%.5f,\"v\":%d}",
            (int)iTime(GoldSymbol, period, i),
            iOpen(GoldSymbol, period, i), iHigh(GoldSymbol, period, i),
            iLow(GoldSymbol, period, i),  iClose(GoldSymbol, period, i),
            (int)iVolume(GoldSymbol, period, i));
    }
    if (StringLen(bars) == 0) return "";

    // Always report as XAUUSD regardless of the broker's suffix, so the app
    // stores one canonical series.
    // NOTE: built with the + operator, not StringConcatenate().
    // In MQL5, StringConcatenate has the signature int StringConcatenate(string&, ...)
    // - it writes into an output parameter and returns a character count, so it
    // cannot be used as an expression ("lvalue expected"). MQL4's version returns
    // a string, which is why the .mq4 build accepted it. The + operator behaves
    // the same in both languages.
    return "{\"symbol\":\"XAUUSD\",\"timeframe\":\"" + tfName +
           "\",\"bars\":[" + bars + "]}";
}

// Rotating cursor over the timeframe list.
int candleCursor = 0;

string BuildGoldCandlePayload() {
    if (!UploadCandles) return "";
    if (TimeCurrent() - lastCandleUpload < CandleUploadSecs) return "";

    string tfs[];
    int n = StringSplit(CandleTimeframes, ',', tfs);
    if (n <= 0) return "";

    // ONE timeframe per upload, rotating. Sending H1+H4+D1 together meant three
    // blocks of 400 bars in a single POST plus three database writes held open
    // inside the request, which could exceed MT5's 20-second WebRequest limit
    // and fail with 1003/5203. Rotating keeps each upload small.
    string entry = "";
    int attempts = 0;
    while (attempts < n && StringLen(entry) == 0) {
        string tf = tfs[candleCursor % n];
        candleCursor++;
        attempts++;
        StringTrimLeft(tf); StringTrimRight(tf);
        if (StringLen(tf) == 0) continue;
        entry = BuildGoldCandleJson(tf);
    }
    if (StringLen(entry) == 0) return "";
    string entries = entry;

    lastCandleUpload = TimeCurrent();
    Print("[GoldEA] Uploading gold candles - timeframe ", candleCursor % n, "/", n, " in rotation");
    return ",\"candles\":[" + entries + "]";
}
