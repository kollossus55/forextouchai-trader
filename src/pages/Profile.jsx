import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { 
  User, 
  Mail, 
  CreditCard, 
  Star, 
  ShieldCheck,
  Award
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';

export default function Profile() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const userData = await base44.auth.me();
        setUser(userData);
      } catch (e) {
        // Fallback for demo
        setUser({ full_name: 'Demo Trader', email: 'trader@example.com', role: 'PRO' });
      }
    };
    fetchUser();
  }, []);

  if (!user) return null;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <User className="w-8 h-8 text-emerald-500" /> My Profile
          </h1>
          <p className="text-slate-400 mt-1">Manage your account and subscription</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* User Info Card */}
        <Card className="col-span-1 md:col-span-1 bg-slate-900/50 border-slate-800 backdrop-blur-sm">
          <CardContent className="p-6 flex flex-col items-center text-center">
            <Avatar className="w-24 h-24 border-4 border-slate-800 mb-4">
              <AvatarImage src="" />
              <AvatarFallback className="bg-emerald-900 text-emerald-200 text-2xl font-bold">
                {user.full_name?.charAt(0)}
              </AvatarFallback>
            </Avatar>
            <h2 className="text-xl font-bold text-white">{user.full_name}</h2>
            <p className="text-slate-400 text-sm mb-4">{user.email}</p>
            
            <Badge className="bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border-emerald-500/50 px-4 py-1 mb-6">
              <Star className="w-3 h-3 mr-1 fill-emerald-400" /> PRO PLAN
            </Badge>

            <div className="w-full space-y-2">
              <div className="flex justify-between text-sm py-2 border-b border-slate-800">
                <span className="text-slate-400">Member Since</span>
                <span className="text-slate-200">Oct 2023</span>
              </div>
              <div className="flex justify-between text-sm py-2 border-b border-slate-800">
                <span className="text-slate-400">Status</span>
                <span className="text-emerald-400">Active</span>
              </div>
              <div className="flex justify-between text-sm py-2 border-b border-slate-800">
                <span className="text-slate-400">Country</span>
                <span className="text-slate-200">United States</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Subscription & Stats */}
        <div className="col-span-1 md:col-span-2 space-y-6">
          <Card className="bg-gradient-to-br from-emerald-900/40 to-slate-900 border-emerald-500/30">
            <CardHeader>
              <CardTitle className="text-white flex items-center justify-between">
                <span className="flex items-center gap-2"><Award className="w-5 h-5 text-emerald-400" /> Current Plan</span>
                <span className="text-lg font-bold text-emerald-400">$49/mo</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center gap-3 text-slate-300">
                  <ShieldCheck className="w-5 h-5 text-emerald-500" />
                  <span>Unlimited AI Signals</span>
                </div>
                <div className="flex items-center gap-3 text-slate-300">
                  <ShieldCheck className="w-5 h-5 text-emerald-500" />
                  <span>Auto-Trading Bot Access</span>
                </div>
                <div className="flex items-center gap-3 text-slate-300">
                  <ShieldCheck className="w-5 h-5 text-emerald-500" />
                  <span>Real-time MT4 Connection</span>
                </div>
                
                <div className="pt-4 flex gap-3">
                  <Button className="bg-emerald-600 hover:bg-emerald-700 text-white">Manage Subscription</Button>
                  <Button variant="outline" className="border-slate-700 text-slate-300">Billing History</Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-slate-900/50 border-slate-800">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-blue-400" /> Payment Method
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between p-3 bg-slate-950 border border-slate-800 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-6 bg-slate-700 rounded flex items-center justify-center text-[10px] text-white font-bold">VISA</div>
                  <span className="text-slate-300">•••• •••• •••• 4242</span>
                </div>
                <Badge variant="outline" className="border-slate-700 text-slate-400">Default</Badge>
              </div>
              <Button variant="link" className="text-emerald-400 p-0 h-auto mt-4 text-sm">
                + Add New Payment Method
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}