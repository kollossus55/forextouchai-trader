import React, { useState, useEffect } from 'react';
import { 
  Shield, 
  Server, 
  Activity, 
  Database, 
  Cpu,
  Users,
  Mail,
  UserCog
} from 'lucide-react';
import RiskManagementPanel from '@/components/autotrade/RiskManagementPanel';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';

export default function Admin() {
  const [currentUser, setCurrentUser] = useState(null);

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
                </TableRow>
              </TableHeader>
              <TableBody>
                {allUsers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-slate-500">
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
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

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