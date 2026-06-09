//+------------------------------------------------------------------+
//|                                        GoldForexTouchAI_EA.mq4  |
//|                              ForexTouchAI Gold (XAUUSD) Bridge EA|
//|                   Optimised exclusively for XAUUSD / Gold trading |
//+------------------------------------------------------------------+
#property copyright "ForexTouchAI"
#property version   "1.00"
#property strict

// --- INPUTS ---
input string BridgeURL    = "https://forex-ai-trader-cc744e2a.base44.app/functions/bridge";
input string ApiKey       = "";   // Paste your API Key from ForexTouchAI Settings page
input int    HeartbeatSec = 30;   // How often to poll bridge (seconds)
input int    MagicNumber  = 99999; // DIFFERENT from standard EA (12345) — Gold trades only
input int    Slippage     = 100;  // Gold requires wide slippage tolerance (100 points)
input string GoldSymbol   = "XAUUSD"; // Symbol name as shown in your broker's Market Watch
input int    MaxGoldTrades = 3;   // Maximum concurrent Gold trades (0 = unlimited)
input bool   EnableTrailing     = false; // Enable trailing stop
input double TrailingStartPoints = 150; // Profit in points before trailing activates (e.g. 150 = $1.50)
input double TrailingStopPoints  = 100; // Trailing stop distance in points (e.g. 100 = $1.00)

// --- GLOBALS ---
datetime lastHeartbeat = 0;

//+------------------------------------------------------------------+
int OnInit() {
    if (StringLen(ApiKey) == 0) {
        Print("[GoldForexTouchAI] WARNING: ApiKey is empty! Get your API Key from the Settings page.");
    }
    // Verify Gold symbol is in Market Watch
    if (MarketInfo(GoldSymbol, MODE_BID) <= 0) {
        Print("[GoldForexTouchAI] WARNING: Symbol '", GoldSymbol, "' not found in Market Watch. Add it and retry.");
    }
    Print("[GoldForexTouchAI] Gold EA v1.00 started. Symbol: ", GoldSymbol, " MagicNumber: ", MagicNumber);
    EventSetTimer(1);
    return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) {
    EventKillTimer();
}

void OnTimer() {
    if (TimeCurrent() - lastHeartbeat < HeartbeatSec) return;
    lastHeartbeat = TimeCurrent();
    SendHeartbeat();
}

void OnTick() {
    if (EnableTrailing) ManageTrailingStop();
}

//+------------------------------------------------------------------+
void ManageTrailingStop() {
    for (int i = 0; i < OrdersTotal(); i++) {
        if (!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
        if (OrderType() != OP_BUY && OrderType() != OP_SELL) continue;
        if (OrderMagicNumber() != MagicNumber) continue;
        if (OrderSymbol() != GoldSymbol) continue;

        double bid = MarketInfo(GoldSymbol, MODE_BID);
        double ask = MarketInfo(GoldSymbol, MODE_ASK);
        double point = MarketInfo(GoldSymbol, MODE_POINT);
        double trailDist = TrailingStopPoints * point;
        double trailStart = TrailingStartPoints * point;

        if (OrderType() == OP_BUY) {
            double profit = bid - OrderOpenPrice();
            if (profit >= trailStart) {
                double newSL = NormalizeDouble(bid - trailDist, 2);
                if (newSL > OrderStopLoss() + point) {
                    OrderModify(OrderTicket(), OrderOpenPrice(), newSL, OrderTakeProfit(), 0, clrGold);
                }
            }
        } else {
            double profit = OrderOpenPrice() - ask;
            if (profit >= trailStart) {
                double newSL = NormalizeDouble(ask + trailDist, 2);
                if (newSL < OrderStopLoss() - point || OrderStopLoss() == 0) {
                    OrderModify(OrderTicket(), OrderOpenPrice(), newSL, OrderTakeProfit(), 0, clrOrangeRed);
                }
            }
        }
    }
}

//+------------------------------------------------------------------+
void SendHeartbeat() {
    // Report ONLY Gold trades managed by this EA (MagicNumber = 99999)
    string tradesJson = "[";
    bool first = true;
    for (int i = 0; i < OrdersTotal(); i++) {
        if (!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
        if (OrderType() != OP_BUY && OrderType() != OP_SELL) continue;
        // Only report Gold trades with this EA's MagicNumber
        if (OrderMagicNumber() != MagicNumber) continue;
        if (OrderSymbol() != GoldSymbol) continue;
        if (!first) tradesJson += ",";
        first = false;
        tradesJson += StringFormat(
            "{\"ticket\":%d,\"pair\":\"%s\",\"type\":\"%s\",\"lot_size\":%.2f,\"open_price\":%.2f,\"pnl\":%.2f,\"magic\":%d}",
            OrderTicket(),
            OrderSymbol(),
            OrderType() == OP_BUY ? "BUY" : "SELL",
            OrderLots(),
            OrderOpenPrice(),  // %.2f — Gold uses 2 decimal places
            OrderProfit(),
            OrderMagicNumber()
        );
    }
    tradesJson += "]";

    // Send only Gold price to bridge
    double goldBid = MarketInfo(GoldSymbol, MODE_BID);
    double goldAsk = MarketInfo(GoldSymbol, MODE_ASK);
    string pricesJson = "[]";
    if (goldBid > 0) {
        pricesJson = StringFormat(
            "[{\"symbol\":\"%s\",\"bid\":%.2f,\"ask\":%.2f}]",
            GoldSymbol, goldBid, goldAsk
        );
    }

    // Build full payload
    string payload = StringFormat(
        "{\"account_number\":\"%s\",\"server_name\":\"%s\",\"balance\":%.2f,\"equity\":%.2f,\"margin\":%.2f,\"free_margin\":%.2f,\"margin_level\":%.2f,\"trades\":%s,\"prices\":%s}",
        IntegerToString(AccountNumber()),
        AccountServer(),
        AccountBalance(),
        AccountEquity(),
        AccountMargin(),
        AccountFreeMargin(),
        AccountMargin() > 0 ? AccountEquity() / AccountMargin() * 100 : 0,
        tradesJson,
        pricesJson
    );

    // --- Send HTTP POST ---
    char postData[];
    char result[];
    string resultHeaders;
    StringToCharArray(payload, postData, 0, StringLen(payload));

    string headers = "Content-Type: application/json\r\nAuthorization: Bearer " + ApiKey + "\r\n";
    int timeout = 5000;

    int res = WebRequest("POST", BridgeURL, headers, timeout, postData, result, resultHeaders);

    if (res == -1) {
        Print("[GoldForexTouchAI] WebRequest failed. Error: ", GetLastError(), " - Add URL to: Tools > Options > Expert Advisors > Allow WebRequest");
        return;
    }
    if (res == 403) {
        Print("[GoldForexTouchAI] ERROR 403: Invalid or missing ApiKey.");
        return;
    }

    string response = CharArrayToString(result);
    Print("[GoldForexTouchAI] Response: ", StringSubstr(response, 0, 200));

    ProcessSignals(response);
}

//+------------------------------------------------------------------+
// Count open Gold trades managed by this EA
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

//+------------------------------------------------------------------+
void ProcessSignals(string json) {
    int start = StringFind(json, "\"pending_signals\"");
    if (start == -1) return;

    start = StringFind(json, "[", start);
    if (start == -1) return;

    int end = StringFind(json, "]", start);
    if (end == -1) return;

    string signalsArray = StringSubstr(json, start + 1, end - start - 1);
    if (StringLen(signalsArray) < 5) return;

    int pos = 0;
    while (pos < StringLen(signalsArray)) {
        // Check trade limit before each signal
        if (MaxGoldTrades > 0 && CountOpenGoldTrades() >= MaxGoldTrades) {
            Print("[GoldForexTouchAI] MaxGoldTrades limit reached (", MaxGoldTrades, ") — skipping remaining signals");
            break;
        }

        int objStart = StringFind(signalsArray, "{", pos);
        if (objStart == -1) break;
        int objEnd = StringFind(signalsArray, "}", objStart);
        if (objEnd == -1) break;

        string obj = StringSubstr(signalsArray, objStart, objEnd - objStart + 1);
        string sigPair = ExtractJsonString(obj, "pair");

        // This EA ONLY executes Gold signals — ignore everything else
        if (sigPair != GoldSymbol) {
            pos = objEnd + 1;
            continue;
        }

        ExecuteSignal(obj);
        pos = objEnd + 1;
    }
}

//+------------------------------------------------------------------+
string ExtractJsonString(string json, string key) {
    string search = "\"" + key + "\":\"";
    int start = StringFind(json, search);
    if (start == -1) return "";
    start += StringLen(search);
    int end = StringFind(json, "\"", start);
    if (end == -1) return "";
    return StringSubstr(json, start, end - start);
}

double ExtractJsonDouble(string json, string key) {
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

//+------------------------------------------------------------------+
void ExecuteSignal(string obj) {
    string signalId = ExtractJsonString(obj, "id");
    string pair     = ExtractJsonString(obj, "pair");
    string type     = ExtractJsonString(obj, "type");
    double lotSize  = ExtractJsonDouble(obj, "lot_size");
    double sl       = ExtractJsonDouble(obj, "stop_loss");
    double tp       = ExtractJsonDouble(obj, "take_profit");

    if (StringLen(pair) == 0 || StringLen(type) == 0) {
        Print("[GoldForexTouchAI] Invalid signal data, skipping");
        return;
    }

    if (lotSize <= 0) lotSize = 0.01; // Gold default lot size is smaller

    // Validate SL/TP are sensible for Gold (must be > $1 away from price)
    double currentBid = MarketInfo(pair, MODE_BID);
    double currentAsk = MarketInfo(pair, MODE_ASK);
    int cmd = (type == "BUY") ? OP_BUY : OP_SELL;
    double price = (cmd == OP_BUY) ? currentAsk : currentBid;

    if (price == 0) {
        Print("[GoldForexTouchAI] ERROR: Cannot get price for ", pair);
        return;
    }

    // Safety check: ensure SL/TP are at least $5 away (broker min stop distance for Gold)
    double minDist = 5.0; // $5 minimum distance
    if (sl > 0) {
        if (cmd == OP_BUY && (price - sl) < minDist) {
            sl = NormalizeDouble(price - minDist * 2, 2);
            Print("[GoldForexTouchAI] SL too close, adjusted to: ", sl);
        }
        if (cmd == OP_SELL && (sl - price) < minDist) {
            sl = NormalizeDouble(price + minDist * 2, 2);
            Print("[GoldForexTouchAI] SL too close, adjusted to: ", sl);
        }
    }
    if (tp > 0) {
        if (cmd == OP_BUY && (tp - price) < minDist) {
            tp = NormalizeDouble(price + minDist * 2, 2);
            Print("[GoldForexTouchAI] TP too close, adjusted to: ", tp);
        }
        if (cmd == OP_SELL && (price - tp) < minDist) {
            tp = NormalizeDouble(price - minDist * 2, 2);
            Print("[GoldForexTouchAI] TP too close, adjusted to: ", tp);
        }
    }

    Print("[GoldForexTouchAI] Executing GOLD: ", type, " ", pair, " Lot=", lotSize, " Price=", price, " SL=", sl, " TP=", tp);

    int ticket = OrderSend(
        pair,
        cmd,
        lotSize,
        price,
        Slippage,  // 100 points — wide tolerance for Gold
        sl,
        tp,
        "GoldForexTouchAI",
        MagicNumber,
        0,
        cmd == OP_BUY ? clrGold : clrOrangeRed
    );

    if (ticket > 0) {
        Print("[GoldForexTouchAI] Gold order placed! Ticket=", ticket, " Signal=", signalId);
        ConfirmExecution(signalId, ticket, pair, type, lotSize, price);
    } else {
        int err = GetLastError();
        Print("[GoldForexTouchAI] OrderSend FAILED. Error=", err, " Price=", price, " SL=", sl, " TP=", tp);
        Print("[GoldForexTouchAI] Check: symbol in Market Watch, broker min stop distance, sufficient margin");
    }
}

//+------------------------------------------------------------------+
void ConfirmExecution(string signalId, int ticket, string pair, string type, double lots, double price) {
    string confirmUrl = ReplaceString(BridgeURL, "bridge", "confirmExecution");

    string payload = StringFormat(
        "{\"signal_id\":\"%s\",\"ticket\":%d,\"pair\":\"%s\",\"type\":\"%s\",\"lot_size\":%.2f,\"open_price\":%.2f,\"account_number\":\"%s\"}",
        signalId, ticket, pair, type, lots, price,
        IntegerToString(AccountNumber())
    );

    char postData[];
    char result[];
    string resultHeaders;
    StringToCharArray(payload, postData, 0, StringLen(payload));

    string headers = "Content-Type: application/json\r\nAuthorization: Bearer " + ApiKey + "\r\n";
    WebRequest("POST", confirmUrl, headers, 5000, postData, result, resultHeaders);
    Print("[GoldForexTouchAI] Execution confirmed for ticket ", ticket);
}

string ReplaceString(string src, string find, string replace) {
    int pos = StringFind(src, find);
    if (pos == -1) return src;
    return StringSubstr(src, 0, pos) + replace + StringSubstr(src, pos + StringLen(find));
}
//+------------------------------------------------------------------+