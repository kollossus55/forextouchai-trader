import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Save, PlayCircle, GitBranch, ArrowRight, BrainCircuit } from 'lucide-react';

export default function StrategyBuilder() {
  const [nodes, setNodes] = useState([
    { id: 1, type: 'trigger', label: 'When RSI < 30', category: 'indicator' },
    { id: 2, type: 'condition', label: 'AND Market Trend is Bullish', category: 'logic' },
    { id: 3, type: 'action', label: 'Buy EUR/USD', category: 'execution' }
  ]);

  const addNode = (type) => {
    const newNode = {
      id: Date.now(),
      type,
      label: type === 'trigger' ? 'New Trigger' : type === 'condition' ? 'New Condition' : 'New Action',
      category: type === 'trigger' ? 'indicator' : type === 'condition' ? 'logic' : 'execution'
    };
    setNodes([...nodes, newNode]);
  };

  const removeNode = (id) => {
    setNodes(nodes.filter(n => n.id !== id));
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[600px]">
      {/* Toolbox */}
      <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-sm lg:col-span-1">
        <CardHeader>
          <CardTitle className="text-white text-lg flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-emerald-400" /> Components
          </CardTitle>
          <CardDescription className="text-slate-400">Drag blocks to build strategy</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-xs text-slate-500 uppercase font-bold mb-2 block">Indicators</Label>
            <div className="space-y-2">
              <Button variant="outline" className="w-full justify-start border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white" onClick={() => addNode('trigger')}>
                <div className="w-2 h-2 bg-blue-500 rounded-full mr-2"></div> RSI Divergence
              </Button>
              <Button variant="outline" className="w-full justify-start border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white" onClick={() => addNode('trigger')}>
                <div className="w-2 h-2 bg-blue-500 rounded-full mr-2"></div> MACD Crossover
              </Button>
              <Button variant="outline" className="w-full justify-start border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white" onClick={() => addNode('trigger')}>
                <div className="w-2 h-2 bg-purple-500 rounded-full mr-2"></div> AI Sentiment Score
              </Button>
            </div>
          </div>
          
          <div>
            <Label className="text-xs text-slate-500 uppercase font-bold mb-2 block">Logic</Label>
            <div className="space-y-2">
              <Button variant="outline" className="w-full justify-start border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white" onClick={() => addNode('condition')}>
                <div className="w-2 h-2 bg-amber-500 rounded-full mr-2"></div> AND / OR
              </Button>
              <Button variant="outline" className="w-full justify-start border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white" onClick={() => addNode('condition')}>
                <div className="w-2 h-2 bg-amber-500 rounded-full mr-2"></div> Time Window
              </Button>
            </div>
          </div>

          <div>
            <Label className="text-xs text-slate-500 uppercase font-bold mb-2 block">Execution</Label>
            <div className="space-y-2">
              <Button variant="outline" className="w-full justify-start border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white" onClick={() => addNode('action')}>
                <div className="w-2 h-2 bg-emerald-500 rounded-full mr-2"></div> Market Buy/Sell
              </Button>
              <Button variant="outline" className="w-full justify-start border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white" onClick={() => addNode('action')}>
                <div className="w-2 h-2 bg-emerald-500 rounded-full mr-2"></div> Dynamic Stop Loss
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Canvas */}
      <Card className="bg-slate-950 border-slate-800 lg:col-span-2 relative overflow-hidden">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(30,41,59,0.5)_1px,transparent_1px),linear-gradient(90deg,rgba(30,41,59,0.5)_1px,transparent_1px)] bg-[size:20px_20px] pointer-events-none"></div>
        <CardHeader className="relative z-10 flex flex-row justify-between items-center border-b border-slate-800/50 bg-slate-900/50 backdrop-blur-sm">
          <div>
            <Input 
              className="bg-transparent border-none text-white font-bold text-lg placeholder:text-slate-500 focus-visible:ring-0 px-0 h-auto" 
              defaultValue="New Trend Following Strategy" 
            />
            <p className="text-xs text-slate-400 mt-1">Visual logic editor</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="border-slate-700 text-slate-300">
              <PlayCircle className="w-4 h-4 mr-2" /> Test
            </Button>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700">
              <Save className="w-4 h-4 mr-2" /> Save Strategy
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-8 relative z-10 h-full overflow-y-auto">
          <div className="flex flex-col items-center space-y-4 pb-20">
            {nodes.map((node, index) => (
              <div key={node.id} className="relative group w-full max-w-md">
                {/* Connecting Line */}
                {index > 0 && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 w-0.5 h-4 bg-slate-700"></div>
                )}
                
                <div className={`
                  p-4 rounded-lg border flex items-center justify-between shadow-lg transition-all
                  ${node.type === 'trigger' ? 'bg-blue-950/40 border-blue-500/30' : 
                    node.type === 'condition' ? 'bg-amber-950/40 border-amber-500/30' : 
                    'bg-emerald-950/40 border-emerald-500/30'}
                `}>
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded flex items-center justify-center
                      ${node.type === 'trigger' ? 'bg-blue-500/20 text-blue-400' : 
                        node.type === 'condition' ? 'bg-amber-500/20 text-amber-400' : 
                        'bg-emerald-500/20 text-emerald-400'}
                    `}>
                      {node.type === 'trigger' ? 'IF' : node.type === 'condition' ? '&' : 'DO'}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-slate-200">{node.label}</div>
                      <div className="text-[10px] text-slate-500 uppercase">{node.category}</div>
                    </div>
                  </div>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => removeNode(node.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
            
            <div className="pt-4">
              <div className="w-8 h-8 rounded-full border-2 border-dashed border-slate-700 flex items-center justify-center text-slate-500">
                <Plus className="w-4 h-4" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}