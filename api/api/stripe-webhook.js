// api/stripe-webhook.js
// Handles Stripe webhook events — marks users as Pro in Supabase
// Requires STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in Vercel env vars

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) return res.status(500).end();

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  // Verify webhook signature using Web Crypto (Vercel Edge compatible)
  try {
    const [header, payload] = [
      sig.split(',').find(s => s.startsWith('t=')).slice(2),
      rawBody
    ];
    const signedPayload = `${header}.${payload}`;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(webhookSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const expectedSig = sig.split(',').find(s => s.startsWith('v1=')).slice(3);
    const sigBytes = Buffer.from(expectedSig, 'hex');
    const computedSig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
    const match = Buffer.from(computedSig).equals(sigBytes);
    if (!match) return res.status(400).json({ error: 'Invalid signature' });
  } catch (e) {
    console.error('Webhook signature error:', e);
    return res.status(400).json({ error: 'Signature verification failed' });
  }

  const event = JSON.parse(rawBody);
  console.log('Stripe event:', event.type);

  // Handle relevant events
  if (
    event.type === 'checkout.session.completed' ||
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated' ||
    event.type === 'invoice.payment_succeeded'
  ) {
    const session = event.data.object;
    const customerEmail = session.customer_email || session.customer_details?.email;
    const mode = session.mode; // 'subscription' or 'payment'
    const status = mode === 'payment' ? 'lifetime' : 'pro';

    if (customerEmail) {
      try {
        // Update Supabase user metadata via Admin API
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (supabaseUrl && supabaseServiceKey) {
          // Find user by email and update their metadata
          const userRes = await fetch(`${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(customerEmail)}`, {
            headers: {
              'apikey': supabaseServiceKey,
              'Authorization': `Bearer ${supabaseServiceKey}`,
            }
          });
          const userData = await userRes.json();
          if (userData.users && userData.users.length > 0) {
            const userId = userData.users[0].id;
            await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
              method: 'PUT',
              headers: {
                'apikey': supabaseServiceKey,
                'Authorization': `Bearer ${supabaseServiceKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                user_metadata: { subscription: status, stripe_customer: session.customer }
              }),
            });
            console.log(`Updated ${customerEmail} to ${status}`);
          }
        }
      } catch (e) {
        console.error('Supabase update error:', e);
      }
    }
  }

  // Handle cancellations
  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    const customerEmail = sub.customer_email;
    if (customerEmail) {
      console.log(`Subscription cancelled for ${customerEmail}`);
      // Optionally downgrade to free tier here
    }
  }

  return res.status(200).json({ received: true });
}
