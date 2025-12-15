// Utility service to fetch real market data from free public APIs
// Supports Crypto (CoinCap) and Forex (Open Exchange Rates)

export const MarketDataService = {
    // Cache for latest prices
    prices: {
        'EUR/USD': 1.0850,
        'GBP/USD': 1.2650,
        'USD/JPY': 148.50
    },

    // Store raw rates for cross-calculation
    rates: {
        'USD': 1.0
    },

    lastUpdate: 0,
    updateInterval: 10000, // Update real data every 10s

    async initialize() {
        await this.fetchAll();
    },

    async fetchAll() {
        const now = Date.now();
        if (now - this.lastUpdate < this.updateInterval) {
            return this.prices;
        }

        try {
            await Promise.all([
                this.fetchCrypto(),
                this.fetchForex()
            ]);
            this.lastUpdate = now;
        } catch (e) {
            console.warn("Market data fetch failed, using cached values", e);
        }
        return this.prices;
    },

    async fetchCrypto() {
        try {
            // CoinCap API (Free, No Key)
            const response = await fetch('https://api.coincap.io/v2/assets?ids=bitcoin,ethereum,solana,ripple,cardano,dogecoin,polkadot,litecoin');
            const data = await response.json();
            
            if (data && data.data) {
                data.data.forEach(asset => {
                    const symbol = asset.symbol.toUpperCase() + '/USD';
                    this.prices[symbol] = parseFloat(asset.priceUsd);
                });
            }
        } catch (e) {
            console.error("Crypto fetch error", e);
        }
    },

    async fetchForex() {
        try {
            // Open Exchange Rates (Free tier / Public endpoint)
            const response = await fetch('https://open.er-api.com/v6/latest/USD');
            const data = await response.json();
            
            if (data && data.rates) {
                this.rates = data.rates;
                // Ensure USD is present
                this.rates['USD'] = 1.0;
            }
        } catch (e) {
            console.error("Forex fetch error", e);
        }
    },

    // Get price with artificial micro-jitter to simulate ticks between API updates
    getPrice(pair) {
        // 1. Check direct cache (Crypto usually)
        if (this.prices[pair]) {
            return this.applyJitter(this.prices[pair]);
        }

        // 2. Try to calculate Forex Cross Rate
        if (pair.includes('/') && Object.keys(this.rates).length > 1) {
            const [base, quote] = pair.split('/');
            
            // Formula: Rate = Quote_Rate_vs_USD / Base_Rate_vs_USD
            // Example: EUR/USD = USD_Rate / EUR_Rate (wait, rates are "Currency per USD")
            // Actually API returns: EUR: 0.92 (0.92 EUR = 1 USD)
            // So 1 EUR = 1/0.92 USD = 1.08 USD.
            //
            // Generic: Price(Base/Quote) = Value(Base) / Value(Quote)
            // Value(Currency) in USD = 1 / Rate(Currency)
            // Price(Base/Quote) = (1 / Rate(Base)) / (1 / Rate(Quote)) = Rate(Quote) / Rate(Base)
            
            const rateBase = this.rates[base];
            const rateQuote = this.rates[quote];

            if (rateBase && rateQuote) {
                const price = rateQuote / rateBase;
                this.prices[pair] = price; // Cache it
                return this.applyJitter(price);
            }
        }

        // 3. Fallback
        return this.applyJitter(1.0);
    },

    applyJitter(price) {
        // Add 0.005% random jitter to simulate live ticks
        return price * (1 + (Math.random() * 0.0001 - 0.00005));
    }
};