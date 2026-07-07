// api/stripe-webhook.js
// Handles Stripe webhook events — marks users as Pro in Supabase
// Requires STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY in Vercel environment variables

import crypto from 'node:crypto';

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

  // ── Handle subscription/payment success ──────────────
  if (
    event.type === 'checkout.session.completed' ||
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated' ||
    event.type === 'invoice.payment_succeeded'
  ) {
    const obj = event.data.object;
    const customerEmail = obj.customer_email || (obj.customer_details && obj.customer_details.email);
    const mode = obj.mode; // 'subscription' or 'payment' (only present on checkout.session)
    const status = mode === 'payment' ? 'lifetime' : 'pro';

    if (customerEmail) {
      try {
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (supabaseUrl && supabaseServiceKey) {
          const userRes = await fetch(
            `${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(customerEmail)}`,
            {
              headers: {
                apikey: supabaseServiceKey,
                Authorization: `Bearer ${supabaseServiceKey}`,
              },
            }
          );
          const userData = await userRes.json();

          if (userData.users && userData.users.length > 0) {
            const userId = userData.users[0].id;
            await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
              method: 'PUT',
              headers: {
                apikey: supabaseServiceKey,
                Authorization: `Bearer ${supabaseServiceKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                app_metadata: { subscription: status, stripe_customer: obj.customer },
              }),
            });
            console.log(`Updated ${customerEmail} -> ${status}`);

            // Referral reward: if this user was referred and this is their
            // first time becoming Pro/Lifetime, credit both accounts.
            if (status === 'pro' || status === 'lifetime') {
              await processReferralReward(supabaseUrl, supabaseServiceKey, secretKey, userId, obj.customer);
            }
          } else {
            console.log(`No Supabase user found for ${customerEmail}`);
          }
        }
      } catch (e) {
        console.error('Supabase update error:', e.message);
      }
    }
  }

  // ── Handle cancellations ──────────────────────────────
  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    console.log('Subscription cancelled:', sub.id);
    try {
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (secretKey && supabaseUrl && supabaseServiceKey && sub.customer) {
        // Resolve the customer's email via Stripe, then downgrade that user.
        const custRes = await fetch('https://api.stripe.com/v1/customers/' + sub.customer, {
          headers: { Authorization: 'Bearer ' + secretKey },
        });
        const cust = await custRes.json();
        const email = cust && cust.email;
        if (email) {
          const userRes = await fetch(
            supabaseUrl + '/auth/v1/admin/users?email=' + encodeURIComponent(email),
            { headers: { apikey: supabaseServiceKey, Authorization: 'Bearer ' + supabaseServiceKey } }
          );
          const userData = await userRes.json();
          if (userData.users && userData.users.length > 0) {
            const u = userData.users[0];
            const current = u.app_metadata && u.app_metadata.subscription;
            if (current !== 'lifetime') {
              await fetch(supabaseUrl + '/auth/v1/admin/users/' + u.id, {
                method: 'PUT',
                headers: {
                  apikey: supabaseServiceKey,
                  Authorization: 'Bearer ' + supabaseServiceKey,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  app_metadata: { subscription: 'free', stripe_customer: sub.customer },
                }),
              });
              console.log('Downgraded ' + email + ' -> free');
            }
          }
        }
      }
    } catch (e) {
      console.error('Downgrade error:', e.message);
    }
  }

  return res.status(200).json({ received: true });
}
