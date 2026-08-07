import React from 'react';
import { Button } from '@/components/ui/button';

const SILVER_EA_MT5_CODE = `//+------------------------------------------------------------------+
//|                                 SilverForexTouchAI_EA.mq5        |
//|        Dedicated Silver (XAGUSD) EA for ForexTouchAI (MT5)       |
//|   Uses MagicNumber 88888 - SEPARATE from Gold (99999) & std EA  |
//|   v1.01: Added broker filling mode detection (fixes error 10030) |
//|   v1.02: Fixed StringReplace in-place symbol matching + hide_sl_tp|
//+------------------------------------------------------------------+
#property copyright "ForexTouchAI"
#property version   "1.03"
#property strict

#include <Trade\\Trade.mqh>

// --- INPUTS ---
input string BridgeURL      = "https://forex-ai-trader-cc744e2a.base44.app/functions/bridge";
input string ApiKey         = "";       // Paste your API Key from ForexTouchAI Settings page
input int    HeartbeatSec   = 30;       // Poll interval (seconds)
input ulong  MagicNumber    = 88888;    // MUST differ from Gold (99999) & standard EA (12345)
input int    Slippage       = 50;       // Slippage tolerance for Silver (points)
input string SilverSymbol   = "XAGUSD"; // Adjust if broker uses XAGUSDm, XAGUSD. etc.
input int    MaxSilverTrades   = 3;     // Maximum concurrent Silver trades (0 = unlimited)
input bool   EnableTrailing     = false; // Enable trailing stop
input double TrailingStartPoints = 150;  // Profit in points before trailing activates
input double TrailingStopPoints  = 100;  // Trailing stop distance in points

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
    Print("[SilverEA MT5] Silver EA v1.03 | Symbol: ", SilverSymbol, " | MagicNumber: ", MagicNumber, " | FillFlags: ", fillFlags);
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
    // Only report Silver positions opened by THIS EA (MagicNumber 88888)
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
            "{\\\"ticket\\\":%I64d,\\\"pair\\\":\\\"%s\\\",\\\"type\\\":\\\"%s\\\",\\\"lot_size\\\":%.2f,\\\"open_price\\\":%.3f,\\\"pnl\\\":%.2f}",
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
        ? StringFormat("[{\\\"symbol\\\":\\\"%s\\\",\\\"bid\\\":%.3f,\\\"ask\\\":%.3f}]", SilverSymbol, bid, ask)
        : "[]";

    string payload = StringFormat(
        "{\\\"account_number\\\":\\\"%I64d\\\",\\\"server_name\\\":\\\"%s\\\",\\\"balance\\\":%.2f,\\\"equity\\\":%.2f,\\\"margin\\\":%.2f,\\\"free_margin\\\":%.2f,\\\"margin_level\\\":%.2f,\\\"trades\\\":%s,\\\"prices\\\":%s}",
        AccountInfoInteger(ACCOUNT_LOGIN),
        AccountInfoString(ACCOUNT_SERVER),
        AccountInfoDouble(ACCOUNT_BALANCE),
        AccountInfoDouble(ACCOUNT_EQUITY),
        AccountInfoDouble(ACCOUNT_MARGIN),
        AccountInfoDouble(ACCOUNT_MARGIN_FREE),
        AccountInfoDouble(ACCOUNT_MARGIN) > 0 ? AccountInfoDouble(ACCOUNT_EQUITY) / AccountInfoDouble(ACCOUNT_MARGIN) * 100 : 0,
        tradesJson, pricesJson
    );

    char postData[], result[];
    string resultHeaders;
    StringToCharArray(payload, postData, 0, StringLen(payload));
    string headers = "Content-Type: application/json\\r\\nAuthorization: Bearer " + ApiKey + "\\r\\n";

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
    int start = StringFind(json, "\\"pending_signals\\"");
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
    string search = "\\"" + key + "\\":\\"";
    int start = StringFind(json, search);
    if (start == -1) return "";
    start += StringLen(search);
    int end = StringFind(json, "\\"", start);
    if (end == -1) return "";
    return StringSubstr(json, start, end - start);
}

double ExtractDbl(string json, string key) {
    string search = "\\"" + key + "\\":";
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
    double lotSize  = ExtractDbl(obj, "lot_size");
    double sl       = ExtractDbl(obj, "stop_loss");
    double tp       = ExtractDbl(obj, "take_profit");
    string orderComment = ExtractStr(obj, "comment");
    if (StringLen(orderComment) == 0) orderComment = "SilverForexTouchAI";

    if (lotSize <= 0) lotSize = 0.01;
    bool isBuy = (type == "BUY");
    double price = isBuy ? SymbolInfoDouble(SilverSymbol, SYMBOL_ASK) : SymbolInfoDouble(SilverSymbol, SYMBOL_BID);
    if (price == 0) { Print("[SilverEA MT5] Cannot get price for ", SilverSymbol); return; }

    // Safety: ensure SL/TP are at least $0.20 away (broker min stop distance for Silver)
    double minDist = 0.20;
    if (sl > 0) {
        if (isBuy && price - sl < minDist) sl = NormalizeDouble(price - minDist * 2, 3);
        if (!isBuy && sl - price < minDist) sl = NormalizeDouble(price + minDist * 2, 3);
    }
    if (tp > 0) {
        if (isBuy && tp - price < minDist) tp = NormalizeDouble(price + minDist * 2, 3);
        if (!isBuy && price - tp < minDist) tp = NormalizeDouble(price - minDist * 2, 3);
    }

    Print("[SilverEA MT5] Executing SILVER ", type, " @ ", price, " SL=", sl, " TP=", tp, " Lot=", lotSize);

    bool ok = isBuy
        ? trade.Buy(lotSize, SilverSymbol, price, sl, tp, orderComment)
        : trade.Sell(lotSize, SilverSymbol, price, sl, tp, orderComment);

    if (ok) {
        ulong ticket = trade.ResultOrder();
        Print("[SilverEA MT5] Silver order placed! Ticket=", ticket, " RetCode=", trade.ResultRetcode());
        ConfirmExecution(signalId, (long)ticket, type, lotSize, price);
    } else {
        Print("[SilverEA MT5] OrderSend FAILED. RetCode=", trade.ResultRetcode(), " ", trade.ResultRetcodeDescription());
        Print("[SilverEA MT5] Ensure XAGUSD is in Market Watch and margin is sufficient.");
    }
}

void ConfirmExecution(string signalId, long ticket, string type, double lots, double price) {
    string confirmUrl = "https://forex-ai-trader-cc744e2a.base44.app/functions/confirmExecution";
    string payload = StringFormat(
        "{\\\"signal_id\\\":\\\"%s\\\",\\\"ticket\\\":%I64d,\\\"pair\\\":\\\"%s\\\",\\\"type\\\":\\\"%s\\\",\\\"lot_size\\\":%.2f,\\\"open_price\\\":%.3f,\\\"account_number\\\":\\\"%I64d\\\"}",
        signalId, ticket, SilverSymbol, type, lots, price, AccountInfoInteger(ACCOUNT_LOGIN)
    );
    char postData[], result[];
    string resultHeaders;
    StringToCharArray(payload, postData, 0, StringLen(payload));
    string headers = "Content-Type: application/json\\r\\nAuthorization: Bearer " + ApiKey + "\\r\\n";
    WebRequest("POST", confirmUrl, headers, 5000, postData, result, resultHeaders);
    Print("[SilverEA MT5] Execution confirmed for ticket ", ticket);
}

void ProcessCloseCommands(string json) {
    int start = StringFind(json, "\\"close_commands\\"");
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
//+------------------------------------------------------------------+`;

const SILVER_EA_CODE = `//+------------------------------------------------------------------+
//|                                    SilverForexTouchAI_EA.mq4    |
//|              Dedicated Silver (XAGUSD) EA for ForexTouchAI      |
//|   Uses MagicNumber 88888 - SEPARATE from Gold (99999) & std EA |
//+------------------------------------------------------------------+
#property copyright "ForexTouchAI"
#property version   "1.02"
#property strict

// --- INPUTS ---
input string BridgeURL      = "https://forex-ai-trader-cc744e2a.base44.app/functions/bridge";
input string ApiKey         = "";      // Paste your API Key from ForexTouchAI Settings page
input int    HeartbeatSec   = 30;      // Poll interval (seconds)
input int    MagicNumber    = 88888;   // MUST differ from Gold (99999) & standard EA (12345)
input int    Slippage       = 50;      // Slippage tolerance for Silver (points)
input string SilverSymbol   = "XAGUSD"; // Adjust if your broker uses XAGUSDm, XAGUSD. etc.
input int    MaxSilverTrades   = 3;    // Maximum concurrent Silver trades (0 = unlimited)
input bool   EnableTrailing     = false; // Enable trailing stop
input double TrailingStartPoints = 150;  // Profit in points before trailing activates
input double TrailingStopPoints  = 100;  // Trailing stop distance in points

// --- GLOBALS ---
datetime lastHeartbeat = 0;

int OnInit() {
    if (StringLen(ApiKey) == 0)
        Print("[SilverEA] WARNING: ApiKey empty - get it from the ForexTouchAI Settings page.");
    if (MarketInfo(SilverSymbol, MODE_BID) <= 0)
        Print("[SilverEA] WARNING: Symbol '", SilverSymbol, "' not in Market Watch. Add it.");
    Print("[SilverEA] Silver EA v1.02 | Symbol: ", SilverSymbol, " | MagicNumber: ", MagicNumber);
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
                    OrderModify(OrderTicket(), OrderOpenPrice(), newSL, OrderTakeProfit(), 0, clrSlateGray);
            }
        }
    }
}

void SendHeartbeat() {
    // Only report Silver trades opened by THIS EA (MagicNumber 88888)
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
            "{\\\"ticket\\\":%d,\\\"pair\\\":\\\"%s\\\",\\\"type\\\":\\\"%s\\\",\\\"lot_size\\\":%.2f,\\\"open_price\\\":%.3f,\\\"pnl\\\":%.2f,\\\"magic\\\":%d}",
            OrderTicket(), OrderSymbol(),
            OrderType() == OP_BUY ? "BUY" : "SELL",
            OrderLots(), OrderOpenPrice(), OrderProfit(), OrderMagicNumber()
        );
    }
    tradesJson += "]";

    double bid = MarketInfo(SilverSymbol, MODE_BID);
    double ask = MarketInfo(SilverSymbol, MODE_ASK);
    string pricesJson = bid > 0
        ? StringFormat("[{\\\"symbol\\\":\\\"%s\\\",\\\"bid\\\":%.3f,\\\"ask\\\":%.3f}]", SilverSymbol, bid, ask)
        : "[]";

    string payload = StringFormat(
        "{\\\"account_number\\\":\\\"%s\\\",\\\"server_name\\\":\\\"%s\\\",\\\"balance\\\":%.2f,\\\"equity\\\":%.2f,\\\"margin\\\":%.2f,\\\"free_margin\\\":%.2f,\\\"margin_level\\\":%.2f,\\\"trades\\\":%s,\\\"prices\\\":%s}",
        IntegerToString(AccountNumber()), AccountServer(),
        AccountBalance(), AccountEquity(), AccountMargin(), AccountFreeMargin(),
        AccountMargin() > 0 ? AccountEquity() / AccountMargin() * 100 : 0,
        tradesJson, pricesJson
    );

    char postData[], result[];
    string resultHeaders;
    StringToCharArray(payload, postData, 0, StringLen(payload));
    string headers = "Content-Type: application/json\\r\\nAuthorization: Bearer " + ApiKey + "\\r\\n";

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
    int start = StringFind(json, "\\"pending_signals\\"");
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
    string search = "\\"" + key + "\\":\\"";
    int start = StringFind(json, search);
    if (start == -1) return "";
    start += StringLen(search);
    int end = StringFind(json, "\\"", start);
    if (end == -1) return "";
    return StringSubstr(json, start, end - start);
}

double ExtractDbl(string json, string key) {
    string search = "\\"" + key + "\\":";
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
    double lotSize  = ExtractDbl(obj, "lot_size");
    double sl       = ExtractDbl(obj, "stop_loss");
    double tp       = ExtractDbl(obj, "take_profit");
    string orderComment = ExtractStr(obj, "comment");
    if (StringLen(orderComment) == 0) orderComment = "SilverForexTouchAI";

    if (lotSize <= 0) lotSize = 0.01;
    int cmd = (type == "BUY") ? OP_BUY : OP_SELL;
    double price = (cmd == OP_BUY) ? MarketInfo(SilverSymbol, MODE_ASK) : MarketInfo(SilverSymbol, MODE_BID);
    if (price == 0) { Print("[SilverEA] Cannot get price for ", SilverSymbol); return; }

    double minDist = 0.20;
    if (sl > 0) {
        if (cmd == OP_BUY && price - sl < minDist) sl = NormalizeDouble(price - minDist * 2, 3);
        if (cmd == OP_SELL && sl - price < minDist) sl = NormalizeDouble(price + minDist * 2, 3);
    }
    if (tp > 0) {
        if (cmd == OP_BUY && tp - price < minDist) tp = NormalizeDouble(price + minDist * 2, 3);
        if (cmd == OP_SELL && price - tp < minDist) tp = NormalizeDouble(price - minDist * 2, 3);
    }

    Print("[SilverEA] Executing SILVER ", type, " @ ", price, " SL=", sl, " TP=", tp, " Lot=", lotSize);

    int ticket = OrderSend(SilverSymbol, cmd, lotSize, price, Slippage, sl, tp, orderComment, MagicNumber, 0, cmd == OP_BUY ? clrSilver : clrSlateGray);

    if (ticket > 0) {
        Print("[SilverEA] Silver order placed! Ticket=", ticket);
        ConfirmExecution(signalId, ticket, type, lotSize, price);
    } else {
        Print("[SilverEA] OrderSend FAILED. Error=", GetLastError(), " Ensure XAGUSD is in Market Watch and margin is sufficient.");
    }
}

void ConfirmExecution(string signalId, int ticket, string type, double lots, double price) {
    string confirmUrl = "https://forex-ai-trader-cc744e2a.base44.app/functions/confirmExecution";
    string payload = StringFormat(
        "{\\\"signal_id\\\":\\\"%s\\\",\\\"ticket\\\":%d,\\\"pair\\\":\\\"%s\\\",\\\"type\\\":\\\"%s\\\",\\\"lot_size\\\":%.2f,\\\"open_price\\\":%.3f,\\\"account_number\\\":\\\"%s\\\"}",
        signalId, ticket, SilverSymbol, type, lots, price, IntegerToString(AccountNumber())
    );
    char postData[], result[];
    string resultHeaders;
    StringToCharArray(payload, postData, 0, StringLen(payload));
    string headers = "Content-Type: application/json\\r\\nAuthorization: Bearer " + ApiKey + "\\r\\n";
    WebRequest("POST", confirmUrl, headers, 5000, postData, result, resultHeaders);
    Print("[SilverEA] Execution confirmed for ticket ", ticket);
}

void ProcessCloseCommands(string json) {
    int start = StringFind(json, "\\"close_commands\\"");
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
    bool ok = OrderClose(ticket, lots, price, Slippage, clrLightGray);
    if (ok) Print("[SilverEA] Closed ticket ", ticket, " ", symbol, " @ ", price);
    else Print("[SilverEA] OrderClose FAILED ticket ", ticket, " error=", GetLastError());
}
//+------------------------------------------------------------------+`;

export default function SilverEADownload() {
    const download = (code, filename) => {
        const element = document.createElement("a");
        const file = new Blob([code], { type: 'text/plain' });
        element.href = URL.createObjectURL(file);
        element.download = filename;
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);
    };

    return (
        <div className="bg-slate-400/10 border border-slate-400/30 rounded-lg p-4 space-y-3 mt-4">
            <div className="flex items-start gap-3">
                <span className="text-2xl">🥈</span>
                <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                        <h4 className="text-sm font-semibold text-slate-200">Silver (XAGUSD) Dedicated EA</h4>
                        <span className="text-xs font-bold text-emerald-300 bg-emerald-500/20 border border-emerald-500/40 px-2 py-0.5 rounded-full">LATEST: MT5 v1.03 / MT4 v1.02</span>
                    </div>
                    <p className="text-xs text-slate-300/70 mb-1">
                        Use this separate EA exclusively for your <strong>SILVER_XAGUSD</strong> bot. It runs independently from the standard and Gold bridge EAs with:
                    </p>
                    <ul className="text-xs text-slate-300/60 list-disc ml-4 space-y-0.5 mb-3">
                        <li><strong>MagicNumber 88888</strong> — keeps Silver trades separate from Forex (12345) and Gold (99999)</li>
                        <li><strong>3dp price precision</strong> — correct for XAGUSD ($30.125)</li>
                        <li><strong>Slippage 50 points</strong> — appropriate tolerance for Silver execution</li>
                        <li>Only picks up XAGUSD signals — ignores all Forex & Gold signals</li>
                        <li><strong>MaxSilverTrades = 3</strong> (default) — limits concurrent Silver trades; set to 0 for unlimited</li>
                        <li><strong>Min SL/TP distance $0.20</strong> — respects broker minimum stop distance for Silver</li>
                        <li><strong>EnableTrailing</strong> — set to true to activate trailing stop on all Silver trades</li>
                    </ul>
                    <p className="text-xs text-slate-200/80 font-semibold mb-3">
                        ⚠ Attach this EA to a separate XAGUSD chart alongside your standard bridge EA.
                    </p>
                    <div className="bg-red-500/10 border border-red-500/30 rounded p-3 mb-3">
                        <p className="text-xs text-red-300 font-semibold mb-1">⚠ MT4: Two URLs must be whitelisted in Tools → Options → Expert Advisors → Allow WebRequest:</p>
                        <code className="text-xs text-red-200/80 block">https://forex-ai-trader-cc744e2a.base44.app/functions/bridge</code>
                        <code className="text-xs text-red-200/80 block">https://forex-ai-trader-cc744e2a.base44.app/functions/confirmExecution</code>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                        <Button
                            onClick={() => download(SILVER_EA_CODE, "SilverForexTouchAI_EA.mq4")}
                            className="bg-slate-500/20 border border-slate-400/40 text-slate-200 hover:bg-slate-500/30 hover:text-white text-xs"
                            size="sm"
                        >
                            🥈 Download Silver EA MT4 (.mq4) — v1.02
                        </Button>
                        <Button
                            onClick={() => download(SILVER_EA_MT5_CODE, "SilverForexTouchAI_EA.mq5")}
                            className="bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/30 hover:text-indigo-100 text-xs"
                            size="sm"
                        >
                            🥈 Download Silver EA MT5 (.mq5) — v1.03
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}