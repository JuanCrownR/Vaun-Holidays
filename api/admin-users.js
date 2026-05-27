// Vaun Holidays — Admin Users API
// POST/GET /api/admin-users
//
// Required env vars (set in Vercel dashboard → Settings → Environment Variables):
//   SUPABASE_URL              — e.g. https://xgdvmanykllnaxtbygny.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY — from Supabase dashboard → Settings → API → service_role key
//                               NEVER expose this key in client-side code
//
// Actions:
//   GET                           → list all users
//   POST { action: 'invite',        email, role }      → invite user by email
//   POST { action: 'delete',        userId }           → delete user
//   POST { action: 'changePassword', userId, password } → change password
//   POST { action: 'changeRole',    userId, role }     → update user role metadata

const { createClient } = require('@supabase/supabase-js');

// Allowed roles
const VALID_ROLES = ['admin', 'manager', 'cleaner', 'staff'];

// Allowed client origins. JWT auth still gates everything, but tightening
// CORS removes the broad `*` and makes drive-by abuse attempts (e.g. from
// a malicious site that managed to extract a user's JWT) noisier.
const ALLOWED_ORIGINS = new Set([
  'https://vaun-holidays.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173',
]);

function corsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
}

module.exports = async function handler(req, res) {
  corsHeaders(req, res);

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only GET and POST
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify env vars exist
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({
      error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables. Add them in your Vercel project settings.'
    });
  }

  // Verify caller is authenticated and has admin role
  const authHeader = req.headers.authorization || '';
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!jwt) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  // Use a regular (anon) client to verify the caller's JWT
  const supabaseAnon = createClient(supabaseUrl, serviceRoleKey);
  const { data: { user: caller }, error: authError } = await supabaseAnon.auth.getUser(jwt);

  if (authError || !caller) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const callerRole = caller.user_metadata?.role || 'staff';
  if (callerRole !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  // Admin client — has full auth.admin.* powers
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // --- GET: list users ---
  if (req.method === 'GET') {
    try {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
      if (error) throw error;

      // Return a sanitised list (no tokens, just useful fields)
      const users = (data.users || []).map(u => ({
        id: u.id,
        email: u.email,
        role: u.user_metadata?.role || 'staff',
        name: u.user_metadata?.full_name || u.user_metadata?.name || '',
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
        confirmed_at: u.confirmed_at,
        invited_at: u.invited_at,
      }));

      return res.status(200).json({ users });
    } catch (err) {
      console.error('listUsers error:', err);
      return res.status(500).json({ error: err.message || 'Failed to list users' });
    }
  }

  // --- POST: actions ---
  const { action, email, userId, password, role } = req.body || {};

  if (!action) {
    return res.status(400).json({ error: 'Missing action field' });
  }

  // Invite user
  if (action === 'invite') {
    if (!email) return res.status(400).json({ error: 'Missing email' });
    const inviteRole = VALID_ROLES.includes(role) ? role : 'staff';

    try {
      const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        data: { role: inviteRole }
      });
      if (error) throw error;
      return res.status(200).json({ success: true, user: { id: data.user?.id, email: data.user?.email } });
    } catch (err) {
      console.error('invite error:', err);
      return res.status(400).json({ error: err.message || 'Failed to invite user' });
    }
  }

  // Delete user
  if (action === 'delete') {
    if (!userId) return res.status(400).json({ error: 'Missing userId' });
    // Prevent self-deletion
    if (userId === caller.id) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }

    try {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (error) throw error;
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('delete error:', err);
      return res.status(400).json({ error: err.message || 'Failed to delete user' });
    }
  }

  // Change password
  if (action === 'changePassword') {
    if (!userId) return res.status(400).json({ error: 'Missing userId' });
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    try {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { password });
      if (error) throw error;
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('changePassword error:', err);
      return res.status(400).json({ error: err.message || 'Failed to change password' });
    }
  }

  // Change role
  if (action === 'changeRole') {
    if (!userId) return res.status(400).json({ error: 'Missing userId' });
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` });
    }
    // Prevent demoting yourself
    if (userId === caller.id && role !== 'admin') {
      return res.status(400).json({ error: 'You cannot change your own role' });
    }

    try {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        user_metadata: { role }
      });
      if (error) throw error;
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('changeRole error:', err);
      return res.status(400).json({ error: err.message || 'Failed to change role' });
    }
  }

  return res.status(400).json({ error: `Unknown action: ${action}` });
};
