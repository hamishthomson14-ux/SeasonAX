// api/send-seasonal-alerts.js
// Triggered daily by Vercel Cron (see vercel.json).
//  - Seasonal alerts: three days before a month begins, emails every user whose alerted asset has that month as its
//    strongest, with the figures recomputed from real prices today (see _lib/alerts.js).
//  - Monthly digest: on the 1st, emails newsletter subscribers the month's seasonal picture from the live API and the
//    official event schedules (see _lib/digest.js).
//  - Public: ?unsubscribe=<email>&token=<hmac> removes that address from the newsletter (link in every digest).
//
// Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY,
// and optionally ALERT_FROM_EMAIL / DIGEST_FROM_EMAIL + CRON_SECRET in Vercel environment variables.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { timingSafeEqual } from 'node:crypto';
import { yahooSymbol, fetchMonthly, computeAdaptiveMonths } from './_lib/seasonal.js';
import { runAlerts } from './_lib/alerts.js';
import { runDigest, unsubToken } from './_lib/digest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOGUE = JSON.parse(readFileSync(path.join(__dirname, '_data/catalogue.json'), 'utf8'));
const SITE = 'https://www.timingax.co.uk';
const MARKETS = [['sp500', 'S&P 500'], ['nasdaq', 'NASDAQ Composite'], ['dow', 'Dow Jones'], ['ftse100', 'FTSE 100'], ['dax', 'DAX 40'], ['nikkei', 'Nikkei 225'], ['gld', 'Gold (GLD)'], ['btc', 'Bitcoin']];

export const config = { maxDuration: 60 };

async function lookup(id) {
  const item = CATALOGUE.find((a) => a.id === id);
  if (!item) return null;
  const rows = await fetchMonthly(yahooSymbol(item));
  return rows ? computeAdaptiveMonths(rows, 15) : null;
}

const getJson = (u) => fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null);

// The digest's figures come from the site's own public API (same numbers as the Monthly outlook page).
export async function digestData(now) {
  const mi = now.getUTCMonth(), year = now.getUTCFullYear();
  const mk = await Promise.all(MARKETS.map(([id]) => getJson(`${SITE}/api/v1/seasonality?id=${id}`)));
  const markets = MARKETS.map(([id, name], k) => { const d = mk[k]; if (!d || d.source !== 'verified') return null; const m = d.months[mi]; return { id, name, avg: m.avgReturn, win: m.winRate, n: m.observations }; }).filter(Boolean);
  const sections = [...new Set(CATALOGUE.map((a) => a.catSection))];
  const rows = [];
  for (let i = 0; i < sections.length; i += 6) {
    const got = await Promise.all(sections.slice(i, i + 6).map((s) => getJson(`${SITE}/api/v1/seasonality?view=leaderboard&month=${mi + 1}&section=${encodeURIComponent(s)}`)));
    if (got.some((g) => !g || !g.rows)) return null;                  // a partial ranking would mislead: send nothing
    got.forEach((g) => g.rows.forEach((r) => { if (r.obs >= 5) rows.push(r); }));
  }
  rows.sort((a, b) => b.avg - a.avg || b.win - a.win || (a.id < b.id ? -1 : 1));
  const ev = await getJson(`${SITE}/assets/events.json`);
  const events = (ev && ev.events || []).filter((e) => { const d = new Date(e.t); return d.getUTCMonth() === mi && d.getUTCFullYear() === year; });
  const pick = (r) => ({ id: r.id, name: r.name, avg: r.avg, win: r.win, n: r.obs });
  return { monthIndex: mi, year, markets, strong: rows.slice(0, 5).map(pick), weak: rows.slice(-5).reverse().map(pick), events };
}

function page(res, code, title, msg) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(code).send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} | TimingAX</title></head>
<body style="font-family:-apple-system,Segoe UI,sans-serif;background:#04070F;color:#EDF2FA;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0">
<div style="max-width:440px;padding:24px;text-align:center"><h1 style="font-size:24px">${title}</h1><p style="color:#8FA3B8">${msg}</p><p><a href="${SITE}" style="color:#F5A52F">Back to TimingAX</a></p></div></body></html>`);
}

async function unsubscribe(req, res) {
  const email = String(req.query.unsubscribe || '').trim().toLowerCase(), token = String(req.query.token || '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY, sb = process.env.SUPABASE_URL;
  if (!key || !sb) return page(res, 500, 'Something went wrong', 'Please reply to any of our emails and we will remove you by hand.');
  const want = Buffer.from(unsubToken(email, key)), got = Buffer.from(token);
  if (!email || got.length !== want.length || !timingSafeEqual(got, want)) return page(res, 400, 'Link not valid', 'This unsubscribe link is incomplete or has expired. Use the link from your most recent email.');
  const r = await fetch(`${sb}/rest/v1/newsletter_subscribers?email=ilike.${encodeURIComponent(email)}`, { method: 'DELETE', headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'return=minimal' } });
  if (!r.ok && r.status !== 204) return page(res, 500, 'Something went wrong', 'Please try the link again in a moment.');
  return page(res, 200, 'You’re unsubscribed', `${email} won’t receive the monthly digest any more.`);
}

export default async function handler(req, res) {
  // Public one-click unsubscribe (GET from the link, POST from email clients' List-Unsubscribe-Post).
  if (req.query && req.query.unsubscribe) return unsubscribe(req, res);

  // Optional shared-secret check. If CRON_SECRET is set in Vercel, Vercel's
  // Cron invocations automatically include it as a Bearer token.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && (req.headers.authorization || '') !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const now = new Date();
    const alerts = await runAlerts({ now, env: process.env, fetch, lookup });
    const digest = await runDigest({ now, env: process.env, fetch, getData: digestData });
    return res.status(alerts.error ? 500 : 200).json({ alerts, digest });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
