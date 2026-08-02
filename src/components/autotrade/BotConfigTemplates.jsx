import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Save, FolderOpen, Trash2, Download, Upload, Copy } from 'lucide-react';
import { toast } from 'sonner';

const STORAGE_KEY = 'botConfigTemplates';

function loadTemplates() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}
function saveTemplates(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

// Fields that should NOT be copied from a bot into a template (bot-specific identity/runtime state)
const SKIP_FIELDS = ['id', 'created_date', 'updated_date', 'created_by', 'created_by_id', 'entity_name', 'app_id', 'is_sample', 'is_deleted', 'deleted_date', 'environment', 'status', 'owner_email'];

export default function BotConfigTemplates({ onApplyTemplate }) {
  const queryClient = useQueryClient();
  const [templateName, setTemplateName] = useState('');
  const [selectedBotId, setSelectedBotId] = useState('');
  const [templates, setTemplates] = useState(loadTemplates);

  const { data: bots = [] } = useQuery({
    queryKey: ['bots'],
    queryFn: () => base44.entities.BotConfig.list('-created_date', 100),
  });

  const refresh = () => setTemplates(loadTemplates());

  const handleSave = () => {
    if (!templateName.trim()) { toast.error('Enter a template name'); return; }
    if (!selectedBotId) { toast.error('Select a bot to save'); return; }
    const bot = bots.find(b => b.id === selectedBotId);
    if (!bot) { toast.error('Bot not found'); return; }

    // Strip identity/runtime fields — keep only config values
    const config = {};
    for (const [key, value] of Object.entries(bot)) {
      if (!SKIP_FIELDS.includes(key)) config[key] = value;
    }

    const newTemplate = {
      id: `tpl_${Date.now()}`,
      name: templateName.trim(),
      saved_at: new Date().toISOString(),
      config,
    };

    const updated = [...templates, newTemplate];
    saveTemplates(updated);
    refresh();
    setTemplateName('');
    setSelectedBotId('');
    toast.success(`Template "${newTemplate.name}" saved`);
  };

  const handleDelete = (id) => {
    const updated = templates.filter(t => t.id !== id);
    saveTemplates(updated);
    refresh();
    toast.success('Template deleted');
  };

  const handleApply = (template) => {
    if (onApplyTemplate) {
      onApplyTemplate(template.config);
      toast.success(`Template "${template.name}" loaded — review and save to deploy`);
    }
  };

  const handleExport = (template) => {
    const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${template.name.replace(/\s+/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const imported = JSON.parse(ev.target.result);
        if (!imported.config) { toast.error('Invalid template file'); return; }
        const newTemplate = {
          id: `tpl_${Date.now()}`,
          name: imported.name || 'Imported Template',
          saved_at: new Date().toISOString(),
          config: imported.config,
        };
        const updated = [...templates, newTemplate];
        saveTemplates(updated);
        refresh();
        toast.success(`Template "${newTemplate.name}" imported`);
      } catch { toast.error('Failed to parse file'); }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="space-y-6">
      {/* Save Section */}
      <Card className="bg-slate-900/50 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Save className="w-5 h-5 text-emerald-500" /> Save Current Bot as Template
          </CardTitle>
          <CardDescription className="text-slate-400">
            Snapshot any bot's configuration so you can restore or duplicate it later.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div className="space-y-2 md:col-span-1">
              <Label className="text-slate-300">Select Bot</Label>
              <Select value={selectedBotId} onValueChange={setSelectedBotId}>
                <SelectTrigger className="bg-slate-950 border-slate-800">
                  <SelectValue placeholder="Choose a bot..." />
                </SelectTrigger>
                <SelectContent>
                  {bots.map(bot => (
                    <SelectItem key={bot.id} value={bot.id}>
                      {bot.name} ({bot.strategy_type?.replace('_', ' ')})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-1">
              <Label className="text-slate-300">Template Name</Label>
              <Input
                value={templateName}
                onChange={e => setTemplateName(e.target.value)}
                placeholder="e.g. Crypto Hybrid v2"
                className="bg-slate-950 border-slate-800"
              />
            </div>
            <Button onClick={handleSave} className="bg-emerald-600 hover:bg-emerald-700 md:col-span-1">
              <Save className="w-4 h-4 mr-2" /> Save Template
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Templates List */}
      <Card className="bg-slate-900/50 border-slate-800">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-white flex items-center gap-2">
              <FolderOpen className="w-5 h-5 text-cyan-500" /> Saved Templates
            </CardTitle>
            <CardDescription className="text-slate-400">
              {templates.length} template{templates.length !== 1 ? 's' : ''} stored locally on this device
            </CardDescription>
          </div>
          <div>
            <input type="file" id="import-template" accept=".json" className="hidden" onChange={handleImport} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => document.getElementById('import-template').click()}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              <Upload className="w-4 h-4 mr-2" /> Import
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {templates.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              <FolderOpen className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p>No templates saved yet. Save a bot config above to get started.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {templates.map(tpl => (
                <div
                  key={tpl.id}
                  className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-4 rounded-lg bg-slate-950/50 border border-slate-800 hover:border-slate-700 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-white font-medium">{tpl.name}</span>
                      <Badge variant="outline" className="text-xs border-slate-700 text-slate-400">
                        {tpl.config.strategy_type?.replace('_', ' ') || 'UNKNOWN'}
                      </Badge>
                      {tpl.config.pairs?.length > 0 && (
                        <Badge variant="outline" className="text-xs border-emerald-500/30 text-emerald-400 bg-emerald-500/10">
                          {tpl.config.pairs.length} pair{tpl.config.pairs.length !== 1 ? 's' : ''}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      Saved {new Date(tpl.saved_at).toLocaleDateString()} · Lot {tpl.config.lot_size || 0.1} · Conf {tpl.config.min_confidence || 80}% · {tpl.config.trading_start_time || '00:00'}–{tpl.config.trading_end_time || '23:59'}
                    </p>
                    {tpl.config.pairs?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {tpl.config.pairs.slice(0, 6).map(p => (
                          <span key={p} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800/60 border border-slate-700 text-slate-300">{p}</span>
                        ))}
                        {tpl.config.pairs.length > 6 && <span className="text-[10px] text-slate-500">+{tpl.config.pairs.length - 6} more</span>}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      onClick={() => handleApply(tpl)}
                      className="bg-emerald-600 hover:bg-emerald-700"
                    >
                      <Copy className="w-3.5 h-3.5 mr-1.5" /> Load
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleExport(tpl)}
                      className="border-slate-700 text-slate-300 hover:bg-slate-800"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDelete(tpl.id)}
                      className="border-rose-500/30 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}