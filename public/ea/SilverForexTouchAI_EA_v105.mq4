//+------------------------------------------------------------------+
//|                                    SilverForexTouchAI_EA.mq4      |
//|              Dedicated Silver (XAGUSD) EA for ForexTouchAI        |
//|   Uses MagicNumber 99998 - SEPARATE from gold (99999) and forex (12345)   |
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
input int    MagicNumber    = 99998;   // MUST differ from gold (99999) and forex (12345) - Silver only
input int    Slippage       = 100;     // Slippage tolerance for Silver
input double MaxSpreadPips  = 8;       // Max spread in SILVER pips (1 pip = $0.01). Typical is 3; 8 blocks news blowouts. 0 = no check.
input string SilverSymbol     = "XAGUSD"; // Adjust if your broker uses XAGUSDm, XAGUSD. etc.
input int    MaxSilverTrades      = 3;     // Maximum concurrent Silver trades (0 = unlimited)
input bool   EnableTrailing     = false; // Enable trailing stop
input double TrailingStartPoints = 150;  // Profit in points before trailing activates
input double TrailingStopPoints  = 100;  // Trailing stop distance in points

// --- v1.05: candle upload (REQUIRED by the app's v2 signal engine) ---
input bool   UploadCandles     = true;   // Send broker OHLC to the app
input int    BarsToUpload      = 400;    // Bars per timeframe (needs >=210 for EMA200)
input string CandleTimeframes  = "H1,H4,D1"; // Must include your silver bot's timeframe + one above
input int    CandleUploadMins  = 15;     // Minutes between candle uploads
input int    OrderRetries      = 3;      // Retries on requote / off-quotes

// --- GLOBALS ---
datetime lastHeartbeat = 0;

int OnInit() {
    if (StringLen(ApiKey) == 0)
        Print("[SilverEA] WARNING: ApiKey empty - get it from the ForexTouchAI Settings page.");
    if (MarketInfo(SilverSymbol, MODE_BID) <= 0)
        Print("[SilverEA] WARNING: Symbol '", SilverSymbol, "' not in Market Watch. Add it.");
    Print("[SilverEA] Silver EA v1.05 | Symbol: ", SilverSymbol, " | MagicNumber: ", MagicNumber);
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
        if (OrderSymbol() != SilverSymbol) continue;
        double point = MarketInfo(SilverSymbol, MODE_POINT);
        double trailDist = TrailingStopPoints * point;
        double trailStart = TrailingStartPoints * point;
        if (OrderType() == OP_BUY) {
            double bid = MarketInfo(SilverSymbol, MODE_BID);
            double profit = bid - OrderOpenPrice();
            if (profit >= trailStart) {
                double newSL = NormalizeDouble(bid - trailDist, 3);
                if (newSL > OrderStopLoss() + point)
                    OrderModify(OrderTicket(), OrderOpenPrice(), newSL, OrderTakeProfit(), 0, clrSilver);
            }
        } else {
            double ask = MarketInfo(SilverSymbol, MODE_ASK);
            double profit = OrderOpenPrice() - ask;
            if (profit >= trailStart) {
                double newSL = NormalizeDouble(ask + trailDist, 3);
                if (newSL < OrderStopLoss() - point || OrderStopLoss() == 0)
                    OrderModify(OrderTicket(), OrderOpenPrice(), newSL, OrderTakeProfit(), 0, clrOrangeRed);
            }
        }
    }
}

void SendHeartbeat() {
    // Only report Silver trades opened by THIS EA (MagicNumber 99998)
    string tradesJson = "[";
    bool first = true;
    for (int i = 0; i < OrdersTotal(); i++) {
        if (!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
        if (OrderType() != OP_BUY && OrderType() != OP_SELL) continue;
        if (OrderMagicNumber() != MagicNumber) continue;
        if (OrderSymbol() != SilverSymbol) continue;
        if (!first) tradesJson += ",";
        first = false;
        tradesJson += StringFormat(
            "{\"ticket\":%d,\"pair\":\"%s\",\"type\":\"%s\",\"lot_size\":%.2f,\"open_price\":%.3f,\"pnl\":%.2f,\"magic\":%d}",
            OrderTicket(), OrderSymbol(),
            OrderType() == OP_BUY ? "BUY" : "SELL",
            OrderLots(), OrderOpenPrice(), OrderProfit(), OrderMagicNumber()
        );
    }
    tradesJson += "]";

    double bid = MarketInfo(SilverSymbol, MODE_BID);
    double ask = MarketInfo(SilverSymbol, MODE_ASK);
    string pricesJson = bid > 0
        ? StringFormat("[{\"symbol\":\"%s\",\"bid\":%.3f,\"ask\":%.3f}]", SilverSymbol, bid, ask)
        : "[]";

    string payload = StringFormat(
        "{\"account_number\":\"%s\",\"server_name\":\"%s\",\"balance\":%.2f,\"equity\":%.2f,\"margin\":%.2f,\"free_margin\":%.2f,\"margin_level\":%.2f,\"trades\":%s,\"prices\":%s%s}",
        IntegerToString(AccountNumber()), AccountServer(),
        AccountBalance(), AccountEquity(), AccountMargin(), AccountFreeMargin(),
        AccountMargin() > 0 ? AccountEquity() / AccountMargin() * 100 : 0,
        tradesJson, pricesJson, BuildSilverCandlePayload()
    );

    char postData[], result[];
    string resultHeaders;
    StringToCharArray(payload, postData, 0, StringLen(payload));
    string headers = "Content-Type: application/json\r\nAuthorization: Bearer " + ApiKey + "\r\n";

    int res = WebRequest("POST", BridgeURL, headers, 5000, postData, result, resultHeaders);
    if (res == -1) { Print("[SilverEA] WebRequest failed. Add URL to Tools > Options > Expert Advisors"); return; }
    if (res == 403) { Print("[SilverEA] ERROR 403: Invalid ApiKey."); return; }

    string response = CharArrayToString(result);
    Print("[SilverEA] Response: ", StringSubstr(response, 0, 200));
    ProcessSignals(response);
    ProcessCloseCommands(response);
}

int CountOpenSilverTrades() {
    int count = 0;
    for (int i = 0; i < OrdersTotal(); i++) {
        if (!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
        if (OrderType() != OP_BUY && OrderType() != OP_SELL) continue;
        if (OrderMagicNumber() != MagicNumber) continue;
        if (OrderSymbol() != SilverSymbol) continue;
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
        if (MaxSilverTrades > 0 && CountOpenSilverTrades() >= MaxSilverTrades) {
            Print("[SilverEA] MaxSilverTrades limit reached (", MaxSilverTrades, ") — skipping remaining signals");
            break;
        }
        int objStart = StringFind(arr, "{", pos);
        if (objStart == -1) break;
        int objEnd = StringFind(arr, "}", objStart);
        if (objEnd == -1) break;
        string obj = StringSubstr(arr, objStart, objEnd - objStart + 1);
        string sigPair = ExtractStr(obj, "pair");
        if (sigPair == SilverSymbol) ExecuteSignal(obj);
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
    if (StringLen(orderComment) == 0) orderComment = "SilverForexTouchAI";

    int cmd = (type == "BUY") ? OP_BUY : OP_SELL;
    double price = (cmd == OP_BUY) ? MarketInfo(SilverSymbol, MODE_ASK) : MarketInfo(SilverSymbol, MODE_BID);
    int digits = (int)MarketInfo(SilverSymbol, MODE_DIGITS);
    if (price == 0) { Print("[SilverEA] Cannot get price for ", SilverSymbol); return; }

    // --- Live-account safety checks (demo accounts skip these silently) ---
    // 1. Spread check — live spreads are wider
    double spreadPts = MarketInfo(SilverSymbol, MODE_SPREAD);
    double point     = MarketInfo(SilverSymbol, MODE_POINT);
    // NOTE: the old expression `spreadPts * point * 10` is CORRECT for silver and
    // was left alone. It reduces to (spread in price) / 0.1, and a gold pip IS
    // 0.1, so it produced the right answer on both 2- and 3-digit brokers.
    // (The same expression in the FOREX EA was wrong by 1000x because a forex
    // pip is 0.0001, and would be wrong by 10x for silver at 0.01.)
    // Written explicitly below so the intent survives future edits.
    // SILVER PIP, NOT GOLD'S. This is the line that must change when deriving a
    // silver EA from the gold one, and the easiest to miss. A gold pip is 0.1;
    // a silver pip is 0.01. Leaving 0.1 here understates the silver spread by
    // 10x — a $0.03 spread reads as 0.3 pips instead of 3 — which leaves the
    // spread filter effectively switched off in exactly the conditions it
    // exists to catch.
    double silverPip = 0.01;
    double spreadPips = (point > 0) ? (spreadPts * point) / silverPip : 0;
    if (MaxSpreadPips > 0 && spreadPips > MaxSpreadPips) {
        Print("[SilverEA] REJECTED: Spread ", DoubleToString(spreadPips, 1), " pips > MaxSpreadPips ", MaxSpreadPips);
        return;
    }

    // 2. Minimum stops level — live brokers enforce this (Error 130 if too close)
    double stopsLevel = MarketInfo(SilverSymbol, MODE_STOPLEVEL);
    double minStopDist = stopsLevel * point;
    // Gold uses a flat $5 floor, which suits an instrument trading near $2,400.
    // Silver trades near $30, where $5 would be a ~17% stop — far wider than any
    // signal intends and enough to make position sizing refuse the trade.
    // $0.10 is the equivalent distance (~3x a typical silver spread).
    double silverMinFallback = 0.10;
    if (minStopDist < silverMinFallback) minStopDist = silverMinFallback;

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
    double minVol  = MarketInfo(SilverSymbol, MODE_MINLOT);
    double maxVol  = MarketInfo(SilverSymbol, MODE_MAXLOT);
    double volStep = MarketInfo(SilverSymbol, MODE_LOTSTEP);
    double lot = (sigLot > 0) ? sigLot : 0.01;
    if (volStep > 0) lot = MathFloor(lot / volStep) * volStep;
    if (lot < minVol) lot = minVol;
    if (lot > maxVol) lot = maxVol;
    lot = NormalizeDouble(lot, 2);

    Print("[SilverEA] Executing SILVER ", type, " @ ", price, " SL=", finalSL, " TP=", finalTP, " Lot=", lot, " StopsLevel=", stopsLevel, " SpreadPips=", DoubleToString(spreadPips, 1));

    // Retry transient rejections. Metals requote far more than forex, and a
    // dropped signal previously sat ACTIVE in the app for 20 minutes before
    // expiring, with nothing to say it had never opened.
    int ticket = -1;
    int lastErr = 0;
    for (int attempt = 0; attempt < MathMax(1, OrderRetries) && ticket <= 0; attempt++) {
        if (attempt > 0) {
            Sleep(400);
            RefreshRates();
            price = (cmd == OP_BUY) ? MarketInfo(SilverSymbol, MODE_ASK) : MarketInfo(SilverSymbol, MODE_BID);
            if (price <= 0) break;
        }
        ticket = OrderSend(SilverSymbol, cmd, lot, price, Slippage, finalSL, finalTP, orderComment, MagicNumber, 0, cmd == OP_BUY ? clrSilver : clrOrangeRed);
        if (ticket <= 0) {
            lastErr = GetLastError();
            if (lastErr != 138 && lastErr != 136 && lastErr != 135 && lastErr != 129) break;
            Print("[SilverEA] OrderSend attempt ", attempt + 1, " failed (", lastErr, ") - retrying");
        }
    }

    if (ticket > 0) {
        Print("[SilverEA] Silver order placed! Ticket=", ticket);
        ConfirmExecution(signalId, ticket, type, lot, price);
    } else {
        Print("[SilverEA] OrderSend FAILED after ", OrderRetries, " attempt(s). Error=", lastErr,
              " Lot=", lot, " SpreadPips=", DoubleToString(spreadPips, 1),
              " - check XAGUSD is in Market Watch and margin is sufficient.");
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
        "{\"signal_id\":\"%s\",\"ticket\":%d,\"pair\":\"%s\",\"type\":\"%s\",\"lot_size\":%.2f,\"open_price\":%.3f,\"account_number\":\"%s\"}",
        signalId, ticket, SilverSymbol, type, lots, price, IntegerToString(AccountNumber())
    );
    char postData[], result[];
    string resultHeaders;
    StringToCharArray(payload, postData, 0, StringLen(payload));
    string headers = "Content-Type: application/json\r\nAuthorization: Bearer " + ApiKey + "\r\n";
    WebRequest("POST", confirmUrl, headers, 5000, postData, result, resultHeaders);
    Print("[SilverEA] Execution confirmed for ticket ", ticket);
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
        Print("[SilverEA] Close: ticket ", ticket, " not found (may already be closed)");
        return;
    }
    string symbol = OrderSymbol();
    double lots = OrderLots();
    int type = OrderType();
    double price = (type == OP_BUY) ? MarketInfo(symbol, MODE_BID) : MarketInfo(symbol, MODE_ASK);
    if (price <= 0) { Print("[SilverEA] Close: no price for ", symbol); return; }
    bool ok = OrderClose(ticket, lots, price, Slippage, clrYellow);
    if (ok) Print("[SilverEA] Closed ticket ", ticket, " ", symbol, " @ ", price);
    else Print("[SilverEA] OrderClose FAILED ticket ", ticket, " error=", GetLastError());
}
//+------------------------------------------------------------------+

//+------------------------------------------------------------------+
//| Report a failed execution so the signal returns to PENDING       |
//+------------------------------------------------------------------+
void ReportExecutionFailure(string signalId, int errorCode) {
    if (StringLen(signalId) == 0) return;
    string payload = StringFormat(
        "{\"signal_id\":\"%s\",\"account_number\":\"%s\",\"symbol\":\"%s\",\"status\":\"FAILED\",\"error_code\":%d}",
        signalId, IntegerToString(AccountNumber()), SilverSymbol, errorCode
    );
    char postData[], result[];
    string resultHeaders;
    StringToCharArray(payload, postData, 0, StringLen(payload));
    string headers = "Content-Type: application/json\r\nAuthorization: Bearer " + ApiKey + "\r\n";
    int r = WebRequest("POST", FunctionUrl("confirmExecution"), headers, 8000, postData, result, resultHeaders);
    if (r < 0) Print("[SilverEA] Could not report failure: ", GetLastError());
    else Print("[SilverEA] Reported execution failure for signal ", signalId);
}

//+------------------------------------------------------------------+
//| Upload broker OHLC for silver                                      |
//+------------------------------------------------------------------+
// This matters MORE for silver than for forex. Without it the app falls back to
// Yahoo, whose silver symbol (SI=F) is COMEX silver FUTURES, not spot XAGUSD.
// Futures trade tens of dollars away from spot, so indicators, stop distances
// and ATR would all be computed against prices your broker never quoted.
datetime lastCandleUpload = 0;

int SilverTimeframeToPeriod(string tf) {
    if (tf == "M5")  return PERIOD_M5;
    if (tf == "M15") return PERIOD_M15;
    if (tf == "M30") return PERIOD_M30;
    if (tf == "H1")  return PERIOD_H1;
    if (tf == "H4")  return PERIOD_H4;
    if (tf == "D1")  return PERIOD_D1;
    if (tf == "W1")  return PERIOD_W1;
    return 0;
}

string BuildSilverCandleJson(string tfName) {
    int period = SilverTimeframeToPeriod(tfName);
    if (period == 0) return "";

    int available = iBars(SilverSymbol, period);
    if (available < 60) {
        Print("[SilverEA] ", SilverSymbol, " ", tfName, ": only ", available, " bars in terminal. ",
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
            (int)iTime(SilverSymbol, period, i),
            iOpen(SilverSymbol, period, i), iHigh(SilverSymbol, period, i),
            iLow(SilverSymbol, period, i),  iClose(SilverSymbol, period, i),
            (int)iVolume(SilverSymbol, period, i));
    }
    if (StringLen(bars) == 0) return "";

    // Always report as XAGUSD regardless of the broker's suffix, so the app
    // stores one canonical series.
    //
    // This label MUST be XAGUSD. The app keys CandleHistory on (symbol,
    // timeframe) and overwrites the row on each upload, so shipping "XAUUSD"
    // here would replace gold's candles with silver bars and the gold bot would
    // then compute its ATR, stops and every indicator from silver prices.
    // NOTE: built with the + operator, not StringConcatenate().
    // In MQL5, StringConcatenate has the signature int StringConcatenate(string&, ...)
    // - it writes into an output parameter and returns a character count, so it
    // cannot be used as an expression ("lvalue expected"). MQL4's version returns
    // a string, which is why the .mq4 build accepted it. The + operator behaves
    // the same in both languages.
    return "{\"symbol\":\"XAGUSD\",\"timeframe\":\"" + tfName +
           "\",\"bars\":[" + bars + "]}";
}

string BuildSilverCandlePayload() {
    if (!UploadCandles) return "";
    if (TimeCurrent() - lastCandleUpload < CandleUploadMins * 60) return "";

    string tfs[];
    int n = StringSplit(CandleTimeframes, ',', tfs);
    if (n <= 0) return "";

    string entries = "";
    for (int i = 0; i < n; i++) {
        string tf = tfs[i];
        StringTrimLeft(tf); StringTrimRight(tf);
        if (StringLen(tf) == 0) continue;
        string entry = BuildSilverCandleJson(tf);
        if (StringLen(entry) == 0) continue;
        if (StringLen(entries) > 0) entries += ",";
        entries += entry;
    }
    if (StringLen(entries) == 0) return "";

    lastCandleUpload = TimeCurrent();
    Print("[SilverEA] Uploading silver candles (", CandleTimeframes, ")");
    return ",\"candles\":[" + entries + "]";
}
