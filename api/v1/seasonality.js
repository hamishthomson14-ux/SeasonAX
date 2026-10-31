// api/v1/seasonality.js
// Public JSON seasonality endpoint — the core TimingAX data as structured JSON.
//
//   GET /api/v1/seasonality?id=sp500
//   GET /api/v1/seasonality?ticker=AAPL
//
// Returns the same monthly seasonal statistics the product uses, computed
// from real historical price data (Yahoo Finance). An asset without real
// history gets a 404, never modelled figures. Keyless, CORS-open, cached.
//
// Response shape:
// {
//   "id": "sp500",
//   "ticker": "^GSPC",
//   "name": "S&P 500",
//   "region": "US",
//   "source": "verified",          // always "verified": computed from real price data
//   "years": 15,                    // years of history the stats are based on
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
  yahooSymbol, computeAdaptiveMonths, bestWorst,
  fetchMonthly, fetchDaily, computeProjection, computePatterns, computeYearCurve, computeMonthGrid, roundGrid, computeConsistency, buildCalendar, computeTrackRecord, computeThisDay, computeEventStudy, computeMonthHistory, computePriceHistory, computeBacktest, computePairStats, MONTH_NAMES, MONTH_ABBR,
} from '../_lib/seasonal.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOGUE = JSON.parse(readFileSync(path.join(__dirname, '../_data/catalogue.json'), 'utf8'));
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
    const members = CATALOGUE.filter(a => a.catSection === section && !a.noHistory);   // noHistory: delisted, no prices to rank
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
  if (!['months', 'projection', 'patterns', 'track', 'day', 'events', 'month', 'backtest', 'pair', 'history', 'curve', 'grid', 'consistency'].includes(view)) return res.status(400).json({ error: 'Unknown view. Use view=months, projection, patterns, track, day, events, month, backtest, pair, history, curve, grid, consistency or leaderboard.' });
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
    const yq = req.query.years;
    if (yq != null && !/^(?:[1-9]|1\d|20)$/.test(String(yq))) return res.status(400).json({ error: 'years must be 1-20' });
    const span = yq != null ? +yq : 15;
    let h = null;
    try {
      const [mrows, drows] = await Promise.all([fetchMonthly(yahooSymbol(item)), fetchDaily(yahooSymbol(item))]);
      h = mrows && computeMonthHistory(mrows, drows, { month: mi, now: new Date(), years: span });
    } catch (e) { h = null; }
    if (!h) return res.status(404).json({ error: 'unavailable', hint: 'Needs real price history (never modelled).' });
    const fed = EVENTS_HISTORY.types.filter((t) => t.id === 'fed-cut' || t.id === 'fed-hike')
      .flatMap((t) => t.events.filter((e) => +e.date.slice(5, 7) - 1 === mi).map((e) => ({ date: e.date, dir: t.id === 'fed-cut' ? 'cut' : 'hike', bp: e.bp, level: e.level })))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({ id: item.id, ticker: item.ticker, name: item.name, source: 'verified', view: 'month', month: MONTH_NAMES[mi], yearsRequested: span, ...h,
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
  // ── ?view=pair&with=<id> — seasonal correlation + actual monthly-return correlation, real data only ──
  if (view === 'pair') {
    const other = CATALOGUE.find(a => a.id === String(req.query.with || '').toLowerCase());
    if (!other) return res.status(400).json({ error: 'Provide the second asset via &with=' });
    let p = null;
    try { const [ra, rb] = await Promise.all([fetchMonthly(yahooSymbol(item)), fetchMonthly(yahooSymbol(other))]); p = ra && rb && computePairStats(ra, rb, { now: new Date() }); } catch (e) { p = null; }
    if (!p) return res.status(404).json({ error: 'unavailable', hint: 'Both assets need real price history; nothing is computed from a model.' });
    const side = (it, x) => ({ id: it.id, ticker: it.ticker, name: it.name, years: x.years, months: x.months.map((m, i) => ({ month: MONTH_NAMES[i], avgReturn: m.avg, winRate: m.win, observations: m.n })) });
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({ source: 'verified', view: 'pair', a: side(item, p.a), b: side(other, p.b), seasonal: p.seasonal, returns: p.returns,
      method: 'Seasonal correlation: Pearson correlation of the two assets\' 12 monthly average returns. Monthly-return correlation: Pearson correlation of their actual monthly returns over the completed months they share in the last 15 calendar years.',
      generatedAt: new Date().toISOString() });
  }
  // ── ?view=history — monthly closes (up to 20 years) with total and annualised return; real data only ──
  if (view === 'history') {
    let h = null;
    try { h = computePriceHistory(await fetchMonthly(yahooSymbol(item))); } catch (e) { h = null; }
    if (!h) return res.status(404).json({ error: 'unavailable', hint: 'Needs real price history (never modelled).' });
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({ id: item.id, ticker: item.ticker, name: item.name, source: 'verified', view: 'history', ...h,
      method: 'Last close of each calendar month (Yahoo Finance; adjusted closes where Yahoo provides them). Annualised return compounds over the months between the first and last close.',
      generatedAt: new Date().toISOString() });
  }
  // ── ?view=grid — every month's real return, year by year (the heatmap); inAvg marks the cells behind the average ──
  if (view === 'grid') {
    let g = null;
    try { g = computeMonthGrid(await fetchMonthly(yahooSymbol(item)), { now: new Date(), years: 15 }); } catch (e) { g = null; }
    if (!g) return res.status(404).json({ error: 'unavailable', hint: 'Needs real monthly price history (never modelled).' });
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    const pub = roundGrid(g);
    return res.status(200).json({ id: item.id, ticker: item.ticker, name: item.name, source: 'verified', view: 'grid', window: pub.window, months: pub.months, years: pub.years,
      method: 'Each cell: last close of the month vs last close of the month before (Yahoo Finance; adjusted where provided). inAvg marks the last ' + g.window + ' completed occurrences of each month, the ones behind the published average; partial marks the month in progress; flag "data" marks a move over 95% treated as a data error. total: Dec to Dec (this year: to the latest close).',
      generatedAt: new Date().toISOString() });
  }
  // ── ?view=curve — the typical calendar year (median path of the last 15 completed years) vs this year so far ──
  if (view === 'curve') {
    let c = null;
    try { c = computeYearCurve(await fetchDaily(yahooSymbol(item)), { now: new Date(), years: 15 }); } catch (e) { c = null; }
    if (!c) return res.status(404).json({ error: 'unavailable', hint: 'Needs at least 5 completed years of real daily prices (never modelled).' });
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
    return res.status(200).json({ id: item.id, ticker: item.ticker, name: item.name, source: 'verified', view: 'curve', ...c,
      method: 'Daily closes (Yahoo Finance; adjusted where provided). Each year is measured from the previous year\'s last close; weekends and holidays carry the last close forward; 29 Feb shares 28 Feb. typical = the median of the ' + c.n + ' years on each calendar day, p25/p75 = the middle half.',
      disclaimer: 'A historical pattern, not a forecast.', generatedAt: new Date().toISOString() });
  }
  // ── ?view=consistency — does the pattern hold out of sample? The 15 completed occurrences of each month behind the
  // published average vs the (up to 15) occurrences before them: two windows that share no month. Needs 32 years of closes.
  if (view === 'consistency') {
    let rows = null;
    try { rows = await fetchMonthly(yahooSymbol(item), '32y'); } catch (e) { rows = null; }
    if (!rows) return res.status(404).json({ error: 'unavailable', hint: 'Needs real monthly price history (never modelled).' });
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
    const c = computeConsistency(rows, { now: new Date(), years: 15 });
    // Too young for the check is an answer, not an error (200): most assets listed after 2001 land here.
    if (!c) return res.status(200).json({ id: item.id, ticker: item.ticker, name: item.name, source: 'verified', view: 'consistency', available: false,
      hint: 'Needs at least 25 years of real monthly history: the last 15 completed occurrences of each month and at least 10 before them (never modelled).', generatedAt: new Date().toISOString() });
    return res.status(200).json({ id: item.id, ticker: item.ticker, name: item.name, source: 'verified', view: 'consistency', available: true, ...c,
      method: 'Month-end closes (Yahoo Finance; adjusted where provided). recent = the last 15 completed occurrences of each month, the same months as the published average; prior = the occurrences before them, so the windows share no month. agree: the month\'s average return has the same sign in both. rankCorr: Spearman rank correlation of the two windows\' 12 monthly averages.',
      disclaimer: 'Agreement between two past windows is evidence that a pattern persisted; it is not a forecast.', generatedAt: new Date().toISOString() });
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

  // Real price history only. Without it (or during a price-source outage) answer "unavailable", cached briefly
  // so a transient failure is retried soon — never model figures.
  let months = null, source = null, years = null;
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
  } catch (e) { /* treated as unavailable below */ }
  if (!months) {
    res.setHeader('Cache-Control', 's-maxage=60');
    return res.status(404).json({ error: 'unavailable', id: item.id, ticker: item.ticker, name: item.name,
      hint: 'No verified price history for this asset right now. TimingAX never serves modelled figures.' });
  }

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
