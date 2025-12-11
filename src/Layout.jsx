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

export default function Layout({ children }) {
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [user, setUser] = useState(null);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const userData = await base44.auth.me();
        setUser(userData);
      } catch (e) {
        console.error("Not logged in");
      }
    };
    fetchUser();
  }, []);

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
    await base44.auth.logout();
  };

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100 font-sans">
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
            ForexAI
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
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse mr-2"></div>
              <span>MT4 Status: <span className="text-emerald-400 font-medium">Connected</span></span>
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