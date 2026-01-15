import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Save, Trash2, Download, Upload } from 'lucide-react';
import { toast } from 'sonner';

export default function ChartTemplateManager({ currentTemplate, onApplyTemplate }) {
  const [templates, setTemplates] = useState([]);
  const [templateName, setTemplateName] = useState('');

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = () => {
    try {
      const saved = JSON.parse(localStorage.getItem('chartTemplates') || '[]');
      setTemplates(saved);
    } catch (e) {
      console.error('Failed to load templates:', e);
      setTemplates([]);
    }
  };

  const saveTemplate = () => {
    if (!templateName.trim()) {
      toast.error('Please enter a template name');
      return;
    }

    if (!currentTemplate) {
      toast.error('No active configuration to save');
      return;
    }

    const newTemplate = {
      ...currentTemplate,
      name: templateName,
      timestamp: new Date().toISOString()
    };

    const updated = [...templates, newTemplate];
    setTemplates(updated);
    localStorage.setItem('chartTemplates', JSON.stringify(updated));
    setTemplateName('');
    toast.success(`Template "${templateName}" saved`);
  };

  const deleteTemplate = (index) => {
    const updated = templates.filter((_, i) => i !== index);
    setTemplates(updated);
    localStorage.setItem('chartTemplates', JSON.stringify(updated));
    toast.success('Template deleted');
  };

  const exportTemplates = () => {
    const dataStr = JSON.stringify(templates, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const exportFileDefaultName = `chart-templates-${Date.now()}.json`;

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
    toast.success('Templates exported');
  };

  const importTemplates = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const imported = JSON.parse(e.target?.result);
        if (Array.isArray(imported)) {
          const updated = [...templates, ...imported];
          setTemplates(updated);
          localStorage.setItem('chartTemplates', JSON.stringify(updated));
          toast.success(`Imported ${imported.length} templates`);
        }
      } catch (err) {
        toast.error('Invalid template file');
      }
    };
    reader.readAsText(file);
  };

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm text-white">Chart Templates</CardTitle>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={exportTemplates}
              disabled={templates.length === 0}
              className="h-7 text-xs"
            >
              <Download className="w-3 h-3 mr-1" />
              Export
            </Button>
            <label>
              <input
                type="file"
                accept=".json"
                onChange={importTemplates}
                className="hidden"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={(e) => e.currentTarget.previousElementSibling.click()}
              >
                <Upload className="w-3 h-3 mr-1" />
                Import
              </Button>
            </label>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Save Current Template */}
        <div className="flex gap-2">
          <Input
            placeholder="Template name..."
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            className="bg-slate-950 border-slate-800 text-slate-200 h-8 text-xs"
          />
          <Button
            size="sm"
            onClick={saveTemplate}
            className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700"
          >
            <Save className="w-3 h-3 mr-1" />
            Save
          </Button>
        </div>

        {/* Saved Templates List */}
        {templates.length > 0 ? (
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {templates.map((template, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-2 bg-slate-950/50 rounded border border-slate-800/50 hover:border-emerald-500/30 transition-colors"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-200">{template.name}</span>
                    {currentTemplate?.name === template.name && (
                      <Badge className="text-[8px] h-4 bg-emerald-500/20 text-emerald-400 border-emerald-500">
                        Active
                      </Badge>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    {template.indicators?.length || 0} indicators • {template.drawings?.length || 0} drawings
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onApplyTemplate(template)}
                    className="h-7 text-xs border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10"
                  >
                    Apply
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => deleteTemplate(index)}
                    className="h-7 w-7 p-0 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-4 text-xs text-slate-500">
            No saved templates. Configure your chart and save it above.
          </div>
        )}
      </CardContent>
    </Card>
  );
}