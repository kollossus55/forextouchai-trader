import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  ArrowLeftRight, 
  Bot, 
  LineChart, 
  Wallet, 
  Users, 
  Bell, 
  Settings, 
  User, 
  Shield,
  Menu,
  X,
  Search,
  LogOut
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { createPageUrl } from '@/utils';
import { Toaster, toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';

export default function Layout({ children }) {
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [user, setUser] = useState(null);
  
  // Don't show layout chrome on Home page (landing page)
  const isHomePage = location.pathname === '/' || location.pathname === '/Home';

  useEffect(() => {
    // Skip auth check on Home page (landing page)
    if (isHomePage) return;
    
    const fetchUser = async () => {
      try {
        const userData = await base44.auth.me();
        setUser(userData);
      } catch (e) {
        console.error("Not logged in - redirecting to login");
        base44.auth.redirectToLogin(window.location.pathname);
      }
    };
    fetchUser();
  }, [isHomePage]);

  const { data: connections, error: connectionError } = useQuery({
    queryKey: ['broker-connections'],
    queryFn: () => base44.entities.BrokerConnection.list(),
    refetchInterval: 2000, // Faster polling: every 2 seconds
    refetchIntervalInBackground: true, // Keep polling even when tab is inactive
    staleTime: 1000, // Consider data stale after 1s
    retry: 3, // Retry failed requests
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 3000),
    initialData: []
  });

  // Check if ANY connection is active
  const isConnected = React.useMemo(() => {
    if (!connections || connections.length === 0) return false;
    
    const now = new Date().getTime();
    
    // Check if at least one connection is healthy
    return connections.some(conn => {
      if (!conn.last_sync) return false;
      
      const lastSync = new Date(conn.last_sync).getTime();
      const timeSinceSync = now - lastSync;
      const isStale = timeSinceSync > 30000;
      
      const veryRecentSync = timeSinceSync < 8000;
      const statusOk = conn.connection_status === 'CONNECTED' || 
                       (veryRecentSync && conn.connection_status !== 'ERROR');
      
      return !isStale && statusOk;
    });
  }, [connections, connectionError]);
  
  // Count active connections
  const activeConnectionCount = React.useMemo(() => {
    if (!connections) return 0;
    const now = new Date().getTime();
    return connections.filter(conn => {
      if (!conn.last_sync) return false;
      const lastSync = new Date(conn.last_sync).getTime();
      const timeSinceSync = now - lastSync;
      return timeSinceSync <= 30000 && conn.connection_status === 'CONNECTED';
    }).length;
  }, [connections]);
  
  // Monitor connection status globally with reconnection feedback
  const [lastConnectionState, setLastConnectionState] = React.useState(null);
  const [disconnectTime, setDisconnectTime] = React.useState(null);
  const [hasShownReconnection, setHasShownReconnection] = React.useState(false);
  
  React.useEffect(() => {
    console.log('[Connection Monitor] isConnected:', isConnected, 'lastConnectionState:', lastConnectionState);
    
    // Skip first render (initialization)
    if (lastConnectionState === null) {
      console.log('[Connection Monitor] First render - initializing to:', isConnected);
      setLastConnectionState(isConnected);
      // If connected on first load, assume this might be a reconnection
      if (isConnected && !hasShownReconnection) {
        console.log('[Connection Monitor] Connected on page load - showing reconnection toast');
        toast.success("MT4/MT5 Connected! ✓", {
          description: "Trading platform is online and syncing",
          duration: 5000,
          cancel: {
            label: "✕",
            onClick: () => {}
          }
        });
        setHasShownReconnection(true);
      }
      return;
    }
    
    // Alert on disconnection
    if (lastConnectionState === true && isConnected === false) {
      console.log('[Connection Monitor] DISCONNECTION DETECTED - Showing alert');
      setDisconnectTime(Date.now());
      setHasShownReconnection(false);
      toast.error("MT4/MT5 Connection Lost", {
        description: "Trading platform disconnected. Check your EA.",
        duration: 10000,
        cancel: {
          label: "✕",
          onClick: () => {}
        },
        action: {
          label: "Settings",
          onClick: () => window.location.href = createPageUrl('Settings')
        }
      });
    }
    
    // Alert on reconnection
    if (lastConnectionState === false && isConnected === true) {
      console.log('[Connection Monitor] RECONNECTION DETECTED - Showing alert');
      const downSeconds = disconnectTime ? Math.floor((Date.now() - disconnectTime) / 1000) : 0;
      const downMinutes = Math.floor(downSeconds / 60);

      toast.success("MT4/MT5 Reconnected! ✓", {
        description: downSeconds > 0 ? `Connection restored after ${downSeconds}s offline` : "Connection restored",
        duration: 5000,
        cancel: {
          label: "✕",
          onClick: () => {}
        }
      });
      
      // ALWAYS send reconnection email when connection is restored
      if (user?.email) {
        const emailBody = downSeconds > 0 
          ? `Your MT4/MT5 trading platform has successfully reconnected after being offline for ${downMinutes > 0 ? downMinutes + ' minute(s)' : downSeconds + ' second(s)'}.\n\nConnection Status: ONLINE\nReconnected At: ${new Date().toLocaleString()}\n\nYour trading bots can now resume operations.`
          : `Your MT4/MT5 trading platform connection has been successfully established.\n\nConnection Status: ONLINE\nConnected At: ${new Date().toLocaleString()}`;
        
        console.log('[Connection Monitor] Sending reconnection email to:', user.email);
        base44.integrations.Core.SendEmail({
          to: user.email,
          subject: '✅ ForexTouchAI - MT4/MT5 Connection Restored',
          body: emailBody
        }).then(() => {
          console.log('[Connection Monitor] Reconnection email sent successfully');
        }).catch(e => {
          console.error("[Connection Monitor] Failed to send reconnection email:", e);
        });
      }
      
      setDisconnectTime(null);
      setHasShownReconnection(true);
    }
    
    setLastConnectionState(isConnected);
  }, [isConnected]);

  const navItems = [
    { label: 'Overview', icon: LayoutDashboard, path: '/Overview' },
    { label: 'Pairs', icon: ArrowLeftRight, path: '/Pairs' },
    { label: 'Auto Trade', icon: Bot, path: '/AutoTrade' },
    { label: 'Analytics', icon: LineChart, path: '/Analytics' },
    { label: 'Portfolio', icon: Wallet, path: '/Portfolio' },
    { label: 'Social', icon: Users, path: '/Social' },
    { label: 'Alerts', icon: Bell, path: '/Alerts' },
    { label: 'Settings', icon: Settings, path: '/Settings' },
    { label: 'Profile', icon: User, path: '/Profile' },
    { label: 'Admin', icon: Shield, path: '/Admin' },
  ];

  const handleLogout = async () => {
    setUser(null);
    await base44.auth.logout('/');
  };

  // If on Home page, just render children without layout chrome
  if (isHomePage) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100 font-sans">
      <Toaster position="top-right" theme="dark" />
      {/* Sidebar */}
      <aside 
        className={`
          fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 border-r border-slate-800 transition-transform duration-300 ease-in-out
          ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} 
          lg:translate-x-0 lg:static lg:block
        `}
      >
        <div className="flex items-center h-16 px-6 border-b border-slate-800">
          <div className="w-8 h-8 rounded bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center mr-3">
            <LineChart className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 to-cyan-400">
            ForexTouchAI
          </span>
          <button 
            className="ml-auto lg:hidden text-slate-400"
            onClick={() => setIsMobileMenuOpen(false)}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="p-4 space-y-1 overflow-y-auto h-[calc(100vh-4rem)]">
          <div className="mb-6 px-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
              <Input 
                placeholder="Search pairs..." 
                className="pl-9 bg-slate-950 border-slate-800 focus:border-emerald-500/50 text-sm h-9" 
              />
            </div>
          </div>

          {navItems.map((item) => {
            const isActive = location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path));
            return (
              <Link
                key={item.path}
                to={createPageUrl(item.path.replace('/', ''))}
                className={`
                  flex items-center px-3 py-2.5 rounded-lg transition-all duration-200 group
                  ${isActive 
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-[0_0_15px_-3px_rgba(16,185,129,0.2)]' 
                    : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-100'}
                `}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <item.icon className={`w-5 h-5 mr-3 transition-colors ${isActive ? 'text-emerald-400' : 'text-slate-500 group-hover:text-slate-300'}`} />
                <span className="font-medium">{item.label}</span>
              </Link>
            );
          })}

          <div className="mt-auto pt-4 border-t border-slate-800">
            <button
              onClick={handleLogout}
              className="flex items-center px-3 py-2.5 rounded-lg transition-all duration-200 group w-full text-slate-400 hover:bg-rose-500/10 hover:text-rose-400 hover:border hover:border-rose-500/20"
            >
              <LogOut className="w-5 h-5 mr-3 transition-colors text-slate-500 group-hover:text-rose-400" />
              <span className="font-medium">Logout</span>
            </button>
          </div>
        </nav>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <header className="h-16 border-b border-slate-800 bg-slate-900/50 backdrop-blur-md flex items-center justify-between px-4 lg:px-8 sticky top-0 z-40">
          <button 
            className="lg:hidden text-slate-400 p-2 -ml-2 hover:bg-slate-800 rounded-md"
            onClick={() => setIsMobileMenuOpen(true)}
          >
            <Menu className="w-6 h-6" />
          </button>

          <div className="hidden md:flex items-center space-x-6 text-sm text-slate-400">
            <div className="flex items-center">
              <div className={`w-2 h-2 rounded-full mr-2 ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`}></div>
              <span>MT4/MT5: <span className={`font-medium ${isConnected ? 'text-emerald-400' : 'text-rose-400'}`}>
                {isConnected ? `${activeConnectionCount} Connected` : 'Disconnected'}
              </span></span>
            </div>
            <div className="flex items-center">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse mr-2"></div>
              <span>AI Engine: <span className="text-emerald-400 font-medium">Active</span></span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" className="relative text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10">
              <Bell className="w-5 h-5" />
              <span className="absolute top-2 right-2 w-2 h-2 bg-emerald-500 rounded-full border-2 border-slate-900"></span>
            </Button>
            
            <div className="h-8 w-[1px] bg-slate-800 mx-2 hidden sm:block"></div>

            <div className="flex items-center gap-3">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-medium text-slate-200">{user?.full_name || 'Trader'}</p>
                <p className="text-xs text-slate-500">{user?.role || 'Pro Plan'}</p>
              </div>
              <Avatar className="w-9 h-9 border border-slate-700 cursor-pointer hover:border-emerald-500/50 transition-colors">
                <AvatarImage src="" />
                <AvatarFallback className="bg-emerald-900 text-emerald-200">
                  {user?.full_name?.[0] || 'T'}
                </AvatarFallback>
              </Avatar>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-8 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-slate-950">
          {children}
        </main>
      </div>
    </div>
  );
}