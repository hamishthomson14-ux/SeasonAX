// api/_lib/seasonal.js
// Shared helpers for computing seasonal statistics from real price history,
// with a modelled-pattern fallback. Used by the per-asset SEO pages.

// Yahoo Finance uses ticker symbols natively in the same format our
// catalogue already stores them (e.g. HSBA.L, SAP.DE, 7203.T, 0700.HK,
// ^GSPC) \u2014 so almost everything just passes through as-is. The only
// exception is crypto, which needs a "-USD" suffix.

export const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
export const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function yahooSymbol(item) {
  if (!item) return null;
  if (item.id === 'btc') return 'BTC-USD';
  if (item.id === 'eth') return 'ETH-USD';
  return item.ticker || null;
}

// Compute per-calendar-month seasonal stats from monthly close-price rows.
// rows: [{ d: 'YYYY-MM-DD', c: close }, ...] oldest first.
export function computeMonths(rows, yearsWanted = 15, minObs = 5) {
  const byMonth = Array.from({ length: 12 }, () => []);
  const cutoffYear = new Date().getFullYear() - yearsWanted;
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1], cur = rows[i];
    const dt = new Date(cur.d);
    if (dt.getFullYear() < cutoffYear) continue;
    if (!isFinite(prev.c) || prev.c <= 0) continue;
    const ret = ((cur.c - prev.c) / prev.c) * 100;
    if (!isFinite(ret) || Math.abs(ret) > 95) continue;
    byMonth[dt.getMonth()].push(ret);
  }
  const months = [];
  for (let m = 0; m < 12; m++) {
    const arr = byMonth[m];
    if (arr.length < minObs) return null;
    let sum = 0, wins = 0;
    for (const r of arr) { sum += r; if (r > 0) wins++; }
    months.push({ m: MONTH_ABBR[m], avg: +(sum / arr.length).toFixed(2), win: Math.round((wins / arr.length) * 100), n: arr.length });
  }
  return months;
}

// Adaptive resolution: try the requested window first, then progressively
// shorter windows for assets that don't have that much history yet (e.g.
// a stock that IPO'd 4 years ago can never satisfy a 15yr/5-obs check, but
// genuinely has real data). minObs scales down with the window. Returns
// {months, years} where `years` reflects the asset's actual data span
// (not just the cutoff window), or null if even a 2yr window fails.
export function computeAdaptiveMonths(rows, yearsWanted = 15) {
  const base = yearsWanted || 15;
  const candidates = [base, 10, 7, 5, 3, 2].filter((y, i, arr) => y <= base && arr.indexOf(y) === i);
  const firstYear = rows.length ? new Date(rows[0].d).getFullYear() : null;
  const lastYear = rows.length ? new Date(rows[rows.length - 1].d).getFullYear() : null;
  const actualYears = (firstYear && lastYear) ? Math.max(1, lastYear - firstYear + 1) : base;
  for (const y of candidates) {
    const minObs = Math.max(1, Math.min(5, Math.floor(y / 2)));
    const months = computeMonths(rows, y, minObs);
    if (months) return { months, years: Math.min(y, actualYears) };
  }
  return null;
}

// Fetch monthly close history from Yahoo Finance's public chart API.
// No API key. (Previously used Stooq's CSV endpoint, but Stooq now blocks
// server-side/datacenter requests with a JS challenge page.)
const YAHOO_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const YAHOO_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];

export async function fetchMonthly(sym) {
  for (const host of YAHOO_HOSTS) {
    const url = 'https://' + host + '/v8/finance/chart/' + encodeURIComponent(sym) + '?range=20y&interval=1mo';
    let json = null;
    try {
      const r = await fetch(url, { headers: { 'User-Agent': YAHOO_UA, 'Accept': 'application/json' } });
      json = await r.json();
    } catch (e) {
      continue;
    }
    const result = json && json.chart && json.chart.result && json.chart.result[0];
    const quote = result && result.indicators && result.indicators.quote && result.indicators.quote[0];
    if (!result || !result.timestamp || !quote) continue;
    const rows = [];
    for (let i = 0; i < result.timestamp.length; i++) {
      const c = quote.close[i];
      if (c == null || !isFinite(c)) continue;
      rows.push({ d: new Date(result.timestamp[i] * 1000).toISOString().slice(0, 10), c });
    }
    if (rows.length < 24) return null;
    return rows;
  }
  return null;
}

// Modelled fallback: returns a 12-month array shaped like computeMonths' output,
// using the sector/region pattern. Falls back to 'broadIndex' for unknown keys.
export function getModelMonths(item, patterns) {
  const patKey = item.pattern || 'broadIndex';
  const pat = patterns[patKey] || patterns.broadIndex;
  return pat.map(m => ({ m: m.m, avg: m.avg, win: m.win, n: null, note: m.note }));
}

export function bestWorst(months) {
  const sorted = months.map((m, i) => ({ ...m, i })).sort((a, b) => b.avg - a.avg);
  return { best: sorted[0], worst: sorted[sorted.length - 1] };
}
