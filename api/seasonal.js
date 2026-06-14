// api/_lib/seasonal.js
// Shared helpers for computing seasonal statistics from real price history,
// with a modelled-pattern fallback. Used by the per-asset SEO pages.

const STOOQ_MAP = {
  'sp500':'^spx','nasdaq':'^ndq','dowjones':'^dji','russell2000':'^rut',
  'ftse100':'^ukx','ftse250':'^ftm','dax':'^dax','mdax':'^mdax',
  'nikkei':'^nkx','hsi':'^hsi','kospi':'^kospi','sensex':'^snx',
  'btc':'btcusd','eth':'ethusd',
  'spy':'spy.us','qqq':'qqq.us','dia':'dia.us','iwm':'iwm.us','vti':'vti.us',
  'gld':'gld.us','slv':'slv.us','uso':'uso.us','tlt':'tlt.us','vnq':'vnq.us',
  'xle':'xle.us','xlf':'xlf.us','xlv':'xlv.us','xlk':'xlk.us','xlp':'xlp.us','xlu':'xlu.us','arkk':'arkk.us'
};

export const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
export const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function stooqSymbol(item) {
  if (!item) return null;
  if (STOOQ_MAP[item.id]) return STOOQ_MAP[item.id];
  const t = (item.ticker || '').toLowerCase();
  if (!t || t.charAt(0) === '^') return null;
  if (t.indexOf('.l') !== -1) return t.replace('.l', '.uk');
  if (t.indexOf('.de') !== -1) return t;
  if (item.region === 'US') return t + '.us';
  return null;
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

// Fetch monthly close history from Stooq's public CSV endpoint. No API key.
export async function fetchMonthly(sym) {
  const url = 'https://stooq.com/q/d/l/?s=' + encodeURIComponent(sym) + '&i=m';
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (TimingAX)' } });
  if (!r.ok) throw new Error('Upstream ' + r.status);
  const csv = await r.text();
  if (!csv || csv.length < 30 || csv.indexOf('Date') === -1) return null;
  const rows = csv.trim().split('\n').slice(1).map(line => {
    const p = line.split(',');
    return { d: p[0], c: parseFloat(p[4]) };
  }).filter(r => r.d && isFinite(r.c));
  if (rows.length < 24) return null;
  return rows;
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
