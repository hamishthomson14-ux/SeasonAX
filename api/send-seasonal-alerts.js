// api/send-seasonal-alerts.js
// Triggered daily by Vercel Cron (see vercel.json).
// For every saved alert, checks whether that asset's strongest seasonal
// month begins in 3 days' time. If so, emails the user via Resend and
// records the year so the same alert doesn't fire twice in one cycle.
//
// Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY,
// and optionally ALERT_FROM_EMAIL + CRON_SECRET in Vercel environment variables.

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export default async function handler(req, res) {
  // Optional shared-secret check. If CRON_SECRET is set in Vercel, Vercel's
  // Cron invocations automatically include it as a Bearer token.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.ALERT_FROM_EMAIL || 'TimingAX Alerts <alerts@timingax.co.uk>';

  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: 'Supabase not configured' });
  if (!resendKey) return res.status(500).json({ error: 'Resend not configured' });

  try {
    // The target date: 3 days from now. If that date is the 1st of a month,
    // any alert whose best_month matches "fires" today.
    const target = new Date();
    target.setUTCDate(target.getUTCDate() + 3);
    const targetIsFirstOfMonth = target.getUTCDate() === 1;
    const targetMonth = target.getUTCMonth(); // 0-11
    const targetYear = target.getUTCFullYear();

    if (!targetIsFirstOfMonth) {
      return res.status(200).json({ ok: true, message: 'No alert windows today.', checkedDate: target.toISOString().slice(0,10) });
    }

    // Fetch all alerts matching this month that haven't been notified this year.
    const alertsRes = await fetch(
      `${supabaseUrl}/rest/v1/seasonal_alerts?select=*&best_month=eq.${targetMonth}`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    const alerts = await alertsRes.json();
    if (!Array.isArray(alerts)) return res.status(500).json({ error: 'Failed to fetch alerts', detail: alerts });

    const due = alerts.filter(a => a.last_notified_year !== targetYear);
    let sent = 0, failed = 0;

    for (const alert of due) {
      try {
        // Look up the user's email via Supabase admin API.
        const userRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${alert.user_id}`, {
          headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
        });
        const userData = await userRes.json();
        const email = userData && userData.email;
        if (!email) { failed++; continue; }

        const monthName = MONTH_NAMES[alert.best_month];
        const avgTxt = (alert.best_avg >= 0 ? '+' : '') + Number(alert.best_avg).toFixed(2) + '%';
        const winTxt = alert.best_win + '%';

        const html = `
          <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;color:#0F1E30">
            <h2 style="color:#E89318;margin-bottom:4px">${monthName} starts in 3 days</h2>
            <p style="font-size:15px;line-height:1.6">
              <strong>${alert.asset_ticker}</strong> (${alert.asset_name}) has historically been
              one of its strongest months in <strong>${monthName}</strong>, averaging
              <strong>${avgTxt}</strong> with a <strong>${winTxt}</strong> win rate.
            </p>
            <p style="font-size:14px;color:#4D6880;line-height:1.6">
              Past seasonal patterns are not a guarantee of future results \u2014 this is a
              reminder based on historical data, not a trading signal.
            </p>
            <p style="margin-top:24px">
              <a href="https://timingax.co.uk/market-seasonality.html" style="background:#E89318;color:#04070F;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600;font-size:14px">Open the Analyzer &rarr;</a>
            </p>
            <p style="font-size:11px;color:#8FA3B8;margin-top:32px">
              You're receiving this because you set a seasonal alert for ${alert.asset_ticker} on TimingAX.
              Manage your alerts from the dashboard.
            </p>
          </div>`;

        const sendRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: fromEmail,
            to: email,
            subject: `${alert.asset_ticker}: ${monthName} (historically a strong month) starts in 3 days`,
            html
          })
        });

        if (sendRes.ok) {
          sent++;
          // Mark as notified for this year so it doesn't fire again.
          await fetch(`${supabaseUrl}/rest/v1/seasonal_alerts?id=eq.${alert.id}`, {
            method: 'PATCH',
            headers: {
              apikey: serviceKey,
              Authorization: `Bearer ${serviceKey}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal'
            },
            body: JSON.stringify({ last_notified_year: targetYear })
          });
        } else {
          failed++;
        }
      } catch (e) {
        failed++;
      }
    }

    return res.status(200).json({ ok: true, month: MONTH_NAMES[targetMonth], due: due.length, sent, failed });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
