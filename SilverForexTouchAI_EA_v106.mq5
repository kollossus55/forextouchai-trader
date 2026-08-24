//+------------------------------------------------------------------+
//|                                  SilverForexTouchAI_EA.mq5        |
//|         Dedicated Silver (XAGUSD) EA for ForexTouchAI (MT5)       |
//|   Uses MagicNumber 99998 - SEPARATE from gold (99999) and forex (12345)    |
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
input ulong  MagicNumber    = 99998;    // MUST differ from gold (99999) and forex (12345) - Silver only
input int    Slippage       = 100;      // Slippage tolerance for Silver
input double MaxSpreadPips  = 8;        // Max spread in SILVER pips (1 pip = $0.01). Typical is 3; 8 blocks news blowouts. 0 = no check.
input string SilverSymbol     = "XAGUSD"; // Adjust if broker uses XAGUSDm, XAGUSD. etc.
input int    MaxSilverTrades      = 3;     // Maximum concurrent Silver trades (0 = unlimited)
input bool   EnableTrailing     = false; // Enable trailing stop
input double TrailingStartPoints = 150;  // Profit in points before trailing activates
input double TrailingStopPoints  = 100;  // Trailing stop distance in points

// --- v1.06: candle upload (REQUIRED by the app's v2 signal engine) ---
input bool   UploadCandles     = true;   // Send broker OHLC to the app
input int    BarsToUpload      = 400;    // Bars per timeframe (needs >=210 for EMA200)
input string CandleTimeframes  = "H1,H4,D1"; // Must include your silver bot's timeframe + one above
input int    CandleUploadMins  = 15;     // Minutes between candle uploads
input int    OrderRetries      = 3;      // Retries on requote / off-quotes

// --- GLOBALS ---
datetime lastHeartbeat = 0;
CTrade trade;

int OnInit() {
    if (StringLen(ApiKey) == 0)
        Print("[SilverEA MT5] WARNING: ApiKey empty - get it from the ForexTouchAI Settings page.");
    double bid = SymbolInfoDouble(SilverSymbol, SYMBOL_BID);
    if (bid <= 0)
        Print("[SilverEA MT5] WARNING: Symbol '", SilverSymbol, "' not in Market Watch. Add it.");
    trade.SetExpertMagicNumber(MagicNumber);
    trade.SetDeviationInPoints(Slippage);
    // Detect and set the correct filling mode for the broker (fixes "Unsupported filling mode" error 10030)
    long fillFlags = SymbolInfoInteger(SilverSymbol, SYMBOL_FILLING_MODE);
    if ((fillFlags & 1) != 0) trade.SetTypeFilling(ORDER_FILLING_FOK);
    else if ((fillFlags & 2) != 0) trade.SetTypeFilling(ORDER_FILLING_IOC);
    else trade.SetTypeFilling(ORDER_FILLING_RETURN);
    Print("[SilverEA MT5] Silver EA v1.06 | Symbol: ", SilverSymbol, " | MagicNumber: ", MagicNumber, " | FillFlags: ", fillFlags);
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
        if (PositionGetString(POSITION_SYMBOL) != SilverSymbol) continue;
        double point = SymbolInfoDouble(SilverSymbol, SYMBOL_POINT);
        double trailDist = TrailingStopPoints * point;
        double trailStart = TrailingStartPoints * point;
        long ptype = PositionGetInteger(POSITION_TYPE);
        double openPrice = PositionGetDouble(POSITION_PRICE_OPEN);
        double curSL = PositionGetDouble(POSITION_SL);
        double curTP = PositionGetDouble(POSITION_TP);
        if (ptype == POSITION_TYPE_BUY) {
            double bid = SymbolInfoDouble(SilverSymbol, SYMBOL_BID);
            double profit = bid - openPrice;
            if (profit >= trailStart) {
                double newSL = NormalizeDouble(bid - trailDist, 3);
                if (newSL > curSL + point) {
                    trade.PositionModify(SilverSymbol, newSL, curTP);
                }
            }
        } else {
            double ask = SymbolInfoDouble(SilverSymbol, SYMBOL_ASK);
            double profit = openPrice - ask;
            if (profit >= trailStart) {
                double newSL = NormalizeDouble(ask + trailDist, 3);
                if (newSL < curSL - point || curSL == 0) {
                    trade.PositionModify(SilverSymbol, newSL, curTP);
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
        if (PositionGetString(POSITION_SYMBOL) != SilverSymbol) continue;
        if (!first) tradesJson += ",";
        first = false;
        long ptype = PositionGetInteger(POSITION_TYPE);
        tradesJson += StringFormat(
            "{\"ticket\":%I64d,\"pair\":\"%s\",\"type\":\"%s\",\"lot_size\":%.2f,\"open_price\":%.3f,\"pnl\":%.2f}",
            (long)ticket, SilverSymbol,
            ptype == POSITION_TYPE_BUY ? "BUY" : "SELL",
            PositionGetDouble(POSITION_VOLUME),
            PositionGetDouble(POSITION_PRICE_OPEN),
            PositionGetDouble(POSITION_PROFIT)
        );
    }
    tradesJson += "]";

    double bid = SymbolInfoDouble(SilverSymbol, SYMBOL_BID);
    double ask = SymbolInfoDouble(SilverSymbol, SYMBOL_ASK);
    string pricesJson = bid > 0
        ? StringFormat("[{\"symbol\":\"%s\",\"bid\":%.3f,\"ask\":%.3f}]", SilverSymbol, bid, ask)
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
        tradesJson, pricesJson, BuildSilverCandlePayload()
    );

    char postData[], result[];
    string resultHeaders;
    StringToCharArray(payload, postData, 0, StringLen(payload));
    string headers = "Content-Type: application/json\r\nAuthorization: Bearer " + ApiKey + "\r\n";

    int res = WebRequest("POST", BridgeURL, headers, 5000, postData, result, resultHeaders);
    if (res == -1) { Print("[SilverEA MT5] WebRequest failed. Error: ", GetLastError(), " - Add URL to: Tools > Options > Expert Advisors > Allow WebRequest"); return; }
    if (res == 403) { Print("[SilverEA MT5] ERROR 403: Invalid ApiKey."); return; }

    string response = CharArrayToString(result);
    Print("[SilverEA MT5] Response: ", StringSubstr(response, 0, 500));
    ProcessSignals(response);
    ProcessCloseCommands(response);
}

int CountOpenSilverTrades() {
    int count = 0;
    for (int i = 0; i < PositionsTotal(); i++) {
        ulong t = PositionGetTicket(i);
        if (!PositionSelectByTicket(t)) continue;
        if (PositionGetInteger(POSITION_MAGIC) != (long)MagicNumber) continue;
        if (PositionGetString(POSITION_SYMBOL) != SilverSymbol) continue;
        count++;
    }
    return count;
}

void ProcessSignals(string json) {
    int start = StringFind(json, "\"pending_signals\"");
    if (start == -1) { Print("[SilverEA MT5] No pending_signals key in response"); return; }
    start = StringFind(json, "[", start);
    if (start == -1) return;
    int end = StringFind(json, "]", start);
    if (end == -1) return;
    string arr = StringSubstr(json, start + 1, end - start - 1);
    if (StringLen(arr) < 5) { Print("[SilverEA MT5] pending_signals array is empty"); return; }
    Print("[SilverEA MT5] Found pending_signals, parsing...");
    int pos = 0;
    while (pos < StringLen(arr)) {
        if (MaxSilverTrades > 0 && CountOpenSilverTrades() >= MaxSilverTrades) {
            Print("[SilverEA MT5] MaxSilverTrades limit reached (", MaxSilverTrades, ") — skipping remaining signals");
            break;
        }
        int objStart = StringFind(arr, "{", pos);
        if (objStart == -1) break;
        int objEnd = StringFind(arr, "}", objStart);
        if (objEnd == -1) break;
        string obj = StringSubstr(arr, objStart, objEnd - objStart + 1);
        string sigPair = ExtractStr(obj, "pair");
        Print("[SilverEA MT5] Signal pair='", sigPair, "' vs SilverSymbol='", SilverSymbol, "' match=", sigPair == SilverSymbol);
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

    bool isBuy = (type == "BUY");
    double price = isBuy ? SymbolInfoDouble(SilverSymbol, SYMBOL_ASK) : SymbolInfoDouble(SilverSymbol, SYMBOL_BID);
    int    digits = (int)SymbolInfoInteger(SilverSymbol, SYMBOL_DIGITS);
    if (price == 0) { Print("[SilverEA MT5] Cannot get price for ", SilverSymbol); return; }

    // --- Live-account safety checks (demo accounts skip these silently) ---
    // 1. Symbol trade mode: live brokers disable symbols outside market hours
    long tradeMode = SymbolInfoInteger(SilverSymbol, SYMBOL_TRADE_MODE);
    if (tradeMode == SYMBOL_TRADE_MODE_DISABLED) {
        Print("[SilverEA MT5] REJECTED: Trading disabled for ", SilverSymbol, " (check broker permissions / market hours)");
        return;
    }
    if (tradeMode == SYMBOL_TRADE_MODE_CLOSEONLY) {
        Print("[SilverEA MT5] REJECTED: ", SilverSymbol, " is close-only on this account");
        return;
    }

    // 2. Spread check — live spreads are wider
    double spreadPts = (double)SymbolInfoInteger(SilverSymbol, SYMBOL_SPREAD);
    double point     = SymbolInfoDouble(SilverSymbol, SYMBOL_POINT);
    // The old expression `spreadPts * point * 10` was CORRECT here and is kept:
    // it reduces to (spread in price) / 0.1, and a gold pip IS 0.1. Written
    // explicitly so the intent is not lost. (The same line in the FOREX EA was
    // wrong by 1000x, and would be wrong by 10x for silver.)
    // SILVER PIP, NOT GOLD'S. This is the line that must change when deriving a
    // silver EA from the gold one, and the easiest to miss. A gold pip is 0.1;
    // a silver pip is 0.01. Leaving 0.1 here understates the silver spread by
    // 10x — a $0.03 spread reads as 0.3 pips instead of 3 — which leaves the
    // spread filter effectively switched off in exactly the conditions it
    // exists to catch.
    double silverPip = 0.01;
    double spreadPips = (point > 0) ? (spreadPts * point) / silverPip : 0;
    if (MaxSpreadPips > 0 && spreadPips > MaxSpreadPips) {
        Print("[SilverEA MT5] REJECTED: Spread ", DoubleToString(spreadPips, 1), " pips > MaxSpreadPips ", MaxSpreadPips);
        return;
    }

    // 3. Minimum stops level — live brokers enforce this (Error 10016 if too close)
    long stopsLevel = SymbolInfoInteger(SilverSymbol, SYMBOL_TRADE_STOPS_LEVEL);
    double minStopDist = stopsLevel * point;
    // Gold uses a flat $5 floor, which suits an instrument trading near $2,400.
    // Silver trades near $30, where $5 would be a ~17% stop — far wider than any
    // signal intends and enough to make position sizing refuse the trade.
    // $0.10 is the equivalent distance (~3x a typical silver spread).
    double silverMinFallback = 0.10;
    if (minStopDist < silverMinFallback) minStopDist = silverMinFallback;

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
    double minVol  = SymbolInfoDouble(SilverSymbol, SYMBOL_VOLUME_MIN);
    double maxVol  = SymbolInfoDouble(SilverSymbol, SYMBOL_VOLUME_MAX);
    double volStep = SymbolInfoDouble(SilverSymbol, SYMBOL_VOLUME_STEP);
    double lot = (sigLot > 0) ? sigLot : 0.01;
    if (volStep > 0) lot = MathFloor(lot / volStep) * volStep;
    if (lot < minVol) lot = minVol;
    if (lot > maxVol) lot = maxVol;
    lot = NormalizeDouble(lot, 2);

    Print("[SilverEA MT5] Executing SILVER ", type, " @ ", price, " SL=", finalSL, " TP=", finalTP, " Lot=", lot, " StopsLevel=", stopsLevel, " SpreadPips=", DoubleToString(spreadPips, 1));

    // Retry transient rejections. Metals requote far more than forex, and a
    // dropped signal previously sat ACTIVE in the app for 20 minutes before
    // expiring, with nothing to indicate it had never opened.
    bool ok = false;
    uint retcode = 0;
    for (int attempt = 0; attempt < MathMax(1, OrderRetries) && !ok; attempt++) {
        if (attempt > 0) {
            Sleep(400);
            MqlTick tk;
            if (!SymbolInfoTick(SilverSymbol, tk)) break;
            price = isBuy ? tk.ask : tk.bid;
            if (price <= 0) break;
        }
        ok = isBuy
            ? trade.Buy(lot, SilverSymbol, price, finalSL, finalTP, orderComment)
            : trade.Sell(lot, SilverSymbol, price, finalSL, finalTP, orderComment);
        if (!ok) {
            retcode = trade.ResultRetcode();
            // Only requote / price-changed / off-quotes are worth another go.
            if (retcode != TRADE_RETCODE_REQUOTE &&
                retcode != TRADE_RETCODE_PRICE_CHANGED &&
                retcode != TRADE_RETCODE_PRICE_OFF) break;
            Print("[SilverEA MT5] Order attempt ", attempt + 1, " failed (", retcode, ") - retrying");
        }
    }

    if (ok) {
        ulong ticket = trade.ResultOrder();
        Print("[SilverEA MT5] Silver order placed! Ticket=", ticket, " RetCode=", trade.ResultRetcode());
        ConfirmExecution(signalId, (long)ticket, type, lot, price);
    } else {
        Print("[SilverEA MT5] Order FAILED after ", OrderRetries, " attempt(s). RetCode=", retcode,
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
        "{\"signal_id\":\"%s\",\"ticket\":%I64d,\"pair\":\"%s\",\"type\":\"%s\",\"lot_size\":%.2f,\"open_price\":%.3f,\"account_number\":\"%I64d\"}",
        signalId, ticket, SilverSymbol, type, lots, price, AccountInfoInteger(ACCOUNT_LOGIN)
    );
    char postData[], result[];
    string resultHeaders;
    StringToCharArray(payload, postData, 0, StringLen(payload));
    string headers = "Content-Type: application/json\r\nAuthorization: Bearer " + ApiKey + "\r\n";
    WebRequest("POST", confirmUrl, headers, 5000, postData, result, resultHeaders);
    Print("[SilverEA MT5] Execution confirmed for ticket ", ticket);
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
        Print("[SilverEA MT5] Close: ticket ", ticket, " not found (may already be closed)");
        return;
    }
    if (trade.PositionClose(ticket)) {
        Print("[SilverEA MT5] Closed ticket ", ticket);
    } else {
        Print("[SilverEA MT5] PositionClose FAILED ticket ", ticket, " RetCode=", trade.ResultRetcode());
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
        signalId, AccountInfoInteger(ACCOUNT_LOGIN), SilverSymbol, errorCode
    );
    char postData[], result[];
    string resultHeaders;
    StringToCharArray(payload, postData, 0, StringLen(payload));
    string headers = "Content-Type: application/json\r\nAuthorization: Bearer " + ApiKey + "\r\n";
    int r = WebRequest("POST", FunctionUrl("confirmExecution"), headers, 8000, postData, result, resultHeaders);
    if (r < 0) Print("[SilverEA MT5] Could not report failure: ", GetLastError());
    else Print("[SilverEA MT5] Reported execution failure for signal ", signalId);
}

//+------------------------------------------------------------------+
//| Upload broker OHLC for silver                                      |
//+------------------------------------------------------------------+
// This matters MORE for silver than for forex. Without it the app falls back to
// Yahoo, whose silver symbol (SI=F) is COMEX silver FUTURES, not spot XAGUSD.
// Futures diverge from spot, so ATR, stop distances and every indicator would
// be computed against prices your broker never quoted.
datetime lastCandleUpload = 0;

ENUM_TIMEFRAMES SilverTimeframeToPeriod(string tf) {
    if (tf == "M5")  return PERIOD_M5;
    if (tf == "M15") return PERIOD_M15;
    if (tf == "M30") return PERIOD_M30;
    if (tf == "H1")  return PERIOD_H1;
    if (tf == "H4")  return PERIOD_H4;
    if (tf == "D1")  return PERIOD_D1;
    if (tf == "W1")  return PERIOD_W1;
    return PERIOD_CURRENT;
}

string BuildSilverCandleJson(string tfName) {
    ENUM_TIMEFRAMES period = SilverTimeframeToPeriod(tfName);
    if (period == PERIOD_CURRENT) return "";

    MqlRates rates[];
    ArraySetAsSeries(rates, true);
    // Request one extra bar: index 0 is the CURRENT, still-open candle and is
    // dropped below. Indicators computed on an open bar repaint.
    int copied = CopyRates(SilverSymbol, period, 0, BarsToUpload + 1, rates);
    if (copied < 61) {
        Print("[SilverEA MT5] ", SilverSymbol, " ", tfName, ": only ", copied, " bars available. ",
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

    // Always report as XAGUSD regardless of the broker's suffix, so the app
    // stores one canonical series.
    //
    // This label MUST be XAGUSD. The app keys CandleHistory on (symbol,
    // timeframe) and overwrites the row on each upload, so shipping "XAUUSD"
    // here would replace gold's candles with silver bars and the gold bot would
    // then compute its ATR, stops and every indicator from silver prices.
    return StringConcatenate("{\"symbol\":\"XAGUSD\",\"timeframe\":\"", tfName, "\",\"bars\":[", bars, "]}");
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
    Print("[SilverEA MT5] Uploading silver candles (", CandleTimeframes, ")");
    return StringConcatenate(",\"candles\":[", entries, "]");
}
