// ════════════════════════════════════════════════════════════════════════════
// Risk validation (local copy for bridge function)
// ════════════════════════════════════════════════════════════════════════════

// Minimal spec shape — avoids cross-file type imports that break the bundler.
interface SpecLike {
    symbol: string;
    category: string;
    pipSize: number;
    typicalSpread: number;
}

/**
 * Validate that a stop/target pair is physically sensible before it reaches a
 * broker. The old bridge only checked which SIDE of price the levels were on,
 * so a $0.30 stop on an index at 6000 passed every check.
 */
export function validateStops(
    spec: SpecLike,
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