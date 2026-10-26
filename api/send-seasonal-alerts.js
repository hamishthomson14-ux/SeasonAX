// api/send-seasonal-alerts.js
// Triggered daily by Vercel Cron (see vercel.json).
// Three days before a month begins, emails every user whose alerted asset has that
// month as its strongest — with the figures recomputed from real prices today
// (see _lib/alerts.js). Assets without verified price history are skipped.
//
// Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY,
// and optionally ALERT_FROM_EMAIL + CRON_SECRET in Vercel environment variables.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { yahooSymbol, fetchMonthly, computeAdaptiveMonths } from './_lib/seasonal.js';
import { runAlerts } from './_lib/alerts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOGUE = JSON.parse(readFileSync(path.join(__dirname, '_data/catalogue.json'), 'utf8'));

export const config = { maxDuration: 60 };

async function lookup(id) {
  const item = CATALOGUE.find((a) => a.id === id);
  if (!item) return null;
  const rows = await fetchMonthly(yahooSymbol(item));
  return rows ? computeAdaptiveMonths(rows, 15) : null;
}

export default async function handler(req, res) {
  // Optional shared-secret check. If CRON_SECRET is set in Vercel, Vercel's
  // Cron invocations automatically include it as a Bearer token.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && (req.headers.authorization || '') !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const out = await runAlerts({ now: new Date(), env: process.env, fetch, lookup });
    return res.status(out.error ? 500 : 200).json(out);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
