import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

// AI assistant for bot configuration. Two narrow modes:
//   'advise'   — conversational advice + structured recommendations
//   'optimize' — returns only optimized numeric parameters
// Both use the deterministic LLM call server-side so integration credits
// are not exposed to the client.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const payload = await req.json();
    const { mode, config, question } = payload;

    if (!config || typeof config !== 'object') {
      return Response.json({ error: 'Bot config required' }, { status: 400 });
    }

    let prompt, schema;

    if (mode === 'optimize') {
      prompt = `You are an expert forex trading bot optimizer. Given the following bot configuration, suggest optimal parameter values based on best practices for the strategy type.

Current Config:
- Strategy: ${config.strategy_type}
- Risk Level: ${config.risk_level}
- Timeframe: ${config.timeframe}
- Lot Size: ${config.lot_size}
- Stop Loss Pips: ${config.stop_loss_pips}
- Take Profit Pips: ${config.take_profit_pips}
- Min AI Confidence: ${config.min_confidence}%
- Max Open Trades: ${config.max_open_trades}
- Max Trades Per Pair: ${config.max_trades_per_pair}

Return ONLY the optimized numeric values as a flat JSON object with the same field names. Optimize for the best risk/reward ratio given the strategy type. Keep lot_size unchanged. Only include fields you are actually changing.`;
      schema = {
        type: 'object',
        properties: {
          stop_loss_pips: { type: 'number' },
          take_profit_pips: { type: 'number' },
          min_confidence: { type: 'number' },
          max_open_trades: { type: 'number' },
          max_trades_per_pair: { type: 'number' },
          max_daily_trades: { type: 'number' }
        }
      };
    } else {
      // 'advise' mode (default)
      prompt = `You are an expert forex trading assistant helping a user configure their trading bot.

Current Bot Configuration:
- Strategy: ${config.strategy_type || 'Not set'}
- Risk Level: ${config.risk_level || 'MEDIUM'}
- Lot Size: ${config.lot_size || 0.1}
- Stop Loss: ${config.stop_loss_pips || 30} pips
- Take Profit: ${config.take_profit_pips || 60} pips
- AI Confidence Threshold: ${config.min_confidence || 80}%
- Max Concurrent Trades: ${config.max_open_trades || 3}
- Trading Pairs: ${config.pairs?.join(', ') || 'None selected'}
- SL/TP Mode: ${config.sl_tp_mode || 'FIXED'}
${config.sl_tp_mode === 'ATR' ? `- ATR Period: ${config.atr_period}, SL Multiplier: ${config.atr_multiplier_sl}, TP Multiplier: ${config.atr_multiplier_tp}` : ''}
- Money Management: ${config.money_management || 'FIXED'}
${config.money_management === 'MARTINGALE' ? `- Martingale Multiplier: ${config.martingale_multiplier}` : ''}

User Question: ${question || ''}

Provide helpful, concise advice. If suggesting parameter changes, explain WHY. If the user asks for recommendations, provide specific numeric values with reasoning. Format your response clearly with bullet points when listing recommendations.`;
      schema = {
        type: 'object',
        properties: {
          answer: { type: 'string' },
          recommendations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                parameter: { type: 'string' },
                current_value: { type: 'string' },
                suggested_value: { type: 'string' },
                reason: { type: 'string' }
              }
            }
          },
          risk_assessment: { type: 'string' }
        }
      };
    }

    const response = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: schema
    });

    return Response.json({ result: response });
  } catch (error) {
    console.error('[aiBotAssistant ERROR]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}