import React from 'react';
import { 
  Shield, 
  Server, 
  Activity, 
  Database, 
  Cpu,
  Users
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';

export default function Admin() {
  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Shield className="w-8 h-8 text-emerald-500" /> System Administration
          </h1>
          <p className="text-slate-400 mt-1">Platform health and operational status</p>
        </div>
        <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 bg-emerald-500/10 px-3 py-1">
          <Activity className="w-3 h-3 mr-2 animate-pulse" /> Systems Operational
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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

        <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">Database Size</CardTitle>
            <Database className="h-4 w-4 text-slate-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">1.2 GB</div>
            <Progress value={45} className="h-2 mt-3 bg-slate-800" indicatorClassName="bg-blue-500" />
            <p className="text-xs text-slate-500 mt-2">45% of allocated storage</p>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">Connected Users</CardTitle>
            <Users className="h-4 w-4 text-slate-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">142</div>
            <div className="flex items-center gap-2 mt-3 text-xs text-emerald-400">
               <Activity className="w-3 h-3" /> +12 from last hour
            </div>
          </CardContent>
        </Card>
      </div>

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