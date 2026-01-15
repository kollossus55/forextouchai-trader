import React, { useState, useRef, useEffect } from 'react';
import { ComposedChart, Line, Area, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Label } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  TrendingUp, 
  TrendingDown, 
  Minus, 
  Plus, 
  Save, 
  Settings, 
  Eye, 
  EyeOff,
  Trash2,
  Move,
  AlertCircle,
  Calendar
} from 'lucide-react';
import ChartDrawingTools from './ChartDrawingTools';
import ChartTemplateManager from './ChartTemplateManager';
import MultiPairComparison from './MultiPairComparison';
import ChartNewsOverlay from './ChartNewsOverlay';

const CustomTooltip = ({ active, payload, label, newsEvents }) => {
  if (!active || !payload || !payload.length) return null;
  
  // Check if there's a news event at this period
  const periodNews = newsEvents?.filter(n => n.period === label) || [];
  
  return (
    <div className="bg-slate-900 border border-slate-700 p-3 rounded shadow-lg">
      <p className="text-xs text-slate-400 mb-2">Period: {label}</p>
      {payload.map((entry, index) => (
        <p key={index} className="text-xs font-mono" style={{ color: entry.color }}>
          {entry.name}: {typeof entry.value === 'number' ? entry.value.toFixed(5) : entry.value}
        </p>
      ))}
      {periodNews.length > 0 && (
        <div className="mt-2 pt-2 border-t border-slate-700">
          <div className="flex items-center gap-1 text-amber-400 text-xs mb-1">
            <AlertCircle className="w-3 h-3" />
            <span className="font-bold">News Events</span>
          </div>
          {periodNews.map((news, i) => (
            <div key={i} className="text-[10px] text-slate-300 mb-1">
              <Badge className="text-[8px] h-4 mr-1" variant={news.impact === 'HIGH' ? 'destructive' : 'outline'}>
                {news.impact}
              </Badge>
              {news.title}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default function AdvancedChart({ 
  priceData, 
  pairSymbol, 
  currentPrice,
  newsEvents = [],
  economicEvents = [],
  onTemplateChange
}) {
  const [activeIndicators, setActiveIndicators] = useState(['price', 'ema200']);
  const [chartMode, setChartMode] = useState('normal'); // normal, compare, drawing
  const [drawings, setDrawings] = useState([]);
  const [currentTemplate, setCurrentTemplate] = useState(null);
  const [showNews, setShowNews] = useState(true);
  const [comparisonPairs, setComparisonPairs] = useState([]);

  if (!priceData || priceData.length === 0) {
    return (
      <Card className="bg-slate-950/50 border-slate-800">
        <CardContent className="py-8 text-center text-slate-500">
          Generating chart data...
        </CardContent>
      </Card>
    );
  }

  const chartData = priceData.map((candle, index) => ({
    period: index,
    price: candle.close,
    high: candle.high,
    low: candle.low,
    open: candle.open,
    ...candle.indicators
  }));

  // Map news events to chart periods
  const newsEventsWithPeriod = newsEvents.map((event, i) => ({
    ...event,
    period: Math.floor((i / newsEvents.length) * chartData.length)
  }));

  const toggleIndicator = (indicator) => {
    setActiveIndicators(prev => 
      prev.includes(indicator) 
        ? prev.filter(i => i !== indicator)
        : [...prev, indicator]
    );
  };

  const applyTemplate = (template) => {
    setActiveIndicators(template.indicators);
    setDrawings(template.drawings || []);
    setShowNews(template.showNews ?? true);
    setCurrentTemplate(template);
    onTemplateChange?.(template);
  };

  const saveCurrentAsTemplate = () => {
    const template = {
      name: `Template ${new Date().toLocaleTimeString()}`,
      indicators: activeIndicators,
      drawings,
      showNews,
      timestamp: new Date().toISOString()
    };
    setCurrentTemplate(template);
    // Save to localStorage
    const templates = JSON.parse(localStorage.getItem('chartTemplates') || '[]');
    templates.push(template);
    localStorage.setItem('chartTemplates', JSON.stringify(templates));
    return template;
  };

  return (
    <div className="space-y-4">
      {/* Chart Controls */}
      <Card className="bg-slate-900 border-slate-800">
        <CardContent className="py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Indicator Toggles */}
            <div className="flex flex-wrap gap-2">
              <Badge 
                onClick={() => toggleIndicator('ema200')}
                className={`cursor-pointer ${activeIndicators.includes('ema200') ? 'bg-amber-500/20 text-amber-400 border-amber-500' : 'bg-slate-800 text-slate-400 border-slate-700'}`}
              >
                EMA 200
              </Badge>
              <Badge 
                onClick={() => toggleIndicator('rsi')}
                className={`cursor-pointer ${activeIndicators.includes('rsi') ? 'bg-purple-500/20 text-purple-400 border-purple-500' : 'bg-slate-800 text-slate-400 border-slate-700'}`}
              >
                RSI
              </Badge>
              <Badge 
                onClick={() => toggleIndicator('macd')}
                className={`cursor-pointer ${activeIndicators.includes('macd') ? 'bg-blue-500/20 text-blue-400 border-blue-500' : 'bg-slate-800 text-slate-400 border-slate-700'}`}
              >
                MACD
              </Badge>
              <Badge 
                onClick={() => toggleIndicator('bollinger')}
                className={`cursor-pointer ${activeIndicators.includes('bollinger') ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500' : 'bg-slate-800 text-slate-400 border-slate-700'}`}
              >
                Bollinger Bands
              </Badge>
              <Badge 
                onClick={() => setShowNews(!showNews)}
                className={`cursor-pointer ${showNews ? 'bg-amber-500/20 text-amber-400 border-amber-500' : 'bg-slate-800 text-slate-400 border-slate-700'}`}
              >
                <Calendar className="w-3 h-3 mr-1" />
                News Events
              </Badge>
            </div>

            {/* Chart Mode Buttons */}
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={chartMode === 'drawing' ? 'default' : 'outline'}
                onClick={() => setChartMode(chartMode === 'drawing' ? 'normal' : 'drawing')}
                className="h-8 text-xs"
              >
                <Move className="w-3 h-3 mr-1" />
                Draw
              </Button>
              <Button
                size="sm"
                variant={chartMode === 'compare' ? 'default' : 'outline'}
                onClick={() => setChartMode(chartMode === 'compare' ? 'normal' : 'compare')}
                className="h-8 text-xs"
              >
                <TrendingUp className="w-3 h-3 mr-1" />
                Compare
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={saveCurrentAsTemplate}
                className="h-8 text-xs"
              >
                <Save className="w-3 h-3 mr-1" />
                Save Template
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Drawing Tools Panel */}
      {chartMode === 'drawing' && (
        <ChartDrawingTools 
          drawings={drawings}
          onDrawingsChange={setDrawings}
          chartData={chartData}
        />
      )}

      {/* Multi-Pair Comparison */}
      {chartMode === 'compare' && (
        <MultiPairComparison
          basePair={pairSymbol}
          onPairsChange={setComparisonPairs}
        />
      )}

      {/* Main Chart */}
      <Card className="bg-slate-950/50 border-slate-800">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm text-slate-300">
              {pairSymbol} - Advanced Chart
              {currentTemplate && (
                <Badge className="ml-2 text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500">
                  Template: {currentTemplate.name}
                </Badge>
              )}
            </CardTitle>
            <div className="text-xs text-slate-400">
              Current: {currentPrice?.toFixed(5)}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={400}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="period" stroke="#64748b" tick={{ fontSize: 10 }} />
              <YAxis stroke="#64748b" tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
              <Tooltip content={<CustomTooltip newsEvents={newsEventsWithPeriod} />} />

              {/* News Event Markers */}
              {showNews && newsEventsWithPeriod.map((event, i) => (
                <ReferenceLine 
                  key={`news-${i}`}
                  x={event.period} 
                  stroke={event.impact === 'HIGH' ? '#ef4444' : '#f59e0b'} 
                  strokeDasharray="3 3"
                  label={{ 
                    value: '📰', 
                    position: 'top',
                    fill: event.impact === 'HIGH' ? '#ef4444' : '#f59e0b',
                    fontSize: 12
                  }}
                />
              ))}

              {/* Price Line */}
              {activeIndicators.includes('price') && (
                <Line 
                  type="monotone" 
                  dataKey="price" 
                  stroke="#10b981" 
                  strokeWidth={2} 
                  dot={false} 
                  name="Price"
                />
              )}

              {/* EMA 200 */}
              {activeIndicators.includes('ema200') && (
                <Line 
                  type="monotone" 
                  dataKey="ema200" 
                  stroke="#f59e0b" 
                  strokeWidth={1.5} 
                  dot={false} 
                  strokeDasharray="5 5" 
                  name="EMA 200"
                />
              )}

              {/* Bollinger Bands */}
              {activeIndicators.includes('bollinger') && (
                <>
                  <Area 
                    type="monotone" 
                    dataKey="bbUpper" 
                    stroke="#ef4444" 
                    fill="#ef444420" 
                    strokeWidth={1} 
                    name="BB Upper"
                  />
                  <Area 
                    type="monotone" 
                    dataKey="bbLower" 
                    stroke="#10b981" 
                    fill="#10b98120" 
                    strokeWidth={1} 
                    name="BB Lower"
                  />
                  <Line 
                    type="monotone" 
                    dataKey="bbMiddle" 
                    stroke="#f59e0b" 
                    strokeWidth={1} 
                    dot={false} 
                    strokeDasharray="3 3" 
                    name="BB Middle"
                  />
                </>
              )}

              {/* MACD Histogram */}
              {activeIndicators.includes('macd') && (
                <Bar 
                  dataKey="macdHistogram" 
                  fill="#3b82f6" 
                  name="MACD Histogram"
                  opacity={0.6}
                />
              )}

              {/* Drawing Overlays */}
              {drawings.map((drawing, i) => {
                if (drawing.type === 'trendline') {
                  return (
                    <ReferenceLine
                      key={`drawing-${i}`}
                      segment={[
                        { x: drawing.startX, y: drawing.startY },
                        { x: drawing.endX, y: drawing.endY }
                      ]}
                      stroke={drawing.color || '#06b6d4'}
                      strokeWidth={2}
                      ifOverflow="extendDomain"
                    />
                  );
                }
                if (drawing.type === 'fibonacci') {
                  const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
                  const range = drawing.endY - drawing.startY;
                  return levels.map((level, j) => (
                    <ReferenceLine
                      key={`fib-${i}-${j}`}
                      y={drawing.startY + range * level}
                      stroke={j === 3 ? '#f59e0b' : '#64748b'}
                      strokeDasharray="3 3"
                      strokeWidth={j === 3 ? 2 : 1}
                      label={{ 
                        value: `${(level * 100).toFixed(1)}%`, 
                        position: 'right',
                        fill: '#64748b',
                        fontSize: 9
                      }}
                    />
                  ));
                }
                return null;
              })}

              {/* Comparison Pairs */}
              {comparisonPairs.map((pair, i) => (
                <Line
                  key={`compare-${i}`}
                  type="monotone"
                  dataKey={`${pair.symbol}_normalized`}
                  stroke={pair.color}
                  strokeWidth={1.5}
                  dot={false}
                  name={pair.symbol}
                  opacity={0.7}
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* RSI Indicator */}
      {activeIndicators.includes('rsi') && (
        <Card className="bg-slate-950/50 border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-300">RSI (14)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={120}>
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="period" stroke="#64748b" tick={{ fontSize: 10 }} />
                <YAxis stroke="#64748b" tick={{ fontSize: 10 }} domain={[0, 100]} />
                <Tooltip content={<CustomTooltip />} />
                <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="3 3" />
                <ReferenceLine y={30} stroke="#10b981" strokeDasharray="3 3" />
                <Line type="monotone" dataKey="rsi" stroke="#a855f7" strokeWidth={2} dot={false} name="RSI" />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Chart Template Manager */}
      <ChartTemplateManager 
        currentTemplate={currentTemplate}
        onApplyTemplate={applyTemplate}
      />

      {/* News & Events Feed */}
      {showNews && (
        <ChartNewsOverlay 
          newsEvents={newsEvents}
          economicEvents={economicEvents}
        />
      )}
    </div>
  );
}