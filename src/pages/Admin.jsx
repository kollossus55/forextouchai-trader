import React, { useState, useEffect } from 'react';
import { appParams } from '@/lib/app-params';
import { 
  Shield, 
  Server, 
  Activity, 
  Database, 
  Cpu,
  Users,
  Mail,
  UserCog,
  Webhook,
  Copy,
  CheckCheck,
  Key,
  RefreshCw,
  Eye,
  EyeOff,
  Bell,
  BellOff,
  Trash2,
  Loader2
} from 'lucide-react';
import useSignalNotifications from '@/hooks/useSignalNotifications';
import RiskManagementPanel from '@/components/autotrade/RiskManagementPanel';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

function WebhookInfoCard() {
  const [copied, setCopied] = useState(null);
  const appId = appParams.appId || 'YOUR_APP_ID';
  const webhookUrl = `https://api.base44.app/api/apps/${appId}/functions/injectSignal`;

  const copy = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const CopyBtn = ({ text, id }) => (
    <button onClick={() => copy(text, id)} className="ml-2 text-slate-500 hover:text-emerald-400 transition-colors">
      {copied === id ? <CheckCheck className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );

  return (
    <Card className="bg-slate-900/50 border-slate-800">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Webhook className="w-5 h-5 text-amber-400" /> 3rd Party Signal Webhook
        </CardTitle>
        <CardDescription className="text-slate-400">Use these details to connect external signal providers</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Webhook URL */}
        <div className="bg-slate-950/60 rounded-lg p-4 border border-slate-800">
          <p className="text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wide">Webhook URL</p>
          <div className="flex items-center">
            <code className="text-emerald-400 text-sm font-mono break-all">{webhookUrl}</code>
            <CopyBtn text={webhookUrl} id="url" />
          </div>
        </div>

        {/* Auth */}
        <div className="bg-slate-950/60 rounded-lg p-4 border border-slate-800">
          <p className="text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wide">Auth Method</p>
          <p className="text-slate-300 text-sm">API Key in JSON body — field name: <code className="text-amber-400 bg-slate-800 px-1.5 py-0.5 rounded text-xs">api_key</code></p>
          <p className="text-xs text-slate-500 mt-1">Use the same API key from your MT4 EA / Broker Connection settings</p>
        </div>

        {/* Payload */}
        <div className="bg-slate-950/60 rounded-lg p-4 border border-slate-800">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide">JSON Payload</p>
            <CopyBtn text={`{\n  "api_key": "YOUR_EA_API_KEY",\n  "pair": "EURUSD",\n  "type": "BUY",\n  "entry_price": 1.08500,\n  "stop_loss": 1.08200,\n  "take_profit": 1.09000,\n  "lot_size": 0.10,\n  "account_number": "123456",\n  "comment": "Signal provider name"\n}`} id="payload" />
          </div>
          <pre className="text-xs text-slate-300 font-mono leading-relaxed">{`{
  "api_key":        "YOUR_EA_API_KEY",   // required
  "pair":           "EURUSD",            // required
  "type":           "BUY",              // required: BUY | SELL
  "entry_price":    1.08500,             // required
  "stop_loss":      1.08200,             // optional
  "take_profit":    1.09000,             // optional
  "lot_size":       0.10,                // optional, default 0.10
  "account_number": "123456",            // optional
  "comment":        "Signal provider"   // optional
}`}</pre>
        </div>

        {/* Quick info row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Method', value: 'POST' },
            { label: 'Format', value: 'JSON' },
            { label: 'Confidence Filter', value: 'None (all accepted)' },
            { label: 'Rate Limit', value: 'No hard limit' },
          ].map(item => (
            <div key={item.label} className="bg-slate-950/40 rounded-lg p-3 border border-slate-800/50">
              <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">{item.label}</p>
              <p className="text-sm text-slate-300 font-medium">{item.value}</p>
            </div>
          ))}
        </div>

        {/* EA API Key display */}
        <EaApiKeySection />

        <p className="text-xs text-slate-500">
          ⚡ Signals appear immediately in <span className="text-slate-400">Admin Overview → Manual Trade Diagnostics</span> and are dispatched to MT4 on the next bridge heartbeat.
        </p>
      </CardContent>
    </Card>
  );
}

function EaApiKeySection() {
  const [apiKey, setApiKey] = useState(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    base44.auth.me().then(u => {
      setApiKey(u?.ea_api_key || null);
      setLoading(false);
    });
  }, []);

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      const res = await base44.functions.invoke('generateEaApiKey', {});
      setApiKey(res.data.ea_api_key);
      setRevealed(true);
    } finally {
      setRegenerating(false);
    }
  };

  const handleCopy = () => {
    if (!apiKey) return;
    navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const maskedKey = apiKey
    ? `${apiKey.slice(0, 7)}${'•'.repeat(apiKey.length - 11)}${apiKey.slice(-4)}`
    : null;

  return (
    <div className="bg-slate-950/60 rounded-lg p-4 border border-amber-500/20">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide flex items-center gap-1.5">
          <Key className="w-3.5 h-3.5 text-amber-400" /> Your EA API Key
        </p>
        <button
          onClick={handleRegenerate}
          disabled={regenerating}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-amber-400 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${regenerating ? 'animate-spin' : ''}`} />
          {regenerating ? 'Regenerating…' : 'Regenerate'}
        </button>
      </div>

      {loading ? (
        <p className="text-slate-500 text-sm">Loading…</p>
      ) : apiKey ? (
        <div className="flex items-center gap-2">
          <code className="flex-1 text-emerald-400 text-sm font-mono bg-slate-900 rounded px-3 py-2 border border-slate-800 break-all">
            {revealed ? apiKey : maskedKey}
          </code>
          <button onClick={() => setRevealed(v => !v)} className="text-slate-500 hover:text-slate-300 transition-colors flex-shrink-0">
            {revealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
          <button onClick={handleCopy} className="text-slate-500 hover:text-emerald-400 transition-colors flex-shrink-0">
            {copied ? <CheckCheck className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <p className="text-slate-500 text-sm">No key generated yet.</p>
          <button
            onClick={handleRegenerate}
            disabled={regenerating}
            className="text-xs text-amber-400 hover:underline disabled:opacity-50"
          >
            Generate now
          </button>
        </div>
      )}
      <p className="text-xs text-slate-600 mt-2">Use this exact key as <code className="text-amber-400/80">api_key</code> in your webhook payload. Regenerating invalidates the old key immediately.</p>
    </div>
  );
}

export default function Admin() {
  const [currentUser, setCurrentUser] = useState(null);
  const [notifEnabled, setNotifEnabled] = useState(true);
  const [notifPermission, setNotifPermission] = useState('Notification' in window ? Notification.permission : 'unsupported');
  const [deletingId, setDeletingId] = useState(null);
  const queryClient = useQueryClient();

  const handleDeleteUser = async (user) => {
    setDeletingId(user.id);
    try {
      await base44.entities.User.delete(user.id);
      toast.success(`User deleted`, { description: user.email });
      queryClient.invalidateQueries({ queryKey: ['all-users'] });
    } catch (e) {
      toast.error('Failed to delete user', { description: e.message });
    } finally {
      setDeletingId(null);
    }
  };

  // Re-check permission on focus AND poll every 2s to catch browser setting changes
  useEffect(() => {
    if (!('Notification' in window)) return;
    const checkPermission = () => setNotifPermission(Notification.permission);
    window.addEventListener('focus', checkPermission);
    const interval = setInterval(checkPermission, 2000);
    return () => {
      window.removeEventListener('focus', checkPermission);
      clearInterval(interval);
    };
  }, []);

  useSignalNotifications({ enabled: notifEnabled });

  const requestNotifPermission = async () => {
    if (!('Notification' in window)) return;
    const perm = await Notification.requestPermission();
    setNotifPermission(perm);
  };

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const user = await base44.auth.me();
        setCurrentUser(user);
      } catch (e) {
        console.error("Failed to fetch user", e);
      }
    };
    fetchUser();
  }, []);

  const { data: allUsers = [] } = useQuery({
    queryKey: ['all-users'],
    queryFn: () => base44.entities.User.list('-created_date'),
    enabled: currentUser?.role === 'admin',
    initialData: []
  });

  const { data: brokerConnections = [] } = useQuery({
    queryKey: ['all-broker-connections'],
    queryFn: () => base44.entities.BrokerConnection.list('-created_date'),
    enabled: currentUser?.role === 'admin',
    initialData: []
  });

  if (currentUser?.role !== 'admin') {
    return (
      <div className="max-w-7xl mx-auto space-y-6 flex items-center justify-center min-h-[60vh]">
        <Card className="bg-slate-900/50 border-slate-800 p-8 text-center max-w-md">
          <Shield className="w-16 h-16 text-rose-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">Access Denied</h2>
          <p className="text-slate-400">This page is only accessible to administrators.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap justify-between items-start gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Shield className="w-8 h-8 text-emerald-500" /> System Administration
          </h1>
          <p className="text-slate-400 mt-1">Platform health and operational status</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* In-app toast alert toggle — always available */}
          <button
            onClick={() => setNotifEnabled(v => !v)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-all cursor-pointer ${
              notifEnabled
                ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                : 'border-slate-600 bg-slate-800/50 text-slate-400 hover:bg-slate-700/50'
            }`}
          >
            {notifEnabled
              ? <><Bell className="w-4 h-4 animate-pulse" /> Signal Alerts ON</>
              : <><BellOff className="w-4 h-4" /> Signal Alerts OFF</>
            }
          </button>
          {/* Browser desktop notification status (informational) */}
          {notifPermission === 'denied' && (
            <span title="Open browser settings (padlock icon in address bar) → Notifications → Allow, then reload" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-400 text-xs cursor-help">
              <BellOff className="w-3.5 h-3.5" /> Desktop blocked — hover for help
            </span>
          )}
          {notifPermission === 'default' && (
            <button
              onClick={requestNotifPermission}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400 text-xs hover:bg-amber-500/20 cursor-pointer"
            >
              <Bell className="w-3.5 h-3.5" /> Allow desktop alerts
            </button>
          )}
          <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 bg-emerald-500/10 px-3 py-1">
            <Activity className="w-3 h-3 mr-2 animate-pulse" /> Systems Operational
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">Total Users</CardTitle>
            <Users className="h-4 w-4 text-slate-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">{allUsers.length}</div>
            <div className="flex items-center gap-2 mt-3 text-xs text-slate-400">
               <UserCog className="w-3 h-3" /> {allUsers.filter(u => u.role === 'admin').length} Admins
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">Broker Connections</CardTitle>
            <Database className="h-4 w-4 text-slate-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">{brokerConnections.length}</div>
            <div className="flex items-center gap-2 mt-3 text-xs text-emerald-400">
               <Activity className="w-3 h-3" /> {brokerConnections.filter(b => b.connection_status === 'CONNECTED').length} Connected
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">Server CPU Load</CardTitle>
            <Cpu className="h-4 w-4 text-slate-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">24%</div>
            <Progress value={24} className="h-2 mt-3 bg-slate-800" indicatorClassName="bg-emerald-500" />
            <p className="text-xs text-slate-500 mt-2">Optimal range</p>
          </CardContent>
        </Card>
      </div>

      {/* User Management Section */}
      <Card className="bg-slate-900/50 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-cyan-400" /> User Management
          </CardTitle>
          <CardDescription className="text-slate-400">All registered users and their details</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-950/50">
                <TableRow className="border-slate-800 hover:bg-slate-900/50">
                  <TableHead className="text-slate-400">User</TableHead>
                  <TableHead className="text-slate-400">Email</TableHead>
                  <TableHead className="text-slate-400">Role</TableHead>
                  <TableHead className="text-slate-400">Joined</TableHead>
                  <TableHead className="text-slate-400">Status</TableHead>
                  <TableHead className="text-slate-400 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allUsers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-slate-500">
                      No users found
                    </TableCell>
                  </TableRow>
                ) : (
                  allUsers.map((user) => (
                    <TableRow key={user.id} className="border-slate-800 hover:bg-slate-800/30">
                      <TableCell className="font-medium text-slate-200">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center text-white font-semibold text-sm">
                            {user.full_name?.[0] || user.email[0].toUpperCase()}
                          </div>
                          {user.full_name || 'N/A'}
                        </div>
                      </TableCell>
                      <TableCell className="text-slate-300">
                        <div className="flex items-center gap-2">
                          <Mail className="w-3 h-3 text-slate-500" />
                          {user.email}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge 
                          variant="outline" 
                          className={user.role === 'admin' 
                            ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10' 
                            : 'border-blue-500/30 text-blue-400 bg-blue-500/10'
                          }
                        >
                          {user.role || 'user'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-slate-400 text-sm">
                        {new Date(user.created_date).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 bg-emerald-500/10">
                          Active
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {user.id === currentUser?.id ? (
                          <span className="text-xs text-slate-600 italic">You</span>
                        ) : (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <button
                                disabled={deletingId === user.id}
                                className="inline-flex items-center gap-1.5 text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 px-2.5 py-1.5 rounded-md border border-rose-500/20 transition-colors disabled:opacity-50"
                              >
                                {deletingId === user.id
                                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Deleting…</>
                                  : <><Trash2 className="w-3.5 h-3.5" /> Delete</>}
                              </button>
                            </AlertDialogTrigger>
                            <AlertDialogContent className="bg-slate-900 border-slate-800">
                              <AlertDialogHeader>
                                <AlertDialogTitle className="text-white">Delete user?</AlertDialogTitle>
                                <AlertDialogDescription className="text-slate-400">
                                  This will permanently remove <span className="text-slate-200 font-medium">{user.full_name || user.email}</span> ({user.email}) from the platform. This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel className="bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700">Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDeleteUser(user)}
                                  className="bg-rose-600 hover:bg-rose-700 text-white border-rose-600"
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* 3rd Party Signal Webhook */}
      <WebhookInfoCard />

      {/* Risk Management Section for all accounts */}
      <RiskManagementPanel />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="bg-slate-900/50 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Server className="w-5 h-5 text-purple-400" /> Service Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { name: 'AI Prediction Engine', status: 'Operational', color: 'text-emerald-400' },
              { name: 'Market Data Feed', status: 'Operational', color: 'text-emerald-400' },
              { name: 'MT4 Bridge', status: 'Latency: 45ms', color: 'text-amber-400' },
              { name: 'Notification Service', status: 'Operational', color: 'text-emerald-400' },
              { name: 'Payment Gateway', status: 'Operational', color: 'text-emerald-400' },
            ].map((service, i) => (
              <div key={i} className="flex justify-between items-center p-3 bg-slate-950/50 rounded-lg border border-slate-800/50">
                <span className="text-slate-300 font-medium">{service.name}</span>
                <span className={`text-sm ${service.color} flex items-center gap-2`}>
                  <div className={`w-2 h-2 rounded-full ${service.color === 'text-emerald-400' ? 'bg-emerald-500' : 'bg-amber-500'}`}></div>
                  {service.status}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="bg-slate-900/50 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white">Recent System Logs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 font-mono text-xs">
              {[
                { time: '10:42:15', msg: 'System backup completed successfully' },
                { time: '10:30:00', msg: 'Cron job [update_rates] executed' },
                { time: '10:15:22', msg: 'New user registration: User#492' },
                { time: '10:05:00', msg: 'AI Model V2.4 training finished' },
                { time: '09:55:12', msg: 'API Rate limit warning: 85%' },
              ].map((log, i) => (
                <div key={i} className="text-slate-400 border-b border-slate-800/50 last:border-0 pb-1">
                  <span className="text-slate-600">[{log.time}]</span> {log.msg}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}