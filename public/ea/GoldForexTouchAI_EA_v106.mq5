//+------------------------------------------------------------------+
//|                                  GoldForexTouchAI_EA.mq5        |
//|         Dedicated Gold (XAUUSD) EA for ForexTouchAI (MT5)       |
//|   Uses MagicNumber 99999 - SEPARATE from standard EA (12345)    |
//|   v1.02: Added broker filling mode detection (fixes error 10030)|
//|   v1.03: Fixed StringReplace in-place symbol matching + hide_sl_tp|
//|   v1.04: Removed StringReplace normalization - direct symbol match  |
//|   v1.05: Live-account hardening (trade mode, spread, stops, lot step)|
//|   v1.06: Uploads broker OHLC (required by app v2 signal engine),    |
//|          order retry on requote, reports failed executions          |
//+------------------------------------------------------------------+
#property copyright "ForexTouchAI"
#property version   "1.06"
#property strict

#include <Trade\Trade.mqh>

// --- INPUTS ---
input string BridgeURL      = "https://forex-ai-trader-cc744e2a.base44.app/functions/bridge";
input string ApiKey         = "";       // Paste your API Key from ForexTouchAI Settings page
input int    HeartbeatSec   = 30;       // Poll interval (seconds)
input ulong  MagicNumber    = 99999;    // MUST differ from standard EA (12345) - Gold only
input int    Slippage       = 100;      // Wide slippage tolerance required for Gold
input double MaxSpreadPips  = 8;        // Max spread in GOLD pips (1 pip = $0.10). Typical is 3; 8 blocks news blowouts. 0 = no check.
input string GoldSymbol     = "XAUUSD"; // Adjust if broker uses XAUUSDm, XAUUSD. etc.
input int    MaxGoldTrades      = 3;     // Maximum concurrent Gold trades (0 = unlimited)
input bool   EnableTrailing     = false; // Enable trailing stop
input double TrailingStartPoints = 150;  // Profit in points before trailing activates
input double TrailingStopPoints  = 100;  // Trailing stop distance in points

// --- v1.06: candle upload (REQUIRED by the app's v2 signal engine) ---
input bool   UploadCandles     = true;   // Send broker OHLC to the app
input int    BarsToUpload      = 400;    // Bars per timeframe (needs >=210 for EMA200)
input string CandleTimeframes  = "H1,H4,D1"; // Must include your gold bot's timeframe + one above
input int    CandleUploadSecs  = 60;     // Seconds between candle uploads. One timeframe is sent per upload, rotating.
input int    OrderRetries      = 3;      // Retries on requote / off-quotes

// --- GLOBALS ---
datetime lastHeartbeat = 0;
CTrade trade;

int OnInit() {
    if (StringLen(ApiKey) == 0)
        Print("[GoldEA MT5] WARNING: ApiKey empty - get it from the ForexTouchAI Settings page.");
    double bid = SymbolInfoDouble(GoldSymbol, SYMBOL_BID);
    if (bid <= 0)
        Print("[GoldEA MT5] WARNING: Symbol '", GoldSymbol, "' not in Market Watch. Add it.");
    trade.SetExpertMagicNumber(MagicNumber);
    trade.SetDeviationInPoints(Slippage);
    // Detect and set the correct filling mode for the broker (fixes "Unsupported filling mode" error 10030)
    long fillFlags = SymbolInfoInteger(GoldSymbol, SYMBOL_FILLING_MODE);
    if ((fillFlags & 1) != 0) trade.SetTypeFilling(ORDER_FILLING_FOK);
    else if ((fillFlags & 2) != 0) trade.SetTypeFilling(ORDER_FILLING_IOC);
    else trade.SetTypeFilling(ORDER_FILLING_RETURN);
    Print("[GoldEA MT5] Gold EA v1.06 | Symbol: ", GoldSymbol, " | MagicNumber: ", MagicNumber, " | FillFlags: ", fillFlags);
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
    for (int i = 0; i < PositionsTotal(); i++) {
        ulong t = PositionGetTicket(i);
        if (!PositionSelectByTicket(t)) continue;
        if (PositionGetInteger(POSITION_MAGIC) != (long)MagicNumber) continue;
        if (PositionGetString(POSITION_SYMBOL) != GoldSymbol) continue;
        double point = SymbolInfoDouble(GoldSymbol, SYMBOL_POINT);
        double trailDist = TrailingStopPoints * point;
        double trailStart = TrailingStartPoints * point;
        long ptype = PositionGetInteger(POSITION_TYPE);
        double openPrice = PositionGetDouble(POSITION_PRICE_OPEN);
        double curSL = PositionGetDouble(POSITION_SL);
        double curTP = PositionGetDouble(POSITION_TP);
        if (ptype == POSITION_TYPE_BUY) {
            double bid = SymbolInfoDouble(GoldSymbol, SYMBOL_BID);
            double profit = bid - openPrice;
            if (profit >= trailStart) {
                double newSL = NormalizeDouble(bid - trailDist, 2);
                if (newSL > curSL + point) {
                    trade.PositionModify(GoldSymbol, newSL, curTP);
                }
            }
        } else {
            double ask = SymbolInfoDouble(GoldSymbol, SYMBOL_ASK);
            double profit = openPrice - ask;
            if (profit >= trailStart) {
                double newSL = NormalizeDouble(ask + trailDist, 2);
                if (newSL < curSL - point || curSL == 0) {
                    trade.PositionModify(GoldSymbol, newSL, curTP);
                }
            }
        }
    }
}

void SendHeartbeat() {
    // Only report Gold positions opened by THIS EA (MagicNumber 99999)
    string tradesJson = "[";
    bool first = true;
    for (int i = 0; i < PositionsTotal(); i++) {
        ulong ticket = PositionGetTicket(i);
        if (!PositionSelectByTicket(ticket)) continue;
        if (PositionGetInteger(POSITION_MAGIC) != (long)MagicNumber) continue;
        if (PositionGetString(POSITION_SYMBOL) != GoldSymbol) continue;
        if (!first) tradesJson += ",";
        first = false;
        long ptype = PositionGetInteger(POSITION_TYPE);
        tradesJson += StringFormat(
            "{\"ticket\":%I64d,\"pair\":\"%s\",\"type\":\"%s\",\"lot_size\":%.2f,\"open_price\":%.2f,\"pnl\":%.2f}",
            (long)ticket, GoldSymbol,
            ptype == POSITION_TYPE_BUY ? "BUY" : "SELL",
            PositionGetDouble(POSITION_VOLUME),
            PositionGetDouble(POSITION_PRICE_OPEN),
            PositionGetDouble(POSITION_PROFIT)
        );
    }
    tradesJson += "]";

    double bid = SymbolInfoDouble(GoldSymbol, SYMBOL_BID);
    double ask = SymbolInfoDouble(GoldSymbol, SYMBOL_ASK);
    string pricesJson = bid > 0
        ? StringFormat("[{\"symbol\":\"%s\",\"bid\":%.2f,\"ask\":%.2f}]", GoldSymbol, bid, ask)
        : "[]";

    string payload = StringFormat(
        "{\"account_number\":\"%I64d\",\"server_name\":\"%s\",\"balance\":%.2f,\"equity\":%.2f,\"margin\":%.2f,\"free_margin\":%.2f,\"margin_level\":%.2f,\"trades\":%s,\"prices\":%s%s}",
        AccountInfoInteger(ACCOUNT_LOGIN),
        AccountInfoString(ACCOUNT_SERVER),
        AccountInfoDouble(ACCOUNT_BALANCE),
        AccountInfoDouble(ACCOUNT_EQUITY),
        AccountInfoDouble(ACCOUNT_MARGIN),
        AccountInfoDouble(ACCOUNT_MARGIN_FREE),
        AccountInfoDouble(ACCOUNT_MARGIN) > 0 ? AccountInfoDouble(ACCOUNT_EQUITY) / AccountInfoDouble(ACCOUNT_MARGIN) * 100 : 0,
        tradesJson, pricesJson, BuildGoldCandlePayload()
    );

    char postData[], result[];
    string resultHeaders;
    StringToCharArray(payload, postData, 0, StringLen(payload));
    string headers = "Content-Type: application/json\r\nAuthorization: Bearer " + ApiKey + "\r\n";

    int res = WebRequest("POST", BridgeURL, headers, 5000, postData, result, resultHeaders);
    if (res == -1) { Print("[GoldEA MT5] WebRequest failed. Error: ", GetLastError(), " - Add URL to: Tools > Options > Expert Advisors > Allow WebRequest"); return; }
    if (res == 403) { Print("[GoldEA MT5] ERROR 403: Invalid ApiKey."); return; }

    string response = CharArrayToString(result);
    Print("[GoldEA MT5] Response: ", StringSubstr(response, 0, 500));
    ProcessSignals(response);
    ProcessCloseCommands(response);
}

int CountOpenGoldTrades() {
    int count = 0;
    for (int i = 0; i < PositionsTotal(); i++) {
        ulong t = PositionGetTicket(i);
        if (!PositionSelectByTicket(t)) continue;
        if (PositionGetInteger(POSITION_MAGIC) != (long)MagicNumber) continue;
        if (PositionGetString(POSITION_SYMBOL) != GoldSymbol) continue;
        count++;
    }
    return count;
}

void ProcessSignals(string json) {
    int start = StringFind(json, "\"pending_signals\"");
    if (start == -1) { Print("[GoldEA MT5] No pending_signals key in response"); return; }
    start = StringFind(json, "[", start);
    if (start == -1) return;
    int end = StringFind(json, "]", start);
    if (end == -1) return;
    string arr = StringSubstr(json, start + 1, end - start - 1);
    if (StringLen(arr) < 5) { Print("[GoldEA MT5] pending_signals array is empty"); return; }
    Print("[GoldEA MT5] Found pending_signals, parsing...");
    int pos = 0;
    while (pos < StringLen(arr)) {
        if (MaxGoldTrades > 0 && CountOpenGoldTrades() >= MaxGoldTrades) {
            Print("[GoldEA MT5] MaxGoldTrades limit reached (", MaxGoldTrades, ") — skipping remaining signals");
            break;
        }
        int objStart = StringFind(arr, "{", pos);
        if (objStart == -1) break;
        int objEnd = StringFind(arr, "}", objStart);
        if (objEnd == -1) break;
        string obj = StringSubstr(arr, objStart, objEnd - objStart + 1);
        string sigPair = ExtractStr(obj, "pair");
        Print("[GoldEA MT5] Signal pair='", sigPair, "' vs GoldSymbol='", GoldSymbol, "' match=", sigPair == GoldSymbol);
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

    bool isBuy = (type == "BUY");
    double price = isBuy ? SymbolInfoDouble(GoldSymbol, SYMBOL_ASK) : SymbolInfoDouble(GoldSymbol, SYMBOL_BID);
    int    digits = (int)SymbolInfoInteger(GoldSymbol, SYMBOL_DIGITS);
    if (price == 0) { Print("[GoldEA MT5] Cannot get price for ", GoldSymbol); return; }

    // --- Live-account safety checks (demo accounts skip these silently) ---
    // 1. Symbol trade mode: live brokers disable symbols outside market hours
    long tradeMode = SymbolInfoInteger(GoldSymbol, SYMBOL_TRADE_MODE);
    if (tradeMode == SYMBOL_TRADE_MODE_DISABLED) {
        Print("[GoldEA MT5] REJECTED: Trading disabled for ", GoldSymbol, " (check broker permissions / market hours)");
        return;
    }
    if (tradeMode == SYMBOL_TRADE_MODE_CLOSEONLY) {
        Print("[GoldEA MT5] REJECTED: ", GoldSymbol, " is close-only on this account");
        return;
    }

    // 2. Spread check — live spreads are wider
    double spreadPts = (double)SymbolInfoInteger(GoldSymbol, SYMBOL_SPREAD);
    double point     = SymbolInfoDouble(GoldSymbol, SYMBOL_POINT);
    // The old expression `spreadPts * point * 10` was CORRECT here and is kept:
    // it reduces to (spread in price) / 0.1, and a gold pip IS 0.1. Written
    // explicitly so the intent is not lost. (The same line in the FOREX EA was
    // wrong by 1000x, and would be wrong by 10x for silver.)
    double goldPip   = 0.1;
    double spreadPips = (point > 0) ? (spreadPts * point) / goldPip : 0;
    if (MaxSpreadPips > 0 && spreadPips > MaxSpreadPips) {
        Print("[GoldEA MT5] REJECTED: Spread ", DoubleToString(spreadPips, 1), " pips > MaxSpreadPips ", MaxSpreadPips);
        return;
    }

    // 3. Minimum stops level — live brokers enforce this (Error 10016 if too close)
    long stopsLevel = SymbolInfoInteger(GoldSymbol, SYMBOL_TRADE_STOPS_LEVEL);
    double minStopDist = stopsLevel * point;
    double goldMinFallback = 5.0;  // Fallback: enforce at least $5 distance for Gold
    if (minStopDist < goldMinFallback) minStopDist = goldMinFallback;

    double finalSL = 0, finalTP = 0;
    if (sigEntry > 0) {
        if (isBuy) {
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
        if (isBuy && (price - finalSL) < minStopDist) finalSL = NormalizeDouble(price - minStopDist, digits);
        if (!isBuy && (finalSL - price) < minStopDist) finalSL = NormalizeDouble(price + minStopDist, digits);
    }
    if (finalTP > 0) {
        if (isBuy && (finalTP - price) < minStopDist) finalTP = NormalizeDouble(price + minStopDist, digits);
        if (!isBuy && (price - finalTP) < minStopDist) finalTP = NormalizeDouble(price - minStopDist, digits);
    }

    // 4. Normalize lot size to broker's volume step (live accounts reject unnormalized lots)
    double minVol  = SymbolInfoDouble(GoldSymbol, SYMBOL_VOLUME_MIN);
    double maxVol  = SymbolInfoDouble(GoldSymbol, SYMBOL_VOLUME_MAX);
    double volStep = SymbolInfoDouble(GoldSymbol, SYMBOL_VOLUME_STEP);
    double lot = (sigLot > 0) ? sigLot : 0.01;
    if (volStep > 0) lot = MathFloor(lot / volStep) * volStep;
    if (lot < minVol) lot = minVol;
    if (lot > maxVol) lot = maxVol;
    lot = NormalizeDouble(lot, 2);

    Print("[GoldEA MT5] Executing GOLD ", type, " @ ", price, " SL=", finalSL, " TP=", finalTP, " Lot=", lot, " StopsLevel=", stopsLevel, " SpreadPips=", DoubleToString(spreadPips, 1));

    // Retry transient rejections. Gold requotes far more than forex, and a
    // dropped signal previously sat ACTIVE in the app for 20 minutes before
    // expiring, with nothing to indicate it had never opened.
    bool ok = false;
    uint retcode = 0;
    for (int attempt = 0; attempt < MathMax(1, OrderRetries) && !ok; attempt++) {
        if (attempt > 0) {
            Sleep(400);
            MqlTick tk;
            if (!SymbolInfoTick(GoldSymbol, tk)) break;
            price = isBuy ? tk.ask : tk.bid;
            if (price <= 0) break;
        }
        ok = isBuy
            ? trade.Buy(lot, GoldSymbol, price, finalSL, finalTP, orderComment)
            : trade.Sell(lot, GoldSymbol, price, finalSL, finalTP, orderComment);
        if (!ok) {
            retcode = trade.ResultRetcode();
            // Only requote / price-changed / off-quotes are worth another go.
            if (retcode != TRADE_RETCODE_REQUOTE &&
                retcode != TRADE_RETCODE_PRICE_CHANGED &&
                retcode != TRADE_RETCODE_PRICE_OFF) break;
            Print("[GoldEA MT5] Order attempt ", attempt + 1, " failed (", retcode, ") - retrying");
        }
    }

    if (ok) {
        ulong ticket = trade.ResultOrder();
        Print("[GoldEA MT5] Gold order placed! Ticket=", ticket, " RetCode=", trade.ResultRetcode());
        ConfirmExecution(signalId, (long)ticket, type, lot, price);
    } else {
        Print("[GoldEA MT5] Order FAILED after ", OrderRetries, " attempt(s). RetCode=", retcode,
              " ", trade.ResultRetcodeDescription(), " Lot=", lot,
              " SpreadPips=", DoubleToString(spreadPips, 1));
        ReportExecutionFailure(signalId, (int)retcode);
    }
}

// Derive sibling endpoints from BridgeURL rather than hardcoding the domain,
// so pointing the EA at a new app updates every endpoint at once.
string FunctionUrl(string fnName) {
    int cut = StringFind(BridgeURL, "/functions/");
    if (cut > 0) return StringSubstr(BridgeURL, 0, cut) + "/functions/" + fnName;
    return BridgeURL;
}

void ConfirmExecution(string signalId, long ticket, string type, double lots, double price) {
    string confirmUrl = FunctionUrl("confirmExecution");
    string payload = StringFormat(
        "{\"signal_id\":\"%s\",\"ticket\":%I64d,\"pair\":\"%s\",\"type\":\"%s\",\"lot_size\":%.2f,\"open_price\":%.2f,\"account_number\":\"%I64d\"}",
        signalId, ticket, GoldSymbol, type, lots, price, AccountInfoInteger(ACCOUNT_LOGIN)
    );
    char postData[], result[];
    string resultHeaders;
    StringToCharArray(payload, postData, 0, StringLen(payload));
    string headers = "Content-Type: application/json\r\nAuthorization: Bearer " + ApiKey + "\r\n";
    WebRequest("POST", confirmUrl, headers, 5000, postData, result, resultHeaders);
    Print("[GoldEA MT5] Execution confirmed for ticket ", ticket);
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
        ulong ticket = (ulong)ExtractDbl(obj, "ticket");
        if (ticket > 0) CloseTicket(ticket);
        pos = objEnd + 1;
    }
}

void CloseTicket(ulong ticket) {
    if (!PositionSelectByTicket(ticket)) {
        Print("[GoldEA MT5] Close: ticket ", ticket, " not found (may already be closed)");
        return;
    }
    if (trade.PositionClose(ticket)) {
        Print("[GoldEA MT5] Closed ticket ", ticket);
    } else {
        Print("[GoldEA MT5] PositionClose FAILED ticket ", ticket, " RetCode=", trade.ResultRetcode());
    }
}
//+------------------------------------------------------------------+

//+------------------------------------------------------------------+
//| Report a failed execution so the signal returns to PENDING       |
//+------------------------------------------------------------------+
void ReportExecutionFailure(string signalId, int errorCode) {
    if (StringLen(signalId) == 0) return;
    string payload = StringFormat(
        "{\"signal_id\":\"%s\",\"account_number\":\"%I64d\",\"symbol\":\"%s\",\"status\":\"FAILED\",\"error_code\":%d}",
        signalId, AccountInfoInteger(ACCOUNT_LOGIN), GoldSymbol, errorCode
    );
    char postData[], result[];
    string resultHeaders;
    StringToCharArray(payload, postData, 0, StringLen(payload));
    string headers = "Content-Type: application/json\r\nAuthorization: Bearer " + ApiKey + "\r\n";
    int r = WebRequest("POST", FunctionUrl("confirmExecution"), headers, 8000, postData, result, resultHeaders);
    if (r < 0) Print("[GoldEA MT5] Could not report failure: ", GetLastError());
    else Print("[GoldEA MT5] Reported execution failure for signal ", signalId);
}

//+------------------------------------------------------------------+
//| Upload broker OHLC for gold                                      |
//+------------------------------------------------------------------+
// This matters MORE for gold than for forex. Without it the app falls back to
// Yahoo, whose gold symbol (GC=F) is COMEX gold FUTURES, not spot XAUUSD.
// Futures trade tens of dollars away from spot, so ATR, stop distances and
// every indicator would be computed against prices your broker never quoted.
datetime lastCandleUpload = 0;

ENUM_TIMEFRAMES GoldTimeframeToPeriod(string tf) {
    if (tf == "M5")  return PERIOD_M5;
    if (tf == "M15") return PERIOD_M15;
    if (tf == "M30") return PERIOD_M30;
    if (tf == "H1")  return PERIOD_H1;
    if (tf == "H4")  return PERIOD_H4;
    if (tf == "D1")  return PERIOD_D1;
    if (tf == "W1")  return PERIOD_W1;
    return PERIOD_CURRENT;
}

string BuildGoldCandleJson(string tfName) {
    ENUM_TIMEFRAMES period = GoldTimeframeToPeriod(tfName);
    if (period == PERIOD_CURRENT) return "";

    MqlRates rates[];
    ArraySetAsSeries(rates, true);
    // Request one extra bar: index 0 is the CURRENT, still-open candle and is
    // dropped below. Indicators computed on an open bar repaint.
    int copied = CopyRates(GoldSymbol, period, 0, BarsToUpload + 1, rates);
    if (copied < 61) {
        Print("[GoldEA MT5] ", GoldSymbol, " ", tfName, ": only ", copied, " bars available. ",
              "Open that chart once so MT5 downloads history, or raise Tools > Options > Charts > Max bars.");
        return "";
    }

    string bars = "";
    // rates[] is series-ordered (0 = newest), so walk DOWN from the oldest
    // index to 1 to emit oldest-first and skip the forming bar at index 0.
    for (int i = copied - 1; i >= 1; i--) {
        if (StringLen(bars) > 0) bars += ",";
        bars += StringFormat("{\"t\":%I64d,\"o\":%.5f,\"h\":%.5f,\"l\":%.5f,\"c\":%.5f,\"v\":%I64d}",
            (long)rates[i].time, rates[i].open, rates[i].high,
            rates[i].low, rates[i].close, rates[i].tick_volume);
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
    Print("[GoldEA MT5] Uploading gold candles - timeframe ", candleCursor % n, "/", n, " in rotation");
    return ",\"candles\":[" + entries + "]";
}
