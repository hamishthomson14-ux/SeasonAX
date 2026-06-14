// api/seasonality/[id].js
// Server-rendered, indexable seasonality snapshot page for one asset.
// Route: /seasonality/:id  (rewritten from /api/seasonality/:id via vercel.json)
// Uses real price data where available (Stooq), falls back to the modelled
// sector pattern, and is always labelled honestly.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { stooqSymbol, computeMonths, fetchMonthly, getModelMonths, bestWorst, MONTH_NAMES, MONTH_ABBR } from '../_lib/seasonal.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOGUE = JSON.parse(readFileSync(path.join(__dirname, '../_data/catalogue.json'), 'utf8'));
const PATTERNS = JSON.parse(readFileSync(path.join(__dirname, '../_data/patterns.json'), 'utf8'));
const BY_ID = Object.fromEntries(CATALOGUE.map(a => [a.id, a]));

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function pct(v) { return (v >= 0 ? '+' : '') + v.toFixed(2) + '%'; }
// Index tickers (e.g. ^GSPC) use Stooq's internal notation \u2014 not user-facing.
// Show the asset name instead in titles/headings for those.
function dispTicker(item) { return item.ticker.startsWith('^') ? item.name : item.ticker; }

function renderChart(months) {
  const W = 640, H = 200, pad = 28;
  const maxAbs = Math.max(0.5, ...months.map(m => Math.abs(m.avg)));
  const bw = (W - pad * 2) / 12;
  const zero = H / 2;
  let bars = '';
  months.forEach((m, i) => {
    const h = (Math.abs(m.avg) / maxAbs) * (H / 2 - 24);
    const x = pad + i * bw + bw * 0.15;
    const w = bw * 0.7;
    const y = m.avg >= 0 ? zero - h : zero;
    const color = m.avg >= 0 ? '#00C97E' : '#F04050';
    bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${color}" opacity="0.85"/>`;
    bars += `<text x="${(x + w/2).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-family="monospace" font-size="10" fill="#4D6880">${MONTH_ABBR[i]}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="auto" role="img" aria-label="Average monthly seasonal returns chart" xmlns="http://www.w3.org/2000/svg">
    <line x1="${pad}" y1="${zero}" x2="${W-pad}" y2="${zero}" stroke="#1E3050" stroke-width="1"/>
    ${bars}
  </svg>`;
}

function relatedAssets(item) {
  return CATALOGUE.filter(a => a.id !== item.id && a.catSection === item.catSection).slice(0, 6);
}

export default async function handler(req, res) {
  const id = String(req.query.id || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  const item = BY_ID[id];

  if (!item) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(404).send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Not found | TimingAX</title>
      <meta name="robots" content="noindex">
      <link rel="icon" href="/favicon.ico"></head>
      <body style="background:#04070F;color:#EDF2FA;font-family:sans-serif;text-align:center;padding:80px 20px">
      <h1>Asset not found</h1><p><a href="/seasonality.html" style="color:#F5A52F">Browse all assets &rarr;</a></p>
      </body></html>`);
    return;
  }

  // Try real price data; fall back to modelled pattern.
  let months = null, source = 'model';
  try {
    const sym = stooqSymbol(item);
    if (sym) {
      const rows = await fetchMonthly(sym);
      if (rows) {
        const real = computeMonths(rows, 15, 5);
        if (real) { months = real; source = 'real'; }
      }
    }
  } catch (e) { /* fall through to model */ }

  if (!months) months = getModelMonths(item, PATTERNS);

  const { best, worst } = bestWorst(months);
  const now = new Date();
  const cm = now.getMonth();
  const cur = months[cm];
  const years = source === 'real' ? (months[0].n || 15) : null;

  const title = `${dispTicker(item)} Seasonality: ${MONTH_NAMES[best.i]} vs ${MONTH_NAMES[worst.i]} | TimingAX`;
  const tickerSuffix = dispTicker(item) !== item.name ? ` (${dispTicker(item)})` : '';
  const desc = `${item.name}${tickerSuffix} seasonal performance${years ? ' over ' + years + ' years' : ''}: averages ${pct(best.avg)} in ${MONTH_NAMES[best.i]} (${best.win}% win rate) and ${pct(worst.avg)} in ${MONTH_NAMES[worst.i]}. Free seasonal chart on TimingAX.`;
  const url = `https://timingax.co.uk/seasonality/${id}`;
  const badge = source === 'real'
    ? `<span class="badge real">&#10003; VERIFIED &middot; ${years}YR REAL DATA</span>`
    : `<span class="badge model">MODELLED PATTERN DATA</span>`;

  const dataLine = source === 'real'
    ? `These figures are computed from <strong>${years} years</strong> of actual monthly closing prices.`
    : `Real price history wasn\u2019t available for this asset, so these figures are based on a modelled seasonal pattern for its sector and region.`;

  const verdict = (cur.avg >= 0.8 && cur.win >= 60) ? ['SEASONAL TAILWIND','#00C97E']
    : (cur.avg <= -0.5 && cur.win <= 45) ? ['SEASONAL HEADWIND','#F04050']
    : ['NEUTRAL SEASONALITY','#F5A52F'];

  const related = relatedAssets(item);

  const tableRows = months.map((m, i) => `
    <tr${i === cm ? ' class="cur"' : ''}>
      <td>${MONTH_NAMES[i]}${i === cm ? ' <span class="now-tag">NOW</span>' : ''}</td>
      <td class="${m.avg >= 0 ? 'pos' : 'neg'}">${pct(m.avg)}</td>
      <td>${m.win}%</td>
    </tr>`).join('');

  const relatedLinks = related.map(a => {
    const dt = dispTicker(a);
    return `<a href="/seasonality/${a.id}" class="rel-chip">${esc(dt)}${dt !== a.name ? ` <span>${esc(a.name)}</span>` : ''}</a>`;
  }).join('');

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    'name': title,
    'description': desc,
    'url': url,
    'about': { '@type': 'Thing', 'name': item.name, 'identifier': dispTicker(item) }
  };

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:image" content="https://timingax.co.uk/api/og/${id}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="https://timingax.co.uk/api/og/${id}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Syne:wght@700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#04070F;--bg2:#070C18;--s1:#131E30;--amber:#E89318;--amber2:#F5A52F;--green:#00C97E;--red:#F04050;--w:#EDF2FA;--w2:#C4D0DF;--w3:#8FA3B8;--w4:#4D6880;--b1:#0F1E30;--b2:#162540;--mono:"IBM Plex Mono",monospace;--disp:"Syne",sans-serif;--sans:"Inter",sans-serif}
body{background:var(--bg);color:var(--w);font-family:var(--sans);line-height:1.6}
a{color:inherit;text-decoration:none}
.nav{height:56px;padding:0 24px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--b1)}
.n-word{font:800 17px/1 var(--disp);letter-spacing:-.02em}
.n-word b{color:var(--amber2)}
.btn-cta{background:var(--amber);color:var(--bg);border:none;padding:7px 17px;border-radius:6px;font-size:13px;font-weight:600}
.wrap{max-width:760px;margin:0 auto;padding:40px 24px 80px}
.eyebrow{font:500 10px/1 var(--mono);letter-spacing:.2em;color:var(--amber2);text-transform:uppercase;margin-bottom:12px}
h1{font:800 32px/1.2 var(--disp);letter-spacing:-.02em;margin-bottom:8px}
.sub{color:var(--w3);font-size:14px;margin-bottom:18px}
.badge{font:700 9px/1 var(--mono);letter-spacing:.12em;text-transform:uppercase;padding:5px 10px;border-radius:4px;display:inline-block;margin-bottom:24px}
.badge.real{background:rgba(0,201,126,.1);color:var(--green);border:1px solid rgba(0,201,126,.3)}
.badge.model{background:var(--s1);color:var(--w4);border:1px solid var(--b2)}
.chart-card{background:var(--bg2);border:1px solid var(--b2);border-radius:12px;padding:20px;margin-bottom:24px}
.verdict{display:inline-block;font:700 11px/1 var(--mono);letter-spacing:.1em;padding:6px 12px;border-radius:6px;margin-bottom:16px}
.callouts{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:24px}
.callout{background:var(--bg2);border:1px solid var(--b2);border-radius:10px;padding:16px}
.callout .l{font:600 10px/1 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--w4);margin-bottom:6px}
.callout .v{font:700 22px/1 var(--disp)}
.callout .v.pos{color:var(--green)} .callout .v.neg{color:var(--red)}
.callout .s{font-size:12px;color:var(--w3);margin-top:4px}
table{width:100%;border-collapse:collapse;margin-bottom:24px;font-size:13.5px}
th{text-align:left;padding:8px 10px;font:600 9px/1 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--w4);border-bottom:2px solid var(--b1)}
td{padding:9px 10px;border-bottom:1px solid var(--b1);color:var(--w2)}
td.pos{color:var(--green)} td.neg{color:var(--red)}
tr.cur td{background:rgba(232,147,24,.06)}
.now-tag{font:700 8px/1 var(--mono);color:var(--amber2);border:1px solid rgba(232,147,24,.3);padding:2px 5px;border-radius:3px;margin-left:6px}
.data-note{font-size:13px;color:var(--w3);background:var(--bg2);border:1px solid var(--b2);border-radius:8px;padding:12px 16px;margin-bottom:24px}
.cta{background:var(--bg2);border:1px solid var(--b2);border-radius:12px;padding:24px;text-align:center;margin-bottom:24px}
.cta h2{font:700 20px/1.3 var(--disp);margin-bottom:8px}
.cta p{color:var(--w3);font-size:13px;margin-bottom:14px}
.btn-amber{background:var(--amber);color:var(--bg);border:none;padding:11px 22px;border-radius:8px;font:700 13px/1 var(--sans);display:inline-block}
.related{margin-top:8px}
.related h3{font:600 11px/1 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--w4);margin-bottom:10px}
.rel-chip{display:inline-block;background:var(--s1);border:1px solid var(--b2);border-radius:6px;padding:7px 12px;margin:0 6px 6px 0;font-size:12px;color:var(--w2)}
.rel-chip span{color:var(--w4)}
.disc{font-size:11px;color:var(--w4);margin-top:32px;line-height:1.7}
footer{border-top:1px solid var(--b1);padding:20px 24px;text-align:center;font:400 11px/1.6 var(--mono);color:var(--w4)}
footer a{color:var(--amber2)}
</style>
</head>
<body>
<nav>
  <div class="n-word">Timing<b>AX</b></div>
  <a href="/auth.html"><button class="btn-cta">Start free &rarr;</button></a>
</nav>
<div class="wrap">
  <div class="eyebrow">Seasonality Snapshot</div>
  <h1>${esc(item.name)}${dispTicker(item) !== item.name ? ` <span style="color:var(--w4);font-weight:600">(${esc(dispTicker(item))})</span>` : ''}</h1>
  <div class="sub">${esc(item.sector || '')}${item.sector && item.region ? ' \u00b7 ' : ''}${esc(item.region || '')} \u00b7 ${esc(item.catSection || '')}</div>
  ${badge}

  <div class="chart-card">
    ${renderChart(months)}
  </div>

  <div class="verdict" style="background:${verdict[1]}1a;color:${verdict[1]};border:1px solid ${verdict[1]}4d">${verdict[0]} \u2014 ${MONTH_NAMES[cm]}</div>

  <div class="callouts">
    <div class="callout">
      <div class="l">Strongest Month</div>
      <div class="v pos">${MONTH_NAMES[best.i]}</div>
      <div class="s">${pct(best.avg)} avg &middot; ${best.win}% win rate</div>
    </div>
    <div class="callout">
      <div class="l">Weakest Month</div>
      <div class="v neg">${MONTH_NAMES[worst.i]}</div>
      <div class="s">${pct(worst.avg)} avg &middot; ${worst.win}% win rate</div>
    </div>
  </div>

  <table>
    <tr><th>Month</th><th>Avg Return</th><th>Win Rate</th></tr>
    ${tableRows}
  </table>

  <div class="data-note">${dataLine} Past seasonal patterns are not a guarantee of future performance. See our <a href="/methodology.html" style="color:var(--amber2)">methodology</a> for how this is calculated, or visit the <a href="/academy.html" style="color:var(--amber2)">Academy</a> to learn how to read seasonal data responsibly.</div>

  <div class="cta">
    <h2>Get the full analysis</h2>
    <p>Backtest this seasonal pattern, compare it against other assets, set alerts, and explore detrended &amp; presidential-cycle views.</p>
    <a href="/market-seasonality.html" class="btn-amber">Open the Analyzer &rarr;</a>
  </div>

  ${related.length ? `<div class="related"><h3>Related: ${esc(item.catSection || '')}</h3>${relatedLinks}</div>` : ''}

  <div class="disc">TimingAX is an independently operated service, not a registered investment adviser. This page is for informational purposes only and is not financial advice.</div>
</div>
<footer>
  <a href="/index.html">TimingAX</a> &middot; <a href="/seasonality.html">Browse all assets</a> &middot; <a href="/methodology.html">Methodology</a>
</footer>
<script src="/cookie-consent.js"></script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(html);
}
