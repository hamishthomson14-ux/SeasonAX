// api/_lib/alerts.js
// Seasonal email alerts: 3 days before an asset's strongest calendar month begins.
// Figures are recomputed from real prices at send time — never the numbers stored
// when the alert was set — and assets without verified history are skipped.
import { MONTH_NAMES, bestWorst } from './seasonal.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pct = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + '%';

// lookup(assetId) -> { months: [{avg, win, n}], years } from real prices, or null.
export async function planSeasonalAlerts(alerts, { now = new Date(), lookup }) {
  const target = new Date(now); target.setUTCDate(target.getUTCDate() + 3);
  if (target.getUTCDate() !== 1) return { due: false, checkedDate: target.toISOString().slice(0, 10) };
  const month = target.getUTCMonth(), year = target.getUTCFullYear();
  const send = [], skip = [];
  for (const alert of alerts) {
    if (alert.last_notified_year === year) { skip.push({ id: alert.id, reason: 'already-sent' }); continue; }
    let real = null;
    try { real = await lookup(alert.asset_id); } catch (e) { real = null; }
    if (!real || !real.months) { skip.push({ id: alert.id, reason: 'no-verified-data' }); continue; }
    if (bestWorst(real.months).best.i !== month) { skip.push({ id: alert.id, reason: 'not-strongest-month' }); continue; }
    const m = real.months[month];
    send.push({ alert, month, monthName: MONTH_NAMES[month], avg: m.avg, win: m.win, n: m.n, years: real.years });
  }
  return { due: true, month, year, send, skip };
}

export function buildAlertEmail({ alert, monthName, avg, win, n }) {
  const t = esc(alert.asset_ticker), name = esc(alert.asset_name);
  const html = `
  <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;color:#0F1E30">
    <h2 style="color:#E89318;margin-bottom:4px">${monthName} starts in 3 days</h2>
    <p style="font-size:15px;line-height:1.6">
      <strong>${t}</strong> (${name}): ${monthName} has been its strongest month, averaging
      <strong>${pct(avg)}</strong> across its last ${n} ${monthName}s and rising in <strong>${win}%</strong> of them,
      from real monthly closes as of today.
    </p>
    <p style="font-size:14px;color:#4D6880;line-height:1.6">
      Past seasonal patterns are not a guarantee of future results. This is a reminder based on
      historical data, not a trading signal and not financial advice.
    </p>
    <p style="margin-top:24px">
      <a href="https://www.timingax.co.uk/seasonality/${encodeURIComponent(alert.asset_id)}" style="background:#E89318;color:#04070F;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600;font-size:14px">See ${t}&rsquo;s full calendar &rarr;</a>
    </p>
    <p style="font-size:11px;color:#8FA3B8;margin-top:32px">
      You're receiving this because you set a seasonal alert for ${t} on TimingAX.
      Turn alerts off from your <a href="https://www.timingax.co.uk/market-seasonality.html" style="color:#8FA3B8">watchlist or the asset's page</a>.
    </p>
  </div>`;
  return { subject: `${alert.asset_ticker}: ${monthName} (historically its strongest month) starts in 3 days`, html };
}

// Dependencies injected so the whole run can be tested without Supabase, Resend or prices.
export async function runAlerts({ now = new Date(), env, fetch, lookup }) {
  const { SUPABASE_URL: sbUrl, SUPABASE_SERVICE_ROLE_KEY: key, RESEND_API_KEY: resendKey } = env;
  if (!sbUrl || !key || !resendKey) return { error: 'Alerts not configured (Supabase / Resend environment variables missing)' };
  const from = env.ALERT_FROM_EMAIL || 'TimingAX Alerts <alerts@timingax.co.uk>';
  const sbHead = { apikey: key, Authorization: `Bearer ${key}` };
  const pre = await planSeasonalAlerts([], { now, lookup });
  if (!pre.due) return { ok: true, message: 'No alert windows today.', checkedDate: pre.checkedDate };

  const alerts = await (await fetch(`${sbUrl}/rest/v1/seasonal_alerts?select=*`, { headers: sbHead })).json();
  if (!Array.isArray(alerts)) return { error: 'Failed to fetch alerts' };
  const plan = await planSeasonalAlerts(alerts, { now, lookup });
  let sent = 0, failed = 0;
  for (const s of plan.send) {
    try {
      const user = await (await fetch(`${sbUrl}/auth/v1/admin/users/${s.alert.user_id}`, { headers: sbHead })).json();
      if (!user || !user.email) { failed++; continue; }
      const { subject, html } = buildAlertEmail(s);
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: user.email, subject, html }),
      });
      if (!r.ok) { failed++; continue; }
      sent++;
      await fetch(`${sbUrl}/rest/v1/seasonal_alerts?id=eq.${encodeURIComponent(s.alert.id)}`, {
        method: 'PATCH', headers: { ...sbHead, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ last_notified_year: plan.year }),
      });
    } catch (e) { failed++; }
  }
  return { ok: true, month: MONTH_NAMES[plan.month], due: plan.send.length, sent, failed, skipped: plan.skip.length };
}
