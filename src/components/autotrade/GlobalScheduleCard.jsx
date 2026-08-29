import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Clock, Save } from 'lucide-react';
import { toast } from 'sonner';

const DEFAULT_WEEKLY = {
  mon: { on: '00:00', off: '23:59' },
  tue: { on: '00:00', off: '23:59' },
  wed: { on: '00:00', off: '23:59' },
  thu: { on: '00:00', off: '23:59' },
  fri: { on: '00:00', off: '23:59' },
  sat: { on: '00:00', off: '00:00' },
  sun: { on: '00:00', off: '00:00' },
};

// Edits the app-wide global trading schedule (RiskManagementSettings with no account_number).
// Every connected account inherits this unless it enables its own schedule as an override.
export default function GlobalScheduleCard() {
  const queryClient = useQueryClient();

  const { data: riskSettingsList = [] } = useQuery({
    queryKey: ['risk-settings'],
    queryFn: () => base44.entities.RiskManagementSettings.list(),
  });

  const globalRecord = (riskSettingsList || []).find(r => !r.account_number) || null;

  const [enabled, setEnabled] = useState(globalRecord?.global_schedule_enabled || false);
  const [schedule, setSchedule] = useState(globalRecord?.weekly_schedule || { ...DEFAULT_WEEKLY });

  useEffect(() => {
    setEnabled(globalRecord?.global_schedule_enabled || false);
    setSchedule(globalRecord?.weekly_schedule || { ...DEFAULT_WEEKLY });
  }, [globalRecord]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        global_schedule_enabled: enabled,
        weekly_schedule: schedule,
      };
      if (globalRecord?.id) {
        return await base44.entities.RiskManagementSettings.update(globalRecord.id, payload);
      }
      return await base44.entities.RiskManagementSettings.create({ ...payload, account_number: '' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['risk-settings']);
      toast.success('Global schedule saved — all accounts inherit this unless they override');
    },
    onError: (err) => toast.error(`Failed to save: ${err.message}`),
  });

  return (
    <Card className="bg-slate-900 border-cyan-500/30 mb-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-white text-lg font-semibold"><Clock className="w-5 h-5 text-cyan-400" /> Global Trading Schedule (App-Wide Default)</CardTitle>
        <CardDescription>Applies to ALL connected accounts. Each account inherits this unless it enables its own schedule as an override. Times are in UTC.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm text-slate-300">Enable global schedule</Label>
          <Switch checked={enabled} onCheckedChange={setEnabled} className="data-[state=checked]:bg-cyan-500" />
        </div>
        {enabled && (
          <>
            <div className="bg-rose-500/10 border border-rose-500/30 rounded p-2 text-[11px] text-rose-300">
              ⚠ Off-window = hard kill: all open trades on every account are closed automatically when the OFF window begins.
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
              {['mon','tue','wed','thu','fri','sat','sun'].map(day => {
                const ds = schedule[day] || {};
                return (
                  <div key={day} className="bg-slate-950 rounded-lg p-2 border border-slate-800 space-y-1.5">
                    <span className="text-[10px] uppercase font-semibold text-slate-400">{day}</span>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-slate-500">On</Label>
                      <Input type="time" value={ds.on || '00:00'}
                        onChange={e => setSchedule(prev => ({ ...prev, [day]: { ...(prev[day] || {}), on: e.target.value } }))}
                        className="bg-slate-950 border-slate-700 text-white h-8 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-slate-500">Off</Label>
                      <Input type="time" value={ds.off || '23:59'}
                        onChange={e => setSchedule(prev => ({ ...prev, [day]: { ...(prev[day] || {}), off: e.target.value } }))}
                        className="bg-slate-950 border-slate-700 text-white h-8 text-xs" />
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
        <div className="flex justify-end">
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="h-9 text-sm">
            <Save className="w-3 h-3 mr-1" /> Save Global Schedule
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}