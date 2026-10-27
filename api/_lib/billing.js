// api/_lib/billing.js
// Shared billing logic for create-checkout.js and stripe-webhook.js.
// Prices come from Vercel settings (STRIPE_PRICE_MONTHLY / STRIPE_PRICE_ANNUAL) so switching Stripe from test to
// live mode needs only environment changes; the defaults are the current (test-mode) prices.

const DEFAULT_PRICES = { monthly: 'price_1Tgkjt2MZ73Stw013w4czf7Z', annual: 'price_1ThF3e2MZ73Stw01iR4vDpHc' };

export function resolvePlan(plan, env = process.env) {
  if (plan === 'monthly') return env.STRIPE_PRICE_MONTHLY || DEFAULT_PRICES.monthly;
  if (plan === 'annual') return env.STRIPE_PRICE_ANNUAL || DEFAULT_PRICES.annual;
  return null;
}

// Older cached pages post a priceId: accept it only if it is one of our own plan prices.
export function planForPrice(priceId, env = process.env) {
  for (const plan of ['monthly', 'annual']) if (priceId && priceId === resolvePlan(plan, env)) return plan;
  return null;
}

// What a Stripe event means for one TimingAX account: { userId, customerId, email, status } or null (no change).
export function eventAction(event) {
  const o = (event && event.data && event.data.object) || {};
  const email = o.customer_email || (o.customer_details && o.customer_details.email) || null;
  switch (event && event.type) {
    case 'checkout.session.completed':
      return { userId: o.client_reference_id || null, customerId: o.customer || null, email, status: o.mode === 'payment' ? 'lifetime' : 'pro' };
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const status = ['active', 'trialing'].includes(o.status) ? 'pro' : ['canceled', 'unpaid', 'incomplete_expired'].includes(o.status) ? 'free' : null;
      return status ? { userId: (o.metadata && o.metadata.user_id) || null, customerId: o.customer || null, email: null, status } : null;
    }
    case 'customer.subscription.deleted':
      return { userId: (o.metadata && o.metadata.user_id) || null, customerId: o.customer || null, email: null, status: 'free' };
    case 'invoice.payment_succeeded': {
      const md = (o.subscription_details && o.subscription_details.metadata) || (o.parent && o.parent.subscription_details && o.parent.subscription_details.metadata) || {};
      return { userId: md.user_id || null, customerId: o.customer || null, email, status: 'pro' };
    }
    default:
      return null;
  }
}

// Exact, case-insensitive email match. The admin list endpoint ignores ?email= and is paginated, so walk the pages.
export async function findUserByEmail(email, { url, key, fetch = globalThis.fetch }) {
  const want = String(email || '').trim().toLowerCase();
  if (!want) return null;
  for (let page = 1; page <= 50; page++) {
    const r = await fetch(`${url}/auth/v1/admin/users?page=${page}&per_page=1000`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!r.ok) return null;
    const users = ((await r.json()) || {}).users || [];
    const hit = users.find((u) => String(u.email || '').toLowerCase() === want);
    if (hit) return hit;
    if (!users.length) return null;
  }
  return null;
}
