import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Send, Loader2, TrendingUp, AlertCircle, CheckCircle2, Lightbulb } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

export default function BotConfigAI({ currentConfig, onApplyRecommendation, backtestResults }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const quickPrompts = [
    { label: "Optimize for Low Risk", prompt: "I want to minimize risk. Help me configure conservative parameters.", icon: AlertCircle },
    { label: "Maximize Returns", prompt: "I'm comfortable with higher risk for better returns. Suggest aggressive settings.", icon: TrendingUp },
    { label: "Explain Parameters", prompt: "Explain how stop loss and take profit affect my strategy performance.", icon: Lightbulb },
    { label: "Review Current Setup", prompt: "Review my current bot configuration and suggest improvements.", icon: CheckCircle2 }
  ];

  const handleSend = async (promptText) => {
    const userMessage = promptText || input;
    if (!userMessage.trim() || isLoading) return;

    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setInput('');
    setIsLoading(true);

    try {
      const context = {
        currentConfig,
        backtestResults: backtestResults || null,
        question: userMessage
      };

      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `You are an expert forex trading assistant helping a user configure their trading bot.

Current Bot Configuration:
- Strategy: ${currentConfig.strategy_type || 'Not set'}
- Risk Level: ${currentConfig.risk_level || 'MEDIUM'}
- Lot Size: ${currentConfig.lot_size || 0.1}
- Stop Loss: ${currentConfig.stop_loss_pips || 30} pips
- Take Profit: ${currentConfig.take_profit_pips || 60} pips
- AI Confidence Threshold: ${currentConfig.min_confidence || 80}%
- Max Concurrent Trades: ${currentConfig.max_open_trades || 3}
- Trading Pairs: ${currentConfig.pairs?.join(', ') || 'None selected'}
- SL/TP Mode: ${currentConfig.sl_tp_mode || 'FIXED'}
${currentConfig.sl_tp_mode === 'ATR' ? `- ATR Period: ${currentConfig.atr_period}, SL Multiplier: ${currentConfig.atr_multiplier_sl}, TP Multiplier: ${currentConfig.atr_multiplier_tp}` : ''}
- Money Management: ${currentConfig.money_management || 'FIXED'}
${currentConfig.money_management === 'MARTINGALE' ? `- Martingale Multiplier: ${currentConfig.martingale_multiplier}` : ''}

${backtestResults ? `Recent Backtest Results:
- Win Rate: ${backtestResults.winRate}%
- Total Return: ${backtestResults.totalReturn}%
- Max Drawdown: ${backtestResults.maxDrawdown}%
- Total Trades: ${backtestResults.totalTrades}` : ''}

User Question: ${userMessage}

Provide helpful, concise advice. If suggesting parameter changes, explain WHY. If the user asks for recommendations, provide specific numeric values with reasoning. Format your response clearly with bullet points when listing recommendations.`,
        response_json_schema: {
          type: "object",
          properties: {
            answer: { type: "string" },
            recommendations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  parameter: { type: "string" },
                  current_value: { type: "string" },
                  suggested_value: { type: "string" },
                  reason: { type: "string" }
                }
              }
            },
            risk_assessment: { type: "string" }
          }
        }
      });

      const aiMessage = {
        role: 'assistant',
        content: response.answer,
        recommendations: response.recommendations || [],
        riskAssessment: response.risk_assessment
      };

      setMessages(prev => [...prev, aiMessage]);
    } catch (error) {
      console.error('AI Error:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        error: true
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleApplyRecommendation = (recommendation) => {
    const paramMap = {
      'lot size': 'lot_size',
      'stop loss': 'stop_loss_pips',
      'take profit': 'take_profit_pips',
      'ai confidence': 'min_confidence',
      'min confidence': 'min_confidence',
      'confidence threshold': 'min_confidence',
      'max trades': 'max_open_trades',
      'risk level': 'risk_level',
      'atr period': 'atr_period',
      'sl multiplier': 'atr_multiplier_sl',
      'tp multiplier': 'atr_multiplier_tp',
      'martingale multiplier': 'martingale_multiplier'
    };

    const paramKey = paramMap[recommendation.parameter.toLowerCase()];
    if (paramKey) {
      let value = recommendation.suggested_value;
      
      // Parse numeric values
      if (paramKey.includes('pips') || paramKey.includes('lot') || paramKey.includes('confidence') || paramKey.includes('trades') || paramKey.includes('multiplier') || paramKey.includes('period')) {
        value = parseFloat(value) || parseInt(value);
      }
      
      onApplyRecommendation({ [paramKey]: value });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="w-5 h-5 text-purple-400" />
        <h3 className="text-lg font-semibold text-white">AI Trading Assistant</h3>
        <Badge variant="outline" className="text-xs border-purple-500/30 text-purple-400">Beta</Badge>
      </div>

      {/* Quick Prompts */}
      {messages.length === 0 && (
        <div className="grid grid-cols-2 gap-2">
          {quickPrompts.map((prompt, idx) => (
            <Button
              key={idx}
              variant="outline"
              size="sm"
              onClick={() => handleSend(prompt.prompt)}
              className="justify-start h-auto py-2 px-3 text-left border-slate-700 hover:border-purple-500/50 hover:bg-purple-500/10 text-slate-300 hover:text-purple-300"
            >
              <prompt.icon className="w-3.5 h-3.5 mr-2 flex-shrink-0" />
              <span className="text-xs">{prompt.label}</span>
            </Button>
          ))}
        </div>
      )}

      {/* Chat Messages */}
      <ScrollArea className="h-[300px] rounded-lg border border-slate-800 bg-slate-950/50 p-4">
        <div className="space-y-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-8">
              <Sparkles className="w-12 h-12 text-purple-400/30 mb-3" />
              <p className="text-sm text-slate-500">Ask me anything about bot configuration</p>
              <p className="text-xs text-slate-600 mt-1">I can help optimize parameters, explain strategies, and more</p>
            </div>
          ) : (
            messages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] ${msg.role === 'user' ? 'bg-emerald-600 text-white' : msg.error ? 'bg-rose-900/30 border border-rose-500/30 text-rose-200' : 'bg-slate-800 text-slate-100'} rounded-lg p-3`}>
                  {msg.role === 'assistant' && (
                    <div className="flex items-center gap-2 mb-2 text-purple-400">
                      <Sparkles className="w-3.5 h-3.5" />
                      <span className="text-xs font-medium">AI Assistant</span>
                    </div>
                  )}
                  
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>

                  {/* Recommendations */}
                  {msg.recommendations && msg.recommendations.length > 0 && (
                    <div className="mt-4 space-y-2">
                      <p className="text-xs font-semibold text-emerald-400">Recommended Changes:</p>
                      {msg.recommendations.map((rec, recIdx) => (
                        <Card key={recIdx} className="bg-slate-900/50 border-slate-700">
                          <CardContent className="p-3">
                            <div className="flex justify-between items-start mb-2">
                              <div className="flex-1">
                                <p className="text-xs font-medium text-white capitalize">{rec.parameter}</p>
                                <p className="text-[10px] text-slate-400 mt-1">
                                  <span className="text-rose-400">{rec.current_value}</span> → <span className="text-emerald-400">{rec.suggested_value}</span>
                                </p>
                              </div>
                              <Button
                                size="sm"
                                onClick={() => handleApplyRecommendation(rec)}
                                className="bg-emerald-600 hover:bg-emerald-700 h-6 px-2 text-[10px] ml-2"
                              >
                                Apply
                              </Button>
                            </div>
                            <p className="text-[10px] text-slate-500 leading-relaxed">{rec.reason}</p>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}

                  {/* Risk Assessment */}
                  {msg.riskAssessment && (
                    <div className="mt-3 p-2 bg-amber-500/10 border border-amber-500/30 rounded text-xs text-amber-200">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                        <span>{msg.riskAssessment}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}

          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-slate-800 rounded-lg p-3">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
                  <span className="text-sm text-slate-400">AI is thinking...</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="flex gap-2">
        <Textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Ask me about parameters, risk management, or strategy optimization..."
          className="bg-slate-950 border-slate-800 text-white resize-none h-20"
          disabled={isLoading}
        />
        <Button
          onClick={() => handleSend()}
          disabled={!input.trim() || isLoading}
          className="bg-purple-600 hover:bg-purple-700 px-4"
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}