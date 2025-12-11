import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { 
  Bot, 
  Play, 
  Pause, 
  Plus, 
  Settings2, 
  Trash2,
  Cpu,
  Zap,
  ShieldAlert
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import BotConfigDialog from '@/components/autotrade/BotConfigDialog';

export default function AutoTrade() {
  const queryClient = useQueryClient();
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [selectedBot, setSelectedBot] = useState(null);
  
  const { data: bots } = useQuery({
    queryKey: ['bots'],
    queryFn: () => base44.entities.BotConfig.list(),
    initialData: []
  });

  const createBot = useMutation({
    mutationFn: (data) => base44.entities.BotConfig.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['bots']);
      setIsConfigOpen(false);
    }
  });

  const updateBot = useMutation({
    mutationFn: ({id, data}) => base44.entities.BotConfig.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['bots']);
      setIsConfigOpen(false);
      setSelectedBot(null);
    }
  });

  const deleteBot = useMutation({
      mutationFn: (id) => base44.entities.BotConfig.delete(id),
      onSuccess: () => {
          queryClient.invalidateQueries(['bots']);
      }
  });

  const toggleBot = useMutation({
    mutationFn: (bot) => base44.entities.BotConfig.update(bot.id, { 
      status: bot.status === 'RUNNING' ? 'STOPPED' : 'RUNNING' 
    }),
    onSuccess: () => queryClient.invalidateQueries(['bots'])
  });

  const handleSave = (data) => {
      if (selectedBot) {
          updateBot.mutate({ id: selectedBot.id, data });
      } else {
          createBot.mutate(data);
      }
  };

  const handleEdit = (bot) => {
      setSelectedBot(bot);
      setIsConfigOpen(true);
  };

  const handleCreate = () => {
      setSelectedBot(null);
      setIsConfigOpen(true);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Bot className="w-8 h-8 text-emerald-500" /> Auto Trading Bots
          </h1>
          <p className="text-slate-400 mt-1">Manage your AI automated trading strategies</p>
        </div>
        
        <Button onClick={handleCreate} className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-900/20">
            <Plus className="w-4 h-4 mr-2" /> Create New Bot
        </Button>
        <BotConfigDialog 
            open={isConfigOpen} 
            onOpenChange={setIsConfigOpen} 
            onSubmit={handleSave}
            initialData={selectedBot}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {bots.map((bot) => (
          <Card key={bot.id} className={`bg-slate-900/50 backdrop-blur-sm border transition-all ${bot.status === 'RUNNING' ? 'border-emerald-500/30 shadow-[0_0_20px_-5px_rgba(16,185,129,0.1)]' : 'border-slate-800'}`}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div className="space-y-1">
                <CardTitle className="text-xl text-white flex items-center gap-2">
                  {bot.name}
                  <Badge variant="outline" className={`ml-2 text-xs font-normal ${
                    bot.status === 'RUNNING' ? 'border-emerald-500/50 text-emerald-400 bg-emerald-500/10' : 'border-slate-700 text-slate-500'
                  }`}>
                    {bot.status}
                  </Badge>
                </CardTitle>
                <CardDescription className="text-slate-400">
                  {bot.strategy_type.replace('_', ' ')}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button 
                  variant="outline" 
                  size="icon"
                  className={`rounded-full w-10 h-10 border-2 ${
                    bot.status === 'RUNNING' 
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-300' 
                    : 'border-slate-700 bg-slate-800/50 text-slate-400 hover:bg-slate-800 hover:text-white'
                  }`}
                  onClick={() => toggleBot.mutate(bot)}
                >
                  {bot.status === 'RUNNING' ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 mt-2 mb-6">
                <div className="bg-slate-950/50 p-3 rounded-lg border border-slate-800/50">
                  <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
                    <ShieldAlert className="w-3 h-3" /> Risk Level
                  </div>
                  <div className={`font-semibold ${
                    bot.risk_level === 'HIGH' ? 'text-rose-400' : 
                    bot.risk_level === 'MEDIUM' ? 'text-amber-400' : 'text-emerald-400'
                  }`}>
                    {bot.risk_level}
                  </div>
                </div>
                <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800/50">
                  <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
                    <Zap className="w-3 h-3" /> Performance
                  </div>
                  <div className="font-semibold text-emerald-400">
                    +12.4% <span className="text-slate-500 text-xs font-normal">this week</span>
                  </div>
                </div>
              </div>

              {/* Mock Terminal Output */}
              <div className="bg-black/40 rounded-lg p-3 font-mono text-xs h-32 overflow-hidden relative border border-slate-800">
                <div className="absolute top-2 right-2 flex gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-red-500/20"></div>
                  <div className="w-2 h-2 rounded-full bg-yellow-500/20"></div>
                  <div className="w-2 h-2 rounded-full bg-green-500/20"></div>
                </div>
                <div className="space-y-1 opacity-70">
                  <p className="text-slate-400"><span className="text-blue-500">[{new Date().toLocaleTimeString()}]</span> Analyzing market patterns...</p>
                  <p className="text-slate-400"><span className="text-blue-500">[{new Date().toLocaleTimeString()}]</span> EUR/USD RSI Divergence detected.</p>
                  <p className="text-emerald-400"><span className="text-blue-500">[{new Date().toLocaleTimeString()}]</span> Signal generated: BUY confidence 87%</p>
                  <p className="text-slate-400"><span className="text-blue-500">[{new Date().toLocaleTimeString()}]</span> Calculating position size based on risk...</p>
                  {bot.status === 'RUNNING' && (
                    <p className="text-emerald-500 animate-pulse">_ Processing tick data...</p>
                  )}
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex justify-between border-t border-slate-800 pt-4">
               <Button variant="ghost" size="sm" onClick={() => handleEdit(bot)} className="text-slate-400 hover:text-white text-xs">
                 <Settings2 className="w-3 h-3 mr-2" /> Configuration
               </Button>
               <Button variant="ghost" size="sm" onClick={() => deleteBot.mutate(bot.id)} className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 text-xs">
                 <Trash2 className="w-3 h-3 mr-2" /> Delete
               </Button>
            </CardFooter>
          </Card>
        ))}

        {bots.length === 0 && (
          <div className="col-span-full flex flex-col items-center justify-center py-16 text-slate-500 border-2 border-dashed border-slate-800 rounded-xl bg-slate-900/20">
            <Cpu className="w-12 h-12 mb-4 opacity-50" />
            <p className="text-lg font-medium">No bots configured</p>
            <p className="text-sm">Create your first AI trading bot to get started.</p>
          </div>
        )}
      </div>
    </div>
  );
}