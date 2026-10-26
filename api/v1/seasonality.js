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
  fetchMonthly, fetchDaily, computeProjection, computePatterns, buildCalendar, computeTrackRecord, computeThisDay, computeEventStudy, computeMonthHistory, computeBacktest, MONTH_NAMES, MONTH_ABBR,
} from '../_lib/seasonal.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOGUE = JSON.parse(readFileSync(path.join(__dirname, '../_data/catalogue.json'), 'utf8'));
const PATTERNS = JSON.parse(readFileSync(path.join(__dirname, '../_data/patterns.json'), 'utf8'));
const EVENTS_HISTORY = JSON.parse(readFileSync(path.join(__dirname, '../_data/events-history.json'), 'utf8'));

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
    // ?month=1..12 (default: the current month)
    const mq = req.query.month;
    if (mq != null && !/^(?:[1-9]|1[0-2])$/.test(String(mq))) return res.status(400).json({ error: 'month must be 1-12' });
    const mi = mq != null ? Number(mq) - 1 : new Date().getUTCMonth();
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
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');   // same freshness as the per-asset view
    return res.status(200).json({ view: 'leaderboard', section, month: MONTH_ABBR[mi], monthName: MONTH_NAMES[mi],
      total: members.length, unavailable: members.length - rowsOut.length, rows: rowsOut, generatedAt: new Date().toISOString() });
  }

  // ── ?view=calendar&ids=a,b,… — ICS feed of historically strong/weak months (watchlist, max 10) ──
  if (req.query.view === 'calendar') {
    const ids = String(req.query.ids || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
    if (ids.length > 10) return res.status(400).json({ error: 'At most 10 assets' });
    const items = [...new Set(ids)].map(x => CATALOGUE.find(a => a.id === x)).filter(Boolean);
    if (!items.length) return res.status(400).json({ error: 'Provide up to 10 asset ids via ?ids=' });
    const entries = (await mapLimit(items, 5, async (item) => {
      try { const rows = await fetchMonthly(yahooSymbol(item)); const real = rows && computeAdaptiveMonths(rows, 15); return real && real.months ? { item, months: real.months } : null; } catch (e) { return null; }
    })).filter(Boolean);                                      // real data only: modelled assets get no events
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="timingax-seasonal.ics"');
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
    return res.status(200).send(buildCalendar(entries, { now: new Date() }));
  }

  // ── ?view=events — event types (official dates); with &type=&id= the asset's moves around each event ──
  if (req.query.view === 'events' && !req.query.type) {
    res.setHeader('Cache-Control', 's-maxage=86400');
    return res.status(200).json({ checked: EVENTS_HISTORY.checked, types: EVENTS_HISTORY.types.map(({ events, ...t }) => ({ ...t, count: events.length, first: events[0] && events[0].date, last: events[events.length - 1] && events[events.length - 1].date })) });
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
  if (!['months', 'projection', 'patterns', 'track', 'day', 'events', 'month', 'backtest'].includes(view)) return res.status(400).json({ error: 'Unknown view. Use view=months, projection, patterns, track, day, events, month, backtest or leaderboard.' });
  if (view === 'events') {
    const type = EVENTS_HISTORY.types.find((t) => t.id === String(req.query.type));
    if (!type) return res.status(400).json({ error: 'Unknown event type', types: EVENTS_HISTORY.types.map((t) => t.id) });
    let st = null;
    try { const rows = await fetchDaily(yahooSymbol(item)); st = rows && computeEventStudy(rows, type.events.map((e) => e.date)); } catch (e) { st = null; }
    if (!st || !st.events.length) return res.status(404).json({ error: 'unavailable', hint: 'No real daily prices covering these events.' });
    const r2 = (v) => (v === null ? null : Math.round(v * 100) / 100), meta = Object.fromEntries(type.events.map((e) => [e.date, e]));
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
    return res.status(200).json({ id: item.id, ticker: item.ticker, name: item.name, source: 'verified', view: 'events',
      type: { id: type.id, name: type.name, note: type.note, source: type.source },
      events: st.events.map((e) => ({ ...meta[e.date], date: e.date, before: r2(e.before), d1: r2(e.d1), w1: r2(e.w1), m1: r2(e.m1), m3: r2(e.m3) })),
      summary: st.summary, method: 'Moves from the close on the last trading day before each event: day 1, 5, 21 and 63 trading days on; "before" is the 21 trading days leading in.', generatedAt: new Date().toISOString() });
  }
  // ── ?view=day&date=MM-DD — daily move on one calendar date over the last 20 years ──
  if (view === 'day') {
    const now = new Date();
    const dq = req.query.date ? String(req.query.date) : `${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
    const dm = dq.match(/^(\d\d)-(\d\d)$/);
    if (!dm || new Date(Date.UTC(2024, +dm[1] - 1, +dm[2])).getUTCDate() !== +dm[2] || +dm[1] < 1 || +dm[1] > 12) return res.status(400).json({ error: 'date must be MM-DD' });
    let d = null;
    try { const rows = await fetchDaily(yahooSymbol(item)); d = rows && computeThisDay(rows, { month: +dm[1], day: +dm[2], years: 20, now }); } catch (e) { d = null; }
    if (!d || !d.summary.traded) return res.status(404).json({ error: 'unavailable', hint: 'Needs real daily prices (never modelled).' });
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
    return res.status(200).json({ id: item.id, ticker: item.ticker, name: item.name, source: 'verified', view: 'day', ...d, generatedAt: new Date().toISOString() });
  }
  // ── ?view=month&month=1..12 — every year's return for that calendar month, biggest days, Fed changes in it ──
  if (view === 'month') {
    const mq = String(req.query.month || '');
    if (!/^(?:[1-9]|1[0-2])$/.test(mq)) return res.status(400).json({ error: 'month must be 1-12' });
    const mi = +mq - 1;
    let h = null;
    try {
      const [mrows, drows] = await Promise.all([fetchMonthly(yahooSymbol(item)), fetchDaily(yahooSymbol(item))]);
      h = mrows && computeMonthHistory(mrows, drows, { month: mi, now: new Date() });
    } catch (e) { h = null; }
    if (!h) return res.status(404).json({ error: 'unavailable', hint: 'Needs real price history (never modelled).' });
    const fed = EVENTS_HISTORY.types.filter((t) => t.id === 'fed-cut' || t.id === 'fed-hike')
      .flatMap((t) => t.events.filter((e) => +e.date.slice(5, 7) - 1 === mi).map((e) => ({ date: e.date, dir: t.id === 'fed-cut' ? 'cut' : 'hike', bp: e.bp, level: e.level })))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({ id: item.id, ticker: item.ticker, name: item.name, source: 'verified', view: 'month', month: MONTH_NAMES[mi], ...h,
      fed, fedSource: 'https://www.federalreserve.gov/monetarypolicy/openmarket.htm',
      method: 'Monthly: last close to last close, same window and rules as the seasonal averages. Daily: close to close. Fed: dates the target change took effect, since October 2006.',
      generatedAt: new Date().toISOString() });
  }
  // ── ?view=backtest&buy=1..12&buyDay=first|last&sell=1..12&sellDay=first|last&from=YYYY&to=YYYY — real daily closes only ──
  if (view === 'backtest') {
    const q = req.query, m = (v) => /^(?:[1-9]|1[0-2])$/.test(String(v)), dayOk = (v) => v === 'first' || v === 'last';
    if (!m(q.buy) || !m(q.sell) || !dayOk(q.buyDay) || !dayOk(q.sellDay)) return res.status(400).json({ error: 'buy/sell must be 1-12 and buyDay/sellDay first or last' });
    const from = /^\d{4}$/.test(String(q.from)) ? +q.from : 0, to = /^\d{4}$/.test(String(q.to)) ? +q.to : 9999;
    let b = null;
    try { const rows = await fetchDaily(yahooSymbol(item)); b = rows && computeBacktest(rows, { buyM: +q.buy - 1, buyDay: q.buyDay, sellM: +q.sell - 1, sellDay: q.sellDay, from, to, now: new Date() }); } catch (e) { b = null; }
    if (!b) return res.status(404).json({ error: 'unavailable', hint: 'Backtests need real daily prices; none are simulated.' });
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({ id: item.id, ticker: item.ticker, name: item.name, source: 'verified', view: 'backtest', ...b,
      method: 'Buy at the close of the chosen trading day of the buy month and sell at the close of the chosen trading day of the sell month (the next year if the window crosses New Year). Only completed windows. Returns compound; buy and hold runs from the first entry to the last exit. Yahoo Finance daily closes (adjusted closes where Yahoo provides them).',
      generatedAt: new Date().toISOString() });
  }
  // ── ?view=track — last 36 months: out-of-sample seasonal verdict vs the actual return ──
  if (view === 'track') {
    let tr = null;
    try { const rows = await fetchMonthly(yahooSymbol(item)); tr = rows && computeTrackRecord(rows, { now: new Date(), months: 36 }); } catch (e) { tr = null; }
    if (!tr || !tr.records.some((x) => x.verdict)) return res.status(404).json({ error: 'unavailable', hint: 'Needs real monthly history (never modelled).' });
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
    return res.status(200).json({ id: item.id, ticker: item.ticker, name: item.name, source: 'verified', view: 'track', ...tr,
      disclaimer: 'Each month\'s signal uses only the 15 years before that month; the outcome is the month\'s actual return. Neutral months are not scored.', generatedAt: new Date().toISOString() });
  }
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
