import React from 'react';
import { Button } from '@/components/ui/button';

const GOLD_EA_MT5_CODE = `//+------------------------------------------------------------------+
//|                                  GoldForexTouchAI_EA.mq5        |
//|         Dedicated Gold (XAUUSD) EA for ForexTouchAI (MT5)       |
//|   Uses MagicNumber 99999 - SEPARATE from standard EA (12345)    |
//+------------------------------------------------------------------+
#property copyright "ForexTouchAI"
#property version   "1.00"
#property strict

#include <Trade\\Trade.mqh>

// --- INPUTS ---
input string BridgeURL    = "https://forex-ai-trader-cc744e2a.base44.app/functions/bridge";
input string ApiKey       = "";       // Paste your API Key from ForexTouchAI Settings page
input int    HeartbeatSec = 30;       // Poll interval (seconds)
input ulong  MagicNumber  = 99999;    // MUST differ from standard EA (12345) - Gold only
input int    Slippage     = 100;      // Wide slippage tolerance required for Gold
input string GoldSymbol   = "XAUUSD"; // Adjust if broker uses XAUUSDm, XAUUSD. etc.

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
    Print("[GoldEA MT5] Gold EA v1.00 | Symbol: ", GoldSymbol, " | MagicNumber: ", MagicNumber);
    EventSetTimer(1);
    return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) { EventKillTimer(); }

void OnTimer() {
    if (TimeCurrent() - lastHeartbeat < HeartbeatSec) return;
    lastHeartbeat = TimeCurrent();
    SendHeartbeat();
}

void OnTick() {}

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
            "{\\\"ticket\\\":%I64d,\\\"pair\\\":\\\"%s\\\",\\\"type\\\":\\\"%s\\\",\\\"lot_size\\\":%.2f,\\\"open_price\\\":%.2f,\\\"pnl\\\":%.2f}",
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
        ? StringFormat("[{\\\"symbol\\\":\\\"%s\\\",\\\"bid\\\":%.2f,\\\"ask\\\":%.2f}]", GoldSymbol, bid, ask)
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
    if (res == -1) { Print("[GoldEA MT5] WebRequest failed. Error: ", GetLastError(), " - Add URL to: Tools > Options > Expert Advisors > Allow WebRequest"); return; }
    if (res == 403) { Print("[GoldEA MT5] ERROR 403: Invalid ApiKey."); return; }

    string response = CharArrayToString(result);
    Print("[GoldEA MT5] Response: ", StringSubstr(response, 0, 200));
    ProcessSignals(response);
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

    if (lotSize <= 0) lotSize = 0.01;
    bool isBuy = (type == "BUY");
    double price = isBuy ? SymbolInfoDouble(GoldSymbol, SYMBOL_ASK) : SymbolInfoDouble(GoldSymbol, SYMBOL_BID);
    if (price == 0) { Print("[GoldEA MT5] Cannot get price for ", GoldSymbol); return; }

    // Safety: ensure SL/TP are at least $5 away
    double minDist = 5.0;
    if (sl > 0) {
        if (isBuy && price - sl < minDist) sl = NormalizeDouble(price - minDist * 3, 2);
        if (!isBuy && sl - price < minDist) sl = NormalizeDouble(price + minDist * 3, 2);
    }
    if (tp > 0) {
        if (isBuy && tp - price < minDist) tp = NormalizeDouble(price + minDist * 3, 2);
        if (!isBuy && price - tp < minDist) tp = NormalizeDouble(price - minDist * 3, 2);
    }

    Print("[GoldEA MT5] Executing GOLD ", type, " @ ", price, " SL=", sl, " TP=", tp, " Lot=", lotSize);

    bool ok = isBuy
        ? trade.Buy(lotSize, GoldSymbol, price, sl, tp, "GoldForexTouchAI")
        : trade.Sell(lotSize, GoldSymbol, price, sl, tp, "GoldForexTouchAI");

    if (ok) {
        ulong ticket = trade.ResultOrder();
        Print("[GoldEA MT5] Gold order placed! Ticket=", ticket, " RetCode=", trade.ResultRetcode());
        ConfirmExecution(signalId, (long)ticket, type, lotSize, price);
    } else {
        Print("[GoldEA MT5] OrderSend FAILED. RetCode=", trade.ResultRetcode(), " ", trade.ResultRetcodeDescription());
        Print("[GoldEA MT5] Ensure XAUUSD is in Market Watch and margin is sufficient.");
    }
}

void ConfirmExecution(string signalId, long ticket, string type, double lots, double price) {
    string confirmUrl = StringSubstr(BridgeURL, 0, StringFind(BridgeURL, "bridge")) + "confirmExecution";
    string payload = StringFormat(
        "{\\\"signal_id\\\":\\\"%s\\\",\\\"ticket\\\":%I64d,\\\"pair\\\":\\\"%s\\\",\\\"type\\\":\\\"%s\\\",\\\"lot_size\\\":%.2f,\\\"open_price\\\":%.2f,\\\"account_number\\\":\\\"%I64d\\\"}",
        signalId, ticket, GoldSymbol, type, lots, price, AccountInfoInteger(ACCOUNT_LOGIN)
    );
    char postData[], result[];
    string resultHeaders;
    StringToCharArray(payload, postData, 0, StringLen(payload));
    string headers = "Content-Type: application/json\\r\\nAuthorization: Bearer " + ApiKey + "\\r\\n";
    WebRequest("POST", confirmUrl, headers, 5000, postData, result, resultHeaders);
    Print("[GoldEA MT5] Execution confirmed for ticket ", ticket);
}
//+------------------------------------------------------------------+`;

const GOLD_EA_CODE = `//+------------------------------------------------------------------+
//|                                    GoldForexTouchAI_EA.mq4      |
//|              Dedicated Gold (XAUUSD) EA for ForexTouchAI        |
//|   Uses MagicNumber 99999 - SEPARATE from standard EA (12345)   |
//+------------------------------------------------------------------+
#property copyright "ForexTouchAI"
#property version   "1.00"
#property strict

// --- INPUTS ---
input string BridgeURL    = "https://forex-ai-trader-cc744e2a.base44.app/functions/bridge";
input string ApiKey       = "";      // Paste your API Key from ForexTouchAI Settings page
input int    HeartbeatSec = 30;      // Poll interval (seconds)
input int    MagicNumber  = 99999;   // MUST differ from standard EA (12345) - Gold only
input int    Slippage     = 100;     // Wide slippage tolerance required for Gold
input string GoldSymbol   = "XAUUSD"; // Adjust if your broker uses XAUUSDm, XAUUSD. etc.

// --- GLOBALS ---
datetime lastHeartbeat = 0;

int OnInit() {
    if (StringLen(ApiKey) == 0)
        Print("[GoldEA] WARNING: ApiKey empty - get it from the ForexTouchAI Settings page.");
    if (MarketInfo(GoldSymbol, MODE_BID) <= 0)
        Print("[GoldEA] WARNING: Symbol '", GoldSymbol, "' not in Market Watch. Add it.");
    Print("[GoldEA] Gold EA v1.00 | Symbol: ", GoldSymbol, " | MagicNumber: ", MagicNumber);
    EventSetTimer(1);
    return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) { EventKillTimer(); }

void OnTimer() {
    if (TimeCurrent() - lastHeartbeat < HeartbeatSec) return;
    lastHeartbeat = TimeCurrent();
    SendHeartbeat();
}

void OnTick() {}

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
            "{\\\"ticket\\\":%d,\\\"pair\\\":\\\"%s\\\",\\\"type\\\":\\\"%s\\\",\\\"lot_size\\\":%.2f,\\\"open_price\\\":%.2f,\\\"pnl\\\":%.2f,\\\"magic\\\":%d}",
            OrderTicket(), OrderSymbol(),
            OrderType() == OP_BUY ? "BUY" : "SELL",
            OrderLots(), OrderOpenPrice(), OrderProfit(), OrderMagicNumber()
        );
    }
    tradesJson += "]";

    double bid = MarketInfo(GoldSymbol, MODE_BID);
    double ask = MarketInfo(GoldSymbol, MODE_ASK);
    string pricesJson = bid > 0
        ? StringFormat("[{\\\"symbol\\\":\\\"%s\\\",\\\"bid\\\":%.2f,\\\"ask\\\":%.2f}]", GoldSymbol, bid, ask)
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
    if (res == -1) { Print("[GoldEA] WebRequest failed. Add URL to Tools > Options > Expert Advisors"); return; }
    if (res == 403) { Print("[GoldEA] ERROR 403: Invalid ApiKey."); return; }

    string response = CharArrayToString(result);
    Print("[GoldEA] Response: ", StringSubstr(response, 0, 200));
    ProcessSignals(response);
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

    if (lotSize <= 0) lotSize = 0.01;
    int cmd = (type == "BUY") ? OP_BUY : OP_SELL;
    double price = (cmd == OP_BUY) ? MarketInfo(GoldSymbol, MODE_ASK) : MarketInfo(GoldSymbol, MODE_BID);
    if (price == 0) { Print("[GoldEA] Cannot get price for ", GoldSymbol); return; }

    double minDist = 5.0;
    if (sl > 0) {
        if (cmd == OP_BUY && price - sl < minDist) sl = NormalizeDouble(price - minDist * 3, 2);
        if (cmd == OP_SELL && sl - price < minDist) sl = NormalizeDouble(price + minDist * 3, 2);
    }
    if (tp > 0) {
        if (cmd == OP_BUY && tp - price < minDist) tp = NormalizeDouble(price + minDist * 3, 2);
        if (cmd == OP_SELL && price - tp < minDist) tp = NormalizeDouble(price - minDist * 3, 2);
    }

    Print("[GoldEA] Executing GOLD ", type, " @ ", price, " SL=", sl, " TP=", tp, " Lot=", lotSize);

    int ticket = OrderSend(GoldSymbol, cmd, lotSize, price, Slippage, sl, tp, "GoldForexTouchAI", MagicNumber, 0, cmd == OP_BUY ? clrGold : clrOrangeRed);

    if (ticket > 0) {
        Print("[GoldEA] Gold order placed! Ticket=", ticket);
        ConfirmExecution(signalId, ticket, type, lotSize, price);
    } else {
        Print("[GoldEA] OrderSend FAILED. Error=", GetLastError(), " Ensure XAUUSD is in Market Watch and margin is sufficient.");
    }
}

void ConfirmExecution(string signalId, int ticket, string type, double lots, double price) {
    string confirmUrl = StringSubstr(BridgeURL, 0, StringFind(BridgeURL, "bridge")) + "confirmExecution";
    string payload = StringFormat(
        "{\\\"signal_id\\\":\\\"%s\\\",\\\"ticket\\\":%d,\\\"pair\\\":\\\"%s\\\",\\\"type\\\":\\\"%s\\\",\\\"lot_size\\\":%.2f,\\\"open_price\\\":%.2f,\\\"account_number\\\":\\\"%s\\\"}",
        signalId, ticket, GoldSymbol, type, lots, price, IntegerToString(AccountNumber())
    );
    char postData[], result[];
    string resultHeaders;
    StringToCharArray(payload, postData, 0, StringLen(payload));
    string headers = "Content-Type: application/json\\r\\nAuthorization: Bearer " + ApiKey + "\\r\\n";
    WebRequest("POST", confirmUrl, headers, 5000, postData, result, resultHeaders);
    Print("[GoldEA] Execution confirmed for ticket ", ticket);
}
//+------------------------------------------------------------------+`;

export default function GoldEADownload() {
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
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 space-y-3">
            <div className="flex items-start gap-3">
                <span className="text-2xl">🥇</span>
                <div className="flex-1">
                    <h4 className="text-sm font-semibold text-amber-300 mb-1">Gold (XAUUSD) Dedicated EA</h4>
                    <p className="text-xs text-amber-200/70 mb-1">
                        Use this separate EA exclusively for your <strong>GOLD_XAUUSD</strong> bot. It runs independently from the standard bridge EA with:
                    </p>
                    <ul className="text-xs text-amber-200/60 list-disc ml-4 space-y-0.5 mb-3">
                        <li><strong>MagicNumber 99999</strong> — keeps Gold trades separate from Forex trades</li>
                        <li><strong>Slippage 100 points</strong> — required by brokers for Gold execution</li>
                        <li><strong>2dp price precision</strong> — correct for XAUUSD ($3200.50)</li>
                        <li>Only picks up XAUUSD signals — ignores all Forex signals</li>
                    </ul>
                    <p className="text-xs text-amber-300/80 font-semibold mb-3">
                        ⚠ Attach this EA to a separate XAUUSD chart alongside your standard bridge EA.
                    </p>
                    <div className="flex gap-2 flex-wrap">
                        <Button
                            onClick={() => download(GOLD_EA_CODE, "GoldForexTouchAI_EA.mq4")}
                            className="bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30 hover:text-amber-100 text-xs"
                            size="sm"
                        >
                            🥇 Download Gold EA MT4 (.mq4)
                        </Button>
                        <Button
                            onClick={() => download(GOLD_EA_MT5_CODE, "GoldForexTouchAI_EA.mq5")}
                            className="bg-purple-500/20 border border-purple-500/40 text-purple-300 hover:bg-purple-500/30 hover:text-purple-100 text-xs"
                            size="sm"
                        >
                            🥇 Download Gold EA MT5 (.mq5)
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}