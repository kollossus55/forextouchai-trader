import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { 
  Bell, 
  Info, 
  AlertTriangle, 
  CheckCircle, 
  XCircle,
  Trash2,
  Check
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default function Alerts() {
  const queryClient = useQueryClient();
  
  const { data: alerts } = useQuery({
    queryKey: ['alerts'],
    queryFn: () => base44.entities.Alert.list('-created_date', 50),
    initialData: []
  });

  const deleteAlert = useMutation({
    mutationFn: (id) => base44.entities.Alert.delete(id),
    onSuccess: () => queryClient.invalidateQueries(['alerts'])
  });

  const markAsRead = useMutation({
    mutationFn: (alert) => base44.entities.Alert.update(alert.id, { is_read: true }),
    onSuccess: () => queryClient.invalidateQueries(['alerts'])
  });

  const clearAll = useMutation({
    mutationFn: () => Promise.all(alerts.map(a => base44.entities.Alert.delete(a.id))),
    onSuccess: () => queryClient.invalidateQueries(['alerts'])
  });

  const getIcon = (type) => {
    switch(type) {
      case 'WARNING': return <AlertTriangle className="w-5 h-5 text-amber-500" />;
      case 'ERROR': return <XCircle className="w-5 h-5 text-rose-500" />;
      case 'SUCCESS': return <CheckCircle className="w-5 h-5 text-emerald-500" />;
      default: return <Info className="w-5 h-5 text-blue-500" />;
    }
  };

  const getBorderColor = (type) => {
    switch(type) {
      case 'WARNING': return 'border-amber-500/20';
      case 'ERROR': return 'border-rose-500/20';
      case 'SUCCESS': return 'border-emerald-500/20';
      default: return 'border-blue-500/20';
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Bell className="w-8 h-8 text-emerald-500" /> Notifications
          </h1>
          <p className="text-slate-400 mt-1">System alerts and trading notifications</p>
        </div>
        <Button 
          onClick={() => clearAll.mutate()}
          disabled={clearAll.isPending || alerts.length === 0}
          className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 hover:text-emerald-300 transition-all"
        >
          {clearAll.isPending ? 'Clearing...' : 'Clear All'}
        </Button>
      </div>

      <div className="space-y-3">
        {alerts.map((alert) => (
          <Card 
            key={alert.id} 
            className={`bg-slate-900/50 backdrop-blur-sm transition-all hover:bg-slate-800/50 ${getBorderColor(alert.type)} ${alert.is_read ? 'opacity-60' : 'opacity-100 border-l-4'}`}
          >
            <CardContent className="p-4 flex items-start gap-4">
              <div className="mt-1 flex-shrink-0">
                {getIcon(alert.type)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-start">
                  <h4 className={`font-semibold text-sm ${alert.is_read ? 'text-slate-400' : 'text-slate-200'}`}>
                    {alert.title}
                  </h4>
                  <span className="text-xs text-slate-500 ml-2 whitespace-nowrap">
                    {new Date(alert.created_date).toLocaleTimeString()}
                  </span>
                </div>
                <p className={`text-sm mt-1 ${alert.is_read ? 'text-slate-500' : 'text-slate-300'}`}>
                  {alert.message}
                </p>
              </div>
              <div className="flex gap-2 ml-2">
                {!alert.is_read && (
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-8 w-8 text-slate-500 hover:text-emerald-400"
                    onClick={() => markAsRead.mutate(alert)}
                  >
                    <Check className="w-4 h-4" />
                  </Button>
                )}
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-8 w-8 text-slate-500 hover:text-rose-400"
                  onClick={() => deleteAlert.mutate(alert.id)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {alerts.length === 0 && (
          <div className="text-center py-16 text-slate-500 border-2 border-dashed border-slate-800 rounded-xl bg-slate-900/20">
            <Bell className="w-12 h-12 mb-4 opacity-50 mx-auto" />
            <p className="text-lg font-medium">No new notifications</p>
          </div>
        )}
      </div>
    </div>
  );
}