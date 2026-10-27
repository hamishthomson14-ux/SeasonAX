// api/stripe-webhook.js
// Handles Stripe webhook events — marks users as Pro in Supabase
// Requires STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY in Vercel environment variables

import crypto from 'node:crypto';
import { eventAction, findUserByEmail } from './_lib/billing.js';

export const config = { api: { bodyParser: false } };

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Manual Stripe signature verification using Node's crypto (not Web Crypto)
function verifyStripeSignature(rawBody, sigHeader, secret) {
  if (!sigHeader) throw new Error('Missing stripe-signature header');

  const parts = sigHeader.split(',').reduce((acc, part) => {
    const [k, v] = part.split('=');
    if (k === 't') acc.timestamp = v;
    if (k === 'v1') { acc.signatures = acc.signatures || []; acc.signatures.push(v); }
    return acc;
  }, {});

  if (!parts.timestamp || !parts.signatures) {
    throw new Error('Malformed stripe-signature header');
  }

  // Reject events outside a 5-minute replay window.
  const TOLERANCE_SECONDS = 300;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(parts.timestamp)) > TOLERANCE_SECONDS) {
    throw new Error('Timestamp outside tolerance');
  }

  const signedPayload = `${parts.timestamp}.${rawBody.toString('utf8')}`;
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(signedPayload, 'utf8')
    .digest('hex');

  const valid = parts.signatures.some((sig) => {
    try {
      return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expectedSig, 'hex'));
    } catch (e) {
      return false;
    }
  });

  if (!valid) {
    throw new Error('Signature mismatch');
  }

  return true;
}

// Applies a one-month Pro credit (£19.99) to a Stripe customer's balance.
// A negative "amount" on the customer balance is a credit: it reduces what
// they owe on their next invoice by this amount.
const REFERRAL_CREDIT_PENCE = 1999; // £19.99 = one month of Pro

async function applyStripeCredit(secretKey, customerId, amountPence, description) {
  const params = new URLSearchParams();
  params.append('amount', String(-amountPence)); // negative = credit
  params.append('currency', 'gbp');
  if (description) params.append('description', description);

  const r = await fetch(`https://api.stripe.com/v1/customers/${customerId}/balance_transactions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  if (!r.ok) {
    throw new Error(`Stripe balance credit failed for ${customerId}: ${await r.text()}`);
  }
  return r.json();
}

// If the user who just became Pro/Lifetime was referred by someone else,
// credit BOTH accounts one free month and mark the referral as rewarded.
// Safe to call on every payment-success event: if there's no pending
// referral for this user (not referred, or already rewarded), it's a no-op.
async function processReferralReward(supabaseUrl, supabaseServiceKey, secretKey, referredUserId, referredCustomerId) {
  const svcHeaders = { apikey: supabaseServiceKey, Authorization: `Bearer ${supabaseServiceKey}` };

  // Look up a pending referral for this user
  const refRes = await fetch(
    `${supabaseUrl}/rest/v1/referrals?referred_id=eq.${referredUserId}&status=eq.pending&select=*`,
    { headers: svcHeaders }
  );
  if (!refRes.ok) {
    console.error('Referral lookup failed:', await refRes.text());
    return;
  }
  const rows = await refRes.json();
  if (!rows || rows.length === 0) return; // not referred, or already rewarded
  const referral = rows[0];

  // Look up the referrer's Stripe customer ID
  const referrerRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${referral.referrer_id}`, {
    headers: svcHeaders,
  });
  if (!referrerRes.ok) {
    console.error('Referrer lookup failed:', await referrerRes.text());
    return;
  }
  const referrer = await referrerRes.json();
  const referrerCustomerId = referrer.app_metadata && referrer.app_metadata.stripe_customer;

  // Credit both sides on Stripe (whichever have a customer ID)
  try {
    if (referredCustomerId) {
      await applyStripeCredit(secretKey, referredCustomerId, REFERRAL_CREDIT_PENCE,
        'Referral reward: thanks for joining via a friend\u2019s link');
    }
    if (referrerCustomerId) {
      await applyStripeCredit(secretKey, referrerCustomerId, REFERRAL_CREDIT_PENCE,
        'Referral reward: a friend joined TimingAX using your link');
    }
  } catch (e) {
    console.error('Referral credit error:', e.message);
    return; // leave status as 'pending' so it can be investigated/retried
  }

  // Mark the referral as rewarded so this never runs twice
  await fetch(`${supabaseUrl}/rest/v1/referrals?id=eq.${referral.id}`, {
    method: 'PATCH',
    headers: { ...svcHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: 'rewarded',
      converted_at: new Date().toISOString(),
      rewarded_at: new Date().toISOString(),
    }),
  });

  console.log(`Referral reward processed for referral ${referral.id}`);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return res.status(500).json({ error: 'STRIPE_WEBHOOK_SECRET not set' });
  }

  let rawBody;
  try {
    rawBody = await getRawBody(req);
  } catch (e) {
    return res.status(400).json({ error: 'Failed to read body: ' + e.message });
  }

  const sig = req.headers['stripe-signature'];

  try {
    verifyStripeSignature(rawBody, sig, webhookSecret);
  } catch (e) {
    console.error('Signature verification failed:', e.message);
    // Details stay in server logs only - never echo signature material to the caller.
    return res.status(400).json({ error: 'Signature verification failed' });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON: ' + e.message });
  }

  console.log('Stripe event received:', event.type);

  // ── Work out which account this event is about, and what it should become ──
  // The account comes from the id we attached at checkout (client_reference_id / subscription metadata). Older
  // subscriptions without it fall back to an exact email match (never "the first user in the list").
  const action = eventAction(event);
  if (action) {
    const supabaseUrl = process.env.SUPABASE_URL, supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const svc = { apikey: supabaseServiceKey, Authorization: `Bearer ${supabaseServiceKey}` };
    try {
      if (!supabaseUrl || !supabaseServiceKey) throw new Error('Supabase not configured');
      let userId = action.userId;
      if (!userId) {
        let email = action.email;
        if (!email && action.customerId && secretKey) {
          const cust = await (await fetch('https://api.stripe.com/v1/customers/' + action.customerId, { headers: { Authorization: 'Bearer ' + secretKey } })).json();
          email = cust && cust.email;
        }
        const found = email ? await findUserByEmail(email, { url: supabaseUrl, key: supabaseServiceKey }) : null;
        userId = found && found.id;
      }
      if (!userId) { console.log(`No TimingAX account for ${event.type} (${action.customerId || 'no customer'})`); }
      else {
        const ur = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, { headers: svc });
        const user = ur.ok ? await ur.json() : null;
        const current = user && user.app_metadata && user.app_metadata.subscription;
        if (!user) console.log(`Account ${userId} not found`);
        else if (action.status === 'free' && current === 'lifetime') console.log(`Kept lifetime for ${userId}`);
        else {
          await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
            method: 'PUT', headers: { ...svc, 'Content-Type': 'application/json' },
            body: JSON.stringify({ app_metadata: { subscription: action.status, stripe_customer: action.customerId || (user.app_metadata && user.app_metadata.stripe_customer) || null } }),
          });
          console.log(`Updated ${userId} -> ${action.status}`);
          // Referral reward: credit both accounts once, when a referred user first becomes paying.
          if (action.status === 'pro' || action.status === 'lifetime') {
            await processReferralReward(supabaseUrl, supabaseServiceKey, secretKey, userId, action.customerId);
          }
        }
      }
    } catch (e) {
      console.error('Account update error:', e.message);
    }
  }

  return res.status(200).json({ received: true });
}
