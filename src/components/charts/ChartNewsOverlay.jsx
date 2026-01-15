import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, Calendar, TrendingUp, TrendingDown } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

export default function ChartNewsOverlay({ newsEvents = [], economicEvents = [] }) {
  const combinedEvents = [
    ...newsEvents.map(n => ({ ...n, type: 'news' })),
    ...economicEvents.map(e => ({ ...e, type: 'economic' }))
  ].sort((a, b) => {
    const aTime = new Date(a.time || a.created_date).getTime();
    const bTime = new Date(b.time || b.created_date).getTime();
    return bTime - aTime;
  }).slice(0, 10);

  const getImpactColor = (impact) => {
    if (!impact) return 'bg-slate-800 text-slate-400 border-slate-700';
    if (impact === 'HIGH') return 'bg-rose-500/20 text-rose-400 border-rose-500';
    if (impact === 'MEDIUM') return 'bg-amber-500/20 text-amber-400 border-amber-500';
    return 'bg-blue-500/20 text-blue-400 border-blue-500';
  };

  const getSentimentColor = (sentiment) => {
    if (!sentiment) return 'text-slate-400';
    if (sentiment === 'POSITIVE') return 'text-emerald-400';
    if (sentiment === 'NEGATIVE') return 'text-rose-400';
    return 'text-slate-400';
  };

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm text-white flex items-center gap-2">
          <Calendar className="w-4 h-4 text-amber-400" />
          News & Events Feed
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-64 pr-4">
          <div className="space-y-2">
            {combinedEvents.length > 0 ? (
              combinedEvents.map((event, i) => (
                <div
                  key={i}
                  className="p-3 bg-slate-950/50 rounded border border-slate-800/50 hover:border-emerald-500/30 transition-colors"
                >
                  <div className="flex items-start gap-2">
                    {event.type === 'news' ? (
                      <AlertCircle className={`w-4 h-4 mt-0.5 ${getSentimentColor(event.sentiment)}`} />
                    ) : (
                      <Calendar className="w-4 h-4 mt-0.5 text-amber-400" />
                    )}
                    <div className="flex-1">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <span className="text-xs font-medium text-slate-200 line-clamp-2">
                          {event.title}
                        </span>
                        {event.impact && (
                          <Badge className={`text-[8px] h-4 ${getImpactColor(event.impact)}`}>
                            {event.impact}
                          </Badge>
                        )}
                      </div>
                      
                      {event.summary && (
                        <p className="text-[10px] text-slate-400 line-clamp-2 mb-2">
                          {event.summary}
                        </p>
                      )}

                      <div className="flex items-center gap-2 flex-wrap">
                        {event.source && (
                          <Badge className="text-[8px] h-4 bg-slate-800 text-slate-400 border-slate-700">
                            {event.source}
                          </Badge>
                        )}
                        {event.currency && (
                          <Badge className="text-[8px] h-4 bg-blue-500/20 text-blue-400 border-blue-500">
                            {event.currency}
                          </Badge>
                        )}
                        {event.sentiment && (
                          <div className={`flex items-center gap-1 text-[10px] ${getSentimentColor(event.sentiment)}`}>
                            {event.sentiment === 'POSITIVE' ? (
                              <TrendingUp className="w-3 h-3" />
                            ) : event.sentiment === 'NEGATIVE' ? (
                              <TrendingDown className="w-3 h-3" />
                            ) : null}
                            <span>{event.sentiment}</span>
                          </div>
                        )}
                        {event.time && (
                          <span className="text-[9px] text-slate-500">
                            {new Date(event.time).toLocaleTimeString()}
                          </span>
                        )}
                      </div>

                      {/* Economic Event Details */}
                      {event.type === 'economic' && (
                        <div className="grid grid-cols-3 gap-2 mt-2 text-[10px]">
                          {event.actual && (
                            <div>
                              <span className="text-slate-500">Actual: </span>
                              <span className="text-white font-mono">{event.actual}</span>
                            </div>
                          )}
                          {event.forecast && (
                            <div>
                              <span className="text-slate-500">Forecast: </span>
                              <span className="text-slate-400 font-mono">{event.forecast}</span>
                            </div>
                          )}
                          {event.previous && (
                            <div>
                              <span className="text-slate-500">Previous: </span>
                              <span className="text-slate-400 font-mono">{event.previous}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-xs text-slate-500">
                No recent news or events
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}