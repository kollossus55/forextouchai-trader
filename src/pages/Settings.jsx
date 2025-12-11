import React, { useState } from 'react';
import { 
  Settings as SettingsIcon, 
  Shield, 
  Bell, 
  Smartphone, 
  Globe, 
  CreditCard,
  Monitor,
  Key
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';

export default function Settings() {
  const [mt4Config, setMt4Config] = useState({
    server: 'MetaQuotes-Demo',
    login: '8593021',
    password: ''
  });

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
          <TabsTrigger value="security" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white py-2 px-4">Security</TabsTrigger>
        </TabsList>
        
        <TabsContent value="general" className="mt-6 space-y-6">
          <Card className="bg-slate-900/50 border-slate-800">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Monitor className="w-5 h-5 text-blue-400" /> Display Settings
              </CardTitle>
              <CardDescription className="text-slate-400">Customize your dashboard appearance</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-slate-200">Dark Mode</Label>
                  <p className="text-xs text-slate-500">Enable dark theme for the interface</p>
                </div>
                <Switch checked={true} />
              </div>
              <Separator className="bg-slate-800" />
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-slate-200">Compact View</Label>
                  <p className="text-xs text-slate-500">Show more data with less spacing</p>
                </div>
                <Switch />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trading" className="mt-6 space-y-6">
          <Card className="bg-slate-900/50 border-slate-800">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Globe className="w-5 h-5 text-emerald-400" /> MT4/MT5 Connection
              </CardTitle>
              <CardDescription className="text-slate-400">Connect your broker account for auto-trading</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label className="text-slate-200">Broker Server</Label>
                <Input 
                  value={mt4Config.server} 
                  onChange={e => setMt4Config({...mt4Config, server: e.target.value})}
                  className="bg-slate-950 border-slate-800 text-slate-200" 
                />
              </div>
              <div className="grid gap-2">
                <Label className="text-slate-200">Login ID</Label>
                <Input 
                  value={mt4Config.login} 
                  onChange={e => setMt4Config({...mt4Config, login: e.target.value})}
                  className="bg-slate-950 border-slate-800 text-slate-200" 
                />
              </div>
              <div className="grid gap-2">
                <Label className="text-slate-200">Password</Label>
                <Input 
                  type="password"
                  value={mt4Config.password} 
                  onChange={e => setMt4Config({...mt4Config, password: e.target.value})}
                  className="bg-slate-950 border-slate-800 text-slate-200" 
                  placeholder="••••••••"
                />
              </div>
            </CardContent>
            <CardFooter>
              <Button className="w-full bg-emerald-600 hover:bg-emerald-700 shadow-lg shadow-emerald-900/20 transition-all">Test Connection</Button>
            </CardFooter>
          </Card>
        </TabsContent>

        <TabsContent value="notifications" className="mt-6 space-y-6">
          <Card className="bg-slate-900/50 border-slate-800">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Bell className="w-5 h-5 text-amber-400" /> Alert Preferences
              </CardTitle>
              <CardDescription className="text-slate-400">Choose how you want to be notified</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-slate-200">Trade Execution</Label>
                  <p className="text-xs text-slate-500">Notify when a trade is opened or closed</p>
                </div>
                <Switch checked={true} />
              </div>
              <Separator className="bg-slate-800" />
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-slate-200">New AI Signals</Label>
                  <p className="text-xs text-slate-500">Notify when a new high-confidence signal is found</p>
                </div>
                <Switch checked={true} />
              </div>
              <Separator className="bg-slate-800" />
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-slate-200">Email Digest</Label>
                  <p className="text-xs text-slate-500">Daily summary of performance</p>
                </div>
                <Switch />
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