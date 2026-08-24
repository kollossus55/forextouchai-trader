import assert from 'node:assert/strict';
import { runBacktest, walkForward, DEFAULT_COSTS } from '../build/backtest.js';
import { getInstrumentSpec } from '../build/instruments.js';

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); console.log(`  ok   ${name}`); pass++; }
    catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); fail++; }
}

// Deterministic PRNG so results are reproducible
function mulberry(seed) {
    return function () {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let tt = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        tt = (tt + Math.imul(tt ^ (tt >>> 7), 61 | tt)) ^ tt;
        return ((tt ^ (tt >>> 14)) >>> 0) / 4294967296;
    };
}

/** Pure random walk — no exploitable structure whatsoever. */
function randomWalk(n, start = 1.08, vol = 0.0008, seed = 42) {
    const rnd = mulberry(seed);
    const out = [];
    let p = start;
    for (let i = 0; i < n; i++) {
        const drift = (rnd() - 0.5) * vol * 2;
        const o = p;
        p = p * (1 + drift);
        const hi = Math.max(o, p) * (1 + rnd() * vol * 0.5);
        const lo = Math.min(o, p) * (1 - rnd() * vol * 0.5);
        out.push({ time: 1600000000 + i * 3600, open: o, high: hi, low: lo, close: p, volume: 1000 });
    }
    return out;
}

/**
 * Trend WITH realistic retracements — impulse legs separated by genuine
 * pullbacks, so a trend-follower gets stopped out sometimes. An always-up
 * series would give a 100% win rate and validate nothing.
 */
function trending(n, start = 1.08, seed = 7) {
    const rnd = mulberry(seed);
    const out = [];
    let p = start;
    let i = 0;
    while (i < n) {
        const impulseLen = 15 + Math.floor(rnd() * 25);
        const pullbackLen = 8 + Math.floor(rnd() * 18);
        for (let k = 0; k < impulseLen && i < n; k++, i++) {
            const o = p;
            p = p * (1 + 0.0009 + (rnd() - 0.5) * 0.0012);
            out.push({ time: 1600000000 + i * 3600, open: o,
                high: Math.max(o, p) * (1 + rnd() * 0.0006),
                low: Math.min(o, p) * (1 - rnd() * 0.0006),
                close: p, volume: 1000 });
        }
        // Retracement giving back a meaningful share of the leg
        for (let k = 0; k < pullbackLen && i < n; k++, i++) {
            const o = p;
            p = p * (1 - 0.0007 + (rnd() - 0.5) * 0.0014);
            out.push({ time: 1600000000 + i * 3600, open: o,
                high: Math.max(o, p) * (1 + rnd() * 0.0008),
                low: Math.min(o, p) * (1 - rnd() * 0.0008),
                close: p, volume: 1000 });
        }
    }
    return out;
}

function toHigher(bars, factor) {
    const out = [];
    for (let i = 0; i + factor <= bars.length; i += factor) {
        const chunk = bars.slice(i, i + factor);
        out.push({
            time: chunk[chunk.length - 1].time,
            open: chunk[0].open,
            high: Math.max(...chunk.map(c => c.high)),
            low: Math.min(...chunk.map(c => c.low)),
            close: chunk[chunk.length - 1].close,
            volume: chunk.reduce((a, c) => a + c.volume, 0),
        });
    }
    return out;
}

const CONFIG = {
    initialBalance: 10000,
    accountCurrency: 'USD',
    riskPercent: 1,
    maxPositionSizePercent: 20,
    leverage: 100,
    costs: DEFAULT_COSTS,
    minConfidence: 40,
    maxConcurrent: 1,
    warmupBars: 250,
};

const BOT = {
    strategy_type: 'AI_PREDICTIVE',
    sl_tp_mode: 'ATR',
    atr_multiplier_sl: 1.5,
    atr_multiplier_tp: 3.0,
    require_htf_alignment: false,
    avoid_rollover: false,
    min_session_quality: 0,
};

const spec = getInstrumentSpec('EURUSD');

function setup(bars) {
    return { H1: bars, H4: toHigher(bars, 4), D1: toHigher(bars, 24) };
}

console.log('\n── No-lookahead guarantees ──');

t('a trade never opens before the signal bar closes', () => {
    const bars = randomWalk(2000, 1.08, 0.0008, 11);
    const r = runBacktest('EURUSD', spec, setup(bars), 'H1', 'H4', BOT, CONFIG);
    for (const tr of r.trades) {
        const entryBar = bars.find(b => b.time === tr.entryTime);
        assert.ok(entryBar, 'entry time must land on a real bar');
        // Fill must be at/near the entry bar's OPEN, never its close
        const distToOpen = Math.abs(tr.entryPrice - entryBar.open);
        const barRange = entryBar.high - entryBar.low;
        assert.ok(distToOpen <= barRange + spec.pipSize * 3,
            'entry price must derive from the entry bar open, not a later price');
    }
});

t('results are identical across runs (fully deterministic)', () => {
    const bars = randomWalk(2000, 1.08, 0.0008, 5);
    const a = runBacktest('EURUSD', spec, setup(bars), 'H1', 'H4', BOT, CONFIG);
    const b = runBacktest('EURUSD', spec, setup(bars), 'H1', 'H4', BOT, CONFIG);
    assert.equal(a.totalTrades, b.totalTrades);
    assert.equal(a.netPnl.toFixed(8), b.netPnl.toFixed(8));
});

t('truncating future bars does not change earlier trades', () => {
    const bars = randomWalk(2500, 1.08, 0.0008, 23);
    const full = runBacktest('EURUSD', spec, setup(bars), 'H1', 'H4', BOT, CONFIG);
    const short = runBacktest('EURUSD', spec, setup(bars.slice(0, 1500)), 'H1', 'H4', BOT, CONFIG);
    const cutoff = bars[1400].time;
    const fullEarly = full.trades.filter(t => t.exitTime <= cutoff);
    const shortEarly = short.trades.filter(t => t.exitTime <= cutoff);
    assert.equal(fullEarly.length, shortEarly.length,
        'trade count before the cutoff must not depend on data after it');
    for (let i = 0; i < fullEarly.length; i++) {
        assert.equal(fullEarly[i].entryTime, shortEarly[i].entryTime);
        assert.equal(fullEarly[i].netPnl.toFixed(6), shortEarly[i].netPnl.toFixed(6));
    }
});

console.log('\n── The test the old backtester could never fail ──');

t('LOSES money on pure random walks (costs are unavoidable)', () => {
    let profitable = 0, total = 0, sumReturn = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const bars = randomWalk(3000, 1.08, 0.0008, seed);
        const r = runBacktest('EURUSD', spec, setup(bars), 'H1', 'H4', BOT, CONFIG);
        if (r.totalTrades === 0) continue;
        total++;
        sumReturn += r.returnPercent;
        if (r.netPnl > 0) profitable++;
    }
    assert.ok(total >= 4, `expected trades on most seeds, got ${total} usable runs`);
    console.log(`       ${profitable}/${total} seeds profitable, mean return ${(sumReturn / total).toFixed(2)}%`);
    assert.ok(sumReturn / total < 0,
        `mean return on random data must be negative after costs, got ${(sumReturn / total).toFixed(2)}%`);
    assert.ok(profitable <= total * 0.5,
        'a random-data edge would mean lookahead bias is present');
});

t('costs are actually charged', () => {
    const bars = randomWalk(3000, 1.08, 0.0008, 3);
    const r = runBacktest('EURUSD', spec, setup(bars), 'H1', 'H4', BOT, CONFIG);
    if (r.totalTrades === 0) return;
    assert.ok(r.totalCosts > 0, 'total costs must be positive');
    for (const tr of r.trades) {
        assert.ok(tr.costs > 0, 'every trade must carry a cost');
        assert.ok(Math.abs(tr.grossPnl - tr.netPnl - tr.costs) < 0.01,
            'net must equal gross minus costs');
    }
});

t('zero-cost run outperforms a realistic-cost run', () => {
    const bars = randomWalk(3000, 1.08, 0.0008, 9);
    const free = runBacktest('EURUSD', spec, setup(bars), 'H1', 'H4', BOT, {
        ...CONFIG,
        costs: { spreadPips: 0, commissionPerLotPerSide: 0, swapLongPerLotPerDay: 0, swapShortPerLotPerDay: 0, slippagePips: 0 },
    });
    const real = runBacktest('EURUSD', spec, setup(bars), 'H1', 'H4', BOT, CONFIG);
    if (real.totalTrades === 0) return;
    assert.ok(free.netPnl > real.netPnl, 'removing costs must improve the result');
});

console.log('\n── Sanity: it can still find a real edge ──');

t('a trend-follower profits on a genuinely trending series', () => {
    const bars = trending(3000, 1.08, 7);
    const r = runBacktest('EURUSD', spec, setup(bars), 'H1', 'H4', {
        ...BOT, strategy_type: 'SWING',
    }, { ...CONFIG, minConfidence: 30 });
    console.log(`       ${r.totalTrades} trades, ${r.winRate.toFixed(1)}% win rate, ${r.returnPercent.toFixed(1)}% return`);
    assert.ok(r.totalTrades > 0, 'expected trades on a strong trend');
    assert.ok(r.netPnl > 0, `a trend-follower should profit on a real trend, got ${r.netPnl.toFixed(2)}`);
    // A realistic fixture must produce realistic losses too — a 100% win rate
    // would mean the fixture, not the strategy, is doing the work.
    assert.ok(r.winRate < 95, `win rate ${r.winRate.toFixed(1)}% is implausibly high — check the fixture`);
    assert.ok(r.losses > 0, 'a trend with pullbacks must produce some losing trades');
});

console.log('\n── Pessimistic intrabar resolution ──');

t('when a bar spans both stop and target, the STOP is taken', () => {
    // Construct a bar that engulfs both levels and confirm no win is recorded
    // for any trade whose exit bar contained both.
    const bars = randomWalk(3000, 1.08, 0.003, 17);   // high volatility → wide bars
    const r = runBacktest('EURUSD', spec, setup(bars), 'H1', 'H4', BOT, CONFIG);
    for (const tr of r.trades) {
        if (tr.exitReason !== 'TARGET') continue;
        const exitBar = bars.find(b => b.time === tr.exitTime);
        if (!exitBar) continue;
        const stopInBar = tr.direction === 'BUY'
            ? exitBar.low <= tr.stopLoss : exitBar.high >= tr.stopLoss;
        assert.ok(!stopInBar,
            'a bar containing the stop must never be resolved as a target hit');
    }
});

console.log('\n── Metrics ──');

t('profit factor and win rate reconcile with the trade list', () => {
    const bars = randomWalk(3000, 1.08, 0.0008, 31);
    const r = runBacktest('EURUSD', spec, setup(bars), 'H1', 'H4', BOT, CONFIG);
    if (r.totalTrades === 0) return;
    const wins = r.trades.filter(t => t.netPnl > 0);
    assert.equal(r.wins, wins.length);
    assert.ok(Math.abs(r.winRate - (wins.length / r.trades.length) * 100) < 1e-9);
    const gp = wins.reduce((a, t) => a + t.netPnl, 0);
    assert.ok(Math.abs(r.grossProfit - gp) < 0.01);
});

t('final balance equals initial plus the sum of net P&L', () => {
    const bars = randomWalk(3000, 1.08, 0.0008, 44);
    const r = runBacktest('EURUSD', spec, setup(bars), 'H1', 'H4', BOT, CONFIG);
    const sum = r.trades.reduce((a, t) => a + t.netPnl, 0);
    assert.ok(Math.abs((CONFIG.initialBalance + sum) - r.finalBalance) < 0.01,
        `balance ${r.finalBalance} vs ${CONFIG.initialBalance + sum}`);
});

t('Sharpe is zero when there are no trades, never NaN', () => {
    const bars = randomWalk(400, 1.08, 0.0008, 2);
    const r = runBacktest('EURUSD', spec, setup(bars), 'H1', 'H4', BOT, CONFIG);
    assert.ok(Number.isFinite(r.sharpeRatio), `Sharpe was ${r.sharpeRatio}`);
    assert.ok(Number.isFinite(r.maxDrawdownPercent));
});

t('warns when too few trades to conclude anything', () => {
    const bars = randomWalk(700, 1.08, 0.0008, 88);
    const r = runBacktest('EURUSD', spec, setup(bars), 'H1', 'H4', BOT, CONFIG);
    assert.ok(r.warnings.some(w => /too few|not meaningful/i.test(w)),
        `expected a low-sample warning, got ${JSON.stringify(r.warnings)}`);
});

t('reports why signals were rejected', () => {
    const bars = randomWalk(3000, 1.08, 0.0008, 55);
    const r = runBacktest('EURUSD', spec, setup(bars), 'H1', 'H4', BOT, CONFIG);
    assert.ok(Object.keys(r.signalsRejected).length > 0, 'rejection reasons must be surfaced');
});

console.log('\n── Walk-forward ──');

t('walk-forward splits into windows and flags inconsistency on noise', () => {
    const bars = randomWalk(6000, 1.08, 0.0008, 99);
    const wf = walkForward('EURUSD', spec, setup(bars), 'H1', 'H4', BOT, CONFIG, 4);
    assert.equal(wf.windows.length, 4);
    assert.ok(typeof wf.summary === 'string' && wf.summary.length > 0);
    assert.equal(wf.consistent, false, 'random data must not be reported as consistent');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
