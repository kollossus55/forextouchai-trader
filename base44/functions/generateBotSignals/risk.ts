// ════════════════════════════════════════════════════════════════════════════
// Position sizing and exposure control
// ════════════════════════════════════════════════════════════════════════════
// The previous build put `lot_size: bot.lot_size || 0.01` on every signal and
// never read `risk_per_trade_percent`, even though it had a UI slider and was
// saved to the database. A fixed lot means risk varies with the stop: 0.10 lots
// with a 30-pip stop on EURUSD risks ~$30; the same 0.10 lots on gold with the
// stop the old code computed risked ~$180.
//
// Here the lot is DERIVED from the stop distance, so every trade risks the same
// fraction of the account regardless of instrument or volatility.
// ════════════════════════════════════════════════════════════════════════════

import { InstrumentSpec, exposureLegs, pipValueInAccountCurrency } from './instruments.ts';

export interface SizingInput {
    spec: InstrumentSpec;
    entryPrice: number;
    stopDistance: number;          // price units
    balance: number;
    accountCurrency: string;
    riskPercent: number;
    maxPositionSizePercent: number;
    leverage: number;
    rates: Record<string, number>;
    minLot?: number;
    maxLot?: number;
    lotStep?: number;
}

export interface SizingResult {
    lots: number;
    riskAmount: number;            // account currency actually at risk
    stopPips: number;
    pipValue: number;
    capped: string | null;
    ok: boolean;
    reason: string | null;
}

export function computeLotSize(input: SizingInput): SizingResult {
    const {
        spec, entryPrice, stopDistance, balance, accountCurrency,
        riskPercent, maxPositionSizePercent, leverage, rates,
        minLot = 0.01, maxLot = 100, lotStep = 0.01,
    } = input;

    const fail = (reason: string): SizingResult => ({
        lots: 0, riskAmount: 0, stopPips: 0, pipValue: 0,
        capped: null, ok: false, reason,
    });

    if (!Number.isFinite(spec.pipSize)) return fail(`Unknown instrument ${spec.symbol} — refusing to size`);
    if (!(balance > 0)) return fail('Account balance unavailable or zero');
    if (!(stopDistance > 0)) return fail('Stop distance is zero — cannot derive size');
    if (!(entryPrice > 0)) return fail('Entry price unavailable');
    if (!(riskPercent > 0)) return fail('risk_per_trade_percent is zero');

    const stopPips = stopDistance / spec.pipSize;
    const pv = pipValueInAccountCurrency(spec, entryPrice, accountCurrency, rates);

    // If we can't convert the quote currency to the account currency, we cannot
    // know what we're risking. Refuse rather than size on a guess.
    if (!pv.exact) {
        return fail(`No ${spec.quote}→${accountCurrency} rate — cannot compute risk for ${spec.symbol}`);
    }

    const riskAmount = balance * (riskPercent / 100);
    const riskPerLot = stopPips * pv.value;
    if (!(riskPerLot > 0)) return fail('Computed risk per lot is zero');

    let lots = riskAmount / riskPerLot;
    let capped: string | null = null;

    // Notional cap — position value must stay within max_position_size_percent
    // of balance once leverage is applied.
    //
    // `entryPrice * contractSize` gives notional in the QUOTE currency, so it
    // must be converted before being compared to a balance in the account
    // currency. Skipping this step overstates USDJPY margin by ~150×, which
    // silently caps every JPY trade at a fraction of its intended size.
    const quoteToAccount = pv.value / spec.pipValuePerLot;   // exact: checked above
    const notionalPerLot = entryPrice * spec.contractSize * quoteToAccount;
    if (notionalPerLot > 0 && leverage > 0) {
        const marginPerLot = notionalPerLot / leverage;
        const maxByMargin = (balance * (maxPositionSizePercent / 100)) / marginPerLot;
        if (maxByMargin < lots) { lots = maxByMargin; capped = 'max_position_size_percent'; }
    }

    if (lots > maxLot) { lots = maxLot; capped = 'broker max lot'; }

    // Round DOWN to the broker's step — never round risk upward.
    lots = Math.floor(lots / lotStep) * lotStep;
    lots = parseFloat(lots.toFixed(4));

    if (lots < minLot) {
        return fail(
            `Risk ${riskPercent}% of ${balance.toFixed(2)} over a ${stopPips.toFixed(1)}-pip stop ` +
            `requires ${(riskAmount / riskPerLot).toFixed(4)} lots, below the ${minLot} minimum. ` +
            `Widen the stop, raise risk %, or skip this instrument.`,
        );
    }

    return {
        lots,
        riskAmount: lots * riskPerLot,
        stopPips,
        pipValue: pv.value,
        capped,
        ok: true,
        reason: null,
    };
}

// ─── Correlation-aware exposure ─────────────────────────────────────────────
// max_concurrent_trades treats every position as independent. Ten longs across
// EURUSD, GBPUSD, AUDUSD, NZDUSD and EURJPY is not ten positions — it is one
// large short-USD position at roughly five times the intended size. This is the
// most common way an account like this is lost.

export interface OpenPosition {
    symbol: string;
    direction: 'BUY' | 'SELL';
    riskAmount: number;
}

export interface ExposureLimits {
    maxPerCurrency: number;          // max simultaneous trades sharing a currency leg
    maxRiskPercentPerCurrency: number;
    maxTotalRiskPercent: number;
}

export const DEFAULT_EXPOSURE_LIMITS: ExposureLimits = {
    maxPerCurrency: 3,
    maxRiskPercentPerCurrency: 4,
    maxTotalRiskPercent: 6,
};

/**
 * Signed exposure per leg. A long EURUSD is +EUR and −USD; a long GBPUSD is
 * also −USD, so the two aggregate rather than diversify.
 */
export function computeExposure(
    positions: OpenPosition[],
    specOf: (symbol: string) => InstrumentSpec,
): Record<string, { net: number; gross: number; count: number }> {
    const out: Record<string, { net: number; gross: number; count: number }> = {};
    for (const p of positions) {
        const spec = specOf(p.symbol);
        const legs = exposureLegs(spec);
        const sign = p.direction === 'BUY' ? 1 : -1;
        legs.forEach((leg, idx) => {
            // First leg is the base (long = +), second the quote (long = −)
            const legSign = idx === 0 ? sign : -sign;
            if (!out[leg]) out[leg] = { net: 0, gross: 0, count: 0 };
            out[leg].net += legSign * p.riskAmount;
            out[leg].gross += p.riskAmount;
            out[leg].count += 1;
        });
    }
    return out;
}

export function checkExposureLimits(
    candidate: OpenPosition,
    existing: OpenPosition[],
    balance: number,
    specOf: (symbol: string) => InstrumentSpec,
    limits: ExposureLimits = DEFAULT_EXPOSURE_LIMITS,
): { allowed: boolean; reason: string | null } {
    if (!(balance > 0)) return { allowed: false, reason: 'Balance unavailable' };

    const withCandidate = [...existing, candidate];
    const exposure = computeExposure(withCandidate, specOf);
    const candidateLegs = exposureLegs(specOf(candidate.symbol));

    for (const leg of candidateLegs) {
        const e = exposure[leg];
        if (!e) continue;
        if (e.count > limits.maxPerCurrency) {
            return { allowed: false, reason: `${e.count} open trades would share ${leg} (limit ${limits.maxPerCurrency})` };
        }
        const netPct = (Math.abs(e.net) / balance) * 100;
        if (netPct > limits.maxRiskPercentPerCurrency) {
            return { allowed: false, reason: `Net ${leg} risk would reach ${netPct.toFixed(2)}% (limit ${limits.maxRiskPercentPerCurrency}%)` };
        }
    }

    const totalRisk = withCandidate.reduce((a, p) => a + p.riskAmount, 0);
    const totalPct = (totalRisk / balance) * 100;
    if (totalPct > limits.maxTotalRiskPercent) {
        return { allowed: false, reason: `Total open risk would reach ${totalPct.toFixed(2)}% (limit ${limits.maxTotalRiskPercent}%)` };
    }

    return { allowed: true, reason: null };
}

/**
 * Validate that a stop/target pair is physically sensible before it reaches a
 * broker. The old bridge only checked which SIDE of price the levels were on,
 * so a $0.30 stop on an index at 6000 passed every check.
 */
export function validateStops(
    spec: InstrumentSpec,
    entry: number,
    stop: number,
    target: number,
    direction: 'BUY' | 'SELL',
): { ok: boolean; reason: string | null } {
    if (!(entry > 0)) return { ok: false, reason: 'No entry price' };
    if (!Number.isFinite(spec.pipSize)) return { ok: false, reason: `Unknown instrument ${spec.symbol}` };

    if (direction === 'BUY' && !(stop < entry && target > entry)) {
        return { ok: false, reason: 'BUY requires stop below and target above entry' };
    }
    if (direction === 'SELL' && !(stop > entry && target < entry)) {
        return { ok: false, reason: 'SELL requires stop above and target below entry' };
    }

    const stopPips = Math.abs(entry - stop) / spec.pipSize;
    const targetPips = Math.abs(target - entry) / spec.pipSize;

    if (stopPips < spec.typicalSpread * 3) {
        return { ok: false, reason: `Stop ${stopPips.toFixed(1)} pips is under 3× typical spread (${spec.typicalSpread})` };
    }

    const stopPct = (Math.abs(entry - stop) / entry) * 100;
    if (stopPct > 10) {
        return { ok: false, reason: `Stop is ${stopPct.toFixed(1)}% of price — implausibly wide` };
    }
    if (stopPct < 0.02 && spec.category !== 'FOREX' && spec.category !== 'JPY') {
        return { ok: false, reason: `Stop is ${stopPct.toFixed(3)}% of price — implausibly tight` };
    }
    if (targetPips < stopPips * 0.5) {
        return { ok: false, reason: `Reward:risk of ${(targetPips / stopPips).toFixed(2)} is below 0.5` };
    }

    return { ok: true, reason: null };
}