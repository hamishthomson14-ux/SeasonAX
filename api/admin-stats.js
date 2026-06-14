// api/admin-stats.js
// Returns an overview of users, subscriptions, referrals, alerts, contact
// messages, and newsletter signups — for the /admin.html dashboard.
//
// SECURITY: this endpoint verifies the caller's Supabase session token,
// looks up the corresponding user's email, and only proceeds if that email
// matches the ADMIN_EMAIL environment variable. Everything else returns 403.
//
// Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAIL in Vercel
// environment variables.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const adminEmail = process.env.ADMIN_EMAIL;

  if (!supabaseUrl || !supabaseServiceKey || !adminEmail) {
    return res.status(500).json({ error: 'Admin dashboard not configured (missing env vars)' });
  }

  // ── Verify the caller is the admin ──────────────────────────
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Missing session token' });

  let callerEmail;
  try {
    const meRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: supabaseServiceKey, Authorization: `Bearer ${token}` },
    });
    if (!meRes.ok) return res.status(401).json({ error: 'Invalid session' });
    const me = await meRes.json();
    callerEmail = (me.email || '').toLowerCase();
  } catch (e) {
    return res.status(401).json({ error: 'Could not verify session' });
  }

  if (callerEmail !== adminEmail.toLowerCase()) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  // ── Gather data using the service role key ──────────────────
  const svcHeaders = { apikey: supabaseServiceKey, Authorization: `Bearer ${supabaseServiceKey}` };

  try {
    // All auth users (paginated)
    let allUsers = [];
    let page = 1;
    while (true) {
      const r = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=1000`, { headers: svcHeaders });
      if (!r.ok) break;
      const data = await r.json();
      const users = data.users || [];
      allUsers = allUsers.concat(users);
      if (users.length < 1000) break;
      page++;
      if (page > 20) break; // safety cap (20,000 users)
    }

    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    let free = 0, pro = 0, lifetime = 0, last7 = 0, last30 = 0;

    for (const u of allUsers) {
      const sub = (u.user_metadata && u.user_metadata.subscription) || 'free';
      if (sub === 'lifetime') lifetime++;
      else if (sub === 'pro') pro++;
      else free++;

      const created = new Date(u.created_at).getTime();
      if (now - created < 7 * day) last7++;
      if (now - created < 30 * day) last30++;
    }

    const recentSignups = allUsers
      .slice()
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 15)
      .map(u => ({
        email: u.email,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
        subscription: (u.user_metadata && u.user_metadata.subscription) || 'free',
      }));

    // Helper: fetch recent rows + exact count from a table
    async function fetchTable(table, orderCol = 'created_at', limit = 10) {
      const r = await fetch(
        `${supabaseUrl}/rest/v1/${table}?select=*&order=${orderCol}.desc&limit=${limit}`,
        { headers: { ...svcHeaders, Prefer: 'count=exact' } }
      );
      if (!r.ok) return { rows: [], count: 0 };
      const rows = await r.json();
      const range = r.headers.get('content-range'); // e.g. "0-9/42"
      const count = range && range.includes('/') ? parseInt(range.split('/')[1], 10) || 0 : rows.length;
      return { rows, count };
    }

    const [referrals, alerts, contacts, emailSubs, newsletterSubs] = await Promise.all([
      fetchTable('referrals', 'created_at', 1000),
      fetchTable('seasonal_alerts', 'created_at', 1),
      fetchTable('contact_messages', 'created_at', 10),
      fetchTable('email_subscribers', 'created_at', 1),
      fetchTable('newsletter_subscribers', 'created_at', 1),
    ]);

    const referralStats = {
      total: referrals.rows.length,
      pending: referrals.rows.filter(r => r.status === 'pending').length,
      rewarded: referrals.rows.filter(r => r.status === 'rewarded').length,
    };

    const PRO_MONTHLY_GBP = 19.99;
    const estimatedMRR = Math.round(pro * PRO_MONTHLY_GBP * 100) / 100;

    return res.status(200).json({
      users: {
        total: allUsers.length,
        free, pro, lifetime,
        signups_last_7d: last7,
        signups_last_30d: last30,
        recent: recentSignups,
      },
      revenue: {
        estimated_mrr_gbp: estimatedMRR,
        pro_subscribers: pro,
        lifetime_customers: lifetime,
      },
      referrals: referralStats,
      seasonal_alerts: { total: alerts.count },
      contact: { total: contacts.count, recent: contacts.rows },
      subscribers: {
        email_subscribers: emailSubs.count,
        newsletter_subscribers: newsletterSubs.count,
      },
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    return res.status(500).json({ error: err.message || 'Failed to load admin stats' });
  }
}
