import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, X, TrendingUp } from 'lucide-react';

const MAJOR_PAIRS = [
  'EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF', 
  'AUD/USD', 'USD/CAD', 'NZD/USD'
];

const PAIR_COLORS = [
  '#06b6d4', '#8b5cf6', '#f59e0b', '#ec4899', '#10b981', '#ef4444'
];

export default function MultiPairComparison({ basePair, onPairsChange }) {
  const [selectedPairs, setSelectedPairs] = useState([]);
  const [currentSelection, setCurrentSelection] = useState('');

  const addPair = () => {
    if (!currentSelection || selectedPairs.some(p => p.symbol === currentSelection)) {
      return;
    }

    const newPair = {
      symbol: currentSelection,
      color: PAIR_COLORS[selectedPairs.length % PAIR_COLORS.length],
      id: Date.now()
    };

    const updated = [...selectedPairs, newPair];
    setSelectedPairs(updated);
    onPairsChange(updated);
    setCurrentSelection('');
  };

  const removePair = (id) => {
    const updated = selectedPairs.filter(p => p.id !== id);
    setSelectedPairs(updated);
    onPairsChange(updated);
  };

  const availablePairs = MAJOR_PAIRS.filter(
    pair => pair !== basePair && !selectedPairs.some(p => p.symbol === pair)
  );

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm text-white flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-cyan-400" />
          Multi-Pair Comparison
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Add Pair Selector */}
        <div className="flex gap-2">
          <Select value={currentSelection} onValueChange={setCurrentSelection}>
            <SelectTrigger className="flex-1 bg-slate-950 border-slate-800 text-slate-200 h-8 text-xs">
              <SelectValue placeholder="Select pair to compare..." />
            </SelectTrigger>
            <SelectContent>
              {availablePairs.map(pair => (
                <SelectItem key={pair} value={pair}>{pair}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            onClick={addPair}
            disabled={!currentSelection}
            className="h-8 text-xs"
          >
            <Plus className="w-3 h-3 mr-1" />
            Add
          </Button>
        </div>

        {/* Base Pair Info */}
        <div className="p-2 bg-slate-950/50 rounded border border-slate-800/50">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-emerald-500" />
            <span className="text-xs text-slate-300 font-medium">{basePair}</span>
            <Badge className="text-[8px] h-4 bg-emerald-500/20 text-emerald-400 border-emerald-500">
              Base
            </Badge>
          </div>
        </div>

        {/* Selected Pairs */}
        {selectedPairs.length > 0 ? (
          <div className="space-y-1">
            {selectedPairs.map((pair) => (
              <div
                key={pair.id}
                className="flex items-center justify-between p-2 bg-slate-950/50 rounded border border-slate-800/50"
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: pair.color }}
                  />
                  <span className="text-xs text-slate-300">{pair.symbol}</span>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => removePair(pair.id)}
                  className="h-6 w-6 p-0 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                >
                  <X className="w-3 h-3" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-3 text-xs text-slate-500">
            No comparison pairs selected
          </div>
        )}

        {/* Info */}
        <div className="bg-slate-950/50 p-3 rounded border border-slate-800/50">
          <p className="text-[10px] text-slate-400">
            <strong className="text-slate-300">Note:</strong> All pairs are normalized to the same scale 
            for visual comparison. Price movements are shown as percentage changes from the start point.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}