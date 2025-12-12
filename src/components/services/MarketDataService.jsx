// Utility service to fetch real market data from free public APIs
// Supports Crypto (CoinCap) and Forex (Open Exchange Rates)
// Designed to be extended with more providers

export const MarketDataService = {
    // Cache for latest prices
    prices: {
        'EUR/USD': 1.0850,
        'GBP/USD': 1.2650,
        'USD/JPY': 148.50,
        'XAU/USD': 2030.50,
        'BTC/USD': 65000.00
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
            const response = await fetch('https://api.coincap.io/v2/assets?ids=bitcoin,ethereum,solana,gold,silver');
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
            // Open Exchange Rates (Free tier / Public endpoint if available) or generic open API
            // Using open.er-api.com which is free and CORS enabled
            const response = await fetch('https://open.er-api.com/v6/latest/USD');
            const data = await response.json();
            
            if (data && data.rates) {
                // Invert rates because API is USD base
                // EUR/USD = 1 / USD/EUR
                if (data.rates.EUR) this.prices['EUR/USD'] = 1 / data.rates.EUR;
                if (data.rates.GBP) this.prices['GBP/USD'] = 1 / data.rates.GBP;
                if (data.rates.AUD) this.prices['AUD/USD'] = 1 / data.rates.AUD;
                
                // Direct pairs
                if (data.rates.JPY) this.prices['USD/JPY'] = data.rates.JPY;
                if (data.rates.CAD) this.prices['USD/CAD'] = data.rates.CAD;
                if (data.rates.CHF) this.prices['USD/CHF'] = data.rates.CHF;
            }
        } catch (e) {
            console.error("Forex fetch error", e);
        }
    },

    // Get price with artificial micro-jitter to simulate ticks between API updates
    getPrice(pair) {
        let price = this.prices[pair];
        if (!price) {
            // Fallback for unmapped pairs, generate plausible price based on cached defaults or 1.0
            price = 1.0;
        }

        // Add 0.005% random jitter to simulate live ticks
        const jitter = price * (Math.random() * 0.0001 - 0.00005);
        return price + jitter;
    }
};