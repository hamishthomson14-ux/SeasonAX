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
  fetchMonthly, MONTH_NAMES, MONTH_ABBR,
} from '../_lib/seasonal.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOGUE = JSON.parse(readFileSync(path.join(__dirname, '../_data/catalogue.json'), 'utf8'));
const PATTERNS = JSON.parse(readFileSync(path.join(__dirname, '../_data/patterns.json'), 'utf8'));

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed. Use GET.' });

  const { id, ticker } = req.query;
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
