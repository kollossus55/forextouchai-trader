//+------------------------------------------------------------------+
//|                                              ForexTouchAI_EA.mq4 |
//|                                          ForexTouchAI Bridge EA  |
//+------------------------------------------------------------------+
#property copyright "ForexTouchAI"
#property version   "2.00"
#property strict

// --- INPUTS ---
input string BridgeURL    = "https://app.base44.com/api/apps/693abc8e3fbeec43cc744e2a/functions/bridge";
input int    HeartbeatSec = 5;   // How often to poll bridge (seconds)
input int    MagicNumber  = 12345;
input int    Slippage     = 3;

// --- GLOBALS ---
datetime lastHeartbeat = 0;

//+------------------------------------------------------------------+
int OnInit() {
    Print("[ForexTouchAI] EA started. Bridge: ", BridgeURL);
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
    // Heartbeat driven by timer, not tick
}

//+------------------------------------------------------------------+
void SendHeartbeat() {
    // Build trades array from currently open orders
    string tradesJson = "[";
    bool first = true;
    for (int i = 0; i < OrdersTotal(); i++) {
        if (!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
        if (OrderMagicNumber() != MagicNumber) continue;
        if (!first) tradesJson += ",";
        first = false;
        tradesJson += StringFormat(
            "{\"ticket\":%d,\"pair\":\"%s\",\"type\":\"%s\",\"lot_size\":%.2f,\"open_price\":%.5f,\"pnl\":%.2f}",
            OrderTicket(),
            OrderSymbol(),
            OrderType() == OP_BUY ? "BUY" : "SELL",
            OrderLots(),
            OrderOpenPrice(),
            OrderProfit()
        );
    }
    tradesJson += "]";

    // Build full payload
    string payload = StringFormat(
        "{\"account_number\":\"%s\",\"server_name\":\"%s\",\"balance\":%.2f,\"equity\":%.2f,\"margin\":%.2f,\"free_margin\":%.2f,\"margin_level\":%.2f,\"trades\":%s}",
        IntegerToString(AccountNumber()),
        AccountServer(),
        AccountBalance(),
        AccountEquity(),
        AccountMargin(),
        AccountFreeMargin(),
        AccountMargin() > 0 ? AccountEquity() / AccountMargin() * 100 : 0,
        tradesJson
    );

    // --- Send HTTP POST ---
    char postData[];
    char result[];
    string resultHeaders;
    StringToCharArray(payload, postData, 0, StringLen(payload));

    string headers = "Content-Type: application/json\r\n";
    int timeout = 5000;

    int res = WebRequest("POST", BridgeURL, headers, timeout, postData, result, resultHeaders);

    if (res == -1) {
        Print("[ForexTouchAI] WebRequest failed. Error: ", GetLastError(), " - Add URL to: Tools > Options > Expert Advisors > Allow WebRequest");
        return;
    }

    string response = CharArrayToString(result);
    Print("[ForexTouchAI] Response: ", StringSubstr(response, 0, 200));

    // --- Parse pending_signals ---
    ProcessSignals(response);
}

//+------------------------------------------------------------------+
void ProcessSignals(string json) {
    // Find pending_signals array
    int start = StringFind(json, "\"pending_signals\"");
    if (start == -1) return;

    start = StringFind(json, "[", start);
    if (start == -1) return;

    int end = StringFind(json, "]", start);
    if (end == -1) return;

    string signalsArray = StringSubstr(json, start + 1, end - start - 1);
    if (StringLen(signalsArray) < 5) return; // empty array

    // Count and process each signal object
    int pos = 0;
    while (pos < StringLen(signalsArray)) {
        int objStart = StringFind(signalsArray, "{", pos);
        if (objStart == -1) break;
        int objEnd = StringFind(signalsArray, "}", objStart);
        if (objEnd == -1) break;

        string obj = StringSubstr(signalsArray, objStart, objEnd - objStart + 1);
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
        Print("[ForexTouchAI] Invalid signal data, skipping");
        return;
    }

    // Normalize lot size
    if (lotSize <= 0) lotSize = 0.1;

    Print("[ForexTouchAI] Executing: ", type, " ", pair, " Lot=", lotSize, " SL=", sl, " TP=", tp);

    int cmd = (type == "BUY") ? OP_BUY : OP_SELL;

    // Get current price
    double price = (cmd == OP_BUY) ? MarketInfo(pair, MODE_ASK) : MarketInfo(pair, MODE_BID);

    if (price == 0) {
        Print("[ForexTouchAI] ERROR: Cannot get price for ", pair, " - symbol may not be in Market Watch");
        return;
    }

    // Execute order
    int ticket = OrderSend(
        pair,
        cmd,
        lotSize,
        price,
        Slippage,
        sl,
        tp,
        "ForexTouchAI",
        MagicNumber,
        0,
        cmd == OP_BUY ? clrGreen : clrRed
    );

    if (ticket > 0) {
        Print("[ForexTouchAI] Order placed! Ticket=", ticket, " Signal=", signalId);
        // Confirm execution back to bridge
        ConfirmExecution(signalId, ticket, pair, type, lotSize, price);
    } else {
        Print("[ForexTouchAI] OrderSend FAILED. Error=", GetLastError(), " Price=", price, " SL=", sl, " TP=", tp);
    }
}

//+------------------------------------------------------------------+
void ConfirmExecution(string signalId, int ticket, string pair, string type, double lots, double price) {
    string confirmUrl = StringReplace(BridgeURL, "bridge", "confirmExecution");

    string payload = StringFormat(
        "{\"signal_id\":\"%s\",\"ticket\":%d,\"pair\":\"%s\",\"type\":\"%s\",\"lot_size\":%.2f,\"open_price\":%.5f,\"account_number\":\"%s\"}",
        signalId, ticket, pair, type, lots, price,
        IntegerToString(AccountNumber())
    );

    char postData[];
    char result[];
    string resultHeaders;
    StringToCharArray(payload, postData, 0, StringLen(payload));

    string headers = "Content-Type: application/json\r\n";
    WebRequest("POST", confirmUrl, headers, 5000, postData, result, resultHeaders);
    Print("[ForexTouchAI] Execution confirmed to bridge for ticket ", ticket);
}

string StringReplace(string src, string find, string replace) {
    int pos = StringFind(src, find);
    if (pos == -1) return src;
    return StringSubstr(src, 0, pos) + replace + StringSubstr(src, pos + StringLen(find));
}
//+------------------------------------------------------------------+