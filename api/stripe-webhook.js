// api/stripe-webhook.js
// Handles Stripe webhook events — marks users as Pro in Supabase
// Requires STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY in Vercel environment variables

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
  const crypto = require('crypto');

  if (!sigHeader) throw new Error('Missing stripe-signature header');

  const parts = sigHeader.split(',').reduce((acc, part) => {
    const [k, v] = part.split('=');
    if (k === 't') acc.timestamp = v;
    if (k === 'v1') { acc.signatures = acc.signatures || []; acc.signatures.push(v); }
    return acc;
  }, {});

  if (!parts.timestamp || !parts.signatures) {
    throw new Error('Malformed stripe-signature header: ' + sigHeader);
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
    throw new Error('Signature mismatch. Expected one of: ' + JSON.stringify(parts.signatures) + ' computed: ' + expectedSig);
  }

  return true;
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
    // Return the error message so it's visible in Stripe's webhook log for debugging
    return res.status(400).json({ error: 'Signature verification failed: ' + e.message });
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
                user_metadata: { subscription: status, stripe_customer: obj.customer },
              }),
            });
            console.log(`Updated ${customerEmail} -> ${status}`);
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
    // Optional: downgrade user to free here via customer ID lookup
  }

  return res.status(200).json({ received: true });
}
