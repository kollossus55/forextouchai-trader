import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import OpenAI from 'npm:openai';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { strategyType, currentParams, historicalData } = await req.json();

        if (!Deno.env.get("OPENAI_API_KEY")) {
            return Response.json({ error: "OpenAI API Key not set" }, { status: 500 });
        }

        const openai = new OpenAI({
            apiKey: Deno.env.get("OPENAI_API_KEY"),
        });

        const prompt = `
        You are an expert algorithmic trading strategist.
        Analyze the following trading strategy configuration and suggest optimized parameters based on general historical market behavior for the selected pairs.

        Strategy Type: ${strategyType}
        Current Parameters: ${JSON.stringify(currentParams, null, 2)}
        
        ${historicalData ? `Recent Market Context (Sample): ${JSON.stringify(historicalData.slice(0, 5))}...` : 'Assume standard market conditions for EUR/USD and major pairs.'}

        Your goal is to suggest improvements to:
        - Stop Loss (pips)
        - Take Profit (pips)
        - Minimum Confidence Threshold (%)
        - Lot Size (for better risk management)
        - Risk Level

        You must output valid JSON matching this schema:
        {
            "suggested_params": {
                "stop_loss_pips": number,
                "take_profit_pips": number,
                "min_confidence": number,
                "lot_size": number,
                "risk_level": "LOW" | "MEDIUM" | "HIGH",
                "reasoning": "Short explanation of why these changes are better"
            }
        }
        `;

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "You are a professional trading algorithm optimizer. Output strictly valid JSON." },
                { role: "user", content: prompt }
            ],
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(completion.choices[0].message.content);

        return Response.json(result);

    } catch (error) {
        console.error("Optimization Error:", error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});