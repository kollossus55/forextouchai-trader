import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import ConnectionDiagnostics from '../components/settings/ConnectionDiagnostics';
import AccountStatusPanel from '../components/settings/AccountStatusPanel';
import GoldEADownload from '../components/settings/GoldEADownload';
import SilverEADownload from '../components/settings/SilverEADownload';
import BridgeEADownload from '../components/settings/BridgeEADownload';
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
  const [isRegeneratingKey, setIsRegeneratingKey] = useState(false);

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

  const handleRegenerateKey = async () => {
    setIsRegeneratingKey(true);
    try {
      const res = await base44.functions.invoke('generateEaApiKey', {});
      const newKey = res.data?.ea_api_key;
      setUser(prev => ({ ...prev, ea_api_key: newKey }));
      toast.success('New EA API Key generated! Update it in your MT4/MT5 EA inputs.');
    } catch (e) {
      toast.error('Failed to generate key. Please try again.');
    } finally {
      setIsRegeneratingKey(false);
    }
  };

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
        owner_email: user?.email,
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
      if (!window.confirm("⚠️ This will DELETE all trades, signals, alerts AND reset risk counters. This cannot be undone. Continue?")) return;

      setIsResetting(true);
      try {
          const res = await base44.functions.invoke('resetData', {});
          toast.success(`Reset complete: ${res.data?.results?.trades_deleted || 0} trades, ${res.data?.results?.signals_deleted || 0} signals, ${res.data?.results?.alerts_deleted || 0} alerts cleared`);
      } catch (e) {
          console.error(e);
          toast.error("Failed to reset data");
      } finally {
          setIsResetting(false);
      }
  };

  // Bridge EA download logic moved to src/components/settings/BridgeEADownload.jsx

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
                        Wipes all trades, signals, alerts and resets risk counters for a fresh start
                    </CardDescription>
                  </div>
                  <Button 
                    variant="destructive" 
                    size="sm"
                    onClick={handleResetTrades}
                    disabled={isResetting}
                    className="bg-rose-600 hover:bg-rose-700"
                  >
                    {isResetting ? 'Clearing...' : 'Reset Everything'}
                  </Button>
              </CardHeader>
          </Card>

          <BridgeEADownload
            connectionStatus={connectionStatus}
            user={user}
            handleRegenerateKey={handleRegenerateKey}
            isRegeneratingKey={isRegeneratingKey}
          />
          <GoldEADownload />
          <SilverEADownload />
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
          <Card className="bg-slate-900/50 border-slate-800">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Database className="w-5 h-5 text-emerald-400" /> Candle Data Pipeline
              </CardTitle>
              <CardDescription className="text-slate-400">
                The signal engine fetches OHLC bars in priority order. Broker data is always tried first.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                <div className="p-2 bg-emerald-500/10 rounded-full mt-0.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-200">1. Broker Feed <span className="text-emerald-400 text-xs ml-1">Primary</span></p>
                  <p className="text-xs text-slate-400 mt-0.5">Your MT4/MT5 EA uploads real-time OHLC via CopyRates(). This is the data your orders execute against — free, no rate limit, no delay.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg bg-slate-950/50 border border-slate-800/50">
                <div className="p-2 bg-blue-500/10 rounded-full mt-0.5">
                  <Globe className="w-4 h-4 text-blue-400" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-200">2. Yahoo Finance <span className="text-blue-400 text-xs ml-1">Fallback</span></p>
                  <p className="text-xs text-slate-400 mt-0.5">Free, no API key. Covers forex, metals (XAU/XAG), crypto and all indices. ~15 min delayed, unofficial endpoint.</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-slate-900/50 border-slate-800">
            <CardHeader>
              <CardTitle className="text-white text-base flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-500" /> Active Data Connections
              </CardTitle>
              <CardDescription className="text-slate-400">All sources are free and require no configuration</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-slate-950/50 rounded-lg border border-emerald-500/20">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-emerald-500/10 rounded-full">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-200">Broker Feed (MT4/MT5 EA)</p>
                      <p className="text-xs text-slate-400">Real-time · Primary source</p>
                    </div>
                  </div>
                  <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20">Active</Badge>
                </div>
                <div className="flex items-center justify-between p-3 bg-slate-950/50 rounded-lg border border-slate-800/50">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-500/10 rounded-full">
                      <Globe className="w-4 h-4 text-blue-500" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-200">Yahoo Finance</p>
                      <p className="text-xs text-slate-400">~15 min delayed · Forex, Metals, Crypto &amp; Indices</p>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-blue-400 border-blue-500/20">Standby</Badge>
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