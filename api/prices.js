// api/prices.js
// Keyless real-price proxy. Sources monthly OHLC history and live quotes
// from Stooq's public CSV endpoints. No API key required.
// Modes:
//   /api/prices?s=aapl.us            -> monthly history CSV -> JSON
//   /api/prices?quotes=^spx,aapl.us  -> latest quotes for ticker tape

const CACHE = new Map(); // simple warm-instance cache
const HIST_TTL = 1000 * 60 * 60 * 12; // 12h for history
const QUOTE_TTL = 1000 * 60 * 5;      // 5min for quotes

async function fetchText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (TimingAX)' } });
  if (!r.ok) throw new Error('Upstream ' + r.status);
  return r.text();
}

// Like fetchText, but never throws and reports the upstream status/body so
// failures can be diagnosed via ?debug=1 instead of just "No data".
async function fetchRaw(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (TimingAX)' } });
  const text = await r.text();
  return { ok: r.ok, status: r.status, text };
}

function cacheGet(key, ttl) {
  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.t < ttl) return hit.v;
  return null;
}
function cacheSet(key, v) { CACHE.set(key, { t: Date.now(), v }); }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');

  const { s, quotes } = req.query;

  try {
    // ── LIVE QUOTES MODE ─────────────────────────────
    if (quotes) {
      const syms = String(quotes).split(',').slice(0, 25).join('+');
      const key = 'q:' + syms;
      let out = cacheGet(key, QUOTE_TTL);
      if (!out) {
        const csv = await fetchText(
          'https://stooq.com/q/l/?s=' + encodeURIComponent(syms) + '&f=sd2t2ohlcv&h&e=csv'
        );
        const lines = csv.trim().split('\n').slice(1);
        out = lines.map(line => {
          const p = line.split(',');
          const close = parseFloat(p[6]);
          const open = parseFloat(p[3]);
          const chg = (open && close) ? ((close - open) / open) * 100 : null;
          return { symbol: p[0], close: isFinite(close) ? close : null, changePct: isFinite(chg) ? +chg.toFixed(2) : null };
        }).filter(q => q.close !== null);
        cacheSet(key, out);
      }
      return res.status(200).json({ quotes: out });
    }

    // ── MONTHLY HISTORY MODE ─────────────────────────
    if (!s) return res.status(400).json({ error: 'Missing symbol' });
    const sym = String(s).toLowerCase().replace(/[^a-z0-9.^-]/g, '').slice(0, 20);
    const key = 'h:' + sym;
    let rows = cacheGet(key, HIST_TTL);
    if (!rows) {
      const upstreamUrl = 'https://stooq.com/q/d/l/?s=' + encodeURIComponent(sym) + '&i=m';
      const { ok, status, text: csv } = await fetchRaw(upstreamUrl);
      if (!csv || csv.length < 30 || csv.indexOf('Date') === -1) {
        const body = { error: 'No data for symbol', symbol: sym };
        if (req.query.debug) {
          body.debug = { upstreamUrl, upstreamOk: ok, upstreamStatus: status, length: csv.length, preview: csv.slice(0, 300) };
        }
        return res.status(404).json(body);
      }
      rows = csv.trim().split('\n').slice(1).map(line => {
        const p = line.split(',');
        return { d: p[0], c: parseFloat(p[4]) };
      }).filter(r => r.d && isFinite(r.c));
      if (rows.length < 24) {
        return res.status(404).json({ error: 'Insufficient history', symbol: sym, rows: rows.length });
      }
      cacheSet(key, rows);
    }
    return res.status(200).json({ symbol: sym, monthly: rows });
  } catch (err) {
    return res.status(502).json({ error: err.message || 'Fetch failed' });
  }
}
