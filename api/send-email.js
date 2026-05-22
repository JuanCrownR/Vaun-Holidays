// Vaun Holidays — Supplier Email API
// POST /api/send-email
//
// Required env vars (set in Vercel dashboard → Settings → Environment Variables):
//   RESEND_API_KEY   — from https://resend.com/api-keys
//   FROM_EMAIL       — e.g. jobs@vaunholidays.com.au
//                      (use "onboarding@resend.dev" until your domain is verified)
//   FROM_NAME        — e.g. Vaun Holidays  (defaults to "Vaun Holidays")

const { Resend } = require('resend');

module.exports = async function handler(req, res) {
  // Only accept POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { to, subject, html } = req.body || {};

  // Basic validation
  if (!to || !subject || !html) {
    return res.status(400).json({ error: 'Missing required fields: to, subject, html' });
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
