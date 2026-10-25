// api/v1/seasonality.js
// Public JSON seasonality endpoint — the core TimingAX data as structured JSON.
//
//   GET /api/v1/seasonality?id=sp500
//   GET /api/v1/seasonality?ticker=AAPL
//
// Returns the same monthly seasonal statistics the product uses, computed
// from real historical price data where available (Yahoo Finance) and
// labelled honestly as "verified" or "modelled". Keyless, CORS-open, cached.
//
// Response shape:
// {
//   "id": "sp500",
//   "ticker": "^GSPC",
//   "name": "S&P 500",
//   "region": "US",
//   "source": "verified",          // "verified" = real price data, "modelled" = sector pattern
//   "years": 15,                    // years of history the stats are based on (verified only)
//   "months": [
//     { "month": "January", "abbr": "Jan", "avgReturn": 1.12, "winRate": 67, "observations": 15 },
//     ...
//   ],
//   "best":  { "month": "November", "avgReturn": 1.71, "winRate": 70 },
//   "worst": { "month": "September", "avgReturn": -0.74, "winRate": 41 },
//   "generatedAt": "2026-06-21T..."
// }

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import {
  yahooSymbol, computeAdaptiveMonths, getModelMonths, bestWorst,
  fetchMonthly, fetchDaily, computeProjection, computePatterns, MONTH_NAMES, MONTH_ABBR,
} from '../_lib/seasonal.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOGUE = JSON.parse(readFileSync(path.join(__dirname, '../_data/catalogue.json'), 'utf8'));
const PATTERNS = JSON.parse(readFileSync(path.join(__dirname, '../_data/patterns.json'), 'utf8'));

// Run fn over items with at most `n` in flight (keeps upstream price requests polite).
async function mapLimit(items, n, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

// Leaderboard sections fetch up to 76 assets: allow the Hobby maximum.
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed. Use GET.' });

  const { id, ticker } = req.query;

  // ── ?view=leaderboard&section=<catSection> — this month's real figures for one catalogue section.
  // The page ranks across all 30 sections; per-section requests keep each call small and CDN-cached.
  if (req.query.view === 'leaderboard') {
    const section = String(req.query.section || '');
    const members = CATALOGUE.filter(a => a.catSection === section);
    if (!members.length) return res.status(400).json({ error: 'Unknown section', sections: [...new Set(CATALOGUE.map(a => a.catSection))] });
    const mi = new Date().getUTCMonth();
    const results = await mapLimit(members, 8, async (item) => {
      try {
        const rows = await fetchMonthly(yahooSymbol(item));
        const real = rows && computeAdaptiveMonths(rows, 15);
        if (!real || !real.months) return null;
        const m = real.months[mi];
        return { id: item.id, name: item.name, ticker: item.ticker, region: item.region, section, avg: +m.avg, win: m.win, obs: m.n != null ? m.n : null, years: real.years };
      } catch (e) { return null; }
    });
    const rowsOut = results.filter(Boolean);
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
    return res.status(200).json({ view: 'leaderboard', section, month: MONTH_ABBR[mi], monthName: MONTH_NAMES[mi],
      total: members.length, unavailable: members.length - rowsOut.length, rows: rowsOut, generatedAt: new Date().toISOString() });
  }

  if (!id && !ticker) {
    return res.status(400).json({
      error: 'Provide an asset via ?id= or ?ticker=',
      example: '/api/v1/seasonality?id=sp500',
      browseAssets: '/api/catalogue',
    });
  }

  // Resolve the asset from the catalogue
  let item = null;
  if (id) {
    item = CATALOGUE.find(a => a.id === String(id).toLowerCase());
  } else if (ticker) {
    const t = String(ticker).toUpperCase();
    item = CATALOGUE.find(a => a.ticker.toUpperCase() === t);
  }
  if (!item) {
    return res.status(404).json({
      error: 'Asset not found',
      hint: 'Browse all available assets at /api/catalogue',
    });
  }

  // ── ?view=projection&days=30|60|90 — next-N-days seasonal path from real daily prices ──
  // (A mode of this endpoint rather than a new function: the Hobby plan allows 12 functions.)
  const view = String(req.query.view || 'months');
  if (!['months', 'projection', 'patterns'].includes(view)) return res.status(400).json({ error: 'Unknown view. Use view=months, projection, patterns or leaderboard.' });
  // ── ?view=patterns — best/worst weeks of the year + turn-of-month, from real daily prices ──
  if (view === 'patterns') {
    let pat = null;
    try { const rows = await fetchDaily(yahooSymbol(item)); pat = rows && computePatterns(rows, { today: new Date(), years: 15 }); } catch (e) { pat = null; }
    if (!pat) return res.status(404).json({ error: 'unavailable', hint: 'Needs at least 5 years of real daily prices (never modelled).' });
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
    return res.status(200).json({ id: item.id, ticker: item.ticker, name: item.name, source: 'verified', view: 'patterns', ...pat,
      disclaimer: 'Averages over the last ' + pat.years + ' years of real daily prices. A historical pattern, not a forecast.', generatedAt: new Date().toISOString() });
  }
  if (view === 'projection') {
    const days = Number(req.query.days || 90);
    if (![30, 60, 90].includes(days)) return res.status(400).json({ error: 'days must be 30, 60 or 90' });
    let proj = null;
    try {
      const rows = await fetchDaily(yahooSymbol(item));
      proj = rows && computeProjection(rows, { today: new Date(), days, years: 15 });
    } catch (e) { proj = null; }
    if (!proj) return res.status(404).json({ error: 'unavailable', hint: 'No real daily price history for a projection (never modelled).' });
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({
      id: item.id, ticker: item.ticker, name: item.name, source: 'verified', view: 'projection',
      ...proj,
      disclaimer: 'How this asset moved over the same calendar window in each of the last ' + proj.n + ' years, applied to the latest close. A historical pattern, not a forecast.',
      generatedAt: new Date().toISOString(),
    });
  }

  // Resolve seasonal months: real data first, modelled fallback (same as product)
  let months = null, source = 'modelled', years = null;
  try {
    const sym = yahooSymbol(item);
    const rows = await fetchMonthly(sym);
    if (rows) {
      const real = computeAdaptiveMonths(rows, 15);
      if (real && real.months) {
        months = real.months;
        years = real.years;
        source = 'verified';
      }
    }
  } catch (e) {
    // fall through to modelled
  }
  if (!months) months = getModelMonths(item, PATTERNS);

  // Shape the monthly array
  const monthsOut = months.map((m, i) => ({
    month: MONTH_NAMES[i],
    abbr: MONTH_ABBR[i],
    avgReturn: +m.avg,
    winRate: m.win,
    observations: m.n != null ? m.n : null,
  }));

  const bw = bestWorst(months);
  const fmtBW = (x) => x ? {
    month: MONTH_NAMES[x.i], avgReturn: +x.avg, winRate: x.win,
  } : null;

  // Cache at the edge for an hour
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).json({
    id: item.id,
    ticker: item.ticker,
    name: item.name,
    region: item.region,
    sector: item.sector,
    source,
    years,
    months: monthsOut,
    best: fmtBW(bw && bw.best),
    worst: fmtBW(bw && bw.worst),
    disclaimer: 'Seasonality is a historical tendency, not a prediction. Past performance does not guarantee future results.',
    generatedAt: new Date().toISOString(),
  });
}
