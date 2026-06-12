// api/create-portal-session.js
// Creates a Stripe Customer Portal session so users can manage
// their subscription (cancel, update card, view invoices).
// Requires STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!secretKey) return res.status(500).json({ error: 'Stripe not configured' });
  if (!supabaseUrl || !supabaseServiceKey) return res.status(500).json({ error: 'Supabase not configured' });

  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });

  const origin = req.headers.origin || 'https://season-ax.vercel.app';

  try {
    // Look up the user's stripe_customer ID from Supabase metadata
    const userRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
      headers: {
        apikey: supabaseServiceKey,
        Authorization: `Bearer ${supabaseServiceKey}`,
      },
    });
    const userData = await userRes.json();
    const customerId = userData.user_metadata && userData.user_metadata.stripe_customer;

    if (!customerId) {
      return res.status(404).json({ error: 'No Stripe customer found for this account. If you just subscribed, please wait a moment and try again, or contact support.' });
    }

    // Create the portal session
    const body = new URLSearchParams({
      customer: customerId,
      return_url: `${origin}/dashboard.html`,
    });

    const response = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    const session = await response.json();
    if (session.error) throw new Error(session.error.message);

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Portal session error:', err);
    return res.status(500).json({ error: err.message || 'Failed to create portal session' });
  }
}
