// ════════════════════════════════════════════════════════════════════════════
// fetchMarketNews — Real live market news & economic events
// ════════════════════════════════════════════════════════════════════════════
// Fetches REAL news from live RSS feeds (CNBC, MarketWatch, FXStreet) and
// REAL economic events via Google Search (InvokeLLM add_context_from_internet).
// No hardcoded or fake data — every item comes from a live external source.
//
// Clears stale NewsItem / EconomicEvent records and replaces them with fresh
// ones. Designed to run on a schedule (every 30 min) or manually from the UI.
// ════════════════════════════════════════════════════════════════════════════

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.45';

const RSS_FEEDS = [
  { url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', source: 'CNBC' },
  { url: 'https://www.cnbc.com/id/10001147/device/rss/rss.html', source: 'CNBC Economy' },
  { url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories', source: 'MarketWatch' },
  { url: 'https://www.fxstreet.com/rss/news', source: 'FXStreet' },
];

// Keywords to filter for forex/market-relevant news
const RELEVANCE_KEYWORDS = [
  'forex', 'dollar', 'eur', 'usd', 'gdp', 'fed', 'ecb', 'boe', 'rate', 'inflation',
  'cpi', 'nfp', 'payroll', 'treasury', 'yield', 'central bank', 'interest rate',
  'currency', 'pound', 'yen', 'euro', 'market', 'stock', 's&p', 'nasdaq', 'dow',
  'commodity', 'oil', 'gold', 'silver', 'trade', 'tariff', 'recession', 'economy',
  'trump', 'biden', 'powell', 'lagarde', 'fomc', 'retail sales', 'jobless',
  'consumer', 'manufacturing', 'pmi', 'sentiment', 'risk', 'safe haven',
];

const POSITIVE_WORDS = [
  'rally', 'surge', 'gain', 'rise', 'jump', 'boost', 'strong', 'beat', 'exceed',
  'upgrade', 'bullish', 'profit', 'recovery', 'soar', 'climb', 'rises', 'gains',
  'higher', 'optimis', 'growth', 'expand',
];
const NEGATIVE_WORDS = [
  'drop', 'fall', 'plunge', 'crash', 'decline', 'loss', 'weak', 'miss', 'downgrade',
  'bearish', 'recession', 'fear', 'sell-off', 'slump', 'tumble', 'sink', 'falls',
  'lower', 'pessimis', 'contraction', 'shrink', 'cut', 'slide',
];

function stripHtml(html: string): string {
  return html
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function analyzeSentiment(text: string): string {
  const lower = text.toLowerCase();
  let pos = 0, neg = 0;
  for (const w of POSITIVE_WORDS) if (lower.includes(w)) pos++;
  for (const w of NEGATIVE_WORDS) if (lower.includes(w)) neg++;
  if (pos > neg) return 'POSITIVE';
  if (neg > pos) return 'NEGATIVE';
  return 'NEUTRAL';
}

function isRelevant(title: string, summary: string): boolean {
  const text = (title + ' ' + summary).toLowerCase();
  return RELEVANCE_KEYWORDS.some(kw => text.includes(kw));
}

function parseRssItems(xml: string, sourceName: string): RawNewsItem[] {
  const items: RawNewsItem[] = [];
  const itemRegex = /<item[\s\S]*?<\/item>/gi;
  const matches = xml.match(itemRegex) || [];

  for (const itemXml of matches) {
    const titleMatch = itemXml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const linkMatch = itemXml.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    const descMatch = itemXml.match(/<description[^>]*>([\s\S]*?)<\/description>/i);
    const dateMatch = itemXml.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i);
    const encMatch = itemXml.match(/<enclosure[^>]*url="([^"]+)"/i);

    const title = titleMatch ? stripHtml(titleMatch[1]) : '';
    const link = linkMatch ? stripHtml(linkMatch[1]) : '';
    const description = descMatch ? stripHtml(descMatch[1]) : '';
    const pubDate = dateMatch ? stripHtml(dateMatch[1]) : '';
    const image_url = encMatch ? encMatch[1] : '';

    if (title && link) {
      items.push({ title, url: link, summary: description.slice(0, 300), source: sourceName, pubDate, image_url });
    }
  }
  return items;
}

interface RawNewsItem {
  title: string;
  url: string;
  summary: string;
  source: string;
  pubDate: string;
  image_url: string;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Auth: allow scheduled (no user) or admin manual trigger
    let user = null;
    try { user = await base44.auth.me(); } catch { /* scheduled run */ }
    if (user && user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    const svc = base44.asServiceRole;
    const warnings: string[] = [];

    // ── 1. Fetch real RSS news ──────────────────────────────────────────
    const feedResults = await Promise.all(
      RSS_FEEDS.map(async (feed) => {
        try {
          const res = await fetch(feed.url, {
            headers: { 'User-Agent': 'ForexTouchAI/1.0 (news fetcher)' },
            signal: AbortSignal.timeout(10000),
          });
          if (!res.ok) {
            warnings.push(`${feed.source}: HTTP ${res.status}`);
            return [];
          }
          const xml = await res.text();
          return parseRssItems(xml, feed.source);
        } catch (e) {
          warnings.push(`${feed.source}: ${e.message}`);
          return [];
        }
      }),
    );

    const allItems = feedResults.flat();

    // Filter for relevance and deduplicate by title
    const seen = new Set<string>();
    const relevant = allItems
      .filter(item => isRelevant(item.title, item.summary))
      .filter(item => {
        const key = item.title.toLowerCase().trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => {
        const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
        const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
        return db - da;
      })
      .slice(0, 20); // Keep top 20 most recent

    // ── 2. Fetch real economic events via Google Search ─────────────────
    let economicEvents: any[] = [];
    try {
      const llmRes = await svc.integrations.Core.InvokeLLM({
        prompt: `Search the web for TODAY's and THIS WEEK's upcoming high-impact economic calendar events relevant to forex trading. ` +
                `Include events like: Non-Farm Payrolls (NFP), CPI, GDP, FOMC meetings, ECB rate decisions, BoE rate decisions, ` +
                `retail sales, manufacturing PMI, jobless claims, consumer sentiment, inflation data. ` +
                `For each event return: title, currency (USD/EUR/GBP/JPY/etc), impact (HIGH/MEDIUM/LOW), time (in UTC, HH:MM format), ` +
                `forecast value, previous value, and a source URL. Only return REAL events from the actual economic calendar — do NOT invent data. ` +
                `If you cannot find the actual value, leave it empty rather than guessing. Return up to 10 events.`,
        add_context_from_internet: true,
        model: 'gemini_3_flash',
        response_json_schema: {
          type: 'object',
          properties: {
            events: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  currency: { type: 'string' },
                  impact: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
                  time: { type: 'string' },
                  forecast: { type: 'string' },
                  previous: { type: 'string' },
                  url: { type: 'string' },
                },
                required: ['title', 'currency', 'impact', 'time'],
              },
            },
          },
        },
      });

      economicEvents = (llmRes as any)?.events || [];
    } catch (e) {
      warnings.push(`Economic events LLM: ${e.message}`);
    }

    // ── 3. Clear old records and store fresh data ───────────────────────
    // Delete all existing NewsItem and EconomicEvent records, then insert fresh.
    const oldNews = await svc.entities.NewsItem.list('-created_date', 100).catch(() => []);
    for (const n of (oldNews || [])) {
      await svc.entities.NewsItem.delete(n.id).catch(() => {});
    }

    const oldEvents = await svc.entities.EconomicEvent.list('-created_date', 100).catch(() => []);
    for (const e of (oldEvents || [])) {
      await svc.entities.EconomicEvent.delete(e.id).catch(() => {});
    }

    // Insert new news items
    let newsInserted = 0;
    for (const item of relevant) {
      await svc.entities.NewsItem.create({
        title: item.title,
        source: item.source,
        summary: item.summary,
        sentiment: analyzeSentiment(item.title + ' ' + item.summary),
        image_url: item.image_url || '',
        url: item.url,
      }).catch((e) => warnings.push(`insert news: ${e.message}`));
      newsInserted++;
    }

    // Insert new economic events
    let eventsInserted = 0;
    for (const ev of economicEvents) {
      await svc.entities.EconomicEvent.create({
        title: ev.title,
        currency: ev.currency,
        impact: ev.impact,
        time: ev.time,
        actual: '',
        forecast: ev.forecast || '',
        previous: ev.previous || '',
        url: ev.url || '',
      }).catch((e) => warnings.push(`insert event: ${e.message}`));
      eventsInserted++;
    }

    return Response.json({
      success: true,
      newsInserted,
      eventsInserted,
      feedsChecked: RSS_FEEDS.length,
      warnings: warnings.slice(0, 10),
      fetchedAt: new Date().toISOString(),
    });

  } catch (error) {
    console.error('[fetchMarketNews ERROR]', error.message, error.stack);
    return Response.json({ error: error.message }, { status: 500 });
  }
});