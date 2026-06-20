// api/prices.js
// Keyless real-price proxy. Sources monthly price history and live quotes
// from Yahoo Finance's public chart API. No API key required.
//
// NOTE: previously sourced from Stooq's CSV endpoints, but Stooq now
// serves a JavaScript bot-verification challenge page to server-side /
// datacenter requests (confirmed via ?debug=1), so it no longer returns
// usable data from a serverless function. Yahoo's v8 chart endpoint is
// the same one used by countless open-source tools (yfinance, etc.) and
// doesn't impose that kind of check.
//
// Modes:
//   /api/prices?s=AAPL                -> monthly history -> {symbol, monthly:[{d,c}]}
//   /api/prices?s=AAPL&debug=1        -> on failure, include upstream debug info
//   /api/prices?quotes=^GSPC,AAPL     -> latest quotes for ticker tape

const CACHE = new Map(); // simple warm-instance cache
const HIST_TTL = 1000 * 60 * 60 * 12; // 12h for history
const QUOTE_TTL = 1000 * 60 * 5;      // 5min for quotes

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];

async function fetchJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* leave json null */ }
  return { ok: r.ok, status: r.status, text, json };
}

// Tries query1 then query2. Returns the chart "result" object plus debug
// info from the last attempt (for ?debug=1 reporting on total failure).
async function fetchChart(sym, range, interval) {
  let last = null;
  for (const host of HOSTS) {
    const url = 'https://' + host + '/v8/finance/chart/' + encodeURIComponent(sym) + '?range=' + range + '&interval=' + interval;
    const r = await fetchJson(url);
    last = { url: url, ok: r.ok, status: r.status, text: r.text };
    const result = r.json && r.json.chart && r.json.chart.result && r.json.chart.result[0];
    if (result && result.timestamp) return { result: result, debug: last };
  }
  return { result: null, debug: last };
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
      const syms = String(quotes).split(',').map(x => x.trim()).filter(Boolean).slice(0, 25);
      const key = 'q:' + syms.join(',');
      let out = cacheGet(key, QUOTE_TTL);
      if (!out) {
        out = [];
        for (const sym of syms) {
          const { result } = await fetchChart(sym, '5d', '1d');
          if (!result || !result.meta) continue;
          const price = result.meta.regularMarketPrice;
          const prevClose = result.meta.chartPreviousClose != null ? result.meta.chartPreviousClose : result.meta.previousClose;
          if (!isFinite(price)) continue;
          const chg = (isFinite(prevClose) && prevClose) ? ((price - prevClose) / prevClose) * 100 : null;
          out.push({ symbol: sym, close: price, changePct: isFinite(chg) ? +chg.toFixed(2) : null });
        }
        cacheSet(key, out);
      }
      return res.status(200).json({ quotes: out });
    }

    // ── MONTHLY HISTORY MODE ─────────────────────────
    if (!s) return res.status(400).json({ error: 'Missing symbol' });
    const sym = String(s).replace(/[^A-Za-z0-9.^-]/g, '').slice(0, 20);
    const key = 'h:' + sym;
    let rows = cacheGet(key, HIST_TTL);
    if (!rows) {
      // Fetch DAILY data and roll up to one close per calendar month
      // ourselves. Yahoo's native 1mo candles have boundary-timestamp drift
      // (esp. for .L / non-US exchanges) that can skip or duplicate a month
      // — e.g. HSBA.L never emits an October candle and double-stamps March.
      // Daily->monthly aggregation keyed on the UTC year-month is exact.
      const { result, debug } = await fetchChart(sym, '20y', '1d');
      const quote = result && result.indicators && result.indicators.quote && result.indicators.quote[0];
      const adj = result && result.indicators && result.indicators.adjclose && result.indicators.adjclose[0];
      if (!result || !result.timestamp || !quote) {
        const body = { error: 'No data for symbol', symbol: sym };
        if (req.query.debug) {
          body.debug = { upstreamUrl: debug && debug.url, upstreamOk: debug && debug.ok, upstreamStatus: debug && debug.status, length: (debug && debug.text || '').length, preview: (debug && debug.text || '').slice(0, 300) };
        }
        return res.status(404).json(body);
      }
      const ts = result.timestamp;
      const closes = (adj && adj.adjclose) ? adj.adjclose : quote.close;
      // Keep the LAST valid close within each calendar month (month-end close).
      const byYM = new Map();
      for (let i = 0; i < ts.length; i++) {
        const c = closes[i];
        if (c == null || !isFinite(c)) continue;
        const ym = new Date(ts[i] * 1000).toISOString().slice(0, 7); // 'YYYY-MM' (UTC)
        byYM.set(ym, c); // later daily rows overwrite -> last close of the month
      }
      rows = Array.from(byYM.entries())
        .map(([ym, c]) => ({ d: ym + '-01', c: c }))
        .sort((a, b) => a.d < b.d ? -1 : 1);
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
