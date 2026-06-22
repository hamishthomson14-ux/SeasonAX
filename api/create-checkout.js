// api/create-checkout.js
// Creates a Stripe Checkout session and returns the URL
// Requires STRIPE_SECRET_KEY in Vercel environment variables

export default async function handler(req, res) {
  // CORS for same-origin requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return res.status(500).json({ error: 'Stripe not configured' });

  const { priceId, email, mode } = req.body;
  if (!priceId) return res.status(400).json({ error: 'Missing priceId' });

  const origin = req.headers.origin || 'https://timingax.co.uk';

  try {
    const body = new URLSearchParams({
      'payment_method_types[]': 'card',
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      'mode': mode === 'payment' ? 'payment' : 'subscription',
      'success_url': `${origin}/dashboard.html?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      'cancel_url': `${origin}/index.html#pricing`,
      'allow_promotion_codes': 'true',
    });

    // 7-day free trial on all subscriptions (Pro monthly & annual).
    // Card is collected up front; Stripe charges automatically when the
    // trial ends unless the user cancels. trial_settings ensures the sub
    // is cancelled (not charged) if no valid card is on file at trial end.
    if (mode !== 'payment') {
      body.append('subscription_data[trial_period_days]', '7');
      body.append('subscription_data[trial_settings][end_behavior][missing_payment_method]', 'cancel');
    }

    if (email) body.append('customer_email', email);

    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    const session = await response.json();
    if (session.error) throw new Error(session.error.message);

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err);
    return res.status(500).json({ error: err.message || 'Checkout failed' });
  }
}
