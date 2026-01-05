import React from 'react';
import { LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-slate-900 border border-slate-700 p-2 rounded shadow-lg">
        <p className="text-xs text-slate-400">Period: {label}</p>
        {payload.map((entry, index) => (
          <p key={index} className="text-xs font-mono" style={{ color: entry.color }}>
            {entry.name}: {typeof entry.value === 'number' ? entry.value.toFixed(4) : entry.value}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

export default function IndicatorCharts({ priceData, indicators }) {
  if (!priceData || priceData.length === 0) {
    return (
      <div className="text-center py-8 text-slate-500">
        Generating chart data...
      </div>
    );
  }

  // Prepare data for charts
  const chartData = priceData.map((candle, index) => ({
    period: index,
    price: candle.close,
    high: candle.high,
    low: candle.low,
    ...candle.indicators
  }));

  return (
    <Tabs defaultValue="price" className="w-full">
      <TabsList className="bg-slate-900 border border-slate-800 w-full grid grid-cols-5">
        <TabsTrigger value="price" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white text-xs">Price + EMA</TabsTrigger>
        <TabsTrigger value="rsi" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white text-xs">RSI</TabsTrigger>
        <TabsTrigger value="macd" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white text-xs">MACD</TabsTrigger>
        <TabsTrigger value="bb" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white text-xs">Bollinger</TabsTrigger>
        <TabsTrigger value="stoch" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white text-xs">Stochastic</TabsTrigger>
      </TabsList>

      <TabsContent value="price" className="mt-4">
        <Card className="bg-slate-950/50 border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-300">Price Action with EMA (200)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="period" stroke="#64748b" tick={{ fontSize: 10 }} />
                <YAxis stroke="#64748b" tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
                <Tooltip content={<CustomTooltip />} />
                <Line type="monotone" dataKey="price" stroke="#10b981" strokeWidth={2} dot={false} name="Price" />
                <Line type="monotone" dataKey="ema200" stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="5 5" name="EMA 200" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="rsi" className="mt-4">
        <Card className="bg-slate-950/50 border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-300">RSI (14) - Relative Strength Index</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="period" stroke="#64748b" tick={{ fontSize: 10 }} />
                <YAxis stroke="#64748b" tick={{ fontSize: 10 }} domain={[0, 100]} />
                <Tooltip content={<CustomTooltip />} />
                <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="3 3" label={{ value: 'Overbought', fill: '#ef4444', fontSize: 10 }} />
                <ReferenceLine y={30} stroke="#10b981" strokeDasharray="3 3" label={{ value: 'Oversold', fill: '#10b981', fontSize: 10 }} />
                <ReferenceLine y={50} stroke="#64748b" strokeDasharray="2 2" />
                <Line type="monotone" dataKey="rsi" stroke="#a855f7" strokeWidth={2} dot={false} name="RSI" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="macd" className="mt-4">
        <Card className="bg-slate-950/50 border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-300">MACD (12, 26, 9)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="period" stroke="#64748b" tick={{ fontSize: 10 }} />
                <YAxis stroke="#64748b" tick={{ fontSize: 10 }} />
                <Tooltip content={<CustomTooltip />} />
                <ReferenceLine y={0} stroke="#64748b" />
                <Bar dataKey="macdHistogram" fill="#3b82f6" name="Histogram" />
                <Line type="monotone" dataKey="macdValue" stroke="#10b981" strokeWidth={2} dot={false} name="MACD" />
                <Line type="monotone" dataKey="macdSignal" stroke="#ef4444" strokeWidth={2} dot={false} name="Signal" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="bb" className="mt-4">
        <Card className="bg-slate-950/50 border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-300">Bollinger Bands (20, 2)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="period" stroke="#64748b" tick={{ fontSize: 10 }} />
                <YAxis stroke="#64748b" tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="bbUpper" stroke="#ef4444" fill="#ef444420" strokeWidth={1.5} name="Upper Band" />
                <Area type="monotone" dataKey="bbLower" stroke="#10b981" fill="#10b98120" strokeWidth={1.5} name="Lower Band" />
                <Line type="monotone" dataKey="bbMiddle" stroke="#f59e0b" strokeWidth={1} dot={false} strokeDasharray="3 3" name="Middle" />
                <Line type="monotone" dataKey="price" stroke="#fff" strokeWidth={2} dot={false} name="Price" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="stoch" className="mt-4">
        <Card className="bg-slate-950/50 border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-300">Stochastic Oscillator (14, 3, 3)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="period" stroke="#64748b" tick={{ fontSize: 10 }} />
                <YAxis stroke="#64748b" tick={{ fontSize: 10 }} domain={[0, 100]} />
                <Tooltip content={<CustomTooltip />} />
                <ReferenceLine y={80} stroke="#ef4444" strokeDasharray="3 3" label={{ value: 'Overbought', fill: '#ef4444', fontSize: 10 }} />
                <ReferenceLine y={20} stroke="#10b981" strokeDasharray="3 3" label={{ value: 'Oversold', fill: '#10b981', fontSize: 10 }} />
                <ReferenceLine y={50} stroke="#64748b" strokeDasharray="2 2" />
                <Line type="monotone" dataKey="stochK" stroke="#06b6d4" strokeWidth={2} dot={false} name="%K" />
                <Line type="monotone" dataKey="stochD" stroke="#f97316" strokeWidth={2} dot={false} name="%D" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}