import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import OpenAI from 'npm:openai';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { pairs, marketData } = await req.json();

        if (!Deno.env.get("OPENAI_API_KEY")) {
            return Response.json({ error: "OpenAI API Key not set" }, { status: 500 });
        }

        const openai = new OpenAI({
            apiKey: Deno.env.get("OPENAI_API_KEY"),
        });

        const prompt = `
        You are an expert Forex and Crypto trading analyst.
        Analyze the following market prices and generate ONE high-probability trade signal.
        
        Current Market Data:
        ${JSON.stringify(marketData, null, 2)}
        
        Pairs to consider: ${pairs.join(', ')}

        You must output valid JSON matching this schema:
        {
            "pair": "Symbol (e.g. EUR/USD)",
            "type": "BUY" or "SELL",
            "entry_price": number (current price),
            "stop_loss": number,
            "take_profit": number,
            "confidence": number (80-99),
            "strategy": "String description (e.g. 'Trend Reversal', 'Breakout')",
            "analysis_summary": "Short explanation of why"
        }

        Rules:
        1. Stop Loss and Take Profit must be realistic (approx 1:2 or 1:3 risk/reward).
        2. Use standard technical analysis reasoning for the strategy name.
        3. Only return the JSON object.
        `;

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "You are a professional trading algorithm. Output strictly valid JSON." },
                { role: "user", content: prompt }
            ],
            response_format: { type: "json_object" }
        });

        const signal = JSON.parse(completion.choices[0].message.content);

        return Response.json(signal);

    } catch (error) {
        console.error("AI Analysis Error:", error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});