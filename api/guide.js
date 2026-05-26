// Vaun Holidays — Guest Guide Public API
// GET /api/guide?id=property_id
//
// Required env vars (set in Vercel dashboard → Settings → Environment Variables):
//   SUPABASE_URL              — from Supabase project settings
//   SUPABASE_SERVICE_ROLE_KEY — from Supabase project settings → API → service_role key

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).send('Method not allowed');
  }

  const { id } = req.query;
  if (!id) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(400).send(errorPage('No property ID provided.'));
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(errorPage('Server configuration error.'));
  }

  try {
    const resp = await fetch(
      `${supabaseUrl}/rest/v1/properties?id=eq.${encodeURIComponent(id)}&select=id,name,address,color,guest_guide&limit=1`,
      {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!resp.ok) {
      console.error('Supabase error:', resp.status, await resp.text());
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(500).send(errorPage('Failed to load guide data.'));
    }

    const rows = await resp.json();
    const prop = rows && rows[0];

    if (!prop) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(404).send(errorPage('This guide does not exist.'));
    }

    const guide = prop.guest_guide || {};

    if (guide.published !== true) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(404).send(errorPage('This guide is not yet available.'));
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).send(buildGuideHTML(prop, guide));
  } catch (err) {
    console.error('Guide handler error:', err);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(errorPage('An unexpected error occurred.'));
  }
};

// ─── HTML helpers ────────────────────────────────────────────────────────────

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function nl2br(str) {
  return esc(str).replace(/\n/g, '<br>');
}

function buildGuideHTML(prop, guide) {
  const color = prop.color || '#1a1a1a';
  const s = guide.sections || {};

  const SECTIONS = [
    { key: 'welcome',        icon: '👋', title: 'Welcome' },
    { key: 'key_collection', icon: '🗝️', title: 'Key Collection & Check-in' },
    { key: 'getting_there',  icon: '📍', title: 'Getting There' },
    { key: 'car_parking',    icon: '🅿️', title: 'Car Parking' },
    { key: 'house_manual',   icon: '🏠', title: 'House Manual & Facilities' },
    { key: 'checkout',       icon: '🚪', title: 'Check-out' },
    { key: 'contacts',       icon: '📞', title: 'Contact Details' },
    { key: 'poi',            icon: '🗺️', title: 'Points of Interest' },
    { key: 'emergency',      icon: '🚨', title: 'Emergency Information' },
    { key: 'faqs',           icon: '❓', title: 'FAQs' },
    { key: 'report_issue',   icon: '⚠️', title: 'Report an Issue' },
  ];

  let body = '';

  for (const sec of SECTIONS) {
    const d = s[sec.key];
    if (!d || d.enabled === false) continue;

    let inner = '';

    if (sec.key === 'welcome' || sec.key === 'getting_there' || sec.key === 'car_parking' || sec.key === 'house_manual' || sec.key === 'emergency') {
      if (!d.content) continue;
      inner = `<p>${nl2br(d.content)}</p>`;
      if (sec.key === 'getting_there' && prop.address) {
        inner += `<a href="https://maps.google.com/?q=${encodeURIComponent(prop.address)}" target="_blank" class="map-btn">📍 Get Directions</a>`;
      }
    } else if (sec.key === 'key_collection') {
      if (!d.content && !d.code) continue;
      inner = d.content ? `<p>${nl2br(d.content)}</p>` : '';
      if (d.code) inner += `<div class="code-box">🔑 Access Code: <strong>${esc(d.code)}</strong></div>`;
    } else if (sec.key === 'checkout') {
      inner = d.content ? `<p>${nl2br(d.content)}</p>` : '';
      if (guide.checkout_time) inner = `<div class="time-badge">Check-out by ${esc(guide.checkout_time)}</div>` + inner;
      if (!inner) continue;
    } else if (sec.key === 'contacts') {
      const items = d.items || [];
      if (!items.length) continue;
      inner = items.map(c => `
        <div class="contact-card">
          <div class="contact-name">${esc(c.name)}</div>
          ${c.role ? `<div class="contact-role">${esc(c.role)}</div>` : ''}
          <div class="contact-links">
            ${c.phone ? `<a href="tel:${esc(c.phone.replace(/\s/g, ''))}" class="contact-link">📱 ${esc(c.phone)}</a>` : ''}
            ${c.email ? `<a href="mailto:${esc(c.email)}" class="contact-link">✉️ ${esc(c.email)}</a>` : ''}
          </div>
        </div>`).join('');
    } else if (sec.key === 'poi') {
      const items = d.items || [];
      if (!items.length) continue;
      inner = items.map(p => `
        <div class="poi-item">
          <div class="poi-name">${esc(p.name)}</div>
          ${p.distance ? `<div class="poi-dist">${esc(p.distance)}</div>` : ''}
          ${p.description ? `<div class="poi-desc">${esc(p.description)}</div>` : ''}
        </div>`).join('');
    } else if (sec.key === 'faqs') {
      const items = d.items || [];
      if (!items.length) continue;
      inner = items.map(f => `
        <details class="faq-item">
          <summary>${esc(f.question)}</summary>
          <div class="faq-answer">${nl2br(f.answer)}</div>
        </details>`).join('');
    } else if (sec.key === 'report_issue') {
      if (!d.email && !d.phone) continue;
      inner = `<p style="color:#64748b;font-size:14px;margin-bottom:12px;">Need to report a problem? Contact us directly:</p>
        <div style="display:flex;flex-direction:column;gap:10px;">
          ${d.phone ? `<a href="tel:${esc(d.phone.replace(/\s/g, ''))}" class="report-btn">📱 Call ${esc(d.phone)}</a>` : ''}
          ${d.email ? `<a href="mailto:${esc(d.email)}" class="report-btn report-btn-email">✉️ Email Us</a>` : ''}
        </div>`;
    }

    body += `
      <div class="section-card">
        <div class="section-header">
          <span class="section-icon">${sec.icon}</span>
          <span class="section-title">${sec.title}</span>
        </div>
        <div class="section-body">${inner}</div>
      </div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Guest Guide — ${esc(prop.name)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f0f4f8;color:#1a1a2e;line-height:1.6}
.header{background:${color};padding:28px 20px 24px;color:white}
.header-name{font-size:26px;font-weight:700;line-height:1.2;margin-bottom:4px}
.header-addr{font-size:13px;opacity:0.85;margin-bottom:12px}
.times{display:flex;gap:10px;flex-wrap:wrap}
.time-chip{background:rgba(255,255,255,0.2);border-radius:999px;padding:5px 14px;font-size:13px;font-weight:500}
main{max-width:640px;margin:0 auto;padding:16px 14px 48px}
.section-card{background:white;border-radius:14px;margin-bottom:14px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.07)}
.section-header{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid #f1f5f9}
.section-icon{font-size:20px;flex-shrink:0}
.section-title{font-size:16px;font-weight:700;color:#0f172a}
.section-body{padding:14px 16px}
.section-body p{font-size:14px;color:#334155;line-height:1.7}
.code-box{background:#f0fdf4;border:1.5px solid #86efac;border-radius:10px;padding:12px 16px;margin-top:10px;font-size:16px;color:#166534;text-align:center;letter-spacing:.05em}
.code-box strong{font-size:22px;display:block;margin-top:2px}
.time-badge{background:#e0f2fe;color:#0369a1;border-radius:8px;padding:8px 14px;font-size:15px;font-weight:600;margin-bottom:10px;display:inline-block}
.map-btn{display:inline-block;margin-top:12px;background:${color};color:white;border-radius:10px;padding:10px 18px;font-size:14px;font-weight:600;text-decoration:none}
.contact-card{padding:12px 0;border-bottom:1px solid #f1f5f9}
.contact-card:last-child{border-bottom:none;padding-bottom:0}
.contact-name{font-size:15px;font-weight:600;color:#0f172a;margin-bottom:2px}
.contact-role{font-size:12px;color:#94a3b8;margin-bottom:8px}
.contact-links{display:flex;flex-direction:column;gap:8px}
.contact-link{display:inline-flex;align-items:center;gap:8px;padding:9px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:9px;font-size:13px;color:#334155;text-decoration:none;font-weight:500}
.contact-link:hover{background:#f1f5f9}
.poi-item{padding:10px 0;border-bottom:1px solid #f1f5f9}
.poi-item:last-child{border-bottom:none}
.poi-name{font-size:14px;font-weight:600;color:#0f172a}
.poi-dist{font-size:12px;color:#94a3b8;margin:2px 0}
.poi-desc{font-size:13px;color:#334155;margin-top:4px}
details.faq-item{border-bottom:1px solid #f1f5f9;padding:2px 0}
details.faq-item:last-child{border-bottom:none}
summary{padding:10px 4px;font-size:14px;font-weight:600;color:#0f172a;cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center}
summary::after{content:'＋';color:#94a3b8;font-size:16px}
details[open] summary::after{content:'－'}
.faq-answer{padding:6px 4px 12px;font-size:13px;color:#334155;line-height:1.6}
.report-btn{display:block;text-align:center;padding:13px 20px;border-radius:12px;font-size:15px;font-weight:600;text-decoration:none;background:${color};color:white}
.report-btn-email{background:#f8fafc;color:#334155;border:1.5px solid #e2e8f0}
footer{text-align:center;padding:20px;font-size:11px;color:#94a3b8}
</style>
</head>
<body>
<div class="header">
  <div class="header-name">${esc(prop.name)}</div>
  ${prop.address ? `<div class="header-addr">📍 ${esc(prop.address)}</div>` : ''}
  <div class="times">
    ${guide.checkin_time ? `<span class="time-chip">✅ Check-in from ${esc(guide.checkin_time)}</span>` : ''}
    ${guide.checkout_time ? `<span class="time-chip">🚪 Check-out by ${esc(guide.checkout_time)}</span>` : ''}
  </div>
</div>
<main>
${body}
</main>
<footer>Powered by Vaun Holidays</footer>
</body>
</html>`;
}

function errorPage(msg) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not Found</title><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f0f4f8;color:#334155;}</style></head><body><div style="text-align:center;padding:20px;"><div style="font-size:48px;margin-bottom:16px;">🏠</div><h2 style="margin-bottom:8px;">Guide not available</h2><p style="color:#64748b;">${msg}</p></div></body></html>`;
}
