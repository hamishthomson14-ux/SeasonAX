// api/admin-actions.js
// Privileged admin operations for /admin.html — search users, grant/revoke Pro,
// resend password resets, delete accounts, export CSV.
//
// SECURITY MODEL (two gates):
//   Gate 1 — Identity: verifies the caller's Supabase session token and confirms
//            the resolved email matches ADMIN_EMAIL. Same as admin-stats.js.
//   Gate 2 — Action password: every STATE-CHANGING action (grant/revoke/delete/
//            reset) additionally requires the correct ADMIN_ACTION_PASSWORD in the
//            request body. Read-only actions (search, list, export) need only Gate 1.
//
// This means a phished/hijacked admin *session* alone cannot delete users or
// change subscriptions — the attacker would also need the separate action
// password, which is never stored in the browser.
//
// Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAIL,
//           ADMIN_ACTION_PASSWORD  (all in Vercel env vars)

import crypto from 'node:crypto';

const READONLY_ACTIONS = new Set(['search_users', 'list_users', 'export_users']);
const WRITE_ACTIONS = new Set(['grant_pro', 'revoke_pro', 'reset_password', 'delete_user']);

// Constant-time string comparison so the action password can't be timing-attacked.
function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (ba.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ba, bb); } catch (e) { return false; }
}

async function svcFetch(supabaseUrl, serviceKey, path, opts = {}) {
  return fetch(`${supabaseUrl}${path}`, {
    ...opts,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const adminEmail = process.env.ADMIN_EMAIL;
  const actionPassword = process.env.ADMIN_ACTION_PASSWORD;

  if (!supabaseUrl || !serviceKey || !adminEmail) {
    return res.status(500).json({ error: 'Admin not configured (missing env vars)' });
  }

  // ── GATE 1: verify caller is the admin ──────────────────────
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Missing session token' });

  let callerEmail;
  try {
    const meRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${token}` },
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

  const body = req.body || {};
  const action = String(body.action || '');

  if (!READONLY_ACTIONS.has(action) && !WRITE_ACTIONS.has(action)) {
    return res.status(400).json({ error: 'Unknown action' });
  }

  // ── GATE 2: write actions require the action password ───────
  if (WRITE_ACTIONS.has(action)) {
    if (!actionPassword) {
      return res.status(500).json({ error: 'ADMIN_ACTION_PASSWORD not configured' });
    }
    if (!safeEqual(body.actionPassword, actionPassword)) {
      return res.status(403).json({ error: 'Incorrect action password' });
    }
    // Never let the admin delete or downgrade their own account by mistake.
    if ((action === 'delete_user' || action === 'revoke_pro') &&
        String(body.email || '').toLowerCase() === adminEmail.toLowerCase()) {
      return res.status(400).json({ error: 'Refusing to modify the admin account itself' });
    }
  }

  try {
    // Helper: resolve a user object by email (exact match)
    async function findUserByEmail(email) {
      const r = await svcFetch(supabaseUrl, serviceKey,
        `/auth/v1/admin/users?email=${encodeURIComponent(email)}`);
      if (!r.ok) return null;
      const d = await r.json();
      const list = d.users || [];
      return list.find(u => (u.email || '').toLowerCase() === String(email).toLowerCase()) || list[0] || null;
    }

    // Fetch ALL users (paginated) — used by list/search/export
    async function fetchAllUsers() {
      let all = [];
      let page = 1;
      while (page <= 50) {
        const r = await svcFetch(supabaseUrl, serviceKey,
          `/auth/v1/admin/users?page=${page}&per_page=1000`);
        if (!r.ok) break;
        const d = await r.json();
        const users = d.users || [];
        all = all.concat(users);
        if (users.length < 1000) break;
        page++;
      }
      return all.map(u => ({
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
        subscription: (u.app_metadata && u.app_metadata.subscription) || 'free',
        email_confirmed: !!(u.email_confirmed_at || u.confirmed_at),
      }));
    }

    // ── READ-ONLY ────────────────────────────────────────────
    if (action === 'list_users' || action === 'export_users') {
      const users = await fetchAllUsers();
      users.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      if (action === 'export_users') {
        const header = 'email,subscription,created_at,last_sign_in_at,email_confirmed\n';
        const csv = header + users.map(u =>
          [u.email, u.subscription, u.created_at, u.last_sign_in_at || '', u.email_confirmed]
            .map(v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`).join(',')
        ).join('\n');
        return res.status(200).json({ csv });
      }
      return res.status(200).json({ users, total: users.length });
    }

    if (action === 'search_users') {
      const q = String(body.query || '').toLowerCase().trim();
      const users = await fetchAllUsers();
      const filtered = q
        ? users.filter(u => (u.email || '').toLowerCase().includes(q))
        : users;
      filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return res.status(200).json({ users: filtered.slice(0, 200), total: filtered.length });
    }

    // ── WRITE ACTIONS (past Gate 2) ──────────────────────────
    const targetEmail = String(body.email || '').trim();
    if (!targetEmail) return res.status(400).json({ error: 'Missing target email' });

    const user = await findUserByEmail(targetEmail);
    if (!user) return res.status(404).json({ error: 'User not found: ' + targetEmail });

    if (action === 'grant_pro' || action === 'revoke_pro') {
      const newSub = action === 'grant_pro' ? 'pro' : 'free';
      const existingMeta = user.app_metadata || {};
      const r = await svcFetch(supabaseUrl, serviceKey,
        `/auth/v1/admin/users/${user.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            app_metadata: { ...existingMeta, subscription: newSub },
          }),
        });
      if (!r.ok) throw new Error('Update failed: ' + (await r.text()));
      return res.status(200).json({ ok: true, email: targetEmail, subscription: newSub });
    }

    if (action === 'reset_password') {
      // Ask Supabase to email a recovery link to the user.
      const r = await svcFetch(supabaseUrl, serviceKey, `/auth/v1/recover`, {
        method: 'POST',
        body: JSON.stringify({ email: targetEmail }),
      });
      if (!r.ok) throw new Error('Reset failed: ' + (await r.text()));
      return res.status(200).json({ ok: true, email: targetEmail, message: 'Reset email sent' });
    }

    if (action === 'delete_user') {
      const r = await svcFetch(supabaseUrl, serviceKey,
        `/auth/v1/admin/users/${user.id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('Delete failed: ' + (await r.text()));
      return res.status(200).json({ ok: true, email: targetEmail, deleted: true });
    }

    return res.status(400).json({ error: 'Unhandled action' });
  } catch (err) {
    console.error('admin-actions error:', err);
    return res.status(500).json({ error: err.message || 'Action failed' });
  }
}
