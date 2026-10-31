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
// The months behind a "15-year average": the last `yearsWanted` COMPLETED occurrences of each month. The month in
// progress is left out (its return so far is not a month's return), no month gets an extra year, and a move over
// 95% (a data error, e.g. an unadjusted split) is skipped so an older year takes its place.
function selectMonths(rows, yearsWanted, now) {
  const current = now.toISOString().slice(0, 7);
  const byMonth = Array.from({ length: 12 }, () => []);
  for (let i = rows.length - 1; i >= 1; i--) {   // newest first, so each month keeps its most recent years
    const prev = rows[i - 1], cur = rows[i];
    if (cur.d.slice(0, 7) >= current) continue;
    const mo = +cur.d.slice(5, 7) - 1;       // 0-indexed month ('YYYY-MM-DD' parsed directly, no TZ drift)
    if (byMonth[mo].length >= yearsWanted) continue;
    if (!isFinite(prev.c) || prev.c <= 0) continue;
    const ret = ((cur.c - prev.c) / prev.c) * 100;
    if (!isFinite(ret) || Math.abs(ret) > 95) continue;
    byMonth[mo].push({ ym: cur.d.slice(0, 7), ret });
  }
  return byMonth;
}

export function computeMonths(rows, yearsWanted = 15, minObs = 5, now = new Date()) {
  const byMonth = selectMonths(rows, yearsWanted, now);
  const months = [];
  for (let m = 0; m < 12; m++) {
    const arr = byMonth[m];
    if (arr.length < minObs) return null;
    let sum = 0, wins = 0;
    for (const { ret } of arr) { sum += ret; if (ret > 0) wins++; }
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
export function computeAdaptiveMonths(rows, yearsWanted = 15, now = new Date()) {
  const base = yearsWanted || 15;
  const candidates = [base, 10, 7, 5, 3, 2].filter((y, i, arr) => y <= base && arr.indexOf(y) === i);
  const firstYear = rows.length ? new Date(rows[0].d).getFullYear() : null;
  const lastYear = rows.length ? new Date(rows[rows.length - 1].d).getFullYear() : null;
  const actualYears = (firstYear && lastYear) ? Math.max(1, lastYear - firstYear + 1) : base;
  for (const y of candidates) {
    const minObs = Math.max(1, Math.min(5, Math.floor(y / 2)));
    const months = computeMonths(rows, y, minObs, now);
    if (months) return { months, years: Math.min(y, actualYears), window: y };
  }
  return null;
}

// Year × month returns grid (the heatmap). Every cell is a month-end to month-end return; inAvg marks exactly the
// cells behind the published average (same window as computeAdaptiveMonths), partial marks the month in progress
// and flag 'data' a skipped data-error move. total is the calendar-year return (Dec to Dec; this year: so far).
export function computeMonthGrid(rows, { now = new Date(), years = 15 } = {}) {
  const ad = rows && computeAdaptiveMonths(rows, years, now);
  if (!ad) return null;
  const used = new Set(selectMonths(rows, ad.window, now).flat().map((x) => x.ym));
  const current = now.toISOString().slice(0, 7), Y = +current.slice(0, 4);
  const first = Math.min(...[...used].map((ym) => +ym.slice(0, 4)));
  const byYM = new Map(rows.map((r, i) => [r.d.slice(0, 7), i]));
  const out = [];
  for (let y = Y; y >= first; y--) {
    const cells = Array.from({ length: 12 }, (_, m) => {
      const ym = `${y}-${String(m + 1).padStart(2, '0')}`, i = byYM.get(ym);
      if (i === undefined || i < 1 || ym > current) return null;
      const prev = rows[i - 1].c, ret = (rows[i].c / prev - 1) * 100;
      if (!isFinite(ret) || prev <= 0) return null;
      const c = { ret, inAvg: used.has(ym) };
      if (ym === current) c.partial = true;
      if (Math.abs(ret) > 95) c.flag = 'data';
      return c;
    });
    const dec = byYM.get(`${y - 1}-12`), end = y === Y ? rows.length - 1 : byYM.get(`${y}-12`);
    const row = { year: y, cells, total: dec !== undefined && end !== undefined && end > dec ? (rows[end].c / rows[dec].c - 1) * 100 : null };
    if (y === Y) row.totalPartial = true;
    out.push(row);
  }
  return { window: ad.window, months: ad.months, years: out };
}
// The grid as published (API and pages): returns to 2 decimals, so every view rounds from the same numbers.
export function roundGrid(g) {
  const r2 = (v) => v == null ? null : Math.round(v * 100) / 100;
  return { ...g, years: g.years.map((y) => ({ ...y, total: r2(y.total), cells: y.cells.map((c) => c && { ...c, ret: r2(c.ret) }) })) };
}

// "Does the pattern hold?": the last `years` completed occurrences of each month (the window behind the published
// average) against the occurrences before them, so the two windows share no month. Out of sample, not a forecast.
// Needs the full recent window and at least `minPrior` earlier occurrences of every month; otherwise null (never modelled).
export function computeConsistency(rows, { now = new Date(), years = 15, minPrior = 10 } = {}) {
  if (!rows) return null;
  const by = selectMonths(rows, years * 2, now);
  const stat = (arr) => { let s = 0, w = 0; for (const { ret } of arr) { s += ret; if (ret > 0) w++; } return { avg: +(s / arr.length).toFixed(2), win: Math.round((w / arr.length) * 100), n: arr.length }; };
  const months = [], span = { recent: [], prior: [] };
  for (let m = 0; m < 12; m++) {
    const recent = by[m].slice(0, years), prior = by[m].slice(years);
    if (recent.length < years || prior.length < minPrior) return null;
    span.recent.push(...recent.map((x) => x.ym)); span.prior.push(...prior.map((x) => x.ym));
    const r = stat(recent), p = stat(prior);
    months.push({ m: MONTH_ABBR[m], recent: r, prior: p, agree: (r.avg > 0) === (p.avg > 0) });
  }
  const window = (yms, ns) => ({ from: yms.reduce((a, b) => (a < b ? a : b)), to: yms.reduce((a, b) => (a > b ? a : b)), n: Math.min(...ns) });
  const rank = (xs) => {   // average ranks, so ties count equally
    const idx = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]), r = new Array(xs.length);
    for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1; i = j + 1; }
    return r;
  };
  // Spearman rank correlation of the two windows' 12 monthly averages: did the ORDER of the months persist?
  const ra = rank(months.map((x) => x.recent.avg)), rp = rank(months.map((x) => x.prior.avg)), mean = 6.5;
  let srp = 0, srr = 0, spp = 0;
  for (let m = 0; m < 12; m++) { srp += (ra[m] - mean) * (rp[m] - mean); srr += (ra[m] - mean) ** 2; spp += (rp[m] - mean) ** 2; }
  const rankCorr = srr && spp ? Math.round((srp / Math.sqrt(srr * spp)) * 100) / 100 : null;
  const pick = (k, sign) => months.reduce((b, x) => (sign * x[k].avg > sign * b[k].avg ? x : b)).m;
  return { years, recent: window(span.recent, months.map((x) => x.recent.n)), prior: window(span.prior, months.map((x) => x.prior.n)), months,
    agree: months.filter((x) => x.agree).length, rankCorr, best: { recent: pick('recent', 1), prior: pick('prior', 1) }, worst: { recent: pick('recent', -1), prior: pick('prior', -1) } };
}

// Fetch monthly close history from Yahoo Finance's public chart API.
// No API key. (Previously used Stooq's CSV endpoint, but Stooq now blocks
// server-side/datacenter requests with a JS challenge page.)
const YAHOO_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
// Overridable for tests (TX_YAHOO_BASES=http://127.0.0.1:1234,...); production uses Yahoo's two query hosts.
const YAHOO_BASES = (process.env.TX_YAHOO_BASES || 'https://query1.finance.yahoo.com,https://query2.finance.yahoo.com').split(',').map((s) => s.trim()).filter(Boolean);
// A stalled request must not hang the page or API until the platform's 60s limit: give up and try the next host.
const FETCH_TIMEOUT_MS = +(process.env.TX_FETCH_TIMEOUT_MS || 12000);
// The provider did not answer (network, timeout, 429/5xx, unparseable): callers say "temporarily unavailable" with a
// 503 and never cache it. It is never "no history", which is what a silent null used to turn into.
export class UpstreamError extends Error { constructor(msg) { super(msg); this.name = 'UpstreamError'; } }
// One chart request with failover across the bases. Returns Yahoo's result object; null when the provider answered
// and has nothing for the symbol (unknown, delisted, no series); throws UpstreamError when no base gave an answer.
async function yahooChart(sym, query) {
  let why = 'no bases configured';
  for (const base of YAHOO_BASES) {
    let r, json;
    try { r = await fetch(base + '/v8/finance/chart/' + encodeURIComponent(sym) + '?' + query, { headers: { 'User-Agent': YAHOO_UA, 'Accept': 'application/json' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }); }
    catch (e) { why = String((e && e.message) || e); continue; }                        // network, DNS, timeout
    try { json = await r.json(); } catch (e) { why = 'HTTP ' + r.status + ', not JSON'; continue; }
    const chart = json && json.chart;
    if (!chart) { why = 'HTTP ' + r.status + ', no chart envelope'; continue; }          // 429/5xx bodies
    if (chart.error && !chart.result) {
      const what = ((chart.error.code || '') + ' ' + (chart.error.description || '')).trim();
      if (/not found|no data|delisted|invalid/i.test(what)) return null;               // definitive: nothing to show
      why = 'HTTP ' + r.status + ', ' + what; continue;
    }
    const result = chart.result && chart.result[0];
    if (!result || !result.timestamp || !result.indicators || !result.indicators.quote || !result.indicators.quote[0]) return null;
    return result;
  }
  throw new UpstreamError('price provider unavailable for ' + sym + ' (' + why + ')');
}

// range: Yahoo accepts '<N>y' with daily bars (range=max silently drops to quarterly bars, so it is never used).
// null: the provider answered and has no usable series for this symbol. UpstreamError: it did not answer.
export async function fetchMonthly(sym, range = '20y') {
  const result = await yahooChart(sym, 'range=' + range + '&interval=1d');
  if (!result) return null;
  const quote = result.indicators.quote[0], adj = result.indicators.adjclose && result.indicators.adjclose[0];
  const closes = (adj && adj.adjclose) ? adj.adjclose : quote.close;
  // Roll daily closes up to one observation per calendar month (last close in each UTC month). Avoids Yahoo's 1mo
  // boundary drift that skips/dups months for non-US exchanges (e.g. .L listings missing October).
  const byYM = new Map();
  for (let i = 0; i < result.timestamp.length; i++) {
    const c = closes[i];
    if (c == null || !isFinite(c)) continue;
    byYM.set(new Date(result.timestamp[i] * 1000).toISOString().slice(0, 7), c);
  }
  const rows = Array.from(byYM.entries()).map(([ym, c]) => ({ d: ym + '-01', c })).sort((a, b) => a.d < b.d ? -1 : 1);
  return rows.length < 24 ? null : rows;
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

// ── Seasonal projection ─────────────────────────────────────────────────────
// Daily closes (dividend-adjusted where Yahoo provides it), oldest first: [{ t: msUTC, c }].
export async function fetchDaily(sym) {
  const result = await yahooChart(sym, 'range=20y&interval=1d');
  if (!result) return null;
  const quote = result.indicators.quote[0], adj = result.indicators.adjclose && result.indicators.adjclose[0];
  const closes = (adj && adj.adjclose) ? adj.adjclose : quote.close;
  const rows = [];
  for (let i = 0; i < result.timestamp.length; i++) {
    const c = closes[i];
    if (c != null && isFinite(c) && c > 0) rows.push({ t: result.timestamp[i] * 1000, c });
  }
  return rows.length ? rows : null;
}

// How the asset moved over the next `days` calendar days from today's calendar date in each of
// the last `years` years, as % paths from that year's start close. Per-day median, quartiles and
// range across years. Only complete windows inside the data are used; null if under 5 years.
export function computeProjection(rows, { today = new Date(), days = 90, years = 15 } = {}) {
  if (!rows || rows.length < 2) return null;
  const DAY = 864e5, MIN_YEARS = 5, MAX_GAP = 7 * DAY;
  const last = rows[rows.length - 1];
  const m = today.getUTCMonth(), d = today.getUTCDate(), y1 = today.getUTCFullYear();
  const paths = [];
  for (let y = y1 - years; y < y1; y++) {
    const start = Date.UTC(y, m, d), end = start + days * DAY;
    if (end > last.t) continue;                                   // window not complete in the data
    let i = rows.findIndex((r) => r.t >= start);
    if (i < 0 || rows[i].t - start > MAX_GAP || i === 0 && rows[0].t > start) continue; // before history / gap
    const p0 = rows[i].c, path = [];
    for (let k = 0; k <= days; k++) {
      const t = start + k * DAY;
      while (i + 1 < rows.length && rows[i + 1].t <= t) i++;
      path.push((rows[i].c / p0 - 1) * 100);
    }
    paths.push({ year: y, path });
  }
  if (paths.length < MIN_YEARS) return null;
  const q = (a, p) => { const s = a.slice().sort((x, z) => x - z), i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
  const r2 = (v) => Math.round(v * 100) / 100;
  const out = { days, n: paths.length, up: 0, median: [], p25: [], p75: [], min: [], max: [],
    from: new Date(Date.UTC(y1, m, d)).toISOString().slice(0, 10),
    finals: paths.map((p) => ({ year: p.year, pct: r2(p.path[days]) })),
    start: { date: new Date(last.t).toISOString().slice(0, 10), price: +last.c.toFixed(4) } };
  out.up = paths.filter((p) => p.path[days] > 0).length;
  for (let k = 0; k <= days; k++) {
    const v = paths.map((p) => p.path[k]);
    out.median.push(r2(q(v, 0.5))); out.p25.push(r2(q(v, 0.25))); out.p75.push(r2(q(v, 0.75)));
    out.min.push(r2(Math.min.apply(null, v))); out.max.push(r2(Math.max.apply(null, v)));
  }
  return out;
}

// ── Weekly and turn-of-month patterns (from daily closes) ───────────────────
// ISO-8601 week number (1–53) of a UTC timestamp.
export function isoWeek(t) {
  const d = new Date(t); const day = (d.getUTCDay() + 6) % 7;            // Mon=0
  const th = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3); // Thursday of this week
  const y = new Date(th).getUTCFullYear();
  return 1 + Math.floor((th - Date.UTC(y, 0, 4) + ((new Date(Date.UTC(y, 0, 4)).getUTCDay() + 6) % 7) * 864e5) / (7 * 864e5));
}
function isoYear(t) { const d = new Date(t), day = (d.getUTCDay() + 6) % 7; return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3)).getUTCFullYear(); }

// Over the last `years` years of daily closes: average return + win rate for each ISO week of the year
// (week 53 folded into 52), and the turn-of-month window (last trading day + first 3 of the next month)
// against the typical 4-day stretch on other days. null when under 5 years of data.
export function computePatterns(rows, { today = new Date(), years = 15 } = {}) {
  if (!rows || rows.length < 2) return null;
  const DAY = 864e5, cutoff = Date.UTC(today.getUTCFullYear() - years, today.getUTCMonth(), today.getUTCDate());
  let s = rows.findIndex((r) => r.t >= cutoff); if (s < 0) return null;
  const startT = Math.max(rows[0].t, cutoff), last = rows[rows.length - 1].t;
  const span = (last - startT) / (365.25 * DAY);
  if (span < 5) return null;
  const R = rows.slice(Math.max(0, s - 1));                               // one close before the window as a base
  const r2 = (v) => Math.round(v * 100) / 100;
  const stat = (a) => a.length ? { avg: r2(a.reduce((x, y) => x + y, 0) / a.length), win: Math.round(a.filter((x) => x > 0).length / a.length * 100), obs: a.length } : { avg: null, win: null, obs: 0 };

  // Weekly: last close of each ISO week vs the previous week's last close.
  const weekLast = [];
  for (const r of R) { const k = isoYear(r.t) * 100 + isoWeek(r.t); if (weekLast.length && weekLast[weekLast.length - 1].k === k) weekLast[weekLast.length - 1].c = r.c; else weekLast.push({ k, w: isoWeek(r.t), c: r.c, t: r.t }); }
  const byWeek = Array.from({ length: 52 }, () => []);
  for (let i = 1; i < weekLast.length; i++) if (weekLast[i].t >= cutoff) byWeek[Math.min(weekLast[i].w, 52) - 1].push((weekLast[i].c / weekLast[i - 1].c - 1) * 100);
  const weeks = byWeek.map((a, i) => ({ week: i + 1, ...stat(a) }));
  const ranked = weeks.filter((w) => w.obs >= 5).sort((a, b) => b.avg - a.avg);

  // Turn of the month on the daily series.
  const tomDay = new Uint8Array(R.length), windows = [];
  for (let i = 1; i + 3 < R.length; i++) {
    if (new Date(R[i].t).getUTCMonth() === new Date(R[i + 1].t).getUTCMonth() || R[i].t < cutoff) continue;
    windows.push((R[i + 3].c / R[i - 1].c - 1) * 100);                     // close before the last day -> 3rd day of next month
    for (let k = 0; k < 4; k++) tomDay[i + k] = 1;
  }
  const other = [];
  for (let i = 1; i < R.length; i++) if (!tomDay[i] && R[i].t >= cutoff) other.push(R[i].c / R[i - 1].c - 1);
  const oAvg = other.length ? other.reduce((x, y) => x + y, 0) / other.length : 0;
  const w = stat(windows);
  return {
    years: Math.min(years, Math.round(span)),
    weeks, bestWeeks: ranked.slice(0, 3), worstWeeks: ranked.slice(-3).reverse(),
    tom: { windowAvg: w.avg, windowWin: w.win, windows: w.obs, otherAvg4: r2(((1 + oAvg) ** 4 - 1) * 100) },
  };
}

// ── Typical year ────────────────────────────────────────────────────────────
// Each completed calendar year as a % path from the previous year's last close, on 365 day-of-year slots
// (29 Feb shares 28 Feb's slot; weekends and holidays carry the last close forward). `typical` is the per-slot
// median across the last `years` completed years, p25/p75 the middle half. A year counts only when both its own
// and the previous year's December closes exist. `current` is this year's real path up to the latest close.
const SLOT0 = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
function yearSlot(t) { const d = new Date(t), m = d.getUTCMonth(); return SLOT0[m] + Math.min(d.getUTCDate(), m === 1 ? 28 : 31) - 1; }
export function computeYearCurve(rows, { now = new Date(), years = 15 } = {}) {
  if (!rows || rows.length < 2) return null;
  const byYear = new Map();
  for (const r of rows) { const y = new Date(r.t).getUTCFullYear(); if (!byYear.has(y)) byYear.set(y, []); byYear.get(y).push(r); }
  const endsInDec = (rs) => rs && new Date(rs[rs.length - 1].t).getUTCMonth() === 11;
  const r2 = (v) => Math.round(v * 100) / 100;
  function path(y, upto) {
    const prev = byYear.get(y - 1), own = byYear.get(y);
    if (!endsInDec(prev) || !own) return null;
    const base = prev[prev.length - 1].c, out = new Array(upto + 1);
    for (const r of own) out[yearSlot(r.t)] = (r.c / base - 1) * 100;
    for (let k = 0, v = 0; k <= upto; k++) { if (out[k] === undefined) out[k] = v; v = out[k]; }
    return out;
  }
  const Y = now.getUTCFullYear(), used = [], paths = [];
  for (let y = Y - 1; used.length < years && byYear.has(y - 1); y--) {
    if (!endsInDec(byYear.get(y))) continue;
    const p = path(y, 364); if (p) { used.unshift(y); paths.unshift(p); }
  }
  if (used.length < 5) return null;
  const q = (a, f) => { const s = a.slice().sort((x, y) => x - y), i = (s.length - 1) * f, lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };
  const col = (f) => Array.from({ length: 365 }, (_, k) => r2(q(paths.map((p) => p[k]), f)));
  const own = byYear.get(Y), lastRow = own && own[own.length - 1];
  const current = lastRow ? path(Y, yearSlot(lastRow.t)) : null;
  return {
    from: used[0], to: used[used.length - 1], n: used.length, years: used,
    typical: col(0.5), p25: col(0.25), p75: col(0.75),
    up: paths.filter((p) => p[364] > 0).length,
    year: Y, current: current && current.map(r2), asOf: current ? new Date(lastRow.t).toISOString().slice(0, 10) : null,
  };
}

// ── Calendar feed (ICS) ─────────────────────────────────────────────────────
// Same rule as the asset pages and tx.js.
export function verdictOf(avg, win) {
  if (avg >= 0.8 && win >= 60) return 'TAILWIND';
  if (avg <= -0.5 && win <= 45) return 'HEADWIND';
  return 'NEUTRAL';
}
const icsEsc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function icsFold(line) {                                   // RFC 5545: max 75 octets, continuation lines start with a space
  const out = []; let cur = '';
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > (out.length ? 74 : 75)) { out.push(cur); cur = ''; }
    cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
}
// entries: [{ item, months }] (months as from computeAdaptiveMonths). One all-day event per historically
// strong (TAILWIND) or weak (HEADWIND) month over the next 12 months, with a reminder the day before.
export function buildCalendar(entries, { now = new Date() } = {}) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const pctS = (v) => (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TimingAX//Seasonal windows//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:TimingAX seasonal windows', 'X-WR-CALDESC:Historically strong and weak months for your TimingAX watchlist. A historical pattern\\, not a forecast.',
    'REFRESH-INTERVAL;VALUE=DURATION:P1D', 'X-PUBLISHED-TTL:P1D'];
  for (const { item, months } of entries) {
    for (let k = 0; k < 12; k++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + k, 1)), end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
      const m = months[d.getUTCMonth()], v = verdictOf(m.avg, m.win);
      if (v === 'NEUTRAL') continue;
      const strong = v === 'TAILWIND', mn = MONTH_NAMES[d.getUTCMonth()];
      lines.push('BEGIN:VEVENT', `UID:${item.id}-${d.toISOString().slice(0, 7)}@timingax.co.uk`, `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${ymd(d)}`, `DTEND;VALUE=DATE:${ymd(end)}`, 'TRANSP:TRANSPARENT',
        `SUMMARY:${icsEsc(`${item.name}: historically ${strong ? 'strong' : 'weak'} month (${pctS(m.avg)})`)}`,
        `DESCRIPTION:${icsEsc(`${mn} has averaged ${pctS(m.avg)} for ${item.name}, positive in ${m.win}% of the last ${m.n} years. https://www.timingax.co.uk/seasonality/${item.id} — A historical pattern, not a forecast.`)}`,
        `URL:https://www.timingax.co.uk/seasonality/${item.id}`,
        'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-P1D', `DESCRIPTION:${icsEsc(`${item.name} enters a historically ${strong ? 'strong' : 'weak'} month tomorrow`)}`, 'END:VALARM',
        'END:VEVENT');
    }
  }
  lines.push('END:VCALENDAR');
  return lines.map(icsFold).join('\r\n') + '\r\n';
}

// ── Track record (out-of-sample) ────────────────────────────────────────────
// For each of the last `months` complete months: the seasonal verdict for that calendar month using ONLY
// the 15 years before it (min 5), and the month's actual return. hit: tailwind & up, headwind & down;
// neutral months are not scored. rows: monthly closes as from fetchMonthly.
export function computeTrackRecord(rows, { now = new Date(), months = 36, lookback = 15 } = {}) {
  const ret = {};
  for (let i = 1; i < rows.length; i++) {
    const p = rows[i - 1].c, c = rows[i].c, r = (c - p) / p * 100;
    if (isFinite(r) && p > 0 && Math.abs(r) <= 95) ret[rows[i].d.slice(0, 7)] = r;
  }
  const r2 = (v) => Math.round(v * 100) / 100, ym = (y, m) => `${y}-${String(m + 1).padStart(2, '0')}`;
  const records = [];
  for (let k = 1; k <= months; k++) {
    const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1)), y = t.getUTCFullYear(), m = t.getUTCMonth();
    const actual = ret[ym(y, m)];
    const past = []; for (let py = y - lookback; py < y; py++) if (ret[ym(py, m)] != null) past.push(ret[ym(py, m)]);
    const rec = { ym: ym(y, m), actual: actual == null ? null : r2(actual), n: past.length, avg: null, win: null, verdict: null, hit: null };
    if (past.length >= 5 && actual != null) {
      rec.avg = r2(past.reduce((a, b) => a + b, 0) / past.length);
      rec.win = Math.round(past.filter((x) => x > 0).length / past.length * 100);
      rec.verdict = verdictOf(rec.avg, rec.win);
      if (rec.verdict !== 'NEUTRAL') rec.hit = rec.verdict === 'TAILWIND' ? actual > 0 : actual < 0;
    }
    records.push(rec);
  }
  const scored = records.filter((x) => x.hit !== null), withActual = records.filter((x) => x.actual != null);
  const group = (v) => { const g = records.filter((x) => x.verdict === v); return { count: g.length, avgActual: g.length ? r2(g.reduce((a, b) => a + b.actual, 0) / g.length) : null }; };
  return { records, summary: {
    signals: scored.length, hits: scored.filter((x) => x.hit).length,
    hitRate: scored.length ? Math.round(scored.filter((x) => x.hit).length / scored.length * 100) : null,
    tailwind: group('TAILWIND'), headwind: group('HEADWIND'), neutral: group('NEUTRAL'),
    baseUpRate: withActual.length ? Math.round(withActual.filter((x) => x.actual > 0).length / withActual.length * 100) : null,
  } };
}

// ── This day in markets ─────────────────────────────────────────────────────
// Daily % change on one calendar date (month 1-12, day) in each of the last `years` years, from daily
// closes. A year where the market was shut that day is null ("closed"). This year counts once that date
// has passed. null for a date that never exists (e.g. 31 Feb).
export function computeThisDay(rows, { month, day, years = 20, now = new Date() } = {}) {
  const m = month - 1;
  if (!(m >= 0 && m < 12) || new Date(Date.UTC(2024, m, day)).getUTCDate() !== day) return null;
  if (!rows || rows.length < 2) return null;
  const idx = new Map(); rows.forEach((r, i) => idx.set(new Date(r.t).toISOString().slice(0, 10), i));
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const top = Date.UTC(now.getUTCFullYear(), m, day) < today ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const r2 = (v) => Math.round(v * 100) / 100, out = [];
  for (let y = top; y > top - years; y--) {
    const t = Date.UTC(y, m, day), key = new Date(t).toISOString().slice(0, 10);
    const i = new Date(t).getUTCDate() === day ? idx.get(key) : undefined;
    out.push({ year: y, change: i > 0 ? r2((rows[i].c / rows[i - 1].c - 1) * 100) : null });
  }
  const tr = out.filter((x) => x.change !== null);
  const by = (f) => tr.length ? tr.reduce((a, b) => (f(b.change, a.change) ? b : a)) : null;
  return { month, day, years: out, summary: {
    traded: tr.length, up: tr.filter((x) => x.change > 0).length, down: tr.filter((x) => x.change < 0).length,
    avg: tr.length ? r2(tr.reduce((a, b) => a + b.change, 0) / tr.length) : null,
    best: by((x, y) => x > y), worst: by((x, y) => x < y) } };
}

// ── Event studies ───────────────────────────────────────────────────────────
// For each event date: % moves measured from the close on the last trading day before the event.
// d1/w1/m1/m3 = close on the 1st/5th/21st/63rd trading day on or after the event date;
// before = the 21 trading days leading up to that base close. null when a window runs past the data.
export function computeEventStudy(rows, dates) {
  const W = { d1: 1, w1: 5, m1: 21, m3: 63 }, r2 = (v) => Math.round(v * 100) / 100;
  const events = [];
  for (const date of dates) {
    const t = Date.parse(date + 'T00:00:00Z'), i = rows.findIndex((r) => r.t >= t);
    if (i < 1 || rows[i].t - t > 7 * 864e5) continue;            // before the data, or a gap
    const base = rows[i - 1].c, e = { date };
    for (const [k, n] of Object.entries(W)) e[k] = rows[i + n - 1] ? (rows[i + n - 1].c / base - 1) * 100 : null;
    e.before = i - 22 >= 0 ? (base / rows[i - 22].c - 1) * 100 : null;
    events.push(e);
  }
  const summary = {};
  for (const k of ['before', 'd1', 'w1', 'm1', 'm3']) {
    const v = events.map((e) => e[k]).filter((x) => x !== null), s = [...v].sort((a, b) => a - b);
    const med = v.length ? (v.length % 2 ? s[(v.length - 1) / 2] : (s[v.length / 2 - 1] + s[v.length / 2]) / 2) : null;
    summary[k] = { n: v.length, avg: v.length ? r2(v.reduce((a, b) => a + b, 0) / v.length) : null, median: med === null ? null : r2(med),
      up: v.length ? Math.round(v.filter((x) => x > 0).length / v.length * 100) : null };
  }
  return { events, summary };
}

// "This month in history": every year's return for one calendar month over the same window and rules as
// computeMonths (last close to last close, years from now-15, moves over 95% excluded), newest first, plus the
// biggest daily moves inside that month from daily closes. month is 0-11.
export function computeMonthHistory(monthlyRows, dailyRows, { month, now = new Date(), years: span = 15 } = {}) {
  const from = now.getUTCFullYear() - span, r2 = (v) => Math.round(v * 100) / 100;
  const years = [];
  for (let i = 1; i < monthlyRows.length; i++) {
    const prev = monthlyRows[i - 1], cur = monthlyRows[i];
    const yr = +cur.d.slice(0, 4), mo = +cur.d.slice(5, 7) - 1;
    if (mo !== month || yr < from || !isFinite(prev.c) || prev.c <= 0) continue;
    const ret = ((cur.c - prev.c) / prev.c) * 100;
    if (!isFinite(ret) || Math.abs(ret) > 95) continue;
    years.push({ year: yr, raw: ret, partial: yr === now.getUTCFullYear() && month === now.getUTCMonth() });
  }
  if (!years.length) return null;
  years.sort((a, b) => b.year - a.year);
  // Compared at the shown precision; on a tie the most recent year (years are newest first) is named.
  const best = years.reduce((a, b) => (r2(b.raw) > r2(a.raw) ? b : a)), worst = years.reduce((a, b) => (r2(b.raw) < r2(a.raw) ? b : a));
  const summary = { n: years.length, up: years.filter((y) => y.raw > 0).length, avg: +(years.reduce((s, y) => s + y.raw, 0) / years.length).toFixed(2),
    best: { year: best.year, ret: r2(best.raw) }, worst: { year: worst.year, ret: r2(worst.raw) }, from: Math.min(...years.map((y) => y.year)) };
  const moves = [];
  for (let i = 1; i < (dailyRows || []).length; i++) {
    const d = new Date(dailyRows[i].t);
    if (d.getUTCMonth() !== month || d.getUTCFullYear() < from) continue;
    const ret = (dailyRows[i].c / dailyRows[i - 1].c - 1) * 100;
    if (isFinite(ret) && Math.abs(ret) <= 95) moves.push({ date: d.toISOString().slice(0, 10), ret: r2(ret) });
  }
  return {
    years: years.map((y) => ({ year: y.year, ret: r2(y.raw), partial: y.partial })), summary,
    days: { up: moves.filter((m) => m.ret > 0).sort((a, b) => b.ret - a.ret).slice(0, 3), down: moves.filter((m) => m.ret < 0).sort((a, b) => a.ret - b.ret).slice(0, 3) },
  };
}

// Seasonal window backtest from real daily closes (oldest first, [{t, c}]). Each year: buy at the close of the
// first/last trading day of buyM, sell at the close of the first/last trading day of sellM — in the next year when
// the window crosses New Year. Only windows whose exit has happened are used; nothing is filled in. Returns compound.
export function computeBacktest(rows, { buyM, buyDay = 'first', sellM, sellDay = 'last', from = 0, to = 9999, now = new Date() } = {}) {
  if (!rows || !rows.length) return null;
  const r2 = (v) => Math.round(v * 100) / 100, iso = (t) => new Date(t).toISOString().slice(0, 10);
  const byYM = new Map();                                  // 'YYYY-M' -> [first row, last row] of that month
  for (const r of rows) {
    const d = new Date(r.t), k = d.getUTCFullYear() + '-' + d.getUTCMonth(), e = byYM.get(k);
    if (e) e[1] = r; else byYM.set(k, [r, r]);
  }
  const lastT = rows[rows.length - 1].t, nowT = now.getTime();
  const pick = (y, m, which) => {
    const e = byYM.get(y + '-' + m); if (!e) return null;
    if (rows[0].t >= Date.UTC(y, m, 1)) return null;    // data starts inside this month: its first trading day isn't in the data
    if (which === 'first') return e[0];
    // The last trading day is only known once the month is over.
    const monthEnd = Date.UTC(y, m + 1, 1);
    return lastT >= monthEnd ? e[1] : null;           // a later trading day in the data proves the month is over
  };
  const exitYearOffset = sellM > buyM || (sellM === buyM && buyDay === 'first' && sellDay === 'last') ? 0 : 1;
  const firstYear = new Date(rows[0].t).getUTCFullYear(), windows = [];
  for (let y = Math.max(from, firstYear); y <= to; y++) {
    const a = pick(y, buyM, buyDay), b = pick(y + exitYearOffset, sellM, sellDay);
    if (!a || !b || b.t <= a.t || b.t > nowT) continue;
    windows.push({ year: y, entry: iso(a.t), exit: iso(b.t), a: a.c, b: b.c, raw: (b.c / a.c - 1) * 100 });
  }
  if (!windows.length) return null;
  let eq = 1; const equity = [];
  const first = windows[0], last = windows[windows.length - 1];
  for (const w of windows) { eq *= 1 + w.raw / 100; equity.push({ date: w.exit, strategy: r2((eq - 1) * 100), buyHold: r2((w.b / first.a - 1) * 100) }); }
  const spanYears = (Date.parse(last.exit) - Date.parse(first.entry)) / (365.25 * 864e5);
  const best = windows.reduce((p, w) => (w.raw > p.raw ? w : p)), worst = windows.reduce((p, w) => (w.raw < p.raw ? w : p));
  return {
    windows: windows.map((w) => ({ year: w.year, entry: w.entry, exit: w.exit, ret: r2(w.raw) })),
    equity,
    summary: {
      n: windows.length, wins: windows.filter((w) => w.raw > 0).length, from: first.year, to: last.year,
      total: r2((eq - 1) * 100), buyHold: r2((last.b / first.a - 1) * 100),
      cagr: spanYears > 0 ? r2((Math.pow(eq, 1 / spanYears) - 1) * 100) : null,
      avg: r2(windows.reduce((s, w) => s + w.raw, 0) / windows.length),
      best: { year: best.year, ret: r2(best.raw) }, worst: { year: worst.year, ret: r2(worst.raw) },
    },
  };
}

// Two assets from real monthly closes: (1) seasonal correlation = Pearson of their 12 monthly averages (the same
// averages as the asset pages); (2) price co-movement = Pearson of their actual monthly returns over the shared
// completed months of the last 15 calendar years. null when either asset lacks real history.
export function computePairStats(rowsA, rowsB, { now = new Date() } = {}) {
  const pear = (a, b) => {
    const n = a.length, ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
    let c = 0, va = 0, vb = 0;
    for (let i = 0; i < n; i++) { c += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2; }
    return va && vb ? Math.round((c / Math.sqrt(va * vb)) * 100) / 100 : null;
  };
  const A = rowsA && computeAdaptiveMonths(rowsA, 15), B = rowsB && computeAdaptiveMonths(rowsB, 15);
  if (!A || !B) return null;
  const from = now.getUTCFullYear() - 15, curYM = now.toISOString().slice(0, 7);
  const rets = (rows) => {
    const out = new Map();
    for (let i = 1; i < rows.length; i++) {
      const p = rows[i - 1], c = rows[i], ym = c.d.slice(0, 7), y = +ym.slice(0, 4), m = +ym.slice(5, 7);
      const prevYM = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
      if (p.d.slice(0, 7) !== prevYM || y < from || ym >= curYM || !(p.c > 0)) continue;   // consecutive, in window, completed
      const r = (c.c / p.c - 1) * 100;
      if (isFinite(r) && Math.abs(r) <= 95) out.set(ym, r);
    }
    return out;
  };
  const ra = rets(rowsA), rb = rets(rowsB), keys = [...ra.keys()].filter((k) => rb.has(k)).sort();
  return {
    a: A, b: B,
    seasonal: pear(A.months.map((m) => m.avg), B.months.map((m) => m.avg)),
    returns: keys.length >= 24 ? { r: pear(keys.map((k) => ra.get(k)), keys.map((k) => rb.get(k))), n: keys.length, from: keys[0], to: keys[keys.length - 1] } : null,
  };
}

// Monthly closing prices as [['YYYY-MM', close], ...] with total and annualised return from the first to the last close.
export function computePriceHistory(monthlyRows) {
  if (!monthlyRows || monthlyRows.length < 2) return null;
  const r2 = (v) => Math.round(v * 100) / 100;
  const points = monthlyRows.filter((r) => isFinite(r.c) && r.c > 0).map((r) => [r.d.slice(0, 7), r.c]);
  if (points.length < 2) return null;
  const [f, l] = [points[0], points[points.length - 1]];
  const months = (+l[0].slice(0, 4) - +f[0].slice(0, 4)) * 12 + (+l[0].slice(5, 7) - +f[0].slice(5, 7));
  const hi = points.reduce((a, b) => (b[1] > a[1] ? b : a)), lo = points.reduce((a, b) => (b[1] < a[1] ? b : a));
  return {
    points,
    summary: { from: f[0], to: l[0], first: f[1], last: l[1], total: r2((l[1] / f[1] - 1) * 100),
      cagr: months >= 12 ? r2((Math.pow(l[1] / f[1], 12 / months) - 1) * 100) : null,
      high: { ym: hi[0], c: hi[1] }, low: { ym: lo[0], c: lo[1] } },
  };
}
