// ════════════════════════════════════════════════════════════════════════════
// Instrument specifications
// ════════════════════════════════════════════════════════════════════════════
// Replaces the old `price > 50 ? 0.01 : 0.0001` heuristic, which produced a
// $0.30 stop on an index at 6000 and mis-sized every non-forex instrument.
//
// pipSize        : price movement of one pip / point for this instrument
// contractSize   : units per 1.00 lot
// pipValuePerLot : value of one pip per 1.00 lot, in the QUOTE currency
// typicalSpread  : in pips — used by the backtester as a cost floor and by the
//                  signal generator to reject instruments whose stop distance
//                  is not meaningfully larger than the cost of entry
// category       : drives session rules, SL/TP defaults and exposure grouping
// ════════════════════════════════════════════════════════════════════════════

export type Category = 'FOREX' | 'JPY' | 'METAL' | 'INDEX' | 'CRYPTO' | 'ENERGY';

export interface InstrumentSpec {
    symbol: string;
    category: Category;
    pipSize: number;
    contractSize: number;
    pipValuePerLot: number;   // in quote currency
    typicalSpread: number;    // pips
    base: string;
    quote: string;
    tradesWeekends: boolean;
    digits: number;
}

const FOREX_MAJORS = [
    'EURUSD', 'GBPUSD', 'AUDUSD', 'NZDUSD', 'USDCHF', 'USDCAD',
];

const FOREX_CROSSES = [
    'EURGBP', 'EURCHF', 'EURAUD', 'EURNZD', 'EURCAD',
    'GBPCHF', 'GBPAUD', 'GBPNZD', 'GBPCAD',
    'AUDNZD', 'AUDCAD', 'AUDCHF',
    'NZDCAD', 'NZDCHF', 'CADCHF',
];

const JPY_PAIRS = [
    'USDJPY', 'EURJPY', 'GBPJPY', 'AUDJPY', 'NZDJPY', 'CADJPY', 'CHFJPY',
];

// Typical retail spreads in pips. Deliberately pessimistic — a backtest that
// assumes tight spreads is the single most common way a losing strategy looks
// profitable on paper.
const SPREAD_TABLE: Record<string, number> = {
    EURUSD: 1.0, GBPUSD: 1.4, USDJPY: 1.1, AUDUSD: 1.3, NZDUSD: 1.8,
    USDCHF: 1.6, USDCAD: 1.6, EURGBP: 1.5, EURJPY: 1.6, GBPJPY: 2.4,
    EURCHF: 1.8, AUDJPY: 1.8, CADJPY: 2.0, CHFJPY: 2.4, NZDJPY: 2.2,
    EURAUD: 2.2, EURNZD: 3.0, EURCAD: 2.2, GBPCHF: 3.0, GBPAUD: 3.0,
    GBPNZD: 4.0, GBPCAD: 3.2, AUDNZD: 2.6, AUDCAD: 2.2, AUDCHF: 2.4,
    NZDCAD: 3.0, NZDCHF: 3.2, CADCHF: 2.6,
    XAUUSD: 3.0, XAGUSD: 3.0,
    US500: 0.6, US30: 3.0, NAS100: 1.5, UK100: 1.5, GER40: 1.2,
    JPN225: 8.0, AUS200: 2.0, FRA40: 1.5, HK50: 8.0,
    BTCUSD: 30.0, ETHUSD: 3.0, SOLUSD: 0.5, XRPUSD: 0.002, LTCUSD: 0.5,
    USOIL: 3.0, UKOIL: 3.0,
};

const INDEX_SPECS: Record<string, { pipSize: number; contract: number; quote: string }> = {
    US500:  { pipSize: 0.1,  contract: 1,   quote: 'USD' },
    SPX500: { pipSize: 0.1,  contract: 1,   quote: 'USD' },
    SP500:  { pipSize: 0.1,  contract: 1,   quote: 'USD' },
    US30:   { pipSize: 1.0,  contract: 1,   quote: 'USD' },
    DJI:    { pipSize: 1.0,  contract: 1,   quote: 'USD' },
    NAS100: { pipSize: 0.1,  contract: 1,   quote: 'USD' },
    US100:  { pipSize: 0.1,  contract: 1,   quote: 'USD' },
    UK100:  { pipSize: 0.5,  contract: 1,   quote: 'GBP' },
    GER40:  { pipSize: 0.5,  contract: 1,   quote: 'EUR' },
    DE40:   { pipSize: 0.5,  contract: 1,   quote: 'EUR' },
    FRA40:  { pipSize: 0.5,  contract: 1,   quote: 'EUR' },
    ESP35:  { pipSize: 1.0,  contract: 1,   quote: 'EUR' },
    JPN225: { pipSize: 1.0,  contract: 1,   quote: 'JPY' },
    AUS200: { pipSize: 0.5,  contract: 1,   quote: 'AUD' },
    HK50:   { pipSize: 1.0,  contract: 1,   quote: 'HKD' },
};

const CRYPTO_SPECS: Record<string, { pipSize: number; quote: string }> = {
    BTCUSD: { pipSize: 1.0,    quote: 'USD' },
    ETHUSD: { pipSize: 0.1,    quote: 'USD' },
    SOLUSD: { pipSize: 0.01,   quote: 'USD' },
    XRPUSD: { pipSize: 0.0001, quote: 'USD' },
    LTCUSD: { pipSize: 0.01,   quote: 'USD' },
    ADAUSD: { pipSize: 0.0001, quote: 'USD' },
    DOGEUSD:{ pipSize: 0.00001,quote: 'USD' },
    AVAXUSD:{ pipSize: 0.01,   quote: 'USD' },
    LINKUSD:{ pipSize: 0.01,   quote: 'USD' },
    DOTUSD: { pipSize: 0.001,  quote: 'USD' },
    MATICUSD:{pipSize: 0.0001, quote: 'USD' },
};

const ALIASES: Record<string, string> = {
    GOLD: 'XAUUSD', XAU: 'XAUUSD',
    SILVER: 'XAGUSD', XAG: 'XAGUSD',
    BITCOIN: 'BTCUSD', BTC: 'BTCUSD',
    ETHEREUM: 'ETHUSD', ETH: 'ETHUSD',
    SOL: 'SOLUSD', XRP: 'XRPUSD', LTC: 'LTCUSD', ADA: 'ADAUSD',
    DOGE: 'DOGEUSD', AVAX: 'AVAXUSD', LINK: 'LINKUSD', DOT: 'DOTUSD',
    MATIC: 'MATICUSD',
    NASDAQ: 'NAS100', DOW: 'US30', FTSE: 'UK100', DAX: 'GER40',
    NIKKEI: 'JPN225', CAC: 'FRA40', HSI: 'HK50',
    WTI: 'USOIL', BRENT: 'UKOIL',
};

/** Strip separators and broker suffixes: "XAU/USD.pro" → "XAUUSD" */
export function normalizeSymbol(raw: string): string {
    if (!raw) return '';
    let s = raw.toUpperCase().replace(/[\/\-_ ]/g, '');
    const dot = s.indexOf('.');
    if (dot > 0) s = s.slice(0, dot);
    // Trim trailing broker tags that survive suffix-stripping (EURUSDM, EURUSDPRO)
    if (s.length > 6 && /^(?:[A-Z]{6})(?:M|PRO|RAW|ECN|C|I|Z)$/.test(s)) s = s.slice(0, 6);
    return ALIASES[s] || s;
}

export function getInstrumentSpec(rawSymbol: string): InstrumentSpec {
    const symbol = normalizeSymbol(rawSymbol);
    const spread = SPREAD_TABLE[symbol];

    // ── Metals ──────────────────────────────────────────────────────────────
    if (symbol === 'XAUUSD') {
        return {
            symbol, category: 'METAL', pipSize: 0.1, contractSize: 100,
            pipValuePerLot: 10, typicalSpread: spread ?? 3.0,
            base: 'XAU', quote: 'USD', tradesWeekends: false, digits: 2,
        };
    }
    if (symbol === 'XAGUSD') {
        return {
            symbol, category: 'METAL', pipSize: 0.01, contractSize: 5000,
            pipValuePerLot: 50, typicalSpread: spread ?? 3.0,
            base: 'XAG', quote: 'USD', tradesWeekends: false, digits: 3,
        };
    }

    // ── Energy ──────────────────────────────────────────────────────────────
    if (symbol === 'USOIL' || symbol === 'UKOIL') {
        return {
            symbol, category: 'ENERGY', pipSize: 0.01, contractSize: 1000,
            pipValuePerLot: 10, typicalSpread: spread ?? 3.0,
            base: symbol, quote: 'USD', tradesWeekends: false, digits: 2,
        };
    }

    // ── Indices ─────────────────────────────────────────────────────────────
    const idx = INDEX_SPECS[symbol];
    if (idx) {
        return {
            symbol, category: 'INDEX', pipSize: idx.pipSize, contractSize: idx.contract,
            pipValuePerLot: idx.pipSize * idx.contract,
            typicalSpread: spread ?? 2.0,
            base: symbol, quote: idx.quote, tradesWeekends: false, digits: 2,
        };
    }

    // ── Crypto ──────────────────────────────────────────────────────────────
    const cx = CRYPTO_SPECS[symbol];
    if (cx) {
        return {
            symbol, category: 'CRYPTO', pipSize: cx.pipSize, contractSize: 1,
            pipValuePerLot: cx.pipSize,
            typicalSpread: spread ?? 20.0,
            base: symbol.replace('USD', ''), quote: 'USD',
            tradesWeekends: true, digits: 2,
        };
    }

    // ── Forex ───────────────────────────────────────────────────────────────
    if (/^[A-Z]{6}$/.test(symbol)) {
        const base = symbol.slice(0, 3);
        const quote = symbol.slice(3);
        const isJpy = quote === 'JPY';
        const known = FOREX_MAJORS.includes(symbol) || FOREX_CROSSES.includes(symbol) || JPY_PAIRS.includes(symbol);
        return {
            symbol,
            category: isJpy ? 'JPY' : 'FOREX',
            pipSize: isJpy ? 0.01 : 0.0001,
            contractSize: 100000,
            pipValuePerLot: isJpy ? 1000 : 10,   // quote-currency value of 1 pip per lot
            typicalSpread: spread ?? (known ? 2.0 : 4.0),
            base, quote, tradesWeekends: false,
            digits: isJpy ? 3 : 5,
        };
    }

    // ── Unknown: refuse to guess ────────────────────────────────────────────
    // The old code silently fell back to a forex pip size, which is how an
    // index ended up with a $0.30 stop. An unknown instrument must be visible.
    return {
        symbol, category: 'FOREX', pipSize: NaN, contractSize: NaN,
        pipValuePerLot: NaN, typicalSpread: NaN,
        base: symbol, quote: 'USD', tradesWeekends: false, digits: 5,
    };
}

export function isKnownInstrument(rawSymbol: string): boolean {
    return !Number.isNaN(getInstrumentSpec(rawSymbol).pipSize);
}

/**
 * Value of one pip, per 1.00 lot, converted into the account currency.
 * `rates` maps "XXXUSD"-style symbols to price, used to convert the quote
 * currency into the account currency. Falls back to 1.0 with a flag so the
 * caller can decide whether to trade — never silently guesses.
 */
export function pipValueInAccountCurrency(
    spec: InstrumentSpec,
    price: number,
    accountCurrency: string,
    rates: Record<string, number> = {},
): { value: number; exact: boolean } {
    const quote = spec.quote;
    const acct = (accountCurrency || 'USD').toUpperCase();

    // Quote currency already matches the account currency
    if (quote === acct) return { value: spec.pipValuePerLot, exact: true };

    // Direct rate QUOTE/ACCT (e.g. quote JPY, account USD → JPYUSD = 1/USDJPY)
    const direct = rates[`${quote}${acct}`];
    if (direct && direct > 0) return { value: spec.pipValuePerLot * direct, exact: true };

    const inverse = rates[`${acct}${quote}`];
    if (inverse && inverse > 0) return { value: spec.pipValuePerLot / inverse, exact: true };

    // Special case that covers most retail setups: USD account, XXXUSD pair.
    if (acct === 'USD' && quote === 'USD') return { value: spec.pipValuePerLot, exact: true };

    return { value: spec.pipValuePerLot, exact: false };
}

/** Currencies whose exposure should be aggregated for correlation limits. */
export function exposureLegs(spec: InstrumentSpec): string[] {
    if (spec.category === 'INDEX') return [`IDX:${spec.symbol}`, `CUR:${spec.quote}`];
    if (spec.category === 'CRYPTO') return ['CRYPTO'];
    if (spec.category === 'METAL') return ['METAL', `CUR:${spec.quote}`];
    if (spec.category === 'ENERGY') return ['ENERGY'];
    return [`CUR:${spec.base}`, `CUR:${spec.quote}`];
}