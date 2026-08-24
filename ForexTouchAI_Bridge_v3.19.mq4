//+------------------------------------------------------------------+
//|                                ForexTouchAI_Bridge_v3.18.mq4 |
//|                                     Copyright 2024, ForexTouchAI |
//|                                       https://www.forextouchai.com |
//+------------------------------------------------------------------+
#property copyright "Copyright 2024, ForexTouchAI"
#property link      "https://www.forextouchai.com"
#property version   "3.18"
#property strict

#define EA_VERSION "3.18"

// --- INPUTS ---
input string AppUrl = "https://forex-ai-trader-cc744e2a.base44.app"; 
input string ApiKey = ""; 
input double  FixedLotSize = 0.01;
input int MaxOpenTrades = 5;
input int MaxDailyTrades = 0; // 0 = unlimited
input double MaxSpreadPips = 3.0;
input bool EnableTrailingStop = false;
input double TrailingStopPips = 20;
input double TrailingStartPips = 30;
input bool HideSLTP = false;
input double CloseAllAtProfitPercent = 0; // 0 = disabled
input double CloseAllAtLossPercent = 0; // 0 = disabled
input string TradingStartTime = "00:00"; // HH:MM format
input string TradingEndTime = "23:59"; // HH:MM format
input bool CountAllTrades = true;   // true = count ALL open trades (all EAs + manual); false = only this EA's trades
input int MagicNumber = 12345;
input string FilterByComment = "";  // Only count trades with this exact comment (empty = use CountAllTrades/MagicNumber). e.g. "ForexTouchAI"
input string SymbolSuffix = "";  // Broker symbol suffix (e.g. ".PRO", ".r", ".m"). Leave empty if your broker uses no suffix.
input bool   UploadCandles   = true;   // Send broker OHLC to the app (needed for real signals)
input int    BarsToUpload    = 400;    // Bars per timeframe (400 = 250 warmup + tradeable)
input string CandleTimeframes = "H1,H4,D1"; // Timeframes to upload, comma-separated
input int    CandleUploadMins = 15;    // Minutes between candle uploads
input int    OrderRetries    = 3;      // Retry attempts on requote/off-quotes
input int    MaxSlippagePips = 2;      // Max slippage in PIPS (converted to points)

// --- GLOBALS ---
string ServiceUrl;
string Endpoint;
datetime LastSync = 0;
string lastSignalId = "";
int TradesToday = 0;
datetime LastResetDate = 0;
struct TradeInfo {
    int ticket;
    double openPrice;
    double hiddenSL;
    double hiddenTP;
};
TradeInfo managedTrades[];
int managedCount = 0;

//+------------------------------------------------------------------+
//| Initialization                                                   |
//+------------------------------------------------------------------+
int OnInit() {
   ServiceUrl = AppUrl;
   
   // 1. Clean URL
   StringTrimRight(ServiceUrl);
   StringTrimLeft(ServiceUrl);
   
   // 2. Remove trailing slash
   int len = StringLen(ServiceUrl);
   if(len > 0 && StringSubstr(ServiceUrl, len-1, 1) == "/") {
      ServiceUrl = StringSubstr(ServiceUrl, 0, len-1);
   }
   
   // 3. Construct Endpoint
   Endpoint = ServiceUrl + "/functions/bridge";

   Print("===================================");
   Print("ForexTouchAI Bridge EA v", EA_VERSION, " (LATEST)");
   Print("===================================");
   Print("Target URL: ", ServiceUrl);
   Print("Endpoint: ", Endpoint);
   
   // 4. Run Connection Test
   if(!TestConnection()) {
       return(INIT_FAILED);
   }
   
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason) { Print("Bridge Stopped."); }

//+------------------------------------------------------------------+
//| Test Connection (Runs once on start)                             |
//+------------------------------------------------------------------+
bool TestConnection() {
   char post[], result[];
   string headers = "Content-Type: application/json\r\n";
       string resHeaders;
   
   Print("... Testing connection to Backend ...");
   ResetLastError();
   // 20s timeout: bridge serializes accounts (up to 15s lock wait) + DB calls.
   // The old 5s limit caused WinINet receive timeout [12002] -> MT4 error 5203 -> INIT_FAILED.
   int res = WebRequest("GET", Endpoint, headers, 20000, post, result, resHeaders);
   
   if(res == 200) {
      Print("SUCCESS: Connected to server successfully.");
      return true;
   }
   
   int err = GetLastError();
   Print("CONNECTION FAILED! HTTP Code: ", res, " | MT4 Error: ", err);
   if(ArraySize(result) > 0) Print("Server Response: " + CharArrayToString(result));
   
   if(err == 5203 || err == 5200 || err == 4060) {
      Print(">>> 5203 / 12002 = receive timeout OR URL not whitelisted <<<");
      Print("1. Tools -> Options -> Expert Advisors > tick 'Allow WebRequest' and add: ", ServiceUrl, " (https, NO trailing slash)");
      Print("2. If already whitelisted, the server took >20s (bridge busy) -- re-attach the EA to retry.");
      Print(">>> ---------------------- <<<");
   }
   
   return false;
}

//+------------------------------------------------------------------+
//| Main Loop                                                        |
//+------------------------------------------------------------------+
void OnTick() {
   // Reset daily trade counter
   if(TimeDayOfYear(TimeCurrent()) != TimeDayOfYear(LastResetDate)) {
      TradesToday = 0;
      LastResetDate = TimeCurrent();
   }
   
   // Check time filter
   if(!IsWithinTradingHours()) return;
   
   // Apply trailing stops
   if(EnableTrailingStop) ManageTrailingStops();
   
   // Check hidden SL/TP
   if(HideSLTP) ManageHiddenLevels();
   
   // Check close all conditions
   CheckCloseAllConditions();
   
   // CRITICAL: Sync every 5 seconds to maintain connection
   if(TimeCurrent() - LastSync < 5) return; // 5s Interval (faster heartbeat)
   LastSync = TimeCurrent();

   // --- SEND DATA (POST) - Maintains Connection ---
   string json = BuildJson();
   SendPost(json);
}

//+------------------------------------------------------------------+
//| Trading Time Filter                                              |
//+------------------------------------------------------------------+
bool IsWithinTradingHours() {
   if(TradingStartTime == "" || TradingEndTime == "") return true;
   
   int currentHour = TimeHour(TimeCurrent());
   int currentMin = TimeMinute(TimeCurrent());
   int currentTime = currentHour * 100 + currentMin;
   
   int startHour = (int)StringToInteger(StringSubstr(TradingStartTime, 0, 2));
   int startMin  = (int)StringToInteger(StringSubstr(TradingStartTime, 3, 2));
   int startTime = startHour * 100 + startMin;
   
   int endHour   = (int)StringToInteger(StringSubstr(TradingEndTime, 0, 2));
   int endMin    = (int)StringToInteger(StringSubstr(TradingEndTime, 3, 2));
   int endTime = endHour * 100 + endMin;
   
   return (currentTime >= startTime && currentTime <= endTime);
}

//+------------------------------------------------------------------+
//| Trailing Stop Management                                         |
//+------------------------------------------------------------------+
void ManageTrailingStops() {
   for(int i = OrdersTotal() - 1; i >= 0; i--) {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderCloseTime() != 0) continue; // Skip closed orders
      if(OrderType() > 1) continue; // Only manage market orders (BUY/SELL)
      
      double point = MarketInfo(OrderSymbol(), MODE_POINT);
      int digits = (int)MarketInfo(OrderSymbol(), MODE_DIGITS);
      double trailDist = TrailingStopPips * point * 10;
      double activationDist = TrailingStartPips * point * 10;
      
      if(OrderType() == OP_BUY) {
         double currentPrice = MarketInfo(OrderSymbol(), MODE_BID);
         double profit = currentPrice - OrderOpenPrice();
         
         if(profit >= activationDist) {
            double newSL = currentPrice - trailDist;
            if(newSL > OrderStopLoss() && newSL < currentPrice) {
               if(!OrderModify(OrderTicket(), OrderOpenPrice(), NormalizeDouble(newSL, digits), OrderTakeProfit(), 0, clrNONE)) {
                  Print("Trailing stop modify failed: ", GetLastError());
               }
            }
         }
      }
      else if(OrderType() == OP_SELL) {
         double currentPrice = MarketInfo(OrderSymbol(), MODE_ASK);
         double profit = OrderOpenPrice() - currentPrice;
         
         if(profit >= activationDist) {
            double newSL = currentPrice + trailDist;
            if((OrderStopLoss() == 0 || newSL < OrderStopLoss()) && newSL > currentPrice) {
               if(!OrderModify(OrderTicket(), OrderOpenPrice(), NormalizeDouble(newSL, digits), OrderTakeProfit(), 0, clrNONE)) {
                  Print("Trailing stop modify failed: ", GetLastError());
               }
            }
         }
      }
   }
}

//+------------------------------------------------------------------+
//| Hidden SL/TP Management                                          |
//+------------------------------------------------------------------+
void ManageHiddenLevels() {
   for(int i = managedCount - 1; i >= 0; i--) {
      if(!OrderSelect(managedTrades[i].ticket, SELECT_BY_TICKET)) {
         // Trade closed, remove from array
         RemoveTradeFromArray(i);
         continue;
      }

      // CRITICAL FIX: Check if order is still open before attempting to close
      if(OrderCloseTime() != 0) {
         // Trade already closed by broker/manually
         Print("Trade ", managedTrades[i].ticket, " already closed externally");
         RemoveTradeFromArray(i);
         continue;
      }

      double currentPrice = (OrderType() == OP_BUY) ? 
         MarketInfo(OrderSymbol(), MODE_BID) : 
         MarketInfo(OrderSymbol(), MODE_ASK);

      // Check hidden SL
      if(managedTrades[i].hiddenSL > 0) {
         if((OrderType() == OP_BUY && currentPrice <= managedTrades[i].hiddenSL) ||
            (OrderType() == OP_SELL && currentPrice >= managedTrades[i].hiddenSL)) {
            if(OrderClose(OrderTicket(), OrderLots(), currentPrice, 20, clrRed)) {
               Print("Hidden SL Hit: Ticket ", OrderTicket());
               RemoveTradeFromArray(i);
            } else {
               Print("Hidden SL close failed: ", GetLastError());
            }
            continue;
         }
      }

      // Check hidden TP
      if(managedTrades[i].hiddenTP > 0) {
         if((OrderType() == OP_BUY && currentPrice >= managedTrades[i].hiddenTP) ||
            (OrderType() == OP_SELL && currentPrice <= managedTrades[i].hiddenTP)) {
            if(OrderClose(OrderTicket(), OrderLots(), currentPrice, 20, clrGreen)) {
               Print("Hidden TP Hit: Ticket ", OrderTicket());
               RemoveTradeFromArray(i);
            } else {
               Print("Hidden TP close failed: ", GetLastError());
            }
            continue;
         }
      }
   }
}

//+------------------------------------------------------------------+
//| Remove Trade from Managed Array                                  |
//+------------------------------------------------------------------+
void RemoveTradeFromArray(int index) {
   for(int i = index; i < managedCount - 1; i++) {
      managedTrades[i] = managedTrades[i + 1];
   }
   managedCount--;
   ArrayResize(managedTrades, (int)managedCount);
}

//+------------------------------------------------------------------+
//| Close All at Profit/Loss Percent                                 |
//+------------------------------------------------------------------+
void CheckCloseAllConditions() {
   if(CloseAllAtProfitPercent == 0 && CloseAllAtLossPercent == 0) return;
   
   double totalProfit = 0;
   int openCount = 0;
   
   for(int i = 0; i < OrdersTotal(); i++) {
      if(OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) {
         totalProfit += OrderProfit();
         openCount++;
      }
   }
   
   if(openCount == 0) return;
   
   double balance = AccountBalance();
   double profitPercent = (totalProfit / balance) * 100;
   
   bool shouldClose = false;
   if(CloseAllAtProfitPercent > 0 && profitPercent >= CloseAllAtProfitPercent) {
      Print("Closing all trades - Profit target reached: ", profitPercent, "%");
      shouldClose = true;
   }
   if(CloseAllAtLossPercent > 0 && profitPercent <= -CloseAllAtLossPercent) {
      Print("Closing all trades - Loss limit reached: ", profitPercent, "%");
      shouldClose = true;
   }
   
   if(shouldClose) {
      for(int i = OrdersTotal() - 1; i >= 0; i--) {
         if(OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) {
            double closePrice = (OrderType() == OP_BUY) ? 
               MarketInfo(OrderSymbol(), MODE_BID) : 
               MarketInfo(OrderSymbol(), MODE_ASK);
            if(!OrderClose(OrderTicket(), OrderLots(), closePrice, 20, clrYellow)) {
               Print("Close all failed for ticket ", OrderTicket(), ": ", GetLastError());
            }
         }
      }
   }
}

//+------------------------------------------------------------------+
//| JSON Builder                                                     |
//+------------------------------------------------------------------+
string BuildJson() {
   string j = "{\"account\":{" + 
      "\"account_number\":\"" + IntegerToString(AccountNumber()) + "\"," +
      "\"server_name\":\"" + AccountServer() + "\"," +
      "\"platform\":\"MT4\"," +
      "\"balance\":" + DoubleToString(AccountBalance(), 2) + "," +
      "\"equity\":" + DoubleToString(AccountEquity(), 2) + "," +
      "\"margin\":" + DoubleToString(AccountMargin(), 2) + "," +
      "\"free_margin\":" + DoubleToString(AccountFreeMargin(), 2) + "," +
      "\"margin_level\":" + DoubleToString(AccountMargin() > 0 ? (AccountEquity() / AccountMargin() * 100) : 0, 2) + 
      "}, \"trades\":[";

   int count = 0;
   for(int i=0; i<OrdersTotal(); i++) {
      if(OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) {
         if(count > 0) j += ",";
         j += "{\"ticket\":" + IntegerToString(OrderTicket()) + 
              ",\"symbol\":\"" + OrderSymbol() + "\"" + 
              ",\"type\":\"" + (OrderType()==OP_BUY ? "BUY" : "SELL") + "\"" +
              ",\"pnl\":" + DoubleToString(OrderProfit(), 2) + "}";
         count++;
      }
   }
   j += "]";

   // Append broker OHLC (throttled internally to CandleUploadMins).
   // Returns "" most heartbeats so the payload stays small.
   j += BuildCandlePayload();

   j += "}";
   return j;
}

//+------------------------------------------------------------------+
//| Network Functions                                                |
//+------------------------------------------------------------------+
void SendPost(string json) {
   char data[];
   StringToCharArray(json, data, 0, StringLen(json));
   char res[];
   string headers = "Content-Type: application/json\r\nAuthorization: Bearer " + ApiKey + "\r\n";
   string resH;

   ResetLastError();
   // 20s timeout: full heartbeat can exceed the old 5s limit (lock wait + DB calls).
   int r = WebRequest("POST", Endpoint, headers, 20000, data, res, resH);
   
   if(r == 200) {
      string response = CharArrayToString(res);
      // Parse and execute any pending signals returned in the POST response
      ProcessPendingSignals(response);
      ProcessCloseCommands(response);
      return;
   }
   
   int err = GetLastError();
   if(r != 200 && r != -1) {
      Print("[BRIDGE ERROR] Sync Failed - HTTP: ", r, " | MT4 Error: ", err);
   }
}

//+------------------------------------------------------------------+
//| Parse and execute all signals in pending_signals array           |
//+------------------------------------------------------------------+
void ProcessPendingSignals(string json) {
   // Find the pending_signals array
   int arrStart = StringFind(json, "\"pending_signals\"");
   if(arrStart < 0) return;
   
   arrStart = StringFind(json, "[", arrStart);
   if(arrStart < 0) return;
   
   int arrEnd = StringFind(json, "]", arrStart);
   if(arrEnd < 0) return;
   
   string arr = StringSubstr(json, arrStart + 1, arrEnd - arrStart - 1);
   if(StringLen(arr) < 5) return; // empty array
   
   // Iterate over each signal object {}
   int pos = 0;
   while(pos < StringLen(arr)) {
      int objStart = StringFind(arr, "{", pos);
      if(objStart < 0) break;
      int objEnd = StringFind(arr, "}", objStart);
      if(objEnd < 0) break;
      
      string obj = StringSubstr(arr, objStart, objEnd - objStart + 1);
      string sigPair = GetJsonValue(obj, "pair");
      
      // Skip Gold/XAUUSD & Silver/XAGUSD signals -- handled by dedicated EAs
      if(sigPair == "XAUUSD" || sigPair == "GOLD" || sigPair == "xauusd" || sigPair == "gold" ||
         sigPair == "XAGUSD" || sigPair == "SILVER" || sigPair == "xagusd" || sigPair == "silver") {
         Print("[BRIDGE] Skipping ", sigPair, " signal -- use dedicated Gold/Silver EA.");
         pos = objEnd + 1;
         continue;
      }
      
      ExecuteSignalObj(obj);
      
      pos = objEnd + 1;
   }
}


//+------------------------------------------------------------------+
//| Detect crypto symbols (BTC, ETH, etc.) — crypto has wider spreads  |
//| and different pip conventions, so forex MaxSpreadPips doesn't apply|
//+------------------------------------------------------------------+
bool IsCryptoSymbol(string sym) {
   string s = sym;
   StringToUpper(s);
   int p = StringFind(s, "/");
   if(p != -1) s = StringSubstr(s, 0, p) + StringSubstr(s, p + 1);
   int d = StringFind(s, ".");
   if(d != -1) s = StringSubstr(s, 0, d);
   return (StringFind(s, "BTC") == 0 || StringFind(s, "ETH") == 0 ||
           StringFind(s, "XRP") == 0 || StringFind(s, "LTC") == 0 ||
           StringFind(s, "SOL") == 0 || StringFind(s, "ADA") == 0 ||
           StringFind(s, "DOGE") == 0 || StringFind(s, "AVAX") == 0 ||
           StringFind(s, "LINK") == 0 || StringFind(s, "MATIC") == 0 ||
           StringFind(s, "DOT") == 0);
}

//+------------------------------------------------------------------+
//| Execute one signal object                                        |
//+------------------------------------------------------------------+
void ExecuteSignalObj(string obj) {
   string id  = GetJsonValue(obj, "id");
   string pair = GetJsonValue(obj, "pair");
   string type = GetJsonValue(obj, "type");
   double sigEntry = StringToDouble(GetJsonValue(obj, "entry_price"));
   double sigSL    = StringToDouble(GetJsonValue(obj, "stop_loss"));
   double sigTP    = StringToDouble(GetJsonValue(obj, "take_profit"));
   double sigLot   = StringToDouble(GetJsonValue(obj, "lot_size"));
   string orderComment = GetJsonValue(obj, "comment");
   if(StringLen(orderComment) == 0) orderComment = "ForexTouchAI";

   if(StringLen(id) == 0 || StringLen(pair) == 0 || StringLen(type) == 0) return;
   if(id == lastSignalId) return; // already executed
   
   // Risk checks
   int myOpenCount = 0;
   if(StringLen(FilterByComment) > 0) {
      for(int ci = 0; ci < OrdersTotal(); ci++) {
         if(OrderSelect(ci, SELECT_BY_POS, MODE_TRADES)) {
            if(OrderType() != OP_BUY && OrderType() != OP_SELL) continue;
            if(OrderComment() == FilterByComment) myOpenCount++;
         }
      }
   } else if(CountAllTrades) {
      myOpenCount = OrdersTotal();
   } else {
      for(int ci = 0; ci < OrdersTotal(); ci++) {
         if(OrderSelect(ci, SELECT_BY_POS, MODE_TRADES)) {
            if(OrderType() != OP_BUY && OrderType() != OP_SELL) continue;
            if(OrderMagicNumber() == MagicNumber) myOpenCount++;
         }
      }
   }
   if(MaxOpenTrades > 0 && myOpenCount >= MaxOpenTrades) {
      Print("[BRIDGE] Signal rejected: Max open trades (", myOpenCount, "/", MaxOpenTrades, StringLen(FilterByComment) > 0 ? " [Comment:" + FilterByComment + "]" : (CountAllTrades ? " [ALL]" : " [EA-only]"), ")");
      return;
   }
   if(MaxDailyTrades > 0 && TradesToday >= MaxDailyTrades) {
      Print("[BRIDGE] Signal rejected: Daily trade limit (", MaxDailyTrades, ")");
      return;
   }
   
   // Strip slash from pair for MT4 symbol lookup (e.g. EUR/USD -> EURUSD)
   string symbol = pair;
   int slashPos = StringFind(pair, "/");
   if(slashPos != -1)
      symbol = StringSubstr(pair, 0, slashPos) + StringSubstr(pair, slashPos + 1);
   // Append broker symbol suffix (e.g. EURUSD -> EURUSD.PRO) if not already present
   if(StringLen(SymbolSuffix) > 0 && StringFind(symbol, SymbolSuffix) < 0)
      symbol = symbol + SymbolSuffix;

   int cmd = (type == "BUY") ? OP_BUY : OP_SELL;
   double currentPrice = MarketInfo(symbol, (cmd == OP_BUY ? MODE_ASK : MODE_BID));
   int digits = (int)MarketInfo(symbol, MODE_DIGITS);

   if(currentPrice == 0) {
      Print("[BRIDGE] ERROR: Cannot get price for ", symbol, " - add symbol to Market Watch");
      return;
   }

   // --- Live-account safety checks (demo accounts skip these silently) ---
   // 1. Spread check -- live spreads are wider and can breach MaxSpreadPips
   double spreadPts = MarketInfo(symbol, MODE_SPREAD);
   double point     = MarketInfo(symbol, MODE_POINT);
   // FIXED. MODE_SPREAD already returns the spread IN POINTS. The previous
   // formula was `spreadPts * point * 10`, which for 5-digit EURUSD with a
   // 1.5-pip spread gave 15 * 0.00001 * 10 = 0.0015 — compared against
   // MaxSpreadPips 3.0 it was never once exceeded. The spread filter had never
   // rejected a single trade, so the bot entered through news spikes and the
   // Sunday open with no complaint.
   // A pip is 10 points on 3- and 5-digit symbols, 1 point otherwise.
   double pipPoints = ((digits == 3 || digits == 5) ? 10.0 : 1.0);
   double spreadPips = spreadPts / pipPoints;
   if(MaxSpreadPips > 0 && !IsCryptoSymbol(symbol) && spreadPips > MaxSpreadPips) {
      Print("[BRIDGE] REJECTED: Spread ", DoubleToString(spreadPips, 1), " pips > MaxSpreadPips ", MaxSpreadPips, " for ", symbol);
      return;
   }

   // 2. Minimum stops level -- live brokers enforce this; demo often has 0.
   //    If SL/TP is closer than the minimum, the order is rejected (Error 130).
   double stopsLevel = MarketInfo(symbol, MODE_STOPLEVEL);
   double minStopDist = stopsLevel * point;

   // Calculate SL/TP as distance from signal entry, apply to current price
   double finalSL = 0, finalTP = 0;
   if(sigEntry > 0) {
      double slDist = 0, tpDist = 0;
      if(cmd == OP_BUY) {
         if(sigSL > 0) slDist = sigEntry - sigSL;
         if(sigTP > 0) tpDist = sigTP - sigEntry;
         if(slDist > 0) finalSL = NormalizeDouble(currentPrice - slDist, digits);
         if(tpDist > 0) finalTP = NormalizeDouble(currentPrice + tpDist, digits);
      } else {
         if(sigSL > 0) slDist = sigSL - sigEntry;
         if(sigTP > 0) tpDist = sigEntry - sigTP;
         if(slDist > 0) finalSL = NormalizeDouble(currentPrice + slDist, digits);
         if(tpDist > 0) finalTP = NormalizeDouble(currentPrice - tpDist, digits);
      }
   }

   // Enforce minimum stops distance on live accounts
   if(minStopDist > 0) {
      if(finalSL > 0) {
         if(cmd == OP_BUY && (currentPrice - finalSL) < minStopDist) finalSL = NormalizeDouble(currentPrice - minStopDist, digits);
         if(cmd == OP_SELL && (finalSL - currentPrice) < minStopDist) finalSL = NormalizeDouble(currentPrice + minStopDist, digits);
      }
      if(finalTP > 0) {
         if(cmd == OP_BUY && (finalTP - currentPrice) < minStopDist) finalTP = NormalizeDouble(currentPrice + minStopDist, digits);
         if(cmd == OP_SELL && (currentPrice - finalTP) < minStopDist) finalTP = NormalizeDouble(currentPrice - minStopDist, digits);
      }
   }

   // 3. Normalize lot size to broker's volume step (live accounts reject unnormalized lots)
   double minVol  = MarketInfo(symbol, MODE_MINLOT);
   double maxVol  = MarketInfo(symbol, MODE_MAXLOT);
   double volStep = MarketInfo(symbol, MODE_LOTSTEP);
   double finalLot  = (sigLot > 0) ? sigLot : FixedLotSize;
   if(volStep > 0) finalLot = MathFloor(finalLot / volStep) * volStep;
   if(finalLot < minVol) finalLot = minVol;
   if(finalLot > maxVol) finalLot = maxVol;
   finalLot = NormalizeDouble(finalLot, 2);

   double displaySL = HideSLTP ? 0 : finalSL;
   double displayTP = HideSLTP ? 0 : finalTP;

   Print("[BRIDGE] Executing: ", type, " ", symbol, " Lot=", finalLot, " Price=", currentPrice, " SL=", finalSL, " TP=", finalTP, " StopsLevel=", stopsLevel, " SpreadPips=", DoubleToString(spreadPips, 1));
   
   // Slippage in POINTS, derived from the pip setting for this symbol.
   int slippagePoints = (int)MathRound(MaxSlippagePips * pipPoints);

   // Retry on transient rejections. Previously a single requote (138) or
   // off-quotes (136) dropped the signal entirely — and because the bridge had
   // already marked it ACTIVE, it would not be re-dispatched for 20 minutes.
   // Live fill rates suffered most in exactly the fast markets the bot is
   // trying to trade.
   int ticket = -1;
   int lastErr = 0;
   for(int attempt = 0; attempt < MathMax(1, OrderRetries) && ticket <= 0; attempt++) {
      if(attempt > 0) {
         Sleep(400);
         RefreshRates();
         currentPrice = MarketInfo(symbol, (cmd == OP_BUY ? MODE_ASK : MODE_BID));
         if(currentPrice <= 0) break;
      }
      ticket = OrderSend(symbol, cmd, finalLot, currentPrice, slippagePoints,
                         displaySL, displayTP, orderComment, MagicNumber, 0,
                         cmd == OP_BUY ? clrGreen : clrRed);
      if(ticket <= 0) {
         lastErr = GetLastError();
         // Only these are worth retrying. Anything else (invalid stops,
         // insufficient margin, market closed) will fail identically.
         if(lastErr != 138 && lastErr != 136 && lastErr != 135 && lastErr != 129) {
            break;
         }
         Print("[BRIDGE] OrderSend attempt ", attempt + 1, " failed with ", lastErr, " — retrying");
      }
   }

   if(ticket > 0) {
      Print("[BRIDGE] Trade opened! Ticket=", ticket, " Signal=", id);
      lastSignalId = id;
      TradesToday++;
      if(HideSLTP && (finalSL > 0 || finalTP > 0)) {
         ArrayResize(managedTrades, (int)(managedCount + 1));
         managedTrades[managedCount].ticket    = ticket;
         managedTrades[managedCount].openPrice = currentPrice;
         managedTrades[managedCount].hiddenSL  = finalSL;
         managedTrades[managedCount].hiddenTP  = finalTP;
         managedCount++;
      }
   } else {
      Print("[BRIDGE] OrderSend FAILED after ", OrderRetries, " attempt(s). Error=", lastErr,
            " Pair=", pair, " Price=", currentPrice, " SL=", finalSL, " TP=", finalTP,
            " Lot=", finalLot, " SpreadPips=", DoubleToString(spreadPips, 1));
      // Tell the app the signal was NOT executed so it can return to PENDING
      // and be retried, instead of sitting ACTIVE until it silently expires.
      ReportExecutionFailure(id, symbol, lastErr);
   }
}

void CheckSignals() { /* Signals now come from POST response - see ProcessPendingSignals */ }

//+------------------------------------------------------------------+
//| Process close_commands from bridge -- flatten broker positions   |
//+------------------------------------------------------------------+
void ProcessCloseCommands(string json) {
   int arrStart = StringFind(json, "\"close_commands\"");
   if(arrStart < 0) return;
   arrStart = StringFind(json, "[", arrStart);
   if(arrStart < 0) return;
   int arrEnd = StringFind(json, "]", arrStart);
   if(arrEnd < 0) return;
   string arr = StringSubstr(json, arrStart + 1, arrEnd - arrStart - 1);
   if(StringLen(arr) < 5) return;
   int pos = 0;
   while(pos < StringLen(arr)) {
      int objStart = StringFind(arr, "{", pos);
      if(objStart < 0) break;
      int objEnd = StringFind(arr, "}", objStart);
      if(objEnd < 0) break;
      string obj = StringSubstr(arr, objStart, objEnd - objStart + 1);
      int ticket = (int)StringToInteger(GetJsonValue(obj, "ticket"));
      if(ticket > 0) CloseTicket(ticket);
      pos = objEnd + 1;
   }
}

void CloseTicket(int ticket) {
   if(!OrderSelect(ticket, SELECT_BY_TICKET, MODE_TRADES)) {
      Print("[BRIDGE] Close: ticket ", ticket, " not found (may already be closed)");
      return;
   }
   string symbol = OrderSymbol();
   double lots = OrderLots();
   int type = OrderType();
   double price = (type == OP_BUY) ? MarketInfo(symbol, MODE_BID) : MarketInfo(symbol, MODE_ASK);
   if(price <= 0) { Print("[BRIDGE] Close: no price for ", symbol); return; }
   if(!OrderClose(ticket, lots, price, 20, clrYellow)) {
      Print("[BRIDGE] OrderClose FAILED ticket ", ticket, " error=", GetLastError());
   } else {
      Print("[BRIDGE] Closed ticket ", ticket, " ", symbol);
   }
}

//+------------------------------------------------------------------+
//| JSON Parsing Helper                                              |
//+------------------------------------------------------------------+
string GetJsonValue(string json, string key) {
   int keyPos = StringFind(json, "\"" + key + "\"");
   if(keyPos < 0) return "";

   int valStart = StringFind(json, ":", keyPos) + 1;
   int valEnd = StringFind(json, ",", valStart);
   int braceEnd = StringFind(json, "}", valStart);
   
   // Find nearest delimiter
   if(valEnd < 0) valEnd = braceEnd;
   if(braceEnd > 0 && braceEnd < valEnd) valEnd = braceEnd;
   if(valEnd < 0) return "";

   string val = StringSubstr(json, valStart, valEnd - valStart);

   // Clean cleanup
   StringReplace(val, "\"", "");
   StringReplace(val, " ", "");
   StringReplace(val, "\\n", "");
   StringReplace(val, "\\r", "");
   
   return val;
}
//+------------------------------------------------------------------+

//+------------------------------------------------------------------+
//| Report a failed execution so the signal returns to PENDING       |
//+------------------------------------------------------------------+
// Without this, a rejected order left the signal ACTIVE in the database for
// 20 minutes before expiring, and the app had no idea the trade never opened.
void ReportExecutionFailure(string signalId, string symbol, int errorCode) {
   if(StringLen(signalId) == 0) return;

   string url = AppUrl + "/functions/confirmExecution";
   string payload = StringConcatenate(
      "{\"signal_id\":\"", signalId, "\",",
      "\"account_number\":\"", IntegerToString(AccountNumber()), "\",",
      "\"symbol\":\"", symbol, "\",",
      "\"status\":\"FAILED\",",
      "\"error_code\":", IntegerToString(errorCode), ",",
      "\"error_text\":\"", ErrorDescription(errorCode), "\"}"
   );

   char post[], result[];
   string resHeaders;
   StringToCharArray(payload, post, 0, StringLen(payload));
   string headers = "Content-Type: application/json\r\nAuthorization: Bearer " + ApiKey + "\r\n";
   int r = WebRequest("POST", url, headers, 8000, post, result, resHeaders);
   if(r < 0) Print("[BRIDGE] Failure report could not be sent: ", GetLastError());
   else      Print("[BRIDGE] Reported execution failure for signal ", signalId);
}

//+------------------------------------------------------------------+
//| Minimal error description for the common OrderSend codes         |
//+------------------------------------------------------------------+
string ErrorDescription(int code) {
   switch(code) {
      case 129: return "Invalid price";
      case 130: return "Invalid stops";
      case 131: return "Invalid trade volume";
      case 132: return "Market closed";
      case 133: return "Trade disabled";
      case 134: return "Not enough money";
      case 135: return "Price changed";
      case 136: return "Off quotes";
      case 138: return "Requote";
      case 146: return "Trade context busy";
      case 148: return "Too many orders";
      default:  return "Error " + IntegerToString(code);
   }
}

//+------------------------------------------------------------------+
//| Upload broker OHLC so the app can compute real indicators        |
//+------------------------------------------------------------------+
// This is the single most valuable addition in this version. The app's signal
// generator previously had NO price history at all — it passed a language model
// one spot price and asked it to describe chart structure. CopyRates gives the
// backend your broker's own candles, which is the data your orders actually
// execute against, at zero cost and with no third-party rate limit.
datetime lastCandleUpload = 0;

int TimeframeToPeriod(string tf) {
   if(tf == "M1")  return PERIOD_M1;
   if(tf == "M5")  return PERIOD_M5;
   if(tf == "M15") return PERIOD_M15;
   if(tf == "M30") return PERIOD_M30;
   if(tf == "H1")  return PERIOD_H1;
   if(tf == "H4")  return PERIOD_H4;
   if(tf == "D1")  return PERIOD_D1;
   if(tf == "W1")  return PERIOD_W1;
   return 0;
}

string BuildCandleJson(string symbol, string tfName) {
   int period = TimeframeToPeriod(tfName);
   if(period == 0) return "";

   int available = iBars(symbol, period);
   if(available < 60) {
      Print("[BRIDGE] ", symbol, " ", tfName, ": only ", available, " bars in terminal. ",
            "Open the chart and scroll back, or increase 'Max bars in chart' in Tools > Options.");
      return "";
   }

   int count = MathMin(BarsToUpload, available - 1);   // -1 excludes the forming bar
   if(count < 60) return "";

   string bars = "";
   // Walk from oldest to newest. Index 0 is the CURRENT, still-forming bar, so
   // we start at index `count` and stop at 1 — never uploading an open candle.
   for(int i = count; i >= 1; i--) {
      if(StringLen(bars) > 0) bars = bars + ",";
      bars = bars + StringConcatenate(
         "{\"t\":", IntegerToString((int)iTime(symbol, period, i)),
         ",\"o\":", DoubleToString(iOpen(symbol, period, i), 8),
         ",\"h\":", DoubleToString(iHigh(symbol, period, i), 8),
         ",\"l\":", DoubleToString(iLow(symbol, period, i), 8),
         ",\"c\":", DoubleToString(iClose(symbol, period, i), 8),
         ",\"v\":", IntegerToString((int)iVolume(symbol, period, i)), "}"
      );
   }
   if(StringLen(bars) == 0) return "";

   string cleanSymbol = symbol;
   if(StringLen(SymbolSuffix) > 0) {
      int sufPos = StringFind(cleanSymbol, SymbolSuffix);
      if(sufPos > 0) cleanSymbol = StringSubstr(cleanSymbol, 0, sufPos);
   }

   return StringConcatenate("{\"symbol\":\"", cleanSymbol, "\",\"timeframe\":\"", tfName,
                            "\",\"bars\":[", bars, "]}");
}

string BuildCandlePayload() {
   if(!UploadCandles) return "";
   if(TimeCurrent() - lastCandleUpload < CandleUploadMins * 60) return "";

   string tfs[];
   int n = StringSplit(CandleTimeframes, ',', tfs);
   if(n <= 0) return "";

   string entries = "";
   for(int i = 0; i < n; i++) {
      string tf = tfs[i];
      StringTrimLeft(tf); StringTrimRight(tf);
      if(StringLen(tf) == 0) continue;
      string entry = BuildCandleJson(Symbol(), tf);
      if(StringLen(entry) == 0) continue;
      if(StringLen(entries) > 0) entries = entries + ",";
      entries = entries + entry;
   }

   if(StringLen(entries) == 0) return "";
   lastCandleUpload = TimeCurrent();
   Print("[BRIDGE] Uploading candles for ", Symbol(), " (", CandleTimeframes, ")");
   return StringConcatenate(",\"candles\":[", entries, "]");
}
