import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Brain, Activity, Shield, TrendingUp, AlertTriangle, Zap, Settings } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function AITradeManagerCard() {
  const queryClient = useQueryClient();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const { data: settings } = useQuery({
    queryKey: ['aiTradeSettings'],
    queryFn: async () => {
      const list = await base44.entities.AITradeSettings.list(1);
      return list[0] || null;
    }
  });

  const [localSettings, setLocalSettings] = useState({
    enableAI: settings?.enableAI || false,
    mode: settings?.mode || 'SUGGESTIONS',
    maxRiskPercent: settings?.maxRiskPercent || 2,
    trailingStopPips: settings?.trailingStopPips || 20,
    profitProtectPercent: settings?.profitProtectPercent || 50,
    maxHoldHours: settings?.maxHoldHours || 24,
    monitoringInterval: settings?.monitoringInterval || 15
  });

  React.useEffect(() => {
    if (settings) {
      setLocalSettings({
        enableAI: settings.enableAI,
        mode: settings.mode,
        maxRiskPercent: settings.maxRiskPercent,
        trailingStopPips: settings.trailingStopPips,
        profitProtectPercent: settings.profitProtectPercent,
        maxHoldHours: settings.maxHoldHours,
        monitoringInterval: settings.monitoringInterval
      });
    }
  }, [settings]);

  const saveSettings = useMutation({
    mutationFn: async (data) => {
      if (settings?.id) {
        return base44.entities.AITradeSettings.update(settings.id, data);
      } else {
        return base44.entities.AITradeSettings.create(data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['aiTradeSettings']);
      toast.success('AI Trade Manager settings saved');
      setSettingsOpen(false);
    }
  });

  const runAIAnalysis = async () => {
    setIsAnalyzing(true);
    try {
      const { data } = await base44.functions.invoke('aiTradeManager', {
        action: 'ANALYZE_ALL',
        riskParams: localSettings
      });

      if (data.adjustments?.length > 0) {
        toast.success(`AI analyzed ${data.tradesAnalyzed} trades`, {
          description: `${data.adjustments.length} adjustments recommended`
        });
      } else {
        toast.info(`All ${data.tradesAnalyzed} trades look good`, {
          description: 'No adjustments needed at this time'
        });
      }

      queryClient.invalidateQueries(['trades']);
      queryClient.invalidateQueries(['alerts']);
    } catch (err) {
      toast.error('AI analysis failed', { description: err.message });
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <>
      <Card className="bg-gradient-to-br from-purple-900/20 to-slate-900/40 border-purple-500/30">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-purple-500/20 border border-purple-500/30 flex items-center justify-center">
                <Brain className="w-5 h-5 text-purple-400" />
              </div>
              <div>
                <CardTitle className="text-white">AI Trade Manager</CardTitle>
                <CardDescription>Automated risk & trade optimization</CardDescription>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSettingsOpen(true)}
              className="text-purple-400 hover:bg-purple-500/10"
            >
              <Settings className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className={`w-4 h-4 ${settings?.enableAI ? 'text-emerald-400 animate-pulse' : 'text-slate-500'}`} />
              <span className="text-sm text-slate-300">Status</span>
            </div>
            <Badge className={settings?.enableAI ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700/20 text-slate-400'}>
              {settings?.enableAI ? 'Active' : 'Disabled'}
            </Badge>
          </div>

          {settings?.enableAI && (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-purple-400" />
                  <span className="text-sm text-slate-300">Mode</span>
                </div>
                <Badge variant="outline" className="text-purple-400 border-purple-500/30">
                  {settings.mode === 'AUTO_EXECUTE' ? 'Auto Execute' : 'Suggestions Only'}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-800/50">
                <div className="text-center p-2 bg-slate-950/50 rounded border border-slate-800/50">
                  <div className="flex items-center justify-center gap-1 text-xs text-slate-400 mb-1">
                    <Shield className="w-3 h-3" /> Max Risk
                  </div>
                  <div className="font-bold text-slate-200">{settings.maxRiskPercent}%</div>
                </div>
                <div className="text-center p-2 bg-slate-950/50 rounded border border-slate-800/50">
                  <div className="flex items-center justify-center gap-1 text-xs text-slate-400 mb-1">
                    <TrendingUp className="w-3 h-3" /> Profit Lock
                  </div>
                  <div className="font-bold text-slate-200">{settings.profitProtectPercent}%</div>
                </div>
              </div>
            </>
          )}

          <Button
            onClick={runAIAnalysis}
            disabled={isAnalyzing || !settings?.enableAI}
            className="w-full bg-purple-600 hover:bg-purple-700 text-white"
          >
            {isAnalyzing ? (
              <>
                <Activity className="w-4 h-4 mr-2 animate-spin" />
                Analyzing Trades...
              </>
            ) : (
              <>
                <Brain className="w-4 h-4 mr-2" />
                Run AI Analysis Now
              </>
            )}
          </Button>

          {!settings?.enableAI && (
            <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5" />
              <p className="text-xs text-amber-300">
                AI Trade Manager is disabled. Configure settings to enable automated trade monitoring.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-purple-400" />
              AI Trade Manager Settings
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Configure AI-powered trade monitoring and risk management
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="flex items-center justify-between">
              <Label className="text-slate-300">Enable AI Trade Manager</Label>
              <Switch
                checked={localSettings.enableAI}
                onCheckedChange={(val) => setLocalSettings({...localSettings, enableAI: val})}
              />
            </div>

            {localSettings.enableAI && (
              <>
                <div className="space-y-2">
                  <Label className="text-slate-300">Operation Mode</Label>
                  <Select
                    value={localSettings.mode}
                    onValueChange={(val) => setLocalSettings({...localSettings, mode: val})}
                  >
                    <SelectTrigger className="bg-slate-950 border-slate-700">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-900 border-slate-800">
                      <SelectItem value="SUGGESTIONS">Suggestions Only</SelectItem>
                      <SelectItem value="AUTO_EXECUTE">Auto Execute</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-slate-500">
                    {localSettings.mode === 'AUTO_EXECUTE' 
                      ? 'AI will automatically adjust trades based on risk parameters' 
                      : 'AI will only alert you with recommendations'}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-300">Max Risk Per Trade (%)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    min="0.5"
                    max="10"
                    value={localSettings.maxRiskPercent}
                    onChange={(e) => setLocalSettings({...localSettings, maxRiskPercent: parseFloat(e.target.value)})}
                    className="bg-slate-950 border-slate-700"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-300">Trailing Stop Distance (Pips)</Label>
                  <Input
                    type="number"
                    step="5"
                    min="10"
                    value={localSettings.trailingStopPips}
                    onChange={(e) => setLocalSettings({...localSettings, trailingStopPips: parseInt(e.target.value)})}
                    className="bg-slate-950 border-slate-700"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-300">Profit Protection (%)</Label>
                  <Input
                    type="number"
                    step="5"
                    min="0"
                    max="100"
                    value={localSettings.profitProtectPercent}
                    onChange={(e) => setLocalSettings({...localSettings, profitProtectPercent: parseInt(e.target.value)})}
                    className="bg-slate-950 border-slate-700"
                  />
                  <p className="text-xs text-slate-500">Lock in profits when this % of TP is reached</p>
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-300">Max Hold Time (Hours)</Label>
                  <Input
                    type="number"
                    step="1"
                    min="1"
                    value={localSettings.maxHoldHours}
                    onChange={(e) => setLocalSettings({...localSettings, maxHoldHours: parseInt(e.target.value)})}
                    className="bg-slate-950 border-slate-700"
                  />
                  <p className="text-xs text-slate-500">Close losing trades after this duration</p>
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-300">Monitoring Interval (Minutes)</Label>
                  <Input
                    type="number"
                    step="5"
                    min="5"
                    value={localSettings.monitoringInterval}
                    onChange={(e) => setLocalSettings({...localSettings, monitoringInterval: parseInt(e.target.value)})}
                    className="bg-slate-950 border-slate-700"
                  />
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSettingsOpen(false)}
              className="border-slate-700 text-slate-300"
            >
              Cancel
            </Button>
            <Button
              onClick={() => saveSettings.mutate(localSettings)}
              className="bg-purple-600 hover:bg-purple-700"
            >
              Save Settings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}