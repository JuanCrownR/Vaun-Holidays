// Vaun Holidays — Supplier Email API
// POST /api/send-email
//
// SECURITY: requires a valid Supabase auth JWT in the Authorization header.
// Previously this endpoint was wide-open — anyone on the internet could POST
// arbitrary `to`/`subject`/`html` and send mail FROM your verified domain.
// That made it a free spam / phishing relay impersonating Vaun Holidays.
//
// Required env vars (set in Vercel dashboard → Settings → Environment Variables):
//   RESEND_API_KEY            — from https://resend.com/api-keys
//   FROM_EMAIL                — e.g. jobs@vaunholidays.com.au
//                               (use "onboarding@resend.dev" until your domain is verified)
//   FROM_NAME                 — e.g. Vaun Holidays  (defaults to "Vaun Holidays")
//   SUPABASE_URL              — for JWT verification
//   SUPABASE_SERVICE_ROLE_KEY — for JWT verification (server-side only, never client)

const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');

// Allowed origins for CORS. Same-origin requests don't need this at all, but
// it's defence-in-depth in case the endpoint is called from a dev build or
// a future companion app. Adjust if you add new client origins.
const ALLOWED_ORIGINS = new Set([
  'https://vaun-holidays.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173',
]);

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
}

module.exports = async function handler(req, res) {
  applyCors(req, res);

  // CORS preflight
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── AuthN: require a valid Supabase JWT ──────────────────────────────────
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const authHeader = req.headers.authorization || '';
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!jwt) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  const sb = createClient(supabaseUrl, serviceRoleKey);
  const { data: { user: caller }, error: authError } = await sb.auth.getUser(jwt);
  if (authError || !caller) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Any authenticated user can send a work-order email. Tighten to admin/manager
  // here if your workflow demands it (mirror admin-users.js callerRole check).

  // ── Payload validation ───────────────────────────────────────────────────
  const { to, subject, html } = req.body || {};
  if (!to || !subject || !html) {
    return res.status(400).json({ error: 'Missing required fields: to, subject, html' });
  }
  // Basic email format guard. Resend will reject malformed values anyway,
  // but failing fast here keeps us from spending the Resend quota on garbage.
  if (typeof to !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return res.status(400).json({ error: 'Invalid `to` email address' });
  }
  if (typeof subject !== 'string' || subject.length > 998) {
    return res.status(400).json({ error: 'Invalid subject' });
  }
  if (typeof html !== 'string' || html.length > 100_000) {
    return res.status(400).json({ error: 'Invalid html payload' });
  }

  if (!process.env.RESEND_API_KEY) {
    return res.status(500).json({
      error: 'RESEND_API_KEY environment variable is not set. Add it in your Vercel project settings.'
    });
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const fromEmail = process.env.FROM_EMAIL || 'onboarding@resend.dev';
  const fromName  = process.env.FROM_NAME  || 'Vaun Holidays';

  try {
    const { data, error } = await resend.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to:   [to],
      subject,
      html,
      // Helpful for audit trails. Resend doesn't enforce this; it's metadata.
      tags: [{ name: 'sender_user_id', value: caller.id }],
    });

    if (error) {
      console.error('Resend error:', error);
      return res.status(400).json({ error: error.message });
    }

    return res.status(200).json({ success: true, id: data?.id });
  } catch (err) {
    console.error('Send email exception:', err);
    return res.status(500).json({ error: err.message || 'Failed to send email' });
  }
};
