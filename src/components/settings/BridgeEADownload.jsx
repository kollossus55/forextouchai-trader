import React from 'react';
import { Button } from '@/components/ui/button';
import { Laptop } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';

const MT5_EA_CODE = `//+------------------------------------------------------------------+
//|                                    ForexTouchAI_Bridge_MT5.mq5 |
//|                                   ForexTouchAI Bridge EA (MT5) |
//+------------------------------------------------------------------+
#property copyright "ForexTouchAI"
#property version   "1.14"
#property strict

#include <Trade\\Trade.mqh>

#define EA_VERSION "1.14"

// --- INPUTS ---
input string AppUrl            = "https://forex-ai-trader-cc744e2a.base44.app";
input string ApiKey            = "";  // Paste your API Key from Settings page
input double FixedLotSize      = 0.01;
input int    MaxOpenTrades     = 5;
input int    MaxDailyTrades    = 0;       // 0 = unlimited
input double MaxSpreadPips     = 3.0;
input bool   EnableTrailingStop = false;
input double TrailingStopPips  = 20;
input double TrailingStartPips = 30;
input string TradingStartTime  = "00:00";
input string TradingEndTime    = "23:59";
input bool   CountAllTrades   = true;   // true = count ALL open trades (all EAs + manual); false = only this EA's trades
input int    MagicNumber      = 12345;
input string FilterByComment  = "";    // Only count trades with this exact comment (empty = use CountAllTrades/MagicNumber). e.g. "ForexTouchAI"
input string SymbolSuffix     = "";    // Broker symbol suffix (e.g. ".PRO", ".r", ".m"). Leave empty if your broker uses no suffix.

// --- GLOBALS ---
string Endpoint;
datetime LastSync   = 0;
string lastSignalId = "";
int    TradesToday  = 0;
MqlDateTime LastResetDate;
CTrade trade;

//+------------------------------------------------------------------+
int OnInit() {
   string url = AppUrl;
   StringTrimRight(url);
   StringTrimLeft(url);
   int len = StringLen(url);
   if(len > 0 && StringSubstr(url, len-1, 1) == "/")
      url = StringSubstr(url, 0, len-1);
   Endpoint = url + "/functions/bridge";
   trade.SetExpertMagicNumber(MagicNumber);
   // Live accounts reject orders if the fill mode doesn't match the broker's config.
   // IOC is the most widely supported; FOK is the CTrade default but many live brokers reject it.
   trade.SetTypeFilling(ORDER_FILLING_IOC);

   Print("===================================");
   Print("ForexTouchAI Bridge EA MT5 v", EA_VERSION, " (LATEST)");
   Print("===================================");
   Print("Endpoint: ", Endpoint);

   EventSetTimer(5);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) {
   EventKillTimer();
   Print("ForexTouchAI Bridge stopped.");
}

void OnTimer() {
   MqlDateTime now;
   TimeToStruct(TimeCurrent(), now);
   MqlDateTime last;
   TimeToStruct(LastSync, last);
   if(now.day != LastResetDate.day) {
      TradesToday = 0;
      TimeToStruct(TimeCurrent(), LastResetDate);
   }
   if(!IsWithinTradingHours()) return;
   if(EnableTrailingStop) ManageTrailingStops();
   string json = BuildJson();
   SendPost(json);
}

void OnTick() {}

//+------------------------------------------------------------------+
bool IsWithinTradingHours() {
   if(TradingStartTime == "" || TradingEndTime == "") return true;
   MqlDateTime t;
   TimeToStruct(TimeCurrent(), t);
   int cur  = t.hour * 100 + t.min;
   int sH   = (int)StringToInteger(StringSubstr(TradingStartTime, 0, 2));
   int sM   = (int)StringToInteger(StringSubstr(TradingStartTime, 3, 2));
   int eH   = (int)StringToInteger(StringSubstr(TradingEndTime, 0, 2));
   int eM   = (int)StringToInteger(StringSubstr(TradingEndTime, 3, 2));
   return (cur >= sH*100+sM && cur <= eH*100+eM);
}

//+------------------------------------------------------------------+
void ManageTrailingStops() {
   for(int i = PositionsTotal()-1; i >= 0; i--) {
      ulong ticket = PositionGetTicket(i);
      if(!PositionSelectByTicket(ticket)) continue;
      double openPrice = PositionGetDouble(POSITION_PRICE_OPEN);
      double sl        = PositionGetDouble(POSITION_SL);
      double tp        = PositionGetDouble(POSITION_TP);
      string sym       = PositionGetString(POSITION_SYMBOL);
      long   ptype     = PositionGetInteger(POSITION_TYPE);
      double point     = SymbolInfoDouble(sym, SYMBOL_POINT);
      int    digits    = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
      double trailDist  = TrailingStopPips * point * 10;
      double activeDist = TrailingStartPips * point * 10;

      if(ptype == POSITION_TYPE_BUY) {
         double bid = SymbolInfoDouble(sym, SYMBOL_BID);
         if(bid - openPrice >= activeDist) {
            double newSL = NormalizeDouble(bid - trailDist, digits);
            if(newSL > sl)
               trade.PositionModify(ticket, newSL, tp);
         }
      } else {
         double ask = SymbolInfoDouble(sym, SYMBOL_ASK);
         if(openPrice - ask >= activeDist) {
            double newSL = NormalizeDouble(ask + trailDist, digits);
            if(sl == 0 || newSL < sl)
               trade.PositionModify(ticket, newSL, tp);
         }
      }
   }
}

//+------------------------------------------------------------------+
string BuildJson() {
   long   acct     = AccountInfoInteger(ACCOUNT_LOGIN);
   string server   = AccountInfoString(ACCOUNT_SERVER);
   double balance  = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity   = AccountInfoDouble(ACCOUNT_EQUITY);
   double margin   = AccountInfoDouble(ACCOUNT_MARGIN);
   double freeMargin = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
   double marginLvl = (margin > 0) ? equity / margin * 100 : 0;

   string j = "{\\"account\\":{" +
      "\\"account_number\\":\\"" + IntegerToString(acct) + "\\"," +
      "\\"server_name\\":\\"" + server + "\\"," +
      "\\"platform\\":\\"MT5\\"," +
      "\\"balance\\":" + DoubleToString(balance, 2) + "," +
      "\\"equity\\":" + DoubleToString(equity, 2) + "," +
      "\\"margin\\":" + DoubleToString(margin, 2) + "," +
      "\\"free_margin\\":" + DoubleToString(freeMargin, 2) + "," +
      "\\"margin_level\\":" + DoubleToString(marginLvl, 2) +
      "},\\"trades\\":[";

   int total = PositionsTotal();
   for(int i = 0; i < total; i++) {
      ulong ticket = PositionGetTicket(i);
      if(!PositionSelectByTicket(ticket)) continue;
      if(i > 0) j += ",";
      long ptype = PositionGetInteger(POSITION_TYPE);
      j += "{\\"ticket\\":" + IntegerToString((long)ticket) +
           ",\\"symbol\\":\\"" + PositionGetString(POSITION_SYMBOL) + "\\"" +
           ",\\"type\\":\\"" + (ptype == POSITION_TYPE_BUY ? "BUY" : "SELL") + "\\"" +
           ",\\"pnl\\":" + DoubleToString(PositionGetDouble(POSITION_PROFIT), 2) + "}";
   }
   j += "]}";
   return j;
}

//+------------------------------------------------------------------+
void SendPost(string json) {
   char data[], res[];
   StringToCharArray(json, data, 0, StringLen(json));
   string headers = "Content-Type: application/json\\r\\nAuthorization: Bearer " + ApiKey + "\\r\\n";
   string resHeaders;
   ResetLastError();
   // 20s timeout: the bridge serializes accounts via a global lock (up to 15s wait) and
   // runs many DB calls per heartbeat. The old 5s limit made MT5 hang and return 1003/5203.
   int r = WebRequest("POST", Endpoint, headers, 20000, data, res, resHeaders);
   if(r == 200) {
      string response = CharArrayToString(res);
      ProcessPendingSignals(response);
      ProcessCloseCommands(response);
   } else {
      int err = GetLastError();
      Print("[BRIDGE MT5] HTTP: ", r, " Error: ", err);
      if(err == 5203 || err == 5200) {
         Print(">>> 1003/5203 = MT5 could not complete the request (timed out, or URL not whitelisted) <<<");
         Print("Check the OnInit 'Endpoint:' line = ", Endpoint);
         Print("1) Tools > Options > Expert Advisors > tick 'Allow WebRequest' and add: ", Endpoint, " (https, NO trailing slash)");
         Print("2) If already whitelisted, the server took >20s (bridge busy) — it auto-recovers next cycle.");
         Print("AppUrl input: ", AppUrl);
      }
   }
}

//+------------------------------------------------------------------+
void ProcessPendingSignals(string json) {
   int arrStart = StringFind(json, "\\"pending_signals\\"");
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
      string sigPair = GetJsonValue(obj, "pair");
      
      // Skip Gold/XAUUSD & Silver/XAGUSD signals — handled by dedicated EAs
      if(sigPair == "XAUUSD" || sigPair == "GOLD" || sigPair == "xauusd" || sigPair == "gold" ||
         sigPair == "XAGUSD" || sigPair == "SILVER" || sigPair == "xagusd" || sigPair == "silver") {
         Print("[BRIDGE MT5] Skipping ", sigPair, " signal — use dedicated Gold/Silver EA.");
         pos = objEnd + 1;
         continue;
      }
      
      ExecuteSignalObj(obj);
      pos = objEnd + 1;
   }
}

//+------------------------------------------------------------------+
void ExecuteSignalObj(string obj) {
   string id    = GetJsonValue(obj, "id");
   string pair  = GetJsonValue(obj, "pair");
   string type  = GetJsonValue(obj, "type");
   double sigEntry = StringToDouble(GetJsonValue(obj, "entry_price"));
   double sigSL    = StringToDouble(GetJsonValue(obj, "stop_loss"));
   double sigTP    = StringToDouble(GetJsonValue(obj, "take_profit"));
   double sigLot   = StringToDouble(GetJsonValue(obj, "lot_size"));
   string orderComment = GetJsonValue(obj, "comment");
   if(StringLen(orderComment) == 0) orderComment = "ForexTouchAI";

   if(StringLen(id) == 0 || StringLen(pair) == 0 || StringLen(type) == 0) return;
   if(id == lastSignalId) return;
   // Strip slash from pair for MT5 symbol lookup (e.g. EUR/USD -> EURUSD)
   string symbol = pair;
   int slashPos = StringFind(pair, "/");
   if(slashPos != -1)
      symbol = StringSubstr(pair, 0, slashPos) + StringSubstr(pair, slashPos + 1);
   // Append broker symbol suffix (e.g. EURUSD -> EURUSD.PRO) if not already present
   if(StringLen(SymbolSuffix) > 0 && StringFind(symbol, SymbolSuffix) < 0)
      symbol = symbol + SymbolSuffix;
   int myOpenCount = 0;
   if(StringLen(FilterByComment) > 0) {
      for(int ci = 0; ci < PositionsTotal(); ci++) {
         ulong ct = PositionGetTicket(ci);
         if(PositionSelectByTicket(ct) && PositionGetString(POSITION_COMMENT) == FilterByComment) myOpenCount++;
      }
   } else if(CountAllTrades) {
      myOpenCount = PositionsTotal();
   } else {
      for(int ci = 0; ci < PositionsTotal(); ci++) {
         ulong ct = PositionGetTicket(ci);
         if(PositionSelectByTicket(ct) && PositionGetInteger(POSITION_MAGIC) == MagicNumber) myOpenCount++;
      }
   }
   if(MaxOpenTrades > 0 && myOpenCount >= MaxOpenTrades) {
      Print("[BRIDGE MT5] Rejected: max open trades (", myOpenCount, "/", MaxOpenTrades, StringLen(FilterByComment) > 0 ? " [Comment:" + FilterByComment + "]" : (CountAllTrades ? " [ALL]" : " [EA-only]"), ")");
      return;
   }
   if(MaxDailyTrades > 0 && TradesToday >= MaxDailyTrades) {
      Print("[BRIDGE MT5] Rejected: daily trade limit");
      return;
   }

   bool isBuy = (type == "BUY");
   double price   = isBuy ? SymbolInfoDouble(symbol, SYMBOL_ASK) : SymbolInfoDouble(symbol, SYMBOL_BID);
   int    digits  = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   if(price == 0) {
      Print("[BRIDGE MT5] Cannot get price for ", symbol, " - add to Market Watch");
      return;
   }

   // --- Live-account safety checks (demo accounts skip these silently) ---
   // 1. Symbol trade mode: live brokers disable symbols outside market hours or by account type
   long tradeMode = SymbolInfoInteger(symbol, SYMBOL_TRADE_MODE);
   if(tradeMode == SYMBOL_TRADE_MODE_DISABLED) {
      Print("[BRIDGE MT5] REJECTED: Trading disabled for ", symbol, " on this account (check broker permissions / market hours)");
      return;
   }
   if(tradeMode == SYMBOL_TRADE_MODE_CLOSEONLY) {
      Print("[BRIDGE MT5] REJECTED: ", symbol, " is close-only on this account (cannot open new positions)");
      return;
   }

   // 2. Spread check — live spreads are wider and can breach MaxSpreadPips
   double spreadPts = SymbolInfoInteger(symbol, SYMBOL_SPREAD);
   double point     = SymbolInfoDouble(symbol, SYMBOL_POINT);
   double spreadPips = (point > 0) ? spreadPts * point * 10 : 0;
   if(MaxSpreadPips > 0 && spreadPips > MaxSpreadPips) {
      Print("[BRIDGE MT5] REJECTED: Spread ", DoubleToString(spreadPips, 1), " pips > MaxSpreadPips ", MaxSpreadPips, " for ", symbol);
      return;
   }

   // 3. Minimum stops level — live brokers enforce this; demo often has 0.
   //    If SL/TP is closer than the minimum, the order is rejected (Error 10016).
   long stopsLevel = SymbolInfoInteger(symbol, SYMBOL_TRADE_STOPS_LEVEL);
   double minStopDist = stopsLevel * point;

   double finalSL = 0, finalTP = 0;
   if(sigEntry > 0) {
      if(isBuy) {
         if(sigSL > 0) finalSL = NormalizeDouble(price - (sigEntry - sigSL), digits);
         if(sigTP > 0) finalTP = NormalizeDouble(price + (sigTP - sigEntry), digits);
      } else {
         if(sigSL > 0) finalSL = NormalizeDouble(price + (sigSL - sigEntry), digits);
         if(sigTP > 0) finalTP = NormalizeDouble(price - (sigEntry - sigTP), digits);
      }
   }

   // Enforce minimum stops distance on live accounts
   if(minStopDist > 0) {
      if(finalSL > 0) {
         if(isBuy && (price - finalSL) < minStopDist) finalSL = NormalizeDouble(price - minStopDist, digits);
         if(!isBuy && (finalSL - price) < minStopDist) finalSL = NormalizeDouble(price + minStopDist, digits);
      }
      if(finalTP > 0) {
         if(isBuy && (finalTP - price) < minStopDist) finalTP = NormalizeDouble(price + minStopDist, digits);
         if(!isBuy && (price - finalTP) < minStopDist) finalTP = NormalizeDouble(price - minStopDist, digits);
      }
   }

   // 4. Normalize lot size to broker's volume step (live accounts reject unnormalized lots)
   double minVol  = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
   double maxVol  = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
   double volStep = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
   double lot = (sigLot > 0) ? sigLot : FixedLotSize;
   if(volStep > 0) lot = MathFloor(lot / volStep) * volStep;
   if(lot < minVol) lot = minVol;
   if(lot > maxVol) lot = maxVol;
   lot = NormalizeDouble(lot, 2);

   Print("[BRIDGE MT5] Executing: ", type, " ", symbol, " Lot=", lot, " Price=", price, " SL=", finalSL, " TP=", finalTP, " StopsLevel=", stopsLevel, " SpreadPips=", DoubleToString(spreadPips, 1));

   bool ok = isBuy
      ? trade.Buy(lot, symbol, price, finalSL, finalTP, orderComment)
      : trade.Sell(lot, symbol, price, finalSL, finalTP, orderComment);

   if(ok) {
      Print("[BRIDGE MT5] Trade opened! Signal=", id, " RetCode=", trade.ResultRetcode());
      lastSignalId = id;
      TradesToday++;
   } else {
      Print("[BRIDGE MT5] OrderSend FAILED. RetCode=", trade.ResultRetcode(), " ", trade.ResultRetcodeDescription(), " Symbol=", symbol, " Lot=", lot, " Price=", price, " SL=", finalSL, " TP=", finalTP);
   }
}

//+------------------------------------------------------------------+
string GetJsonValue(string json, string key) {
   int keyPos = StringFind(json, "\\"" + key + "\\"");
   if(keyPos < 0) return "";
   int valStart = StringFind(json, ":", keyPos) + 1;
   int valEnd   = StringFind(json, ",", valStart);
   int braceEnd = StringFind(json, "}", valStart);
   if(valEnd < 0) valEnd = braceEnd;
   if(braceEnd > 0 && braceEnd < valEnd) valEnd = braceEnd;
   if(valEnd < 0) return "";
   string val = StringSubstr(json, valStart, valEnd - valStart);
   StringReplace(val, "\\"", "");
   StringReplace(val, " ", "");
   return val;
}

void ProcessCloseCommands(string json) {
   int arrStart = StringFind(json, "\\"close_commands\\"");
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
      ulong ticket = (ulong)StringToInteger(GetJsonValue(obj, "ticket"));
      if(ticket > 0) CloseTicket(ticket);
      pos = objEnd + 1;
   }
}

void CloseTicket(ulong ticket) {
   if(!PositionSelectByTicket(ticket)) {
      Print("[BRIDGE MT5] Close: ticket ", ticket, " not found (may already be closed)");
      return;
   }
   if(trade.PositionClose(ticket)) {
      Print("[BRIDGE MT5] Closed ticket ", ticket);
   } else {
      Print("[BRIDGE MT5] PositionClose FAILED ticket ", ticket, " RetCode=", trade.ResultRetcode());
   }
}
//+------------------------------------------------------------------+`;

const MT4_EA_CODE = `//+------------------------------------------------------------------+
//|                                      ForexTouchAI_Bridge_v3.mq4 |
//|                                     Copyright 2024, ForexTouchAI |
//|                                       https://www.forextouchai.com |
//+------------------------------------------------------------------+
#property copyright "Copyright 2024, ForexTouchAI"
#property link      "https://www.forextouchai.com"
#property version   "3.13"
#property strict

#define EA_VERSION "3.13"

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
   string headers = "Content-Type: application/json\\r\\n";
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
      Print("2. If already whitelisted, the server took >20s (bridge busy) — re-attach the EA to retry.");
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
   
   int startHour = StringToInteger(StringSubstr(TradingStartTime, 0, 2));
   int startMin = StringToInteger(StringSubstr(TradingStartTime, 3, 2));
   int startTime = startHour * 100 + startMin;
   
   int endHour = StringToInteger(StringSubstr(TradingEndTime, 0, 2));
   int endMin = StringToInteger(StringSubstr(TradingEndTime, 3, 2));
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
   string j = "{\\"account\\":{" + 
      "\\"account_number\\":\\"" + IntegerToString(AccountNumber()) + "\\"," +
      "\\"server_name\\":\\"" + AccountServer() + "\\"," +
      "\\"platform\\":\\"MT4\\"," +
      "\\"balance\\":" + DoubleToString(AccountBalance(), 2) + "," +
      "\\"equity\\":" + DoubleToString(AccountEquity(), 2) + "," +
      "\\"margin\\":" + DoubleToString(AccountMargin(), 2) + "," +
      "\\"free_margin\\":" + DoubleToString(AccountFreeMargin(), 2) + "," +
      "\\"margin_level\\":" + DoubleToString(AccountMargin() > 0 ? (AccountEquity() / AccountMargin() * 100) : 0, 2) + 
      "}, \\"trades\\":[";
      
   int count = 0;
   for(int i=0; i<OrdersTotal(); i++) {
      if(OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) {
         if(count > 0) j += ",";
         j += "{\\"ticket\\":" + IntegerToString(OrderTicket()) + 
              ",\\"symbol\\":\\"" + OrderSymbol() + "\\"" + 
              ",\\"type\\":\\"" + (OrderType()==OP_BUY ? "BUY" : "SELL") + "\\"" +
              ",\\"pnl\\":" + DoubleToString(OrderProfit(), 2) + "}";
         count++;
      }
   }
   j += "]}";
   return j;
}

//+------------------------------------------------------------------+
//| Network Functions                                                |
//+------------------------------------------------------------------+
void SendPost(string json) {
   char data[];
   StringToCharArray(json, data, 0, StringLen(json));
   char res[];
   string headers = "Content-Type: application/json\\r\\nAuthorization: Bearer " + ApiKey + "\\r\\n";
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
   int arrStart = StringFind(json, "\\"pending_signals\\"");
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
      
      // Skip Gold/XAUUSD & Silver/XAGUSD signals — handled by dedicated EAs
      if(sigPair == "XAUUSD" || sigPair == "GOLD" || sigPair == "xauusd" || sigPair == "gold" ||
         sigPair == "XAGUSD" || sigPair == "SILVER" || sigPair == "xagusd" || sigPair == "silver") {
         Print("[BRIDGE] Skipping ", sigPair, " signal — use dedicated Gold/Silver EA.");
         pos = objEnd + 1;
         continue;
      }
      
      ExecuteSignalObj(obj);
      
      pos = objEnd + 1;
   }
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
   // 1. Spread check — live spreads are wider and can breach MaxSpreadPips
   double spreadPts = MarketInfo(symbol, MODE_SPREAD);
   double point     = MarketInfo(symbol, MODE_POINT);
   double spreadPips = (point > 0) ? spreadPts * point * 10 : 0;
   if(MaxSpreadPips > 0 && spreadPips > MaxSpreadPips) {
      Print("[BRIDGE] REJECTED: Spread ", DoubleToString(spreadPips, 1), " pips > MaxSpreadPips ", MaxSpreadPips, " for ", symbol);
      return;
   }

   // 2. Minimum stops level — live brokers enforce this; demo often has 0.
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
   
   int ticket = OrderSend(symbol, cmd, finalLot, currentPrice, 20, displaySL, displayTP, orderComment, MagicNumber, 0, cmd == OP_BUY ? clrGreen : clrRed);
   
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
      Print("[BRIDGE] OrderSend FAILED. Error=", GetLastError(), " Pair=", pair, " Price=", currentPrice, " SL=", finalSL, " TP=", finalTP);
   }
}

void CheckSignals() { /* Signals now come from POST response - see ProcessPendingSignals */ }

//+------------------------------------------------------------------+
//| Process close_commands from bridge — flatten broker positions   |
//+------------------------------------------------------------------+
void ProcessCloseCommands(string json) {
   int arrStart = StringFind(json, "\\"close_commands\\"");
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
   int keyPos = StringFind(json, "\\"" + key + "\\"");
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
   StringReplace(val, "\\", "");
   StringReplace(val, " ", "");
   StringReplace(val, "\\n", "");
   StringReplace(val, "\\r", "");
   
   return val;
}
//+------------------------------------------------------------------+`;

export default function BridgeEADownload({ connectionStatus, user, handleRegenerateKey, isRegeneratingKey }) {
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
    <Card className="bg-slate-900/50 border-slate-800">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Laptop className="w-5 h-5 text-blue-400" /> Bridge EA Installation
        </CardTitle>
        <CardDescription className="text-slate-400">
          Required to sync Balance, Equity, and Live Trades from your terminal to this dashboard.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {connectionStatus === 'DISCONNECTED' && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mb-4">
            <div className="flex gap-3">
              <span className="text-amber-400 text-lg">⚠</span>
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-amber-300">Connection Status: DISCONNECTED</h4>
                <p className="text-xs text-amber-200/80">
                  The MT4/MT5 platform is not sending data. The EA must be running and properly configured.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* API Key Display */}
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <span className="text-amber-400 text-lg">🔑</span>
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-semibold text-amber-300 mb-1">Your EA API Key (Required)</h4>
              <p className="text-xs text-amber-200/70 mb-2">Paste this token into the <strong>ApiKey</strong> field when attaching the EA in MT4/MT5. This key is unique to your account.</p>
              {!user?.ea_api_key ? (
                <div className="space-y-2">
                  <p className="text-xs text-amber-300/80">No API key generated yet. Click below to create your unique key.</p>
                  <Button size="sm" onClick={handleRegenerateKey} disabled={isRegeneratingKey}
                    className="bg-amber-500/20 border border-amber-500/30 text-amber-300 hover:bg-amber-500/30">
                    {isRegeneratingKey ? 'Generating...' : '⚡ Generate My API Key'}
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-2 items-center">
                    <code className="flex-1 bg-slate-950 border border-slate-700 rounded px-3 py-2 text-xs text-emerald-400 font-mono break-all select-all">
                      {user.ea_api_key}
                    </code>
                    <Button size="sm" variant="outline" className="border-amber-500/30 text-amber-300 hover:bg-amber-500/10 shrink-0"
                      onClick={() => { navigator.clipboard.writeText(user.ea_api_key); toast.success('API Key copied!'); }}>
                      Copy
                    </Button>
                  </div>
                  <Button size="sm" variant="outline" onClick={handleRegenerateKey} disabled={isRegeneratingKey}
                    className="border-rose-500/30 text-rose-400 hover:bg-rose-500/10 text-xs">
                    {isRegeneratingKey ? 'Regenerating...' : '🔄 Regenerate Key (invalidates old key)'}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="bg-slate-950/50 p-4 rounded-lg border border-slate-800/50 space-y-3">
          <h4 className="text-sm font-medium text-slate-200">Setup Instructions:</h4>
          <ol className="list-decimal list-inside text-xs text-slate-400 space-y-2">
            <li>Download the <span className="text-blue-400">MT4 (.mq4)</span> or <span className="text-purple-400">MT5 (.mq5)</span> bridge file below depending on your platform.</li>
            <li><strong>MT4:</strong> File → Open Data Folder → MQL4 → Experts → paste .mq4 file there.<br/><strong>MT5:</strong> File → Open Data Folder → MQL5 → Experts → paste .mq5 file there.</li>
            <li>Right-click Navigator → Refresh. You should see "ForexTouchAI_Bridge" in Expert Advisors.</li>
            <li className="text-amber-400 font-medium">CRITICAL: Go to Tools &gt; Options &gt; Expert Advisors.</li>
            <li>Check <strong>"Allow WebRequest for listed URLs"</strong> and add BOTH URLs below to the list (some MT5 builds reject the request unless the full path is whitelisted — this is why your Gold/Silver EAs connect but the Bridge EA gets error 5203).</li>
            <li className="text-white font-mono bg-slate-900 p-1.5 mt-1 block text-center select-all rounded">https://forex-ai-trader-cc744e2a.base44.app</li>
            <li className="text-white font-mono bg-slate-900 p-1.5 mt-1 block text-center select-all rounded">https://forex-ai-trader-cc744e2a.base44.app/functions/bridge</li>
            <li className="text-amber-400 font-bold">Do NOT include a trailing slash "/" at the end of either URL.</li>
            <li>Drag the EA from Navigator onto ANY chart (only attach once).</li>
            <li className="text-amber-300 font-semibold">In the EA inputs, paste your <strong>API Key</strong> (shown above) into the <code>ApiKey</code> field.</li>
            <li className="text-cyan-300 font-semibold">If your broker uses a symbol suffix (e.g. IC Markets ".PRO", Pepperstone ".r"), enter it in the <code>SymbolSuffix</code> input (e.g. ".PRO"). Leave empty if your broker has no suffix.</li>
            <li className="text-emerald-300 font-semibold">Live accounts: The EA v1.14+ (MT5) / v3.13+ (MT4) automatically enforces your broker's minimum stop distance, spread limits, lot-step normalization, and IOC fill mode. If a trade is rejected, check the Experts tab log — the rejection reason (spread, stops level, trade mode) is printed in plain English.</li>
            <li>Click "Allow live trading" and "Allow DLL imports" when prompted.</li>
            <li className="text-emerald-400 font-medium">If setup is correct, you'll see "SUCCESS: Connected to server successfully" in the Experts tab.</li>
            <li><strong>Common Errors:</strong>
              <ul className="list-disc ml-6 mt-1 space-y-1">
                <li>Error 5203: URL not in allowed list</li>
                <li>Error -1: WebRequest disabled or URL has trailing slash</li>
                <li>No connection: EA not attached to chart or AutoTrading is off</li>
              </ul>
            </li>
          </ol>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex gap-2 ml-auto">
            <Button
              onClick={() => download(MT4_EA_CODE, "ForexTouchAI_Bridge_v3.13.mq4")}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              Download MT4 Bridge (.mq4) — v3.13
            </Button>
            <Button
              onClick={() => download(MT5_EA_CODE, "ForexTouchAI_Bridge_MT5_v1.14.mq5")}
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              Download MT5 Bridge (.mq5) — v1.14
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}