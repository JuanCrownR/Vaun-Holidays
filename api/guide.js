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
  // Escape HTML, then auto-link https:// URLs, then convert newlines to <br>
  const escaped = esc(str);
  const linked = escaped.replace(
    /(https?:\/\/[^\s<>"]+)/g,
    '<a href="$1" target="_blank" rel="noopener" style="color:var(--brand);font-weight:500;text-decoration:underline;word-break:break-all;">📍 Open in Maps</a>'
  );
  return linked.replace(/\n/g, '<br>');
}

function buildGuideHTML(prop, guide) {
  const color = prop.color || '#2192A3';
  const s = guide.sections || {};

  const SECTIONS = [
    { key: 'welcome',        icon: '👋', title: 'Welcome',                   label: 'Welcome' },
    { key: 'key_collection', icon: '🔑', title: 'Key Collection & Check-in', label: 'Check-In' },
    { key: 'wifi',           icon: '📶', title: 'WiFi Details',              label: 'WiFi' },
    { key: 'getting_there',  icon: '📍', title: 'Getting There',             label: 'Directions' },
    { key: 'car_parking',    icon: '🅿️', title: 'Car Parking',              label: 'Parking' },
    { key: 'house_manual',   icon: '🏠', title: 'House Manual',              label: 'Manual' },
    { key: 'checkout',       icon: '🚪', title: 'Check-out',                 label: 'Check-Out' },
    { key: 'contacts',       icon: '📞', title: 'Contact Details',           label: 'Contact' },
    { key: 'poi',            icon: '🗺️', title: 'Points of Interest',        label: 'Explore' },
    { key: 'emergency',      icon: '🚨', title: 'Emergency Info',            label: 'Emergency' },
    { key: 'faqs',           icon: '❓', title: 'FAQs',                      label: 'FAQs' },
    { key: 'report_issue',   icon: '⚠️', title: 'Report an Issue',           label: 'Report' },
  ];

  // Quick-jump nav: all enabled sections
  const enabledSections = SECTIONS.filter(sec => {
    const d = s[sec.key];
    return d && d.enabled !== false;
  });

  const quickNav = enabledSections.length > 1 ? `
<nav class="quick-nav">
  ${enabledSections.map(sec => `<a href="#section-${sec.key}" class="quick-item">
    <span class="quick-icon">${sec.icon}</span>
    <span class="quick-label">${sec.label}</span>
  </a>`).join('')}
</nav>` : '';

  // Section cards
  let body = '';

  for (const sec of SECTIONS) {
    const d = s[sec.key];
    if (!d || d.enabled === false) continue;

    let inner = '';

    if (sec.key === 'welcome' || sec.key === 'getting_there' || sec.key === 'car_parking' ||
        sec.key === 'house_manual' || sec.key === 'emergency') {
      if (!d.content) continue;
      inner = `<div class="prose">${nl2br(d.content)}</div>`;
      if (sec.key === 'getting_there' && prop.address) {
        inner += `<a href="https://maps.google.com/?q=${encodeURIComponent(prop.address)}" target="_blank" rel="noopener" class="map-btn">📍 Get Directions</a>`;
      }
    } else if (sec.key === 'key_collection') {
      if (!d.content && !d.code) continue;
      inner = d.content ? `<div class="prose">${nl2br(d.content)}</div>` : '';
      if (d.code) inner += `<div class="code-box"><div class="code-label">🔑 Access Code</div><div class="code-value">${esc(d.code)}</div></div>`;
    } else if (sec.key === 'wifi') {
      if (!d.network && !d.password) continue;
      inner = `<div class="wifi-box">
        ${d.network  ? `<div class="wifi-row"><span class="wifi-label">Network</span><span class="wifi-val">${esc(d.network)}</span></div>` : ''}
        ${d.password ? `<div class="wifi-row"><span class="wifi-label">Password</span><span class="wifi-pass">${esc(d.password)}</span></div>` : ''}
      </div>`;
      if (d.content) inner += `<div class="prose" style="margin-top:10px;">${nl2br(d.content)}</div>`;
    } else if (sec.key === 'checkout') {
      inner = d.content ? `<div class="prose">${nl2br(d.content)}</div>` : '';
      if (guide.checkout_time) inner = `<div class="time-badge">🚪 Check-out by ${esc(guide.checkout_time)}</div>` + inner;
      if (!inner) continue;
    } else if (sec.key === 'contacts') {
      const items = d.items || [];
      if (!items.length) continue;
      inner = `<div class="contact-list">${items.map(c => `
        <div class="contact-item">
          <div class="contact-name">${esc(c.name)}</div>
          ${c.role ? `<div class="contact-role">${esc(c.role)}</div>` : ''}
          <div class="contact-actions">
            ${c.phone ? `<a href="tel:${esc(c.phone.replace(/\s/g, ''))}" class="contact-btn primary">📱 ${esc(c.phone)}</a>` : ''}
            ${c.email ? `<a href="mailto:${esc(c.email)}" class="contact-btn">✉️ Email</a>` : ''}
          </div>
        </div>`).join('')}</div>`;
    } else if (sec.key === 'poi') {
      const items = d.items || [];
      if (!items.length) continue;
      inner = `<div class="poi-list">${items.map(p => `
        <div class="poi-item">
          <div class="poi-name-row">
            <span class="poi-name">${esc(p.name)}</span>
            ${p.maps_url ? `<a href="${esc(p.maps_url)}" target="_blank" rel="noopener" class="poi-map-btn">📍 Directions</a>` : ''}
          </div>
          ${p.distance ? `<div class="poi-dist">${esc(p.distance)} away</div>` : ''}
          ${p.description ? `<div class="poi-desc">${esc(p.description)}</div>` : ''}
        </div>`).join('')}</div>`;
    } else if (sec.key === 'faqs') {
      const items = d.items || [];
      if (!items.length) continue;
      inner = `<div class="faq-list">${items.map(f => `
        <details class="faq-item">
          <summary>${esc(f.question)}</summary>
          <div class="faq-answer">${nl2br(f.answer)}</div>
        </details>`).join('')}</div>`;
    } else if (sec.key === 'report_issue') {
      if (!d.email && !d.phone) continue;
      inner = `<p class="report-intro">Need to report a problem? Contact us directly:</p>
        <div class="report-btns">
          ${d.phone ? `<a href="tel:${esc(d.phone.replace(/\s/g, ''))}" class="report-btn report-btn-phone">📱 Call ${esc(d.phone)}</a>` : ''}
          ${d.email ? `<a href="mailto:${esc(d.email)}" class="report-btn report-btn-email">✉️ Email Us</a>` : ''}
        </div>`;
    }

    // Append section photos (sequential order)
    inner += photosHTML(d.photos);

    body += `
    <div class="section-card" id="section-${sec.key}">
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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--brand:${color}}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f0f4f8;color:#303336;line-height:1.6;-webkit-font-smoothing:antialiased}

/* ── Header ── */
.header{background:var(--brand);padding:24px 16px 22px;color:white}
.header-name{font-size:26px;font-weight:700;line-height:1.2;margin-bottom:5px}
.header-addr{font-size:13px;opacity:.85;margin-bottom:14px}
.times{display:flex;gap:8px;flex-wrap:wrap}
.time-chip{background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.35);border-radius:999px;padding:5px 14px;font-size:12px;font-weight:600;white-space:nowrap}

/* ── Quick-jump nav ── */
.quick-nav{background:white;border-bottom:1px solid #e9e9ea;padding:14px 16px;display:flex;gap:10px;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;position:sticky;top:0;z-index:10}
.quick-nav::-webkit-scrollbar{display:none}
.quick-item{display:flex;flex-direction:column;align-items:center;gap:5px;padding:10px 12px;border-radius:8px;background:white;box-shadow:0 3px 10px rgba(0,0,0,.10);text-decoration:none;color:#303336;min-width:58px;flex-shrink:0;transition:box-shadow .15s,transform .15s}
.quick-item:active{box-shadow:0 1px 4px rgba(0,0,0,.08);transform:scale(.97)}
.quick-icon{font-size:20px;line-height:1}
.quick-label{font-size:10px;font-weight:600;text-align:center;white-space:nowrap;color:#64748b}

/* ── Main ── */
main{max-width:640px;margin:0 auto;padding:16px 14px 64px}

/* ── Section cards ── */
.section-card{background:white;border-radius:8px;margin-bottom:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.07)}
.section-header{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid #e9e9ea}
.section-icon{font-size:20px;flex-shrink:0;line-height:1}
.section-title{font-size:16px;font-weight:700;color:#0f172a}
.section-body{padding:14px 16px;font-size:14px;color:#475569;line-height:1.75}
.prose{font-size:14px;color:#475569;line-height:1.75}

/* ── Access code ── */
.code-box{background:#f0fdf4;border:2px solid var(--brand);border-radius:8px;padding:18px 16px;margin-top:12px;text-align:center}
.code-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#64748b;margin-bottom:8px}
.code-value{font-size:28px;font-weight:700;letter-spacing:7px;color:#166534;line-height:1.2}

/* ── Time badge ── */
.time-badge{display:inline-flex;align-items:center;gap:6px;background:#e0f2fe;color:#0369a1;border-radius:6px;padding:7px 14px;font-size:14px;font-weight:600;margin-bottom:10px}

/* ── Map button ── */
.map-btn{display:inline-flex;align-items:center;gap:6px;margin-top:14px;background:var(--brand);color:white;border-radius:8px;padding:11px 18px;font-size:14px;font-weight:600;text-decoration:none}

/* ── Contacts ── */
.contact-item{padding:12px 0;border-bottom:1px solid #e9e9ea}
.contact-item:last-child{border-bottom:none;padding-bottom:0}
.contact-name{font-size:15px;font-weight:600;color:#0f172a;margin-bottom:2px}
.contact-role{font-size:12px;color:#94a3b8;margin-bottom:8px}
.contact-actions{display:flex;gap:8px}
.contact-btn{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:5px;padding:9px 10px;background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;color:#334155;text-decoration:none;font-weight:500;text-align:center}
.contact-btn.primary{background:var(--brand);color:white;border-color:var(--brand)}

/* ── Points of interest ── */
.poi-item{padding:11px 0;border-bottom:1px solid #e9e9ea}
.poi-item:last-child{border-bottom:none}
.poi-name-row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.poi-name{font-size:14px;font-weight:600;color:#0f172a}
.poi-map-btn{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:var(--brand);color:white;border-radius:6px;font-size:11px;font-weight:600;text-decoration:none;white-space:nowrap;flex-shrink:0}
.poi-dist{font-size:12px;color:#94a3b8;margin:3px 0}
.poi-desc{font-size:13px;color:#475569;margin-top:4px;line-height:1.6}

/* ── FAQs ── */
details.faq-item{border-bottom:1px solid #e9e9ea}
details.faq-item:last-child{border-bottom:none}
summary{padding:12px 4px;font-size:14px;font-weight:600;color:#0f172a;cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center;gap:8px}
summary::-webkit-details-marker{display:none}
summary::after{content:'+';color:#94a3b8;font-size:20px;font-weight:300;flex-shrink:0}
details[open] summary::after{content:'−'}
.faq-answer{padding:0 4px 12px;font-size:13px;color:#475569;line-height:1.65}

/* ── Report issue ── */
.report-intro{font-size:13px;color:#64748b;margin-bottom:12px}
.report-btns{display:flex;flex-direction:column;gap:10px}
.report-btn{display:block;text-align:center;padding:13px 20px;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none}
.report-btn-phone{background:var(--brand);color:white}
.report-btn-email{background:#f8fafc;color:#334155;border:1.5px solid #e2e8f0}

/* ── WiFi ── */
.wifi-box{background:#f0f9ff;border:2px solid var(--brand);border-radius:8px;padding:4px 16px;overflow:hidden}
.wifi-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 0;border-bottom:1px solid #e0f2fe}
.wifi-row:last-child{border-bottom:none}
.wifi-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#64748b;flex-shrink:0}
.wifi-val{font-size:15px;font-weight:600;color:#0f172a;text-align:right}
.wifi-pass{font-size:18px;font-weight:700;letter-spacing:3px;color:#0369a1;font-family:monospace;text-align:right}

/* ── Section photos ── */
.photo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid #e9e9ea}
.photo-grid a{display:block;aspect-ratio:1;overflow:hidden;border-radius:6px;background:#f8fafc}
.photo-grid img{width:100%;height:100%;object-fit:cover;display:block;transition:opacity .2s}
.photo-grid img:hover{opacity:.88}

/* ── Footer ── */
footer{text-align:center;padding:24px 16px;font-size:11px;color:#94a3b8}
</style>
</head>
<body>

<header class="header">
  <div class="header-name">${esc(prop.name)}</div>
  ${prop.address ? `<div class="header-addr">📍 ${esc(prop.address)}</div>` : ''}
  <div class="times">
    ${guide.checkin_time ? `<span class="time-chip">✅ Check-in from ${esc(guide.checkin_time)}</span>` : ''}
    ${guide.checkout_time ? `<span class="time-chip">🚪 Check-out by ${esc(guide.checkout_time)}</span>` : ''}
  </div>
</header>

${quickNav}

<main>
${body}
</main>

<footer>Powered by Vaun Holidays</footer>

</body>
</html>`;
}

function photosHTML(photos) {
  if (!photos || !photos.length) return '';
  const imgs = photos.filter(p =>
    p.url && ((p.type && p.type.startsWith('image/')) || /\.(jpe?g|png|gif|webp|heic)$/i.test(p.name || ''))
  );
  if (!imgs.length) return '';
  return `<div class="photo-grid">${
    imgs.map(p => `<a href="${esc(p.url)}" target="_blank" rel="noopener"><img src="${esc(p.url)}" alt="" loading="lazy"></a>`).join('')
  }</div>`;
}

function errorPage(msg) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not Found</title><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet"><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Inter',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f0f4f8;color:#334155;}</style></head><body><div style="text-align:center;padding:32px 20px;"><div style="font-size:52px;margin-bottom:20px;">🏠</div><h2 style="font-size:20px;font-weight:700;color:#0f172a;margin-bottom:8px;">Guide not available</h2><p style="font-size:14px;color:#64748b;">${msg}</p></div></body></html>`;
}
