//+------------------------------------------------------------------+
//|                                    ForexTouchAI_Bridge_MT5.mq5 |
//|                                   ForexTouchAI Bridge EA (MT5) |
//+------------------------------------------------------------------+
#property copyright "ForexTouchAI"
#property version   "1.16"
#property strict

#include <Trade\\Trade.mqh>

#define EA_VERSION "1.16"

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

// --- v1.17: candle upload (REQUIRED by the app's v2 signal engine) ---
input bool   UploadCandles     = true;   // Send broker OHLC to the app
input string TrackedSymbols    = "";     // Comma list of pairs to send prices+candles for, e.g. "EURUSD,GBPUSD,USDJPY". Empty = chart symbol only. LIST YOUR BOT'S PAIRS HERE.
input int    BarsToUpload      = 400;    // Bars per timeframe (needs >=210 for EMA200)
input string CandleTimeframes  = "H1,H4,D1"; // Must include your bot's timeframe + one above
input int    CandleUploadMins  = 15;     // Minutes between candle uploads
input int    OrderRetries      = 3;      // Retries on requote / off-quotes

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
      // `point * 10` assumes a 3- or 5-digit broker. On a 4-digit (or 2-digit
      // JPY) feed a pip IS one point, so that expression made the trailing stop
      // ten times wider than configured — a 20-pip trail became 200.
      double pipSize    = point * ((digits == 3 || digits == 5) ? 10.0 : 1.0);
      double trailDist  = TrailingStopPips * pipSize;
      double activeDist = TrailingStartPips * pipSize;

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

   string j = "{\"account\":{" +
      "\"account_number\":\"" + IntegerToString(acct) + "\"," +
      "\"server_name\":\"" + server + "\"," +
      "\"platform\":\"MT5\"," +
      "\"balance\":" + DoubleToString(balance, 2) + "," +
      "\"equity\":" + DoubleToString(equity, 2) + "," +
      "\"margin\":" + DoubleToString(margin, 2) + "," +
      "\"free_margin\":" + DoubleToString(freeMargin, 2) + "," +
      "\"margin_level\":" + DoubleToString(marginLvl, 2) +
      "},\"trades\":[";

   int total = PositionsTotal();
   // The old code used `if(i > 0) j += ","`, keyed on the LOOP index rather than
   // on how many entries had actually been written. If position 0 failed to
   // select and position 1 succeeded, it emitted `[,{...}]` — invalid JSON, and
   // the bridge would reject the whole heartbeat. Track emitted count instead.
   int emitted = 0;
   for(int i = 0; i < total; i++) {
      ulong ticket = PositionGetTicket(i);
      if(!PositionSelectByTicket(ticket)) continue;
      if(emitted > 0) j += ",";
      emitted++;
      long ptype = PositionGetInteger(POSITION_TYPE);
      j += "{\"ticket\":" + IntegerToString((long)ticket) +
           ",\"symbol\":\"" + PositionGetString(POSITION_SYMBOL) + "\"" +
           ",\"type\":\"" + (ptype == POSITION_TYPE_BUY ? "BUY" : "SELL") + "\"" +
           ",\"pnl\":" + DoubleToString(PositionGetDouble(POSITION_PROFIT), 2) + "}";
   }
   j += "]";

   // v1.17: broker bid/ask so the app has live prices, and broker OHLC so it
   // can compute real indicators. v1.15 sent neither, so the backend had no
   // price data of its own from this EA at all.
   j += BuildPricesJson();
   j += BuildCandlePayload();

   j += "}";
   return j;
}

//+------------------------------------------------------------------+
void SendPost(string json) {
   char data[], res[];
   StringToCharArray(json, data, 0, StringLen(json));
   string headers = "Content-Type: application/json\r\nAuthorization: Bearer " + ApiKey + "\r\n";
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
   int arrStart = StringFind(json, "\"pending_signals\"");
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
   // Resolve the broker's actual symbol name — tries bare+suffix first, then bare.
   // This handles indices/metals that don't carry the same suffix as forex pairs
   // (e.g. forex uses ".PRO" but indices are plain "UK100" with no suffix).
   string resolved = ResolveSymbol(symbol);
   if(StringLen(resolved) > 0)
      symbol = resolved;
   else if(StringLen(SymbolSuffix) > 0 && StringFind(symbol, SymbolSuffix) < 0)
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
   double spreadPts = (double)SymbolInfoInteger(symbol, SYMBOL_SPREAD);
   double point     = SymbolInfoDouble(symbol, SYMBOL_POINT);
   // FIXED. SYMBOL_SPREAD already returns the spread IN POINTS. The old
   // expression `spreadPts * point * 10` gave 15 * 0.00001 * 10 = 0.0015 for a
   // 1.5-pip EURUSD spread, compared against MaxSpreadPips 3.0 — so it was
   // never once exceeded and this filter had NEVER rejected a trade. The bot
   // entered through news spikes and the Sunday open without complaint.
   // A pip is 10 points on 3- and 5-digit symbols, 1 point otherwise.
   double pipPoints  = ((digits == 3 || digits == 5) ? 10.0 : 1.0);
   double spreadPips = spreadPts / pipPoints;
   if(MaxSpreadPips > 0 && !IsCryptoSymbol(symbol) && spreadPips > MaxSpreadPips) {
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

   // Retry transient rejections. Previously a single requote or off-quote
   // dropped the signal entirely — and because the bridge had already marked it
   // ACTIVE, it would not be re-dispatched for 20 minutes. Fill rates suffered
   // most in exactly the fast markets the bot is trying to trade.
   bool ok = false;
   uint retcode = 0;
   for(int attempt = 0; attempt < MathMax(1, OrderRetries) && !ok; attempt++) {
      if(attempt > 0) {
         Sleep(400);
         MqlTick tk;
         if(!SymbolInfoTick(symbol, tk)) break;
         price = isBuy ? tk.ask : tk.bid;
         if(price <= 0) break;
      }
      ok = isBuy
         ? trade.Buy(lot, symbol, price, finalSL, finalTP, orderComment)
         : trade.Sell(lot, symbol, price, finalSL, finalTP, orderComment);
      if(!ok) {
         retcode = trade.ResultRetcode();
         if(retcode != TRADE_RETCODE_REQUOTE &&
            retcode != TRADE_RETCODE_PRICE_CHANGED &&
            retcode != TRADE_RETCODE_PRICE_OFF) break;
         Print("[BRIDGE MT5] Order attempt ", attempt + 1, " failed (", retcode, ") - retrying");
      }
   }

   if(ok) {
      Print("[BRIDGE MT5] Trade opened! Signal=", id, " RetCode=", trade.ResultRetcode());
      lastSignalId = id;
      TradesToday++;
      // v1.17: actually tell the app. v1.15 never called confirmExecution at
      // all, so the signal stayed ACTIVE until the reconcile loop happened to
      // notice the new ticket — or until it silently expired.
      ConfirmExecution(id, (long)trade.ResultOrder(), symbol, type, lot, price);
   } else {
      Print("[BRIDGE MT5] Order FAILED after ", OrderRetries, " attempt(s). RetCode=", retcode,
            " ", trade.ResultRetcodeDescription(), " Symbol=", symbol, " Lot=", lot,
            " Price=", price, " SL=", finalSL, " TP=", finalTP,
            " SpreadPips=", DoubleToString(spreadPips, 1));
      ReportExecutionFailure(id, symbol, (int)retcode);
   }
}

//+------------------------------------------------------------------+
string GetJsonValue(string json, string key) {
   int keyPos = StringFind(json, "\"" + key + "\"");
   if(keyPos < 0) return "";
   int valStart = StringFind(json, ":", keyPos) + 1;
   int valEnd   = StringFind(json, ",", valStart);
   int braceEnd = StringFind(json, "}", valStart);
   if(valEnd < 0) valEnd = braceEnd;
   if(braceEnd > 0 && braceEnd < valEnd) valEnd = braceEnd;
   if(valEnd < 0) return "";
   string val = StringSubstr(json, valStart, valEnd - valStart);
   StringReplace(val, "\"", "");
   StringReplace(val, " ", "");
   return val;
}

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
//+------------------------------------------------------------------+

//+------------------------------------------------------------------+
//| v1.17 additions                                                  |
//+------------------------------------------------------------------+

// Resolve the broker's actual symbol name for a bare pair, applying
// SymbolSuffix. Returns "" if the symbol is not tradeable on this account.
string ResolveSymbol(string bare) {
   string candidate = bare + SymbolSuffix;
   if(SymbolInfoInteger(candidate, SYMBOL_SELECT) || SymbolSelect(candidate, true))
      return candidate;
   if(SymbolInfoInteger(bare, SYMBOL_SELECT) || SymbolSelect(bare, true))
      return bare;
   return "";
}

// Strip the broker suffix so the app stores one canonical series per pair.
string BareSymbol(string brokerSymbol) {
   string out = brokerSymbol;
   if(StringLen(SymbolSuffix) > 0) {
      int pos = StringFind(out, SymbolSuffix);
      if(pos > 0) out = StringSubstr(out, 0, pos);
   }
   int dot = StringFind(out, ".");
   if(dot > 0) out = StringSubstr(out, 0, dot);
   StringToUpper(out);
   return out;
}

// Which symbols this EA reports on. Defaults to the chart symbol; set
// TrackedSymbols to your bot's pair list so the app gets candles for all of
// them from one attached EA.
int GetTrackedSymbols(string &out[]) {
   string list = TrackedSymbols;
   StringTrimLeft(list); StringTrimRight(list);
   if(StringLen(list) == 0) {
      ArrayResize(out, 1);
      out[0] = Symbol();
      return 1;
    }
   string parts[];
   int n = StringSplit(list, ',', parts);
   int count = 0;
   ArrayResize(out, n);
   for(int i = 0; i < n; i++) {
      string bare = parts[i];
      StringTrimLeft(bare); StringTrimRight(bare);
      if(StringLen(bare) == 0) continue;
      StringToUpper(bare);
      string resolved = ResolveSymbol(bare);
      if(StringLen(resolved) == 0) {
         Print("[BRIDGE MT5] TrackedSymbols: '", bare, "' not available on this account - skipped");
         continue;
      }
      out[count] = resolved;
      count++;
   }
   ArrayResize(out, count);
   return count;
}

//+------------------------------------------------------------------+
//| Live bid/ask for tracked symbols                                 |
//+------------------------------------------------------------------+
string BuildPricesJson() {
   string syms[];
   int n = GetTrackedSymbols(syms);
   if(n <= 0) return "";

   string entries = "";
   for(int i = 0; i < n; i++) {
      MqlTick tk;
      if(!SymbolInfoTick(syms[i], tk)) continue;
      if(tk.bid <= 0) continue;
      int dg = (int)SymbolInfoInteger(syms[i], SYMBOL_DIGITS);
      if(StringLen(entries) > 0) entries += ",";
      entries += "{\"symbol\":\"" + BareSymbol(syms[i]) + "\"" +
                 ",\"bid\":" + DoubleToString(tk.bid, dg) +
                 ",\"ask\":" + DoubleToString(tk.ask, dg) + "}";
   }
   if(StringLen(entries) == 0) return "";
   return ",\"prices\":[" + entries + "]";
}

//+------------------------------------------------------------------+
//| Upload broker OHLC so the app can compute real indicators        |
//+------------------------------------------------------------------+
// This is the single most important addition. The app's v2 signal engine
// computes every indicator from candles; without an upload it falls back to
// Yahoo Finance, which is delayed, unofficial, and quotes prices your broker
// never traded at.
datetime lastCandleUpload = 0;

ENUM_TIMEFRAMES TfNameToPeriod(string tf) {
   if(tf == "M5")  return PERIOD_M5;
   if(tf == "M15") return PERIOD_M15;
   if(tf == "M30") return PERIOD_M30;
   if(tf == "H1")  return PERIOD_H1;
   if(tf == "H4")  return PERIOD_H4;
   if(tf == "D1")  return PERIOD_D1;
   if(tf == "W1")  return PERIOD_W1;
   return PERIOD_CURRENT;
}

string BuildCandleJson(string brokerSymbol, string tfName) {
   ENUM_TIMEFRAMES period = TfNameToPeriod(tfName);
   if(period == PERIOD_CURRENT) return "";

   MqlRates rates[];
   ArraySetAsSeries(rates, true);
   // One extra bar requested: index 0 is the CURRENT, still-open candle and is
   // dropped below. Indicators computed on an open bar repaint.
   int copied = CopyRates(brokerSymbol, period, 0, BarsToUpload + 1, rates);
   if(copied < 61) {
      Print("[BRIDGE MT5] ", brokerSymbol, " ", tfName, ": only ", copied,
            " bars available. Open that chart once so MT5 downloads history, or raise ",
            "Tools > Options > Charts > Max bars in chart.");
      return "";
   }

   int dg = (int)SymbolInfoInteger(brokerSymbol, SYMBOL_DIGITS);
   string bars = "";
   // rates[] is series-ordered (0 = newest). Walk DOWN from the oldest index to
   // 1 so bars are emitted oldest-first, skipping the forming bar at index 0.
   for(int i = copied - 1; i >= 1; i--) {
      if(StringLen(bars) > 0) bars += ",";
      bars += "{\"t\":" + IntegerToString((long)rates[i].time) +
              ",\"o\":" + DoubleToString(rates[i].open,  dg) +
              ",\"h\":" + DoubleToString(rates[i].high,  dg) +
              ",\"l\":" + DoubleToString(rates[i].low,   dg) +
              ",\"c\":" + DoubleToString(rates[i].close, dg) +
              ",\"v\":" + IntegerToString((long)rates[i].tick_volume) + "}";
   }
   if(StringLen(bars) == 0) return "";

   return "{\"symbol\":\"" + BareSymbol(brokerSymbol) + "\",\"timeframe\":\"" + tfName +
          "\",\"bars\":[" + bars + "]}";
}

string BuildCandlePayload() {
   if(!UploadCandles) return "";
   if(TimeCurrent() - lastCandleUpload < CandleUploadMins * 60) return "";

   string syms[];
   int symCount = GetTrackedSymbols(syms);
   if(symCount <= 0) return "";

   string tfs[];
   int tfCount = StringSplit(CandleTimeframes, ',', tfs);
   if(tfCount <= 0) return "";

   string entries = "";
   for(int a = 0; a < symCount; a++) {
      for(int b = 0; b < tfCount; b++) {
         string tf = tfs[b];
         StringTrimLeft(tf); StringTrimRight(tf);
         if(StringLen(tf) == 0) continue;
         string entry = BuildCandleJson(syms[a], tf);
         if(StringLen(entry) == 0) continue;
         if(StringLen(entries) > 0) entries += ",";
         entries += entry;
      }
   }
   if(StringLen(entries) == 0) return "";

   lastCandleUpload = TimeCurrent();
   Print("[BRIDGE MT5] Uploading candles for ", symCount, " symbol(s) x ", CandleTimeframes);
   return ",\"candles\":[" + entries + "]";
}

//+------------------------------------------------------------------+
//| Tell the app a signal executed                                   |
//+------------------------------------------------------------------+
void ConfirmExecution(string signalId, long ticket, string symbol, string type, double lots, double price) {
   if(StringLen(signalId) == 0) return;
   int dg = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   string payload = "{\"signal_id\":\"" + signalId + "\"" +
                    ",\"ticket\":" + IntegerToString(ticket) +
                    ",\"pair\":\"" + BareSymbol(symbol) + "\"" +
                    ",\"type\":\"" + type + "\"" +
                    ",\"lot_size\":" + DoubleToString(lots, 2) +
                    ",\"open_price\":" + DoubleToString(price, dg) +
                    ",\"account_number\":\"" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "\"}";
   PostToFunction("confirmExecution", payload);
}

//+------------------------------------------------------------------+
//| Report a failed execution so the signal returns to PENDING       |
//+------------------------------------------------------------------+
void ReportExecutionFailure(string signalId, string symbol, int errorCode) {
   if(StringLen(signalId) == 0) return;
   string payload = "{\"signal_id\":\"" + signalId + "\"" +
                    ",\"account_number\":\"" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "\"" +
                    ",\"symbol\":\"" + BareSymbol(symbol) + "\"" +
                    ",\"status\":\"FAILED\"" +
                    ",\"error_code\":" + IntegerToString(errorCode) + "}";
   PostToFunction("confirmExecution", payload);
}

// Endpoint is built in OnInit as AppUrl + "/functions/bridge", so sibling
// functions are derived from AppUrl rather than hardcoded anywhere.
void PostToFunction(string fnName, string payload) {
   string url = AppUrl;
   StringTrimRight(url); StringTrimLeft(url);
   int len = StringLen(url);
   if(len > 0 && StringSubstr(url, len - 1, 1) == "/") url = StringSubstr(url, 0, len - 1);
   url = url + "/functions/" + fnName;

   char data[], res[];
   string resHeaders;
   StringToCharArray(payload, data, 0, StringLen(payload));
   string headers = "Content-Type: application/json\r\nAuthorization: Bearer " + ApiKey + "\r\n";
   ResetLastError();
   int r = WebRequest("POST", url, headers, 10000, data, res, resHeaders);
   if(r < 0)
      Print("[BRIDGE MT5] ", fnName, " failed: ", GetLastError(),
            " - is ", url, " whitelisted in Tools > Options > Expert Advisors?");
}
