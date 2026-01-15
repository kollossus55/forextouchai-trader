import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Minus, TrendingUp, Percent, Trash2, Move } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function ChartDrawingTools({ drawings, onDrawingsChange, chartData }) {
  const [activeTool, setActiveTool] = useState(null);
  const [drawingState, setDrawingState] = useState({ startX: null, startY: null });

  const tools = [
    { id: 'trendline', name: 'Trend Line', icon: Minus, color: '#06b6d4' },
    { id: 'horizontal', name: 'Horizontal Line', icon: Minus, color: '#8b5cf6' },
    { id: 'fibonacci', name: 'Fibonacci', icon: Percent, color: '#f59e0b' },
  ];

  const addDrawing = (type) => {
    if (!chartData || chartData.length === 0) return;
    
    const midPoint = Math.floor(chartData.length / 2);
    const startPrice = chartData[midPoint - 10]?.price || 1;
    const endPrice = chartData[midPoint + 10]?.price || 1;

    const newDrawing = {
      type,
      startX: midPoint - 10,
      startY: startPrice,
      endX: midPoint + 10,
      endY: endPrice,
      color: tools.find(t => t.id === type)?.color || '#06b6d4',
      id: Date.now()
    };

    onDrawingsChange([...drawings, newDrawing]);
  };

  const removeDrawing = (id) => {
    onDrawingsChange(drawings.filter(d => d.id !== id));
  };

  const clearAllDrawings = () => {
    onDrawingsChange([]);
  };

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm text-white flex items-center gap-2">
            <Move className="w-4 h-4 text-cyan-400" />
            Drawing Tools
          </CardTitle>
          <Button
            size="sm"
            variant="destructive"
            onClick={clearAllDrawings}
            disabled={drawings.length === 0}
            className="h-7 text-xs"
          >
            <Trash2 className="w-3 h-3 mr-1" />
            Clear All
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Tool Buttons */}
        <div className="flex flex-wrap gap-2">
          {tools.map((tool) => (
            <Button
              key={tool.id}
              size="sm"
              variant={activeTool === tool.id ? 'default' : 'outline'}
              onClick={() => {
                setActiveTool(tool.id);
                addDrawing(tool.id);
              }}
              className="h-8 text-xs"
              style={activeTool === tool.id ? { backgroundColor: tool.color, borderColor: tool.color } : {}}
            >
              <tool.icon className="w-3 h-3 mr-1" />
              {tool.name}
            </Button>
          ))}
        </div>

        {/* Active Drawings List */}
        {drawings.length > 0 && (
          <div className="space-y-2">
            <Label className="text-xs text-slate-400">Active Drawings ({drawings.length})</Label>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {drawings.map((drawing) => {
                const tool = tools.find(t => t.id === drawing.type);
                return (
                  <div
                    key={drawing.id}
                    className="flex items-center justify-between p-2 bg-slate-950/50 rounded border border-slate-800/50"
                  >
                    <div className="flex items-center gap-2">
                      {tool && <tool.icon className="w-3 h-3" style={{ color: drawing.color }} />}
                      <span className="text-xs text-slate-300">{tool?.name || drawing.type}</span>
                      <Badge className="text-[9px] h-4 bg-slate-800 border-slate-700">
                        {drawing.startX} → {drawing.endX}
                      </Badge>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeDrawing(drawing.id)}
                      className="h-6 w-6 p-0 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Instructions */}
        <div className="bg-slate-950/50 p-3 rounded border border-slate-800/50">
          <p className="text-[10px] text-slate-400">
            <strong className="text-slate-300">How to use:</strong> Click on a drawing tool to add it to the chart. 
            Drawings are positioned automatically. Use the coordinates shown to identify your analysis points.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}