// api/seasonality/[id].js
// Server-rendered, indexable seasonality snapshot page for one asset.
// Route: /seasonality/:id  (rewritten from /api/seasonality/:id via vercel.json)
// Uses real price data where available (Yahoo Finance), falls back to the modelled
// sector pattern, and is always labelled honestly.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { yahooSymbol, computeAdaptiveMonths, getModelMonths, bestWorst, fetchMonthly, MONTH_NAMES, MONTH_ABBR } from '../_lib/seasonal.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOGUE = JSON.parse(readFileSync(path.join(__dirname, '../_data/catalogue.json'), 'utf8'));
const PATTERNS = JSON.parse(readFileSync(path.join(__dirname, '../_data/patterns.json'), 'utf8'));
const BY_ID = Object.fromEntries(CATALOGUE.map(a => [a.id, a]));

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function pct(v) { return (v >= 0 ? '+' : '') + v.toFixed(2) + '%'; }
// On-page figures use a true minus sign; pct() stays as-is for titles, meta and JSON-LD.
function dpct(v) { return pct(v).replace('-', '\u2212'); }
// Index tickers (e.g. ^GSPC) use Yahoo's notation directly \u2014 not user-facing.
// Show the asset name instead in titles/headings for those.
function dispTicker(item) { return item.ticker.startsWith('^') ? item.name : item.ticker; }

function renderChart(months, cm) {
  const W = 640, H = 220, pad = 20;
  const maxAbs = Math.max(0.5, ...months.map(m => Math.abs(m.avg)));
  const bw = (W - pad * 2) / 12;
  const zero = (H - 22) / 2;
  let bars = '';
  months.forEach((m, i) => {
    const h = Math.max(1.5, (Math.abs(m.avg) / maxAbs) * (zero - 22));
    const x = pad + i * bw + bw * 0.16;
    const w = bw * 0.68;
    const y = m.avg >= 0 ? zero - h : zero;
    const color = m.avg >= 0 ? '#00C97E' : '#F04050';
    if (i === cm) bars += `<rect x="${(pad + i * bw + 2).toFixed(1)}" y="4" width="${(bw - 4).toFixed(1)}" height="${H - 8}" rx="4" fill="rgba(232,147,24,.07)" stroke="rgba(232,147,24,.55)" stroke-width="1"/>`;
    bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${color}"/>`;
    bars += `<text x="${(x + w/2).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="11" fill="${i === cm ? '#F5A52F' : '#8296AD'}">${MONTH_ABBR[i]}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Average monthly seasonal returns chart" xmlns="http://www.w3.org/2000/svg">
    <line x1="${pad}" y1="${zero}" x2="${W-pad}" y2="${zero}" stroke="#22324F" stroke-width="1"/>
    ${bars}
  </svg>`;
}

function relatedAssets(item) {
  return CATALOGUE.filter(a => a.id !== item.id && a.catSection === item.catSection).slice(0, 6);
}

export default async function handler(req, res) {
  if (req.query.view === 'compare') return compareHandler(req, res);
  const id = String(req.query.id || '').toLowerCase().replace(/[^a-z0-9_-]/g, ''); // 14 catalogue ids contain _ (bp_uk)
  const item = BY_ID[id];

  if (!item) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(404).send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Not found | TimingAX</title>
      <meta name="robots" content="noindex"><meta name="viewport" content="width=device-width, initial-scale=1.0">
      <link rel="icon" href="/favicon.ico">
<!-- tx:head -->
<script>document.documentElement.className += " js";</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="/assets/tx.css">
<script src="/assets/tx.js" defer></script>
<!-- /tx:head -->
</head><body class="tx">
<!-- tx:header -->
<div class="tx-ticker" aria-label="Market prices, daily change"><div class="tx-ticker__track" id="ttrack"></div></div>
<header class="tx-header">
  <div class="tx-wrap tx-header__bar">
    <a class="tx-logo" href="/" aria-label="TimingAX home"><svg viewBox="0 0 26 26" fill="none" aria-hidden="true"><rect width="26" height="26" rx="6" fill="#0F1728"/><polyline points="3,18 8,12 13,15 19,7" stroke="#E89318" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="19" cy="7" r="1.8" fill="#E89318"/><rect x="3" y="19.5" width="2.2" height="2.8" rx="1" fill="#00C97E" opacity=".8"/><rect x="7.5" y="17.5" width="2.2" height="4.8" rx="1" fill="#00C97E" opacity=".8"/><rect x="12" y="15" width="2.2" height="7.3" rx="1" fill="#E89318" opacity=".9"/><rect x="16.5" y="11" width="2.2" height="11.3" rx="1" fill="#E89318"/></svg><span>Timing<b>AX</b></span></a>
    <nav class="tx-nav" id="txNav" aria-label="Main">
      <a href="/market-seasonality.html">Platform</a>
      <a href="/seasonality.html">Data</a>
      <a href="/leaderboard.html">Leaderboard</a>
      <a href="/academy.html">Academy</a>
      <a href="/#pricing">Pricing</a>
      <a href="/about.html">About</a>
    </nav>
    <div class="tx-header__actions">
      <a class="tx-btn tx-btn--ghost tx-btn--sm" href="/auth.html">Log in</a>
      <a class="tx-btn tx-btn--primary tx-btn--sm" href="/auth.html">Start free</a>
    </div>
    <button class="tx-menu-btn" type="button" aria-label="Menu" aria-expanded="false" aria-controls="txNav"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
  </div>
</header>
<!-- /tx:header -->
<main class="tx-wrap" style="padding:96px 24px;text-align:center">
  <span class="tx-eyebrow">404 &middot; Unknown asset</span>
  <h1 class="tx-h1" style="margin:18px 0 14px;font-size:clamp(34px,5vw,56px)">Asset not found</h1>
  <p class="tx-lead" style="margin:0 auto 28px">We don&rsquo;t have seasonality data for that link. Browse all 733 assets instead.</p>
  <a class="tx-btn tx-btn--primary tx-btn--lg" href="/seasonality.html">Browse all assets &rarr;</a>
</main>
<!-- tx:footer -->
<footer class="tx-footer">
  <div class="tx-wrap">
    <div class="tx-footer__grid">
      <div class="tx-footer__brand">
        <a class="tx-logo" href="/" aria-label="TimingAX home"><svg viewBox="0 0 26 26" fill="none" aria-hidden="true"><rect width="26" height="26" rx="6" fill="#0F1728"/><polyline points="3,18 8,12 13,15 19,7" stroke="#E89318" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="19" cy="7" r="1.8" fill="#E89318"/><rect x="3" y="19.5" width="2.2" height="2.8" rx="1" fill="#00C97E" opacity=".8"/><rect x="7.5" y="17.5" width="2.2" height="4.8" rx="1" fill="#00C97E" opacity=".8"/><rect x="12" y="15" width="2.2" height="7.3" rx="1" fill="#E89318" opacity=".9"/><rect x="16.5" y="11" width="2.2" height="11.3" rx="1" fill="#E89318"/></svg><span>Timing<b>AX</b></span></a>
        <p style="margin:14px 0 0;max-width:340px">Professional market seasonality intelligence for self-directed investors. 733 global assets, 15 years of real price history.</p>
      </div>
      <div><h4>Product</h4><ul>
        <li><a href="/market-seasonality.html">Open the app</a></li>
        <li><a href="/seasonality.html">Browse assets</a></li>
        <li><a href="/outlook.html">Monthly outlook</a></li>
        <li><a href="/leaderboard.html">Leaderboard</a></li>
        <li><a href="/compare.html">Compare assets</a></li>
        <li><a href="/#pricing">Pricing</a></li>
        <li><a href="/data.html">Data &amp; methodology</a></li>
        <li><a href="/track-record.html">Track record</a></li>
        <li><a href="/methodology.html">Methodology</a></li>
        <li><a href="/changelog.html">Changelog</a></li>
      </ul></div>
      <div><h4>Company</h4><ul>
        <li><a href="/about.html">About</a></li>
        <li><a href="/academy.html">Academy</a></li>
        <li><a href="/blog.html">Blog</a></li>
        <li><a href="/contact.html">Contact</a></li>
      </ul></div>
      <div><h4>Legal</h4><ul>
        <li><a href="/accessibility.html">Accessibility</a></li>
        <li><a href="/privacy-policy.html">Privacy policy</a></li>
        <li><a href="/terms-of-service.html">Terms of service</a></li>
        <li><a href="/terms-of-service.html">Disclaimer</a></li>
      </ul></div>
    </div>
    <div class="tx-footer__legal">
      <p>Past seasonal performance does not guarantee future results. TimingAX provides historical data for informational purposes only and does not constitute financial advice. All investments carry risk. Consult a qualified financial adviser before making investment decisions. TimingAX is an independently operated service and not a registered investment adviser.</p>
      <span>&copy; 2026 TimingAX &middot; All rights reserved</span>
    </div>
  </div>
</footer>
<!-- /tx:footer -->
</body></html>`);
    return;
  }

  // Try real price data; fall back to modelled pattern.
  let months = null, source = 'model', realYears = null;
  try {
    const sym = yahooSymbol(item);
    if (sym) {
      const rows = await fetchMonthly(sym);
      if (rows) {
        const real = computeAdaptiveMonths(rows, 15);
        if (real) { months = real.months; source = 'real'; realYears = real.years; }
      }
    }
  } catch (e) { /* fall through to model */ }

  if (!months) months = getModelMonths(item, PATTERNS);

  const { best, worst } = bestWorst(months);
  const now = new Date();
  const cm = now.getMonth();
  const cur = months[cm];
  const years = source === 'real' ? realYears : null;

  const title = `${dispTicker(item)} Seasonality: ${MONTH_NAMES[best.i]} vs ${MONTH_NAMES[worst.i]} | TimingAX`;
  const tickerSuffix = dispTicker(item) !== item.name ? ` (${dispTicker(item)})` : '';
  const desc = `${item.name}${tickerSuffix} seasonal performance${years ? ' over ' + years + ' years' : ''}: averages ${pct(best.avg)} in ${MONTH_NAMES[best.i]} (${best.win}% win rate) and ${pct(worst.avg)} in ${MONTH_NAMES[worst.i]}. Free seasonal chart on TimingAX.`;
  const url = `https://timingax.co.uk/seasonality/${id}`;
  const badge = source === 'real'
    ? `<span class="tx-badge tx-badge--verified">&#10003; Verified &middot; ${years}yr real data</span>`
    : `<span class="tx-badge tx-badge--modelled">Modelled pattern data</span>`;

  const dataLine = source === 'real'
    ? `These figures are computed from <strong>${years} years</strong> of actual monthly closing prices.`
    : `Real price history wasn\u2019t available for this asset, so these figures are based on a modelled seasonal pattern for its sector and region.`;

  const verdict = (cur.avg >= 0.8 && cur.win >= 60) ? ['SEASONAL TAILWIND','tx-badge--tail']
    : (cur.avg <= -0.5 && cur.win <= 45) ? ['SEASONAL HEADWIND','tx-badge--head']
    : ['NEUTRAL SEASONALITY','tx-badge--neutral'];

  const related = relatedAssets(item);

  const tableRows = months.map((m, i) => `
    <tr${i === cm ? ' class="is-now"' : ''}>
      <td>${MONTH_NAMES[i]}${i === cm ? ' <span class="tx-badge tx-badge--now">Now</span>' : ''}</td>
      <td class="r tx-num ${m.avg >= 0 ? 'tx-up' : 'tx-down'}" data-tx-sid="${id}" data-tx-month="${MONTH_ABBR[i]}" data-tx-field="avg">${dpct(m.avg)}</td>
      <td class="r tx-num" data-tx-sid="${id}" data-tx-month="${MONTH_ABBR[i]}" data-tx-field="win">${m.win}%</td>
    </tr>`).join('');

  const relatedLinks = related.map(a => {
    const dt = dispTicker(a);
    return `<a href="/seasonality/${a.id}" class="a-chip">${esc(dt)}${dt !== a.name ? ` <span>${esc(a.name)}</span>` : ''}</a>`;
  }).join('');

  // Build the FAQ answers from the real computed figures
  const dt = dispTicker(item);
  const faqBestA = `Historically, ${MONTH_NAMES[best.i]} has been ${item.name}'s strongest month, averaging ${pct(best.avg)} with a ${best.win}% win rate${years ? ' over ' + years + ' years of data' : ''}. ${MONTH_NAMES[worst.i]} has been the weakest at ${pct(worst.avg)}.`;
  const faqSeasonalA = `${item.name} shows a measurable seasonal pattern: its best and worst months differ by ${(best.avg - worst.avg).toFixed(2)} percentage points on average. ${source === 'real' ? 'These figures come from ' + years + ' years of real monthly closing prices.' : 'These figures are based on a modelled sector pattern.'} Seasonality is a historical tendency, not a prediction.`;
  const faqNowA = `${item.name} is currently in ${MONTH_NAMES[cm]}, which has historically averaged ${pct(cur.avg)} with a ${cur.win}% win rate. ${verdict[0] === 'SEASONAL TAILWIND' ? 'That has historically been a seasonally favourable window.' : verdict[0] === 'SEASONAL HEADWIND' ? 'That has historically been a seasonally weak window.' : 'That is a historically neutral window.'}`;

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'Dataset',
      'name': `${dt} Monthly Seasonality Data`,
      'description': desc,
      'url': url,
      'keywords': [`${item.name} seasonality`, `${dt} seasonal pattern`, `${item.name} best month`, `${item.name} monthly returns`],
      'creator': { '@type': 'Organization', 'name': 'TimingAX', 'url': 'https://timingax.co.uk' },
      'isAccessibleForFree': true,
      'temporalCoverage': years ? `${new Date().getFullYear() - years}/${new Date().getFullYear()}` : undefined,
      'variableMeasured': [
        { '@type': 'PropertyValue', 'name': 'Average monthly return', 'unitText': 'PERCENT' },
        { '@type': 'PropertyValue', 'name': 'Monthly win rate', 'unitText': 'PERCENT' }
      ],
      'about': { '@type': 'Thing', 'name': item.name, 'identifier': dt }
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      'mainEntity': [
        { '@type': 'Question', 'name': `What is ${item.name}'s best month historically?`,
          'acceptedAnswer': { '@type': 'Answer', 'text': faqBestA } },
        { '@type': 'Question', 'name': `Is ${item.name} seasonal?`,
          'acceptedAnswer': { '@type': 'Answer', 'text': faqSeasonalA } },
        { '@type': 'Question', 'name': `How does ${item.name} historically perform in ${MONTH_NAMES[cm]}?`,
          'acceptedAnswer': { '@type': 'Answer', 'text': faqNowA } }
      ]
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      'itemListElement': [
        { '@type': 'ListItem', 'position': 1, 'name': 'Seasonality', 'item': 'https://timingax.co.uk/market-seasonality.html' },
        { '@type': 'ListItem', 'position': 2, 'name': `${dt} Seasonality`, 'item': url }
      ]
    }
  ];

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
<!-- tx:head -->
<script>document.documentElement.className += " js";</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="/assets/tx.css">
<script src="/assets/tx.js" defer></script>
<!-- /tx:head -->
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<style>
.a-wrap{max-width:1040px;padding-top:40px;padding-bottom:80px}
.a-crumb{font:500 12px var(--tx-font-mono);color:var(--tx-text-3);letter-spacing:.04em;margin-bottom:22px}
.a-crumb a{color:var(--tx-text-3) !important}.a-crumb a:hover{color:var(--tx-text-1) !important}
.a-title{font:700 clamp(32px,5vw,52px)/1.05 var(--tx-font-ui);letter-spacing:-.03em;margin:14px 0 8px}
.a-title span{color:var(--tx-text-3);font-weight:600}
.a-sub{color:var(--tx-text-3);font-size:15px;margin:0 0 18px}
.a-grid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:20px;margin-top:28px;align-items:start}
.a-chart{padding:14px 12px 4px}
.a-kpis{display:flex;flex-direction:column;gap:12px}
.a-kpi .tx-label{display:block;margin-bottom:8px}
.a-kpi b{display:block;font:600 24px/1.1 var(--tx-font-ui);letter-spacing:-.02em}
.a-kpi small{display:block;margin-top:6px;font:500 13px var(--tx-font-mono);color:var(--tx-text-2)}
.a-table{margin-top:28px}
.a-note{margin-top:20px;padding:16px 18px;font-size:14px;color:var(--tx-text-2);line-height:1.65}
.a-faq{margin-top:56px}
.a-cta{margin-top:40px;text-align:center;padding:36px 24px;background:radial-gradient(500px 200px at 50% 100%,rgba(232,147,24,.12),transparent 70%),var(--tx-bg-1)}
.a-cta p{color:var(--tx-text-2);max-width:56ch;margin:8px auto 20px}
.a-rel{margin-top:40px}
.a-chip{display:inline-flex;gap:6px;align-items:center;background:var(--tx-surface-1);border:1px solid var(--tx-border-1);border-radius:6px;padding:8px 12px;margin:0 6px 8px 0;font:500 13px var(--tx-font-mono);color:var(--tx-text-1) !important}
.a-chip span{font-family:var(--tx-font-ui);color:var(--tx-text-3)}
.a-chip:hover{border-color:var(--tx-border-2)}
.a-disc{margin-top:36px}
@media (max-width:860px){.a-grid{grid-template-columns:1fr}.a-kpis{display:grid;grid-template-columns:1fr 1fr}.a-kpis > :last-child{grid-column:1/-1}}
@media (max-width:600px){.a-wrap{padding-top:28px}.a-table td,.a-table th{padding-left:8px;padding-right:8px}}
</style>
</head>
<body class="tx">
<!-- tx:header -->
<div class="tx-ticker" aria-label="Market prices, daily change"><div class="tx-ticker__track" id="ttrack"></div></div>
<header class="tx-header">
  <div class="tx-wrap tx-header__bar">
    <a class="tx-logo" href="/" aria-label="TimingAX home"><svg viewBox="0 0 26 26" fill="none" aria-hidden="true"><rect width="26" height="26" rx="6" fill="#0F1728"/><polyline points="3,18 8,12 13,15 19,7" stroke="#E89318" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="19" cy="7" r="1.8" fill="#E89318"/><rect x="3" y="19.5" width="2.2" height="2.8" rx="1" fill="#00C97E" opacity=".8"/><rect x="7.5" y="17.5" width="2.2" height="4.8" rx="1" fill="#00C97E" opacity=".8"/><rect x="12" y="15" width="2.2" height="7.3" rx="1" fill="#E89318" opacity=".9"/><rect x="16.5" y="11" width="2.2" height="11.3" rx="1" fill="#E89318"/></svg><span>Timing<b>AX</b></span></a>
    <nav class="tx-nav" id="txNav" aria-label="Main">
      <a href="/market-seasonality.html">Platform</a>
      <a href="/seasonality.html">Data</a>
      <a href="/leaderboard.html">Leaderboard</a>
      <a href="/academy.html">Academy</a>
      <a href="/#pricing">Pricing</a>
      <a href="/about.html">About</a>
    </nav>
    <div class="tx-header__actions">
      <a class="tx-btn tx-btn--ghost tx-btn--sm" href="/auth.html">Log in</a>
      <a class="tx-btn tx-btn--primary tx-btn--sm" href="/auth.html">Start free</a>
    </div>
    <button class="tx-menu-btn" type="button" aria-label="Menu" aria-expanded="false" aria-controls="txNav"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
  </div>
</header>
<!-- /tx:header -->
<main class="tx-wrap a-wrap">
  <div class="a-crumb"><a href="/seasonality.html">Data</a> / <a href="/seasonality.html">${esc(item.catSection || 'Assets')}</a> / ${esc(dt)}</div>
  <span class="tx-eyebrow">Seasonality snapshot</span>
  <h1 class="a-title">${esc(item.name)}${dispTicker(item) !== item.name ? ` <span>(${esc(dispTicker(item))})</span>` : ''}</h1>
  <p class="a-sub">${esc(item.sector || '')}${item.sector && item.region ? ' \u00b7 ' : ''}${esc(item.region || '')} \u00b7 ${esc(item.catSection || '')}</p>
  <div class="tx-row">${badge}<span class="tx-badge ${verdict[1]}">${verdict[0]} \u2014 ${MONTH_NAMES[cm]}</span></div>

  <div class="a-grid">
    <div class="tx-term">
      <div class="tx-term__head"><span class="tx-term__title">${esc(dt)} \u00b7 Avg return by month</span><span class="tx-term__status">${source === 'real' ? years + 'Y \u00b7 real data' : 'Modelled'}</span></div>
      <div class="a-chart">${renderChart(months, cm)}</div>
    </div>
    <div class="a-kpis">
      <div class="tx-card a-kpi"><span class="tx-label">Strongest month</span><b class="tx-up">${MONTH_NAMES[best.i]}</b><small>${dpct(best.avg)} avg &middot; ${best.win}% win rate</small></div>
      <div class="tx-card a-kpi"><span class="tx-label">Weakest month</span><b class="tx-down">${MONTH_NAMES[worst.i]}</b><small>${dpct(worst.avg)} avg &middot; ${worst.win}% win rate</small></div>
      <div class="tx-card a-kpi"><span class="tx-label">This month &middot; ${MONTH_NAMES[cm]}</span><b class="${cur.avg >= 0 ? 'tx-up' : 'tx-down'}">${dpct(cur.avg)}</b><small>${cur.win}% win rate &middot; ${verdict[0].toLowerCase()}</small></div>
    </div>
  </div>

  ${source === 'real' ? `<div class="tx-term proj" id="projPreview" style="margin-top:20px">
    <div class="tx-term__head"><span class="tx-term__title">${esc(item.name)} \u00b7 Seasonal projection</span><span class="tx-term__status">Pro</span></div>
    <div class="proj-locked"><div class="proj-blur"><svg viewBox="0 0 760 300" width="100%" aria-hidden="true"><path d="M62,170 C200,150 300,120 420,128 S620,90 742,70 L742,40 C620,60 520,80 420,96 S200,120 62,150Z" fill="rgba(232,147,24,.25)"/><path d="M62,160 C200,140 300,110 420,112 S620,80 742,55" fill="none" stroke="#F5A52F" stroke-width="3"/></svg></div>
      <div class="proj-cta"><span class="tx-badge tx-badge--now">Pro</span><b>Where has ${esc(item.name)} typically gone from here?</b><span>See the next 30, 60 or 90 days, drawn from up to 15 years of real price history.</span><a class="tx-btn tx-btn--primary" href="/auth.html?tab=up">Start 7-day free trial</a></div>
    </div>
  </div>` : ''}

  <div class="tx-card a-table" style="padding:6px 6px 0">
    <table class="tx-table">
      <thead><tr><th>Month</th><th class="r">Avg return</th><th class="r">Win rate</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
  </div>

  <div class="tx-card a-note">${dataLine} Past seasonal patterns are not a guarantee of future performance. See our <a href="/methodology.html">methodology</a> for how this is calculated, or visit the <a href="/academy.html">Academy</a> to learn how to read seasonal data responsibly.</div>

  <section class="tx-prose a-faq">
    <h2>${esc(item.name)} seasonality: common questions</h2>
    <h3>What is ${esc(item.name)}'s best month historically?</h3>
    <p>${esc(faqBestA)}</p>
    <h3>Is ${esc(item.name)} seasonal?</h3>
    <p>${esc(faqSeasonalA)}</p>
    <h3>How does ${esc(item.name)} historically perform in ${MONTH_NAMES[cm]}?</h3>
    <p>${esc(faqNowA)}</p>
  </section>

  <div class="tx-card a-cta">
    <h2 class="tx-h2" style="font-size:28px">Get the full analysis</h2>
    <p>Backtest this seasonal pattern, compare it against other assets, set alerts, and explore detrended &amp; presidential-cycle views.</p>
    <a href="/market-seasonality.html" class="tx-btn tx-btn--primary tx-btn--lg">Open the Analyzer &rarr;</a>
  </div>

  ${related.length ? `<div class="a-rel"><span class="tx-label">Related: ${esc(item.catSection || '')}</span><div style="margin-top:12px">${relatedLinks}</div></div>` : ''}

  <p class="tx-note a-disc">TimingAX is an independently operated service, not a registered investment adviser. This page is for informational purposes only and is not financial advice.</p>
</main>
<!-- tx:footer -->
<footer class="tx-footer">
  <div class="tx-wrap">
    <div class="tx-footer__grid">
      <div class="tx-footer__brand">
        <a class="tx-logo" href="/" aria-label="TimingAX home"><svg viewBox="0 0 26 26" fill="none" aria-hidden="true"><rect width="26" height="26" rx="6" fill="#0F1728"/><polyline points="3,18 8,12 13,15 19,7" stroke="#E89318" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="19" cy="7" r="1.8" fill="#E89318"/><rect x="3" y="19.5" width="2.2" height="2.8" rx="1" fill="#00C97E" opacity=".8"/><rect x="7.5" y="17.5" width="2.2" height="4.8" rx="1" fill="#00C97E" opacity=".8"/><rect x="12" y="15" width="2.2" height="7.3" rx="1" fill="#E89318" opacity=".9"/><rect x="16.5" y="11" width="2.2" height="11.3" rx="1" fill="#E89318"/></svg><span>Timing<b>AX</b></span></a>
        <p style="margin:14px 0 0;max-width:340px">Professional market seasonality intelligence for self-directed investors. 733 global assets, 15 years of real price history.</p>
      </div>
      <div><h4>Product</h4><ul>
        <li><a href="/market-seasonality.html">Open the app</a></li>
        <li><a href="/seasonality.html">Browse assets</a></li>
        <li><a href="/outlook.html">Monthly outlook</a></li>
        <li><a href="/leaderboard.html">Leaderboard</a></li>
        <li><a href="/compare.html">Compare assets</a></li>
        <li><a href="/#pricing">Pricing</a></li>
        <li><a href="/data.html">Data &amp; methodology</a></li>
        <li><a href="/track-record.html">Track record</a></li>
        <li><a href="/methodology.html">Methodology</a></li>
        <li><a href="/changelog.html">Changelog</a></li>
      </ul></div>
      <div><h4>Company</h4><ul>
        <li><a href="/about.html">About</a></li>
        <li><a href="/academy.html">Academy</a></li>
        <li><a href="/blog.html">Blog</a></li>
        <li><a href="/contact.html">Contact</a></li>
      </ul></div>
      <div><h4>Legal</h4><ul>
        <li><a href="/accessibility.html">Accessibility</a></li>
        <li><a href="/privacy-policy.html">Privacy policy</a></li>
        <li><a href="/terms-of-service.html">Terms of service</a></li>
        <li><a href="/terms-of-service.html">Disclaimer</a></li>
      </ul></div>
    </div>
    <div class="tx-footer__legal">
      <p>Past seasonal performance does not guarantee future results. TimingAX provides historical data for informational purposes only and does not constitute financial advice. All investments carry risk. Consult a qualified financial adviser before making investment decisions. TimingAX is an independently operated service and not a registered investment adviser.</p>
      <span>&copy; 2026 TimingAX &middot; All rights reserved</span>
    </div>
  </div>
</footer>
<!-- /tx:footer -->
<script src="/cookie-consent.js"></script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(html);
}


// ── /compare/<a>-vs-<b> (vercel.json rewrite → ?view=compare) ───────────────
// Two assets' monthly calendars side by side, real data only. Canonical order is alphabetical by id.
const PAIRS = JSON.parse(readFileSync(path.join(__dirname, '../_data/pairs.json'), 'utf8'));

function pearson(x, y) {
  const n = x.length, mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}
function corrWords(r) {
  if (r >= 0.6) return 'Strongly similar seasonal rhythms';
  if (r >= 0.3) return 'Somewhat similar seasonal rhythms';
  if (r > -0.3) return 'Largely unrelated seasonal rhythms';
  return 'Opposite seasonal rhythms';
}
async function realMonths(item) {
  try {
    const rows = await fetchMonthly(yahooSymbol(item));
    const real = rows && computeAdaptiveMonths(rows, 15);
    return real && real.months ? real : null;
  } catch (e) { return null; }
}
function compareNotFound(res, msg) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(404).send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Comparison not available | TimingAX</title>
      <meta name="robots" content="noindex"><meta name="viewport" content="width=device-width, initial-scale=1.0">
      <link rel="icon" href="/favicon.ico">
<!-- tx:head -->
<script>document.documentElement.className += " js";</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="/assets/tx.css">
<script src="/assets/tx.js" defer></script>
<!-- /tx:head -->
</head><body class="tx">
<!-- tx:header -->
<div class="tx-ticker" aria-label="Market prices, daily change"><div class="tx-ticker__track" id="ttrack"></div></div>
<header class="tx-header">
  <div class="tx-wrap tx-header__bar">
    <a class="tx-logo" href="/" aria-label="TimingAX home"><svg viewBox="0 0 26 26" fill="none" aria-hidden="true"><rect width="26" height="26" rx="6" fill="#0F1728"/><polyline points="3,18 8,12 13,15 19,7" stroke="#E89318" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="19" cy="7" r="1.8" fill="#E89318"/><rect x="3" y="19.5" width="2.2" height="2.8" rx="1" fill="#00C97E" opacity=".8"/><rect x="7.5" y="17.5" width="2.2" height="4.8" rx="1" fill="#00C97E" opacity=".8"/><rect x="12" y="15" width="2.2" height="7.3" rx="1" fill="#E89318" opacity=".9"/><rect x="16.5" y="11" width="2.2" height="11.3" rx="1" fill="#E89318"/></svg><span>Timing<b>AX</b></span></a>
    <nav class="tx-nav" id="txNav" aria-label="Main">
      <a href="/market-seasonality.html">Platform</a>
      <a href="/seasonality.html">Data</a>
      <a href="/leaderboard.html">Leaderboard</a>
      <a href="/academy.html">Academy</a>
      <a href="/#pricing">Pricing</a>
      <a href="/about.html">About</a>
    </nav>
    <div class="tx-header__actions">
      <a class="tx-btn tx-btn--ghost tx-btn--sm" href="/auth.html">Log in</a>
      <a class="tx-btn tx-btn--primary tx-btn--sm" href="/auth.html">Start free</a>
    </div>
    <button class="tx-menu-btn" type="button" aria-label="Menu" aria-expanded="false" aria-controls="txNav"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
  </div>
</header>
<!-- /tx:header -->
<main class="tx-wrap" style="padding:96px 24px;text-align:center">
  <span class="tx-eyebrow">Compare</span>
  <h1 class="tx-h1" style="margin:18px 0 14px;font-size:clamp(32px,5vw,52px)">Comparison not available</h1>
  <p class="tx-lead" style="margin:0 auto 28px">${esc(msg)}</p>
  <a class="tx-btn tx-btn--primary tx-btn--lg" href="/compare.html">Compare two assets &rarr;</a>
</main>
<!-- tx:footer -->
<footer class="tx-footer">
  <div class="tx-wrap">
    <div class="tx-footer__grid">
      <div class="tx-footer__brand">
        <a class="tx-logo" href="/" aria-label="TimingAX home"><svg viewBox="0 0 26 26" fill="none" aria-hidden="true"><rect width="26" height="26" rx="6" fill="#0F1728"/><polyline points="3,18 8,12 13,15 19,7" stroke="#E89318" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="19" cy="7" r="1.8" fill="#E89318"/><rect x="3" y="19.5" width="2.2" height="2.8" rx="1" fill="#00C97E" opacity=".8"/><rect x="7.5" y="17.5" width="2.2" height="4.8" rx="1" fill="#00C97E" opacity=".8"/><rect x="12" y="15" width="2.2" height="7.3" rx="1" fill="#E89318" opacity=".9"/><rect x="16.5" y="11" width="2.2" height="11.3" rx="1" fill="#E89318"/></svg><span>Timing<b>AX</b></span></a>
        <p style="margin:14px 0 0;max-width:340px">Professional market seasonality intelligence for self-directed investors. 733 global assets, 15 years of real price history.</p>
      </div>
      <div><h4>Product</h4><ul>
        <li><a href="/market-seasonality.html">Open the app</a></li>
        <li><a href="/seasonality.html">Browse assets</a></li>
        <li><a href="/outlook.html">Monthly outlook</a></li>
        <li><a href="/leaderboard.html">Leaderboard</a></li>
        <li><a href="/compare.html">Compare assets</a></li>
        <li><a href="/#pricing">Pricing</a></li>
        <li><a href="/data.html">Data &amp; methodology</a></li>
        <li><a href="/track-record.html">Track record</a></li>
        <li><a href="/methodology.html">Methodology</a></li>
        <li><a href="/changelog.html">Changelog</a></li>
      </ul></div>
      <div><h4>Company</h4><ul>
        <li><a href="/about.html">About</a></li>
        <li><a href="/academy.html">Academy</a></li>
        <li><a href="/blog.html">Blog</a></li>
        <li><a href="/contact.html">Contact</a></li>
      </ul></div>
      <div><h4>Legal</h4><ul>
        <li><a href="/accessibility.html">Accessibility</a></li>
        <li><a href="/privacy-policy.html">Privacy policy</a></li>
        <li><a href="/terms-of-service.html">Terms of service</a></li>
        <li><a href="/terms-of-service.html">Disclaimer</a></li>
      </ul></div>
    </div>
    <div class="tx-footer__legal">
      <p>Past seasonal performance does not guarantee future results. TimingAX provides historical data for informational purposes only and does not constitute financial advice. All investments carry risk. Consult a qualified financial adviser before making investment decisions. TimingAX is an independently operated service and not a registered investment adviser.</p>
      <span>&copy; 2026 TimingAX &middot; All rights reserved</span>
    </div>
  </div>
</footer>
<!-- /tx:footer -->
</body></html>`);
}

async function compareHandler(req, res) {
  const pair = String(req.query.id || '').toLowerCase();
  const m = pair.match(/^([a-z0-9_]+)-vs-([a-z0-9_]+)$/);
  if (!m) return compareNotFound(res, 'That comparison link isn’t valid.');
  const [ia, ib] = [m[1], m[2]];
  if (ia === ib) return compareNotFound(res, 'Pick two different assets to compare.');
  if (!BY_ID[ia] || !BY_ID[ib]) return compareNotFound(res, 'We don’t track one of those assets.');
  if (ia > ib) { res.setHeader('Location', `/compare/${ib}-vs-${ia}`); return res.status(301).end(); }
  const A = BY_ID[ia], B = BY_ID[ib];
  const [ra, rb] = await Promise.all([realMonths(A), realMonths(B)]);
  if (!ra || !rb) return compareNotFound(res, `We need real price history for both ${A.name} and ${B.name}, and ${!ra ? A.name : B.name} doesn’t have enough yet.`);

  const ma = ra.months, mb = rb.months, cm = new Date().getMonth();
  const r = pearson(ma.map(x => x.avg), mb.map(x => x.avg));
  const rTxt = (r >= 0 ? '+' : '−') + Math.abs(r).toFixed(2);
  const da = dispTicker(A), db = dispTicker(B);
  const la = da !== A.name ? `${A.name} (${da})` : A.name, lb = db !== B.name ? `${B.name} (${db})` : B.name;
  const bwA = bestWorst(ma), bwB = bestWorst(mb);
  const winsA = ma.filter((x, i) => x.avg >= mb[i].avg).length;
  const nowA = ma[cm].avg >= mb[cm].avg;
  const title = `${la} vs ${lb} Seasonality: Month-by-Month Comparison | TimingAX`;
  const desc = `${A.name} vs ${B.name} seasonality from real price history: ${A.name}'s best month is ${MONTH_NAMES[bwA.best.i]} (${pct(bwA.best.avg)}), ${B.name}'s is ${MONTH_NAMES[bwB.best.i]} (${pct(bwB.best.avg)}). Seasonal correlation ${r.toFixed(2)}.`;
  const url = `https://www.timingax.co.uk/compare/${ia}-vs-${ib}`;
  const cell = (id, i, mm) => `<td class="r tx-num ${mm.avg >= 0 ? 'tx-up' : 'tx-down'}" data-tx-sid="${id}" data-tx-month="${MONTH_ABBR[i]}" data-tx-field="avg">${dpct(mm.avg)}</td><td class="r tx-num" data-tx-sid="${id}" data-tx-month="${MONTH_ABBR[i]}" data-tx-field="win">${mm.win}%</td>`;
  const rows = ma.map((x, i) => {
    const sa = x.avg >= mb[i].avg;
    return `<tr data-stronger="${sa ? ia : ib}"${i === cm ? ' class="is-now"' : ''}><td>${MONTH_NAMES[i]}${i === cm ? ' <span class="tx-badge tx-badge--now">Now</span>' : ''}</td>${cell(ia, i, x)}${cell(ib, i, mb[i])}<td class="r"><span class="tx-badge ${sa ? 'tx-badge--tail' : 'tx-badge--modelled'}">${esc(sa ? da : db)}</span></td></tr>`;
  }).join('');
  // Paired bars
  const W = 680, H = 220, pad = 18, bw = (W - pad * 2) / 12, zero = (H - 22) / 2;
  const maxAbs = Math.max(0.5, ...ma.map(x => Math.abs(x.avg)), ...mb.map(x => Math.abs(x.avg)));
  let bars = '';
  for (let i = 0; i < 12; i++) {
    [[ma[i], '#F5A52F', 0], [mb[i], '#4DA3FF', 1]].forEach(([mm, col, k]) => {
      const h = Math.max(1.5, Math.abs(mm.avg) / maxAbs * (zero - 18)), x = pad + i * bw + bw * (0.14 + k * 0.38), y = mm.avg >= 0 ? zero - h : zero;
      bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.34).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${col}"/>`;
    });
    bars += `<text x="${(pad + i * bw + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="11" fill="${i === cm ? '#F5A52F' : '#8296AD'}">${MONTH_ABBR[i]}</text>`;
  }
  const chart = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(A.name)} and ${esc(B.name)} average return by month"><line x1="${pad}" y1="${zero}" x2="${W - pad}" y2="${zero}" stroke="#22324F"/>${bars}</svg>`;
  const popular = PAIRS.filter(([x, y]) => [x, y].includes(ia) || [x, y].includes(ib)).filter(([x, y]) => !(x === ia && y === ib)).slice(0, 6)
    .map(([x, y]) => `<a class="a-chip" href="/compare/${x}-vs-${y}">${esc(BY_ID[x].name)} <span>vs</span> ${esc(BY_ID[y].name)}</a>`).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:image" content="https://www.timingax.co.uk/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<!-- tx:head -->
<script>document.documentElement.className += " js";</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="/assets/tx.css">
<script src="/assets/tx.js" defer></script>
<!-- /tx:head -->
<style>
.c-wrap{max-width:1040px;padding-top:40px;padding-bottom:80px}
.c-crumb{font:500 12px var(--tx-font-mono);color:var(--tx-text-3);margin-bottom:22px}
.c-crumb a{color:var(--tx-text-3) !important}
.c-title{font:700 clamp(30px,4.6vw,50px)/1.08 var(--tx-font-ui);letter-spacing:-.03em;margin:14px 0 10px}
.c-title em{font-style:normal;color:var(--tx-text-3);font-weight:600}
.c-kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:28px 0 20px}
.c-kpis b{display:block;font:600 24px/1.1 var(--tx-font-mono);margin:8px 0 6px}
.c-kpis small{color:var(--tx-text-2);font-size:13.5px}
.c-legend{display:flex;gap:16px;padding:10px 16px;border-top:1px solid var(--tx-border-1);font:500 12px var(--tx-font-mono);color:var(--tx-text-2)}
.c-legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:-1px}
.c-table{margin-top:20px;padding:6px 6px 0;overflow-x:auto}
.c-table th:nth-child(n+2),.c-table td:nth-child(n+2){text-align:right}
.c-chips{margin-top:28px}
.c-chips a.a-chip{display:inline-flex;gap:6px;background:var(--tx-surface-1);border:1px solid var(--tx-border-1);border-radius:6px;padding:8px 12px;margin:0 6px 8px 0;font:500 13px var(--tx-font-ui);color:var(--tx-text-1) !important}
.c-chips a.a-chip span{color:var(--tx-text-3)}
@media (max-width:760px){.c-kpis{grid-template-columns:1fr}.c-table .tx-table td,.c-table .tx-table th{padding:10px 7px;font-size:12.5px}}
</style>
</head>
<body class="tx">
<!-- tx:header -->
<div class="tx-ticker" aria-label="Market prices, daily change"><div class="tx-ticker__track" id="ttrack"></div></div>
<header class="tx-header">
  <div class="tx-wrap tx-header__bar">
    <a class="tx-logo" href="/" aria-label="TimingAX home"><svg viewBox="0 0 26 26" fill="none" aria-hidden="true"><rect width="26" height="26" rx="6" fill="#0F1728"/><polyline points="3,18 8,12 13,15 19,7" stroke="#E89318" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="19" cy="7" r="1.8" fill="#E89318"/><rect x="3" y="19.5" width="2.2" height="2.8" rx="1" fill="#00C97E" opacity=".8"/><rect x="7.5" y="17.5" width="2.2" height="4.8" rx="1" fill="#00C97E" opacity=".8"/><rect x="12" y="15" width="2.2" height="7.3" rx="1" fill="#E89318" opacity=".9"/><rect x="16.5" y="11" width="2.2" height="11.3" rx="1" fill="#E89318"/></svg><span>Timing<b>AX</b></span></a>
    <nav class="tx-nav" id="txNav" aria-label="Main">
      <a href="/market-seasonality.html">Platform</a>
      <a href="/seasonality.html">Data</a>
      <a href="/leaderboard.html">Leaderboard</a>
      <a href="/academy.html">Academy</a>
      <a href="/#pricing">Pricing</a>
      <a href="/about.html">About</a>
    </nav>
    <div class="tx-header__actions">
      <a class="tx-btn tx-btn--ghost tx-btn--sm" href="/auth.html">Log in</a>
      <a class="tx-btn tx-btn--primary tx-btn--sm" href="/auth.html">Start free</a>
    </div>
    <button class="tx-menu-btn" type="button" aria-label="Menu" aria-expanded="false" aria-controls="txNav"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
  </div>
</header>
<!-- /tx:header -->
<main class="tx-wrap c-wrap">
  <div class="c-crumb"><a href="/seasonality.html">Data</a> / <a href="/compare.html">Compare</a> / ${esc(da)} vs ${esc(db)}</div>
  <span class="tx-eyebrow">Seasonality comparison</span>
  <h1 class="c-title">${esc(A.name)} <em>vs</em> ${esc(B.name)}</h1>
  <p class="tx-lead">How <a href="/seasonality/${ia}">${esc(A.name)}</a> and <a href="/seasonality/${ib}">${esc(B.name)}</a> have historically performed in each calendar month, from ${ra.years === rb.years ? ra.years : ra.years + ' and ' + rb.years} years of real price history.</p>

  <div class="c-kpis">
    <div class="tx-card"><span class="tx-label">Seasonal correlation</span><b data-cmp="corr">${rTxt}</b><small>${corrWords(r)}</small></div>
    <div class="tx-card"><span class="tx-label">Stronger more often</span>${winsA === 6 ? `<b>Even</b><small>Each ahead in 6 of 12 months on average return</small>` : `<b>${esc(winsA > 6 ? da : db)}</b><small>Ahead in ${Math.max(winsA, 12 - winsA)} of 12 months on average return</small>`}</div>
    <div class="tx-card"><span class="tx-label">This month &middot; ${MONTH_NAMES[cm]}</span><b class="${(nowA ? ma[cm].avg : mb[cm].avg) >= 0 ? 'tx-up' : 'tx-down'}">${esc(nowA ? da : db)}</b><small>Historically stronger: ${dpct(nowA ? ma[cm].avg : mb[cm].avg)} vs ${dpct(nowA ? mb[cm].avg : ma[cm].avg)}</small></div>
  </div>

  <div class="tx-term">
    <div class="tx-term__head"><span class="tx-term__title">Avg return by month</span><span class="tx-term__status">${ra.years}Y / ${rb.years}Y real data</span></div>
    <div style="padding:14px 12px 4px">${chart}</div>
    <div class="c-legend"><span><i style="background:#F5A52F"></i>${esc(A.name)}</span><span><i style="background:#4DA3FF"></i>${esc(B.name)}</span></div>
  </div>

  <div class="tx-card c-table">
    <table class="tx-table" id="cmpTable">
      <thead><tr><th>Month</th><th>${esc(da)} avg</th><th>Win</th><th>${esc(db)} avg</th><th>Win</th><th>Stronger</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>

  <p class="tx-note" style="margin-top:18px">${esc(A.name)}: best month ${MONTH_NAMES[bwA.best.i]} (${dpct(bwA.best.avg)}), weakest ${MONTH_NAMES[bwA.worst.i]} (${dpct(bwA.worst.avg)}). ${esc(B.name)}: best ${MONTH_NAMES[bwB.best.i]} (${dpct(bwB.best.avg)}), weakest ${MONTH_NAMES[bwB.worst.i]} (${dpct(bwB.worst.avg)}). Seasonality is a historical tendency, not a forecast. See the <a href="/methodology.html">methodology</a>.</p>

  <div class="c-chips">${popular ? `<span class="tx-label">More comparisons</span><div style="margin-top:12px">${popular}</div>` : ''}
    <div style="margin-top:16px"><a class="tx-btn tx-btn--primary" href="/compare.html">Compare any two assets &rarr;</a></div></div>
</main>
<!-- tx:footer -->
<footer class="tx-footer">
  <div class="tx-wrap">
    <div class="tx-footer__grid">
      <div class="tx-footer__brand">
        <a class="tx-logo" href="/" aria-label="TimingAX home"><svg viewBox="0 0 26 26" fill="none" aria-hidden="true"><rect width="26" height="26" rx="6" fill="#0F1728"/><polyline points="3,18 8,12 13,15 19,7" stroke="#E89318" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="19" cy="7" r="1.8" fill="#E89318"/><rect x="3" y="19.5" width="2.2" height="2.8" rx="1" fill="#00C97E" opacity=".8"/><rect x="7.5" y="17.5" width="2.2" height="4.8" rx="1" fill="#00C97E" opacity=".8"/><rect x="12" y="15" width="2.2" height="7.3" rx="1" fill="#E89318" opacity=".9"/><rect x="16.5" y="11" width="2.2" height="11.3" rx="1" fill="#E89318"/></svg><span>Timing<b>AX</b></span></a>
        <p style="margin:14px 0 0;max-width:340px">Professional market seasonality intelligence for self-directed investors. 733 global assets, 15 years of real price history.</p>
      </div>
      <div><h4>Product</h4><ul>
        <li><a href="/market-seasonality.html">Open the app</a></li>
        <li><a href="/seasonality.html">Browse assets</a></li>
        <li><a href="/outlook.html">Monthly outlook</a></li>
        <li><a href="/leaderboard.html">Leaderboard</a></li>
        <li><a href="/compare.html">Compare assets</a></li>
        <li><a href="/#pricing">Pricing</a></li>
        <li><a href="/data.html">Data &amp; methodology</a></li>
        <li><a href="/track-record.html">Track record</a></li>
        <li><a href="/methodology.html">Methodology</a></li>
        <li><a href="/changelog.html">Changelog</a></li>
      </ul></div>
      <div><h4>Company</h4><ul>
        <li><a href="/about.html">About</a></li>
        <li><a href="/academy.html">Academy</a></li>
        <li><a href="/blog.html">Blog</a></li>
        <li><a href="/contact.html">Contact</a></li>
      </ul></div>
      <div><h4>Legal</h4><ul>
        <li><a href="/accessibility.html">Accessibility</a></li>
        <li><a href="/privacy-policy.html">Privacy policy</a></li>
        <li><a href="/terms-of-service.html">Terms of service</a></li>
        <li><a href="/terms-of-service.html">Disclaimer</a></li>
      </ul></div>
    </div>
    <div class="tx-footer__legal">
      <p>Past seasonal performance does not guarantee future results. TimingAX provides historical data for informational purposes only and does not constitute financial advice. All investments carry risk. Consult a qualified financial adviser before making investment decisions. TimingAX is an independently operated service and not a registered investment adviser.</p>
      <span>&copy; 2026 TimingAX &middot; All rights reserved</span>
    </div>
  </div>
</footer>
<!-- /tx:footer -->
<script src="/cookie-consent.js"></script>
</body>
</html>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(html);
}
