// api/create-checkout.js
// Creates a Stripe Checkout session for a signed-in user and returns its URL.
// The caller's Supabase session token decides who is paying (never the request body), and the plan decides the
// price (see _lib/billing.js), so the webhook can upgrade exactly that account.
// Requires STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY; optional STRIPE_PRICE_MONTHLY / STRIPE_PRICE_ANNUAL.
import { resolvePlan, planForPrice } from './_lib/billing.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secretKey = process.env.STRIPE_SECRET_KEY, sbUrl = process.env.SUPABASE_URL, sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secretKey || !sbUrl || !sbKey) return res.status(500).json({ error: 'Checkout not configured' });

  // Who is paying: verified from their own session token.
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Please sign in to start your trial.', signIn: true });
  let user = null;
  try {
    const me = await fetch(`${sbUrl}/auth/v1/user`, { headers: { apikey: sbKey, Authorization: `Bearer ${token}` } });
    if (me.ok) user = await me.json();
  } catch (e) { user = null; }
  if (!user || !user.id || !user.email) return res.status(401).json({ error: 'Your session has expired. Please sign in again.', signIn: true });

  const body = req.body || {};
  const plan = body.plan || planForPrice(body.priceId);
  const priceId = resolvePlan(plan);
  if (!priceId) return res.status(400).json({ error: 'Unknown plan' });

  const origin = /^https:\/\/(www\.)?timingax\.co\.uk$|^http:\/\/localhost(:\d+)?$/.test(req.headers.origin || '') ? req.headers.origin : 'https://www.timingax.co.uk';
  try {
    const params = new URLSearchParams({
      'payment_method_types[]': 'card',
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      mode: 'subscription',
      client_reference_id: user.id,
      customer_email: user.email,
      'subscription_data[metadata][user_id]': user.id,
      // 7-day free trial; card collected up front. If no valid card is on file at trial end, the subscription is
      // cancelled rather than charged.
      'subscription_data[trial_period_days]': '7',
      'subscription_data[trial_settings][end_behavior][missing_payment_method]': 'cancel',
      success_url: `${origin}/dashboard.html?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/index.html#pricing`,
      allow_promotion_codes: 'true',
    });
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const session = await r.json();
    if (session.error) throw new Error(session.error.message);
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err);
    return res.status(500).json({ error: 'Checkout failed. Please try again.' });
  }
}
