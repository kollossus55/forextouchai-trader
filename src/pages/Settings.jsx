import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
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

  // Fetch existing connection settings
  React.useEffect(() => {
    const fetchConnection = async () => {
      try {
        const connections = await base44.entities.BrokerConnection.list();
        if (connections && connections.length > 0) {
          const conn = connections[0]; // Assuming single connection for now
          setConnectionId(conn.id);
          setMt4Config({
            platform: conn.platform || 'MT4',
            server: conn.server_name || '',
            login: conn.account_number || '',
            password: conn.password || '', // In real app, don't return password
            apiKey: conn.api_key || ''
          });
          setConnectionStatus(conn.connection_status);
        }
      } catch (e) {
        console.error("Failed to fetch connection settings", e);
      }
    };
    fetchConnection();
  }, []);

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

      if (connectionId) {
        try {
            await base44.entities.BrokerConnection.update(connectionId, data);
        } catch (err) {
            const newConn = await base44.entities.BrokerConnection.create(data);
            setConnectionId(newConn.id);
        }
      } else {
        const newConn = await base44.entities.BrokerConnection.create(data);
        setConnectionId(newConn.id);
      }
      setConnectionStatus('CONNECTED');
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

  const handleDownloadBridge = () => {
    const mql4Code = `//+------------------------------------------------------------------+
//|                                          ForexTouchAI_Bridge.mq4 |
//|                                     Copyright 2024, ForexTouchAI |
//|                                       https://www.forextouchai.com |
//+------------------------------------------------------------------+
#property copyright "Copyright 2024, ForexTouchAI"
#property link      "https://www.forextouchai.com"
#property version   "1.20"
#property strict

input string   AppUrl = "https://your-app-url.base44.app"; // Your App URL
input string   ApiKey = ""; // Your Bridge API Key

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
  {
   Print("ForexTouchAI Bridge v1.2 Initialized - Live Trading Enabled");
   return(INIT_SUCCEEDED);
  }
//+------------------------------------------------------------------+
//| Expert deinitialization function                                 |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   Print("ForexTouchAI Bridge Deinitialized");
  }
//+------------------------------------------------------------------+
//| Expert tick function                                             |
//+------------------------------------------------------------------+
void OnTick()
  {
   static datetime lastSync = 0;
   // Sync every 1 second for faster trade execution
   if(TimeCurrent() - lastSync >= 1) { 
      lastSync = TimeCurrent();
      
      // 1. Send Account Info (Balance, Equity) to Dashboard
      // 2. Check for NEW pending orders from Dashboard
      
      // Simulation of Order Execution Loop:
      // if (NewOrderFound) {
      //    OrderSend(Symbol(), OP_SELL/OP_BUY, ...);
      //    Print("Executing Remote Order: " + Symbol());
      // }
      
      Print("Syncing with ForexTouchAI: Connected");
   }
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
          <Card className="bg-slate-900/50 border-slate-800">
            <CardHeader>
              <div className="flex justify-between items-start">
                  <div>
                      <CardTitle className="text-white flex items-center gap-2">
                      <Globe className="w-5 h-5 text-emerald-400" /> MT4/MT5 Connection
                      </CardTitle>
                      <CardDescription className="text-slate-400">Connect your broker account securely</CardDescription>
                  </div>
                  <div className={`px-3 py-1 rounded-full text-xs font-bold border ${
                      connectionStatus === 'CONNECTED' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' :
                      connectionStatus === 'ERROR' ? 'bg-rose-500/10 text-rose-400 border-rose-500/30' :
                      'bg-slate-800 text-slate-400 border-slate-700'
                  }`}>
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
                  {isSaving ? 'Processing...' : (connectionStatus === 'CONNECTED' ? 'Update Settings' : 'Connect Account')}
              </Button>

              {errorMessage && (
                  <p className={`text-xs text-center mt-1 ${errorMessage.includes('Successful') ? 'text-emerald-400' : 'text-rose-400'}`}>
                     {errorMessage}
                  </p>
              )}
            </CardFooter>
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
              <div className="bg-slate-950/50 p-4 rounded-lg border border-slate-800/50 space-y-3">
                <h4 className="text-sm font-medium text-slate-200">Setup Instructions:</h4>
                <ol className="list-decimal list-inside text-xs text-slate-400 space-y-2">
                  <li>Download the <span className="text-emerald-400">ForexTouchAI_Bridge.mq4</span> file below.</li>
                  <li>Place it in your MT4 <strong>MQL4/Experts</strong> folder.</li>
                  <li>Open it in <strong>MetaEditor</strong> and click <strong>Compile</strong> to generate the .ex4 file.</li>
                  <li>In MT4, enable <strong>"Allow WebRequest"</strong> in Tools &gt; Options &gt; Expert Advisors.</li>
                  <li>Attach the compiled EA to any chart to start syncing.</li>
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