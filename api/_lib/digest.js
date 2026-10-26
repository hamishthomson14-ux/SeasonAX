// api/_lib/digest.js
// Monthly digest email (sent on the 1st by the daily cron in api/send-seasonal-alerts.js).
// Every figure is passed in from the live API (real prices) and every date from the official schedules;
// nothing here estimates anything. Each email carries its own one-click unsubscribe link.
import { createHmac } from 'node:crypto';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const AB = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const SITE = 'https://www.timingax.co.uk';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pct = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + '%';

export function unsubToken(email, secret) {
  return createHmac('sha256', String(secret)).update(String(email).trim().toLowerCase()).digest('hex').slice(0, 32);
}
export function unsubUrl(email, secret) {
  return `${SITE}/api/send-seasonal-alerts?unsubscribe=${encodeURIComponent(email)}&token=${unsubToken(email, secret)}`;
}

// data: { monthIndex, year, markets: [{id,name,avg,win,n}], strong: [{id,name,avg,win}], weak: [...], events: [{t,name,source}] }
export function buildDigest(data, unsubscribeUrl) {
  const M = MONTHS[data.monthIndex];
  const row = (a, extra) => `<tr><td style="padding:6px 0"><a href="${SITE}/seasonality/${encodeURIComponent(a.id)}" style="color:#0F1E30;font-weight:600;text-decoration:none">${esc(a.name)}</a></td><td style="padding:6px 0;text-align:right;color:${a.avg >= 0 ? '#0a7a4f' : '#b3192b'};font-family:monospace">${pct(a.avg)}</td><td style="padding:6px 0 6px 12px;text-align:right;color:#4D6880;font-family:monospace">${a.win}% up${extra || ''}</td></tr>`;
  const table = (rows) => `<table style="width:100%;border-collapse:collapse;font-size:14px">${rows}</table>`;
  const evDate = (t) => { const d = new Date(t); return `${d.getUTCDate()} ${AB[d.getUTCMonth()]}`; };
  const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;color:#0F1E30;line-height:1.55">
  <p style="color:#E89318;font-weight:700;letter-spacing:.08em;font-size:12px;margin:0 0 4px">TIMINGAX &middot; ${M.toUpperCase()} ${data.year}</p>
  <h1 style="font-size:22px;margin:0 0 8px">${M}: the seasonal picture</h1>
  <p style="margin:0 0 18px;color:#4D6880">How each market has historically done in ${M}, from real monthly closes (up to 15 years). History, not a forecast.</p>
  <h2 style="font-size:15px;margin:18px 0 6px">Major markets in ${M}</h2>
  ${table(data.markets.map((a) => row(a, ` &middot; ${a.n} ${M}s`)).join(''))}
  <h2 style="font-size:15px;margin:22px 0 6px">Historically strongest in ${M}</h2>
  ${table(data.strong.map((a) => row(a, a.n ? ` &middot; ${a.n} ${M}s` : '')).join(''))}
  <h2 style="font-size:15px;margin:22px 0 6px">Historically weakest in ${M}</h2>
  ${table(data.weak.map((a) => row(a, a.n ? ` &middot; ${a.n} ${M}s` : '')).join(''))}
  ${data.events.length ? `<h2 style="font-size:15px;margin:22px 0 6px">Scheduled in ${M}</h2>
  <ul style="padding-left:18px;margin:0">${data.events.map((e) => `<li>${evDate(e.t)} &mdash; ${esc(e.name)} (<a href="${esc(e.source)}" style="color:#4D6880">${esc(new URL(e.source).hostname.replace(/^www\./, ''))}</a>)</li>`).join('')}</ul>` : ''}
  <p style="margin:26px 0"><a href="${SITE}/outlook.html" style="background:#E89318;color:#04070F;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600">See the full ${M} outlook &rarr;</a></p>
  <p style="font-size:12px;color:#8FA3B8">Seasonal patterns are historical tendencies, not guarantees, and this is not financial advice. Rankings use assets with at least 5 years of real data; the number of years behind each figure is shown, and figures from fewer years are less reliable.<br>
  You're receiving this because you subscribed at timingax.co.uk. <a href="${esc(unsubscribeUrl)}" style="color:#8FA3B8">Unsubscribe</a>.</p>
</div>`;
  const line = (a, extra) => `- ${a.name}: ${pct(a.avg)}, ${a.win}% up${extra || ''}`;
  const text = [`${M} ${data.year}: the seasonal picture (TimingAX)`, '', `Major markets in ${M}:`, ...data.markets.map((a) => line(a, `, ${a.n} ${M}s`)),
    '', `Historically strongest in ${M}:`, ...data.strong.map((a) => line(a, a.n ? `, ${a.n} ${M}s` : '')), '', `Historically weakest in ${M}:`, ...data.weak.map((a) => line(a, a.n ? `, ${a.n} ${M}s` : '')),
    ...(data.events.length ? ['', `Scheduled in ${M}:`, ...data.events.map((e) => `- ${evDate(e.t)}: ${e.name} (${e.source})`)] : []),
    '', `Full outlook: ${SITE}/outlook.html`, 'History, not a forecast. Not financial advice.', `Unsubscribe: ${unsubscribeUrl}`].join('\n');
  return { subject: `${M} ${data.year}: the seasonal picture`, html, text };
}

// Dependencies injected so the whole run is testable without Supabase, Resend or live data.
export async function runDigest({ now = new Date(), env, fetch, getData }) {
  if (now.getUTCDate() !== 1) return { due: false };
  const { SUPABASE_URL: sb, SUPABASE_SERVICE_ROLE_KEY: key, RESEND_API_KEY: resend } = env;
  if (!sb || !key || !resend) return { due: true, error: 'Digest not configured (Supabase / Resend environment variables missing)' };
  let data = null;
  try { data = await getData(now); } catch (e) { data = null; }
  if (!data || !data.markets || !data.markets.length || !data.strong || !data.strong.length) return { due: true, error: 'Digest data unavailable; nothing sent' };
  const subs = await (await fetch(`${sb}/rest/v1/newsletter_subscribers?select=email`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })).json();
  if (!Array.isArray(subs)) return { due: true, error: 'Could not read subscribers' };
  const from = env.DIGEST_FROM_EMAIL || env.ALERT_FROM_EMAIL || 'TimingAX <hello@timingax.co.uk>';
  const emails = [...new Set(subs.map((s) => String(s.email || '').trim()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))];
  let sent = 0, failed = 0;
  for (let i = 0; i < emails.length; i += 100) {
    const batch = emails.slice(i, i + 100).map((to) => {
      const u = unsubUrl(to, key), e = buildDigest(data, u);
      return { from, to, subject: e.subject, html: e.html, text: e.text, headers: { 'List-Unsubscribe': `<${u}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } };
    });
    try {
      const r = await fetch('https://api.resend.com/emails/batch', { method: 'POST', headers: { Authorization: `Bearer ${resend}`, 'Content-Type': 'application/json' }, body: JSON.stringify(batch) });
      if (r.ok) sent += batch.length; else failed += batch.length;
    } catch (e) { failed += batch.length; }
  }
  return { due: true, month: MONTHS[data.monthIndex], subscribers: emails.length, sent, failed };
}
