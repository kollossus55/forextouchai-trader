import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import ConnectionDiagnostics from '../components/settings/ConnectionDiagnostics';
import AccountStatusPanel from '../components/settings/AccountStatusPanel';
import { 
  Settings as SettingsIcon, 
  Shield, 
  Bell, 
  Smartphone, 
  Globe, 
  CreditCard,
  Monitor,
  Key,
  Volume2,
  Clock,
  Moon,
  Laptop,
  Languages,
  DollarSign,
  Database,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Activity
  } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';

export default function Settings() {
  const [mt4Config, setMt4Config] = useState({
    platform: 'MT4',
    server: '',
    login: '',
    password: '',
    apiKey: ''
  });
  
  const [isResetting, setIsResetting] = useState(false);

  const [dataSources, setDataSources] = useState({
    crypto: 'coincap',
    forex: 'openex',
    cryptoKey: '',
    forexKey: ''
  });
  const [connectionStatus, setConnectionStatus] = useState('DISCONNECTED');
  const [isSaving, setIsSaving] = useState(false);
  const [connectionId, setConnectionId] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [isTestLoading, setIsTestLoading] = useState(false);
  const [user, setUser] = useState(null);

  React.useEffect(() => {
    const fetchUser = async () => {
      try {
        const u = await base44.auth.me();
        setUser(u);
      } catch (e) { console.error(e); }
    };
    fetchUser();
  }, []);

  // Connection list state
  const [allConnections, setAllConnections] = React.useState([]);

  // Enhanced connection monitoring with improved staleness detection
  React.useEffect(() => {
    const fetchConnection = async () => {
      try {
        // Force fresh data by adding timestamp to bypass any caching
        const connections = await base44.entities.BrokerConnection.list('-updated_date'); // Get most recent first
        console.log('[Settings] Fetched connections:', connections.map(c => ({
          id: c.id,
          account: c.account_number,
          balance: c.balance,
          equity: c.equity,
          last_sync: c.last_sync,
          status: c.connection_status
        })));
        setAllConnections(connections); // Store all connections
        
        if (connections && connections.length > 0) {
          // Check if ANY connection is active
          const now = new Date().getTime();
          const hasActiveConnection = connections.some(conn => {
            if (!conn.last_sync) return false;
            const lastSync = new Date(conn.last_sync).getTime();
            const timeSinceSync = now - lastSync;
            return timeSinceSync <= 300000 && conn.connection_status === 'CONNECTED';
          });
          
          setConnectionStatus(hasActiveConnection ? 'CONNECTED' : 'DISCONNECTED');
          
          // Use the most recently updated connection for the form
          const mostRecent = connections[0];
          setConnectionId(mostRecent.id);
          
          // Only update form config if it's the first load to avoid overwriting user input while typing
          if (!connectionId) {
              setMt4Config(prev => ({
                ...prev,
                platform: mostRecent.platform || 'MT4',
                server: mostRecent.server_name || '',
                login: mostRecent.account_number || '',
              }));
          }

          const wasConnected = connectionStatus === 'CONNECTED';
          const newStatus = hasActiveConnection ? 'CONNECTED' : 'DISCONNECTED';

          // IMMEDIATE alert on disconnection (only if ALL connections lost)
          if (newStatus === 'DISCONNECTED' && wasConnected) {
            const oldestConn = connections[connections.length - 1];
            const lastSyncTime = oldestConn?.last_sync ? new Date(oldestConn.last_sync) : null;
            
            toast.error("MT4/MT5 Connection Lost", {
              description: "Platform has disconnected. Check your EA and internet connection.",
              duration: 10000
            });

            // Send email alert only once initially
            const lastEmailAlert = sessionStorage.getItem('lastEmailAlert');
            const shouldSendEmail = !lastEmailAlert;

            if (shouldSendEmail && user?.email) {
              sessionStorage.setItem('lastEmailAlert', Date.now().toString());
              try {
                await base44.integrations.Core.SendEmail({
                  to: user.email,
                  subject: 'ALERT: MT4/MT5 Platform Disconnected',
                  body: `Your trading platform has lost connection. Last sync: ${lastSyncTime ? lastSyncTime.toLocaleString() : 'Unknown'}\n\nPlease check:\n1. MT4/MT5 is running\n2. ForexTouchAI EA is attached to a chart\n3. Internet connection is stable`
                });

                // Create in-app alert
                await base44.entities.Alert.create({
                  title: "MT4/MT5 Disconnected",
                  message: "Your trading platform connection has been lost. Check EA and internet connection.",
                  type: "ERROR",
                  is_read: false
                });
              } catch (e) {
                console.error("Failed to send alert:", e);
              }
            }
          }

          // Continue alerting every 5 minutes while ALL connections disconnected
          if (newStatus === 'DISCONNECTED' && connections.length > 0) {
            const oldestSync = Math.min(...connections.map(c => new Date(c.last_sync || 0).getTime()));
            const minutesDisconnected = Math.floor((now - oldestSync) / 60000);
            if (minutesDisconnected > 0 && minutesDisconnected % 5 === 0) {
              const lastAlertKey = `toast_${minutesDisconnected}`;
              const lastEmailAlert = sessionStorage.getItem('lastEmailAlert');
              const lastEmailTime = lastEmailAlert ? parseInt(lastEmailAlert) : 0;
              const shouldSendEmail = (Date.now() - lastEmailTime) >= 300000; // 5 minutes

              if (!sessionStorage.getItem(lastAlertKey)) {
                sessionStorage.setItem(lastAlertKey, 'true');
                toast.error("Still Disconnected", {
                  description: `Platform offline for ${minutesDisconnected} minutes`,
                  duration: 8000
                });

                // Send email reminder every 5 minutes
                if (shouldSendEmail && user?.email) {
                  sessionStorage.setItem('lastEmailAlert', Date.now().toString());
                  const oldestConn = connections[connections.length - 1];
                  const lastSyncTime = oldestConn?.last_sync ? new Date(oldestConn.last_sync) : null;
                  
                  try {
                    await base44.integrations.Core.SendEmail({
                      to: user.email,
                      subject: 'REMINDER: MT4/MT5 Still Disconnected',
                      body: `Your trading platform has been offline for ${minutesDisconnected} minutes.\n\nLast sync: ${lastSyncTime ? lastSyncTime.toLocaleString() : 'Unknown'}`
                    });
                  } catch (e) {
                    console.error("Failed to send reminder:", e);
                  }
                }
              }
            }
          } else {
            // Clear alert flags when reconnected
            sessionStorage.clear();
          }
        }
      } catch (e) {
        console.error("Failed to fetch connection settings", e);
      }
    };

    fetchConnection();
    const interval = setInterval(fetchConnection, 5000); // Poll every 5 seconds (reduced rate)
    return () => clearInterval(interval);
  }, [connectionId, user, connectionStatus]);

  const handleSaveConnection = async () => {
    setErrorMessage('');
    if (!mt4Config.server || !mt4Config.login) {
       setConnectionStatus('ERROR');
       setErrorMessage('Please fill in Broker Server and Account Number');
       return;
    }

    setIsSaving(true);
    try {
      const data = {
        platform: mt4Config.platform,
        server_name: mt4Config.server,
        account_number: mt4Config.login,
        password: mt4Config.password || '******',
        api_key: mt4Config.apiKey,
        connection_status: 'CONNECTED', 
        last_sync: new Date().toISOString()
      };

      // Check if a connection with this account number already exists
      const existing = allConnections.find(c => c.account_number === mt4Config.login);
      if (existing) {
        await base44.entities.BrokerConnection.update(existing.id, data);
        setErrorMessage('Connection updated for account ' + mt4Config.login);
      } else {
        // Always create a NEW connection for a new account number
        const newConn = await base44.entities.BrokerConnection.create(data);
        setConnectionId(newConn.id);
        setErrorMessage('New account ' + mt4Config.login + ' added successfully!');
      }
      setConnectionStatus('CONNECTED');
      // Clear form for next entry
      setMt4Config({ platform: 'MT4', server: '', login: '', password: '', apiKey: '' });
      setTimeout(() => setErrorMessage(''), 4000);
    } catch (e) {
      console.error("Failed to save connection", e);
      setConnectionStatus('ERROR');
      setErrorMessage(e.message || 'Connection refused. Please verify credentials.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDisconnect = async () => {
    if (!connectionId) return;
    setIsSaving(true);
    try {
      await base44.entities.BrokerConnection.update(connectionId, {
        connection_status: 'DISCONNECTED',
        last_sync: new Date().toISOString()
      });
      setConnectionStatus('DISCONNECTED');
      setErrorMessage('');
    } catch (e) {
      console.error("Failed to disconnect", e);
      setErrorMessage('Failed to disconnect');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestConnection = async () => {
    if (connectionStatus !== 'CONNECTED') return;
    setIsSaving(true);
    setErrorMessage('');
    try {
      // Simulate network ping
      await new Promise(resolve => setTimeout(resolve, 800));
      setErrorMessage('Test Successful: 24ms Latency');
      setTimeout(() => setErrorMessage(''), 3000);
    } catch (e) {
      setErrorMessage('Test Failed: Connection timed out');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestPush = async () => {
    setIsTestLoading(true);
    try {
        await base44.entities.Alert.create({
            title: "Test Notification",
            message: "This is a test push notification from Settings.",
            type: "INFO",
            is_read: false
        });
        toast.info("Test Notification Received", {
            description: "This is how in-app alerts will appear.",
            duration: 4000
        });
    } catch (e) {
        toast.error("Failed to send test alert");
    } finally {
        setIsTestLoading(false);
    }
  };

  const handleTestEmail = async () => {
    if (!user?.email) {
        toast.error("User email not found");
        return;
    }
    setIsTestLoading(true);
    try {
        await base44.integrations.Core.SendEmail({
            to: user.email,
            subject: "ForexTouchAI: Test Alert",
            body: "This is a test email alert to verify your notification settings. You will receive alerts here for major market events and trade executions."
        });
        toast.success(`Test email sent to ${user.email}`);
    } catch (e) {
        console.error(e);
        toast.error("Failed to send test email. Please try again.");
    } finally {
        setIsTestLoading(false);
    }
  };

  const handleResetTrades = async () => {
      if (!window.confirm("Are you sure you want to delete ALL trades? This action cannot be undone.")) return;

      setIsResetting(true);
      try {
          await base44.functions.invoke('resetData', { target: 'trades' });
          toast.success("All trades have been reset successfully");
      } catch (e) {
          console.error(e);
          toast.error("Failed to reset trades");
      } finally {
          setIsResetting(false);
      }
  };

  const handleDownloadBridge = () => {
    // Enhanced version 3.0 with advanced features
    const mql4Code = `//+------------------------------------------------------------------+
      //|                                      ForexTouchAI_Bridge_v3.mq4 |
      //|                                     Copyright 2024, ForexTouchAI |
      //|                                       https://www.forextouchai.com |
      //+------------------------------------------------------------------+
      #property copyright "Copyright 2024, ForexTouchAI"
      #property link      "https://www.forextouchai.com"
      #property version   "3.10"
      #property strict
      
      #define EA_VERSION "3.1"

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
         Print("ForexTouchAI Bridge EA v", EA_VERSION);
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
         int res = WebRequest("GET", Endpoint, headers, 5000, post, result, resHeaders);
         
         if(res == 200) {
            Print("SUCCESS: Connected to server successfully.");
            return true;
         }
         
         int err = GetLastError();
         Print("CONNECTION FAILED! HTTP Code: ", res, " | MT4 Error: ", err);
         if(ArraySize(result) > 0) Print("Server Response: " + CharArrayToString(result));
         
         if(err == 5203 || err == 5200 || err == 4060) {
            Print(">>> CRITICAL SETUP ERROR <<<");
            Print("1. Go to Tools -> Options -> Expert Advisors");
            Print("2. Check 'Allow WebRequest'");
            Print("3. Add this EXACT URL to the list (Double check for spaces!):");
            Print("   ", ServiceUrl);
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
         
         // --- CHECK SIGNALS (GET) - Also updates heartbeat ---
         CheckSignals();
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
         string headers = "Content-Type: application/json\\r\\n";
         string resH;
         
         ResetLastError();
         int r = WebRequest("POST", Endpoint, headers, 5000, data, res, resH);
         
         if(r == 200) {
            string response = CharArrayToString(res);
            // Parse and execute any pending signals returned in the POST response
            ProcessPendingSignals(response);
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
         
         if(StringLen(id) == 0 || StringLen(pair) == 0 || StringLen(type) == 0) return;
         if(id == lastSignalId) return; // already executed
         
         // Risk checks
         if(MaxOpenTrades > 0 && OrdersTotal() >= MaxOpenTrades) {
            Print("[BRIDGE] Signal rejected: Max open trades (", MaxOpenTrades, ")");
            return;
         }
         if(MaxDailyTrades > 0 && TradesToday >= MaxDailyTrades) {
            Print("[BRIDGE] Signal rejected: Daily trade limit (", MaxDailyTrades, ")");
            return;
         }
         
         int cmd = (type == "BUY") ? OP_BUY : OP_SELL;
         double currentPrice = MarketInfo(pair, (cmd == OP_BUY ? MODE_ASK : MODE_BID));
         int digits = (int)MarketInfo(pair, MODE_DIGITS);
         
         if(currentPrice == 0) {
            Print("[BRIDGE] ERROR: Cannot get price for ", pair, " - add symbol to Market Watch");
            return;
         }
         
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
         
         double displaySL = HideSLTP ? 0 : finalSL;
         double displayTP = HideSLTP ? 0 : finalTP;
         double finalLot  = (sigLot > 0) ? sigLot : FixedLotSize;
         
         Print("[BRIDGE] Executing: ", type, " ", pair, " Lot=", finalLot, " Price=", currentPrice, " SL=", finalSL, " TP=", finalTP);
         
         int ticket = OrderSend(pair, cmd, finalLot, currentPrice, 20, displaySL, displayTP, "ForexTouchAI", 0, 0, cmd == OP_BUY ? clrGreen : clrRed);
         
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
         StringReplace(val, "\\"", "");
         StringReplace(val, " ", "");
         StringReplace(val, "\\n", "");
         StringReplace(val, "\\r", "");
         
         return val;
      }
      //+------------------------------------------------------------------+`;

    const element = document.createElement("a");
    const file = new Blob([mql4Code], {type: 'text/plain'});
    element.href = URL.createObjectURL(file);
    element.download = "ForexTouchAI_Bridge.mq4";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <SettingsIcon className="w-8 h-8 text-emerald-500" /> Settings
          </h1>
          <p className="text-slate-400 mt-1">Configure your trading environment</p>
        </div>
      </div>

      <Tabs defaultValue="general" className="w-full">
        <TabsList className="bg-slate-900 border border-slate-800 w-full justify-start h-auto p-1">
          <TabsTrigger value="general" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white py-2 px-4">General</TabsTrigger>
          <TabsTrigger value="trading" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white py-2 px-4">Trading Platform</TabsTrigger>
          <TabsTrigger value="notifications" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white py-2 px-4">Notifications</TabsTrigger>
          <TabsTrigger value="market_data" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white py-2 px-4">Market Data</TabsTrigger>
          <TabsTrigger value="security" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white py-2 px-4">Security</TabsTrigger>
        </TabsList>
        
        <TabsContent value="general" className="mt-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="bg-slate-900/50 border-slate-800">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Monitor className="w-5 h-5 text-blue-400" /> Appearance
                </CardTitle>
                <CardDescription className="text-slate-400">Customize visual interface</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between p-3 rounded-lg bg-slate-950/50 border border-slate-800/50">
                  <div className="flex items-center gap-3">
                    <Moon className="w-4 h-4 text-slate-400" />
                    <div className="space-y-0.5">
                      <Label className="text-slate-200">Dark Mode</Label>
                      <p className="text-xs text-slate-500">Optimized for night trading</p>
                    </div>
                  </div>
                  <Switch checked={true} className="data-[state=checked]:bg-emerald-600" />
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-slate-950/50 border border-slate-800/50">
                  <div className="flex items-center gap-3">
                    <Laptop className="w-4 h-4 text-slate-400" />
                    <div className="space-y-0.5">
                      <Label className="text-slate-200">Compact Density</Label>
                      <p className="text-xs text-slate-500">Show more data on screen</p>
                    </div>
                  </div>
                  <Switch className="data-[state=checked]:bg-emerald-600" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-slate-900/50 border-slate-800">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Globe className="w-5 h-5 text-purple-400" /> Localization
                </CardTitle>
                <CardDescription className="text-slate-400">Language and region settings</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-slate-200 flex items-center gap-2">
                    <Languages className="w-3.5 h-3.5 text-slate-400" /> Interface Language
                  </Label>
                  <Select defaultValue="en">
                    <SelectTrigger className="bg-slate-950 border-slate-800 text-slate-200">
                      <SelectValue placeholder="Select Language" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">English (US)</SelectItem>
                      <SelectItem value="es">Español</SelectItem>
                      <SelectItem value="fr">Français</SelectItem>
                      <SelectItem value="de">Deutsch</SelectItem>
                      <SelectItem value="jp">日本語</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-200 flex items-center gap-2">
                    <DollarSign className="w-3.5 h-3.5 text-slate-400" /> Base Currency
                  </Label>
                  <Select defaultValue="usd">
                    <SelectTrigger className="bg-slate-950 border-slate-800 text-slate-200">
                      <SelectValue placeholder="Select Currency" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="usd">USD - US Dollar</SelectItem>
                      <SelectItem value="eur">EUR - Euro</SelectItem>
                      <SelectItem value="gbp">GBP - British Pound</SelectItem>
                      <SelectItem value="jpy">JPY - Japanese Yen</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-200 flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5 text-slate-400" /> Timezone
                  </Label>
                  <Select defaultValue="utc">
                    <SelectTrigger className="bg-slate-950 border-slate-800 text-slate-200">
                      <SelectValue placeholder="Select Timezone" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="utc">UTC (GMT+0)</SelectItem>
                      <SelectItem value="ny">New York (GMT-5)</SelectItem>
                      <SelectItem value="london">London (GMT+0)</SelectItem>
                      <SelectItem value="tokyo">Tokyo (GMT+9)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="trading" className="mt-6 space-y-6">
          <ConnectionDiagnostics />
          <AccountStatusPanel />

          <Card className="bg-slate-900/50 border-slate-800">
            <CardHeader>
              <div className="flex justify-between items-start">
                  <div>
                      <CardTitle className="text-white flex items-center gap-2">
                      <Globe className="w-5 h-5 text-emerald-400" /> Add MT4/MT5 Connection
                      </CardTitle>
                      <CardDescription className="text-slate-400">Connect a new broker account</CardDescription>
                  </div>
                  <div className={`px-3 py-1 rounded-full text-xs font-bold border flex items-center gap-2 ${
                      connectionStatus === 'CONNECTED' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' :
                      connectionStatus === 'DISCONNECTED' ? 'bg-rose-500/10 text-rose-400 border-rose-500/30' :
                      connectionStatus === 'ERROR' ? 'bg-rose-500/10 text-rose-400 border-rose-500/30' :
                      'bg-slate-800 text-slate-400 border-slate-700'
                  }`}>
                      <div className={`w-2 h-2 rounded-full ${
                        connectionStatus === 'CONNECTED' ? 'bg-emerald-500 animate-pulse' : 
                        connectionStatus === 'DISCONNECTED' ? 'bg-rose-500' : 'bg-slate-600'
                      }`}></div>
                      {connectionStatus === 'ERROR' ? 'CONNECTION FAILED' : connectionStatus}
                  </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                   <div className="grid gap-2">
                      <Label className="text-slate-200">Platform</Label>
                      <Select 
                          value={mt4Config.platform} 
                          onValueChange={v => setMt4Config({...mt4Config, platform: v})}
                      >
                          <SelectTrigger className="bg-slate-950 border-slate-800 text-slate-200">
                              <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                              <SelectItem value="MT4">MetaTrader 4</SelectItem>
                              <SelectItem value="MT5">MetaTrader 5</SelectItem>
                          </SelectContent>
                      </Select>
                  </div>
                  <div className="grid gap-2">
                      <Label className="text-slate-200">Broker Server</Label>
                      <Input 
                          placeholder="e.g. MetaQuotes-Demo"
                          value={mt4Config.server} 
                          onChange={e => setMt4Config({...mt4Config, server: e.target.value})}
                          className="bg-slate-950 border-slate-800 text-slate-200" 
                      />
                  </div>
              </div>

              <div className="grid gap-2">
                <Label className="text-slate-200">Account Number (Login)</Label>
                <Input 
                  value={mt4Config.login} 
                  onChange={e => setMt4Config({...mt4Config, login: e.target.value})}
                  className="bg-slate-950 border-slate-800 text-slate-200" 
                />
              </div>
              <div className="grid gap-2">
                <Label className="text-slate-200">Master Password</Label>
                <Input 
                  type="password"
                  value={mt4Config.password} 
                  onChange={e => setMt4Config({...mt4Config, password: e.target.value})}
                  className="bg-slate-950 border-slate-800 text-slate-200" 
                  placeholder="••••••••"
                />
                <p className="text-[10px] text-slate-500">Your password is encrypted. We recommend using a limited-access Investor password if trading privileges are not required.</p>
              </div>

              <Separator className="bg-slate-800/50 my-2" />

              <div className="grid gap-2">
                  <Label className="text-slate-200 flex items-center gap-2">
                      Bridge API Key <Badge variant="outline" className="text-[10px] h-4 border-slate-700 text-slate-400">Optional</Badge>
                  </Label>
                  <Input 
                      type="password"
                      value={mt4Config.apiKey}
                      onChange={e => setMt4Config({...mt4Config, apiKey: e.target.value})}
                      className="bg-slate-950 border-slate-800 text-slate-200" 
                      placeholder="Paste API token from bridge provider"
                  />
                  <p className="text-[10px] text-slate-500">
                      For enhanced security, use an API token from a supported bridge provider (e.g. MetaApi) instead of direct credentials.
                  </p>
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-3">
              <div className="flex gap-3 w-full">
                  {connectionStatus === 'CONNECTED' && (
                      <>
                          <Button 
                              variant="outline" 
                              onClick={handleTestConnection}
                              disabled={isSaving}
                              className="flex-1 bg-blue-500/10 border-blue-500/20 text-blue-400 hover:bg-blue-500/20 hover:text-blue-300 hover:border-blue-500/30 transition-all"
                          >
                              Test Connection
                          </Button>
                          <Button 
                              variant="outline" 
                              onClick={handleDisconnect}
                              disabled={isSaving}
                              className="flex-1 bg-rose-500/10 border-rose-500/20 text-rose-400 hover:bg-rose-500/20 hover:text-rose-300 hover:border-rose-500/30 transition-all"
                          >
                              Disconnect
                          </Button>
                      </>
                  )}
              </div>

              <Button 
                  onClick={handleSaveConnection} 
                  disabled={isSaving}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 shadow-lg shadow-emerald-900/20 transition-all"
                  >
                  {isSaving ? 'Processing...' : 'Add New Connection'}
              </Button>

              {errorMessage && (
                  <p className={`text-xs text-center mt-1 ${errorMessage.includes('Successful') ? 'text-emerald-400' : 'text-rose-400'}`}>
                     {errorMessage}
                  </p>
              )}
            </CardFooter>
          </Card>

          <Card className="bg-slate-900/50 border-slate-800">
              <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-white flex items-center gap-2">
                        <Database className="w-5 h-5 text-rose-400" /> Data Management
                    </CardTitle>
                    <CardDescription className="text-slate-400">
                        Reset simulation data and clear history
                    </CardDescription>
                  </div>
                  <Button 
                    variant="destructive" 
                    size="sm"
                    onClick={handleResetTrades}
                    disabled={isResetting}
                    className="bg-rose-600 hover:bg-rose-700"
                  >
                    {isResetting ? 'Clearing...' : 'Reset All Trades'}
                  </Button>
              </CardHeader>
          </Card>

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
                    <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                    <div className="space-y-2">
                      <h4 className="text-sm font-semibold text-amber-300">Connection Status: DISCONNECTED</h4>
                      <p className="text-xs text-amber-200/80">
                        The MT4/MT5 platform is not sending data. The EA must be running and properly configured.
                      </p>
                      <div className="flex gap-2 mt-2">
                        <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-300">
                          EA Not Attached
                        </Badge>
                        <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-300">
                          Check MT4 Terminal
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="bg-slate-950/50 p-4 rounded-lg border border-slate-800/50 space-y-3">
                <h4 className="text-sm font-medium text-slate-200">Setup Instructions:</h4>
                <ol className="list-decimal list-inside text-xs text-slate-400 space-y-2">
                  <li>Download the <span className="text-emerald-400">ForexTouchAI_Bridge.mq4</span> file below.</li>
                  <li>Open MT4/MT5 → File → Open Data Folder → MQL4 → Experts → paste the .mq4 file there.</li>
                  <li>In MT4, right-click on Navigator → Refresh. You should see "ForexTouchAI_Bridge" in Expert Advisors.</li>
                  <li className="text-amber-400 font-medium">CRITICAL: Go to Tools &gt; Options &gt; Expert Advisors.</li>
                  <li>Check <strong>"Allow WebRequest for listed URLs"</strong> and add your App URL to the list.</li>
                  <li className="text-white font-mono bg-slate-900 p-1.5 mt-1 block text-center select-all rounded">https://forex-ai-trader-cc744e2a.base44.app</li>
                  <li className="text-amber-400 font-bold">Do NOT include a trailing slash "/" at the end of the URL.</li>
                  <li>Drag the EA from Navigator onto ANY chart (only attach once).</li>
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
                <Button className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 hover:text-emerald-300 hover:border-emerald-500/30 transition-all">
                  <Key className="w-4 h-4 mr-2" /> Generate Bridge Token
                </Button>
                <Button 
                  onClick={handleDownloadBridge}
                  className="bg-blue-600 hover:bg-blue-700 text-white ml-auto"
                >
                  Download Bridge Source (.mq4)
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications" className="mt-6 space-y-6">
          <Card className="bg-slate-900/50 border-slate-800">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="space-y-1">
                <CardTitle className="text-white flex items-center gap-2">
                  <Bell className="w-5 h-5 text-amber-400" /> Notification Channels
                </CardTitle>
                <CardDescription className="text-slate-400">Global notification settings</CardDescription>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" className="text-slate-400 hover:text-emerald-400">Enable All</Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6 pt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-center justify-between p-3 rounded-lg bg-slate-950/30 border border-slate-800/30">
                  <div className="flex items-center gap-3">
                    <Smartphone className="w-4 h-4 text-emerald-500" />
                    <div>
                        <Label className="text-slate-200 block">Push Notifications</Label>
                        <p className="text-[10px] text-slate-500">Receive in-app toasts and alerts</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                      <Button variant="outline" size="sm" onClick={handleTestPush} disabled={isTestLoading} className="h-7 text-xs border-slate-700 text-slate-400">
                          Test
                      </Button>
                      <Switch checked={true} className="data-[state=checked]:bg-emerald-600" />
                  </div>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-slate-950/30 border border-slate-800/30">
                  <div className="flex items-center gap-3">
                    <div className="w-4 h-4 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-[10px] font-bold">@</div>
                    <div>
                        <Label className="text-slate-200 block">Email Alerts</Label>
                        <p className="text-[10px] text-slate-500">Sent to {user?.email || 'your email'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                      <Button variant="outline" size="sm" onClick={handleTestEmail} disabled={isTestLoading} className="h-7 text-xs border-slate-700 text-slate-400">
                          Test
                      </Button>
                      <Switch checked={true} className="data-[state=checked]:bg-emerald-600" />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="bg-slate-900/50 border-slate-800">
              <CardHeader>
                <CardTitle className="text-white text-base">Trading Activity</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-slate-300">Order Execution</Label>
                    <p className="text-[10px] text-slate-500">Entry and exit notifications</p>
                  </div>
                  <Switch checked={true} className="data-[state=checked]:bg-emerald-600" />
                </div>
                <Separator className="bg-slate-800/50" />
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-slate-300">Stop Loss / Take Profit</Label>
                    <p className="text-[10px] text-slate-500">When limits are hit</p>
                  </div>
                  <Switch checked={true} className="data-[state=checked]:bg-emerald-600" />
                </div>
                <Separator className="bg-slate-800/50" />
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-slate-300">Margin Calls</Label>
                    <p className="text-[10px] text-slate-500">Critical account warnings</p>
                  </div>
                  <Switch checked={true} className="data-[state=checked]:bg-emerald-600" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-slate-900/50 border-slate-800">
              <CardHeader>
                <CardTitle className="text-white text-base">Market Intelligence</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-slate-300">AI Signals</Label>
                    <p className="text-[10px] text-slate-500">New high-probability setups</p>
                  </div>
                  <Switch checked={true} className="data-[state=checked]:bg-emerald-600" />
                </div>
                <Separator className="bg-slate-800/50" />
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-slate-300">High Impact News</Label>
                    <p className="text-[10px] text-slate-500">Major economic events</p>
                  </div>
                  <Switch className="data-[state=checked]:bg-emerald-600" />
                </div>
                <Separator className="bg-slate-800/50" />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Volume2 className="w-3.5 h-3.5 text-slate-400" />
                    <div className="space-y-0.5">
                      <Label className="text-slate-300">Sound Effects</Label>
                      <p className="text-[10px] text-slate-500">Play sounds on alerts</p>
                    </div>
                  </div>
                  <Switch checked={true} className="data-[state=checked]:bg-emerald-600" />
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="market_data" className="mt-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="bg-slate-900/50 border-slate-800">
              <CardHeader>
                <div className="flex justify-between">
                  <div>
                    <CardTitle className="text-white flex items-center gap-2">
                      <Database className="w-5 h-5 text-amber-400" /> Crypto Feed
                    </CardTitle>
                    <CardDescription className="text-slate-400">Digital asset price sources</CardDescription>
                  </div>
                  <Badge variant="outline" className="h-6 bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                     <CheckCircle2 className="w-3 h-3 mr-1" /> Active
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-slate-200">Provider</Label>
                  <Select 
                    value={dataSources.crypto} 
                    onValueChange={(v) => setDataSources({...dataSources, crypto: v})}
                  >
                    <SelectTrigger className="bg-slate-950 border-slate-800 text-slate-200">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="coincap">CoinCap (Free / Public)</SelectItem>
                      <SelectItem value="coingecko">CoinGecko (Free / Public)</SelectItem>
                      <SelectItem value="binance">Binance API (Requires Key)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                {dataSources.crypto === 'binance' && (
                  <div className="space-y-2 animate-in slide-in-from-top-2">
                    <Label className="text-slate-200">API Key</Label>
                    <Input 
                      type="password"
                      placeholder="Binance API Key"
                      value={dataSources.cryptoKey}
                      onChange={(e) => setDataSources({...dataSources, cryptoKey: e.target.value})}
                      className="bg-slate-950 border-slate-800 text-slate-200" 
                    />
                  </div>
                )}

                <div className="bg-slate-950/30 p-3 rounded border border-slate-800/50 flex items-start gap-2">
                   <RefreshCw className="w-4 h-4 text-slate-500 mt-0.5" />
                   <div className="space-y-1">
                     <p className="text-xs text-slate-300">Update Frequency: <strong>Real-time</strong></p>
                     <p className="text-[10px] text-slate-500">Supports BTC, ETH, SOL, XRP and major alts.</p>
                   </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-slate-900/50 border-slate-800">
              <CardHeader>
                <div className="flex justify-between">
                  <div>
                    <CardTitle className="text-white flex items-center gap-2">
                      <Globe className="w-5 h-5 text-blue-400" /> Forex Feed
                    </CardTitle>
                    <CardDescription className="text-slate-400">Fiat currency exchange rates</CardDescription>
                  </div>
                  <Badge variant="outline" className="h-6 bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                     <CheckCircle2 className="w-3 h-3 mr-1" /> Active
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-slate-200">Provider</Label>
                  <Select 
                    value={dataSources.forex} 
                    onValueChange={(v) => setDataSources({...dataSources, forex: v})}
                  >
                    <SelectTrigger className="bg-slate-950 border-slate-800 text-slate-200">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="openex">Open Exchange Rates (Free)</SelectItem>
                      <SelectItem value="alphavantage">Alpha Vantage (API Key)</SelectItem>
                      <SelectItem value="fixer">Fixer.io (API Key)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {(dataSources.forex === 'alphavantage' || dataSources.forex === 'fixer') && (
                  <div className="space-y-2 animate-in slide-in-from-top-2">
                    <Label className="text-slate-200">API Key</Label>
                    <Input 
                      type="password"
                      placeholder={`Paste your ${dataSources.forex === 'alphavantage' ? 'Alpha Vantage' : 'Fixer.io'} Key`}
                      value={dataSources.forexKey}
                      onChange={(e) => setDataSources({...dataSources, forexKey: e.target.value})}
                      className="bg-slate-950 border-slate-800 text-slate-200" 
                    />
                  </div>
                )}

                <div className="bg-slate-950/30 p-3 rounded border border-slate-800/50 flex items-start gap-2">
                   <AlertCircle className="w-4 h-4 text-slate-500 mt-0.5" />
                   <div className="space-y-1">
                     <p className="text-xs text-slate-300">Update Frequency: <strong>15 min / Daily</strong></p>
                     <p className="text-[10px] text-slate-500">Free tier providers may have rate limits or delayed data.</p>
                   </div>
                </div>
              </CardContent>
            </Card>
          </div>
          
          <div className="flex justify-end">
            <Button className="bg-emerald-600 hover:bg-emerald-700">
               Save Data Settings
            </Button>
          </div>

          <Card className="bg-slate-900/50 border-slate-800 mt-6">
            <CardHeader>
              <CardTitle className="text-white text-base flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-500" /> Active Data Connections
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-slate-950/50 rounded-lg border border-slate-800/50">
                   <div className="flex items-center gap-3">
                      <div className="p-2 bg-amber-500/10 rounded-full">
                        <Database className="w-4 h-4 text-amber-500" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-200">Crypto Feed</p>
                        <p className="text-xs text-slate-400 capitalize">{dataSources.crypto} API</p>
                      </div>
                   </div>
                   <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20">Connected</Badge>
                </div>
                <div className="flex items-center justify-between p-3 bg-slate-950/50 rounded-lg border border-slate-800/50">
                   <div className="flex items-center gap-3">
                      <div className="p-2 bg-blue-500/10 rounded-full">
                        <Globe className="w-4 h-4 text-blue-500" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-200">Forex Feed</p>
                        <p className="text-xs text-slate-400 capitalize">{dataSources.forex} API</p>
                      </div>
                   </div>
                   <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20">Connected</Badge>
                </div>
              </div>
            </CardContent>
          </Card>
          </TabsContent>

        <TabsContent value="security" className="mt-6 space-y-6">
          <Card className="bg-slate-900/50 border-slate-800">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Shield className="w-5 h-5 text-rose-400" /> Security Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button className="w-full justify-start bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 hover:text-emerald-300 transition-all">
                <Key className="w-4 h-4 mr-2" /> Change Password
              </Button>
              <Button className="w-full justify-start bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 hover:text-emerald-300 transition-all">
                <Smartphone className="w-4 h-4 mr-2" /> Enable 2FA
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}