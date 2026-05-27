// Vaun Holidays — Guest Guide Public API
// GET /api/guide?id=property_id

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Method not allowed');

  const { id } = req.query;
  if (!id) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(400).send(errorPage('No property ID provided.'));
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(errorPage('Server configuration error.'));
  }

  try {
    const resp = await fetch(
      `${supabaseUrl}/rest/v1/properties?id=eq.${encodeURIComponent(id)}&select=id,name,address,color,guest_guide&limit=1`,
      { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' } }
    );
    if (!resp.ok) {
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function nl2br(str) {
  const e = esc(str);
  const linked = e.replace(/(https?:\/\/[^\s<>"]+)/g,
    '<a href="$1" target="_blank" rel="noopener" style="color:var(--brand);font-weight:500;text-decoration:underline;word-break:break-all;">📍 Open in Maps</a>');
  return linked.replace(/\n/g,'<br>');
}

function photosHTML(photos) {
  if (!photos || !photos.length) return '';
  const imgs = photos.filter(p => p.url &&
    ((p.type && p.type.startsWith('image/')) || /\.(jpe?g|png|gif|webp|heic)$/i.test(p.name||'')));
  if (!imgs.length) return '';
  return `<div class="photo-grid">${imgs.map(p =>
    `<a href="${esc(p.url)}" target="_blank" rel="noopener"><img src="${esc(p.url)}" alt="" loading="lazy"></a>`
  ).join('')}</div>`;
}

// ─── Main builder ─────────────────────────────────────────────────────────────

function buildGuideHTML(prop, guide) {
  const color = prop.color || '#2192A3';
  const secs  = guide.sections || {};

  const SECTIONS = [
    { key: 'welcome',        icon: '👋', title: 'Welcome',                   sub: 'Your stay overview'  },
    { key: 'key_collection', icon: '🔑', title: 'Key Collection & Check-in', sub: 'Access & entry'      },
    { key: 'wifi',           icon: '📶', title: 'WiFi Details',              sub: 'Network & password'  },
    { key: 'getting_there',  icon: '📍', title: 'Getting to the Property',   sub: 'Maps & transport'    },
    { key: 'car_parking',    icon: '🅿️', title: 'Car Parking',              sub: 'Parking info'        },
    { key: 'house_manual',   icon: '🏠', title: 'House Manual',              sub: 'Appliances & rules'  },
    { key: 'checkout',       icon: '🚪', title: 'Check-out',                 sub: 'Before you leave'    },
    { key: 'contacts',       icon: '📞', title: 'Contact Details',           sub: 'Get in touch'        },
    { key: 'poi',            icon: '🗺️', title: 'Points of Interest',        sub: 'Local highlights'    },
    { key: 'emergency',      icon: '🚨', title: 'Emergency Info',            sub: 'Important numbers'   },
    { key: 'faqs',           icon: '❓', title: 'FAQs',                      sub: 'Common questions'    },
    { key: 'report_issue',   icon: '⚠️', title: 'Report an Issue',           sub: 'Report a problem'    },
  ];

  // Sections shown inline on home page (critical check-in info)
  const HOME_KEYS = ['welcome', 'key_collection', 'car_parking', 'wifi', 'contacts'];

  // ── Check if a section has any content ─────────────────────────────────────
  function hasContent(sec) {
    const d = secs[sec.key];
    if (!d || d.enabled === false) return false;
    const photos = d.photos && d.photos.length > 0;
    if (sec.key === 'wifi')         return d.network || d.password || d.content || photos;
    if (sec.key === 'contacts')     return (d.items||[]).some(c => c.name||c.phone||c.email) || photos;
    if (sec.key === 'poi')          return (d.items||[]).some(p => p.name) || photos;
    if (sec.key === 'faqs')         return (d.items||[]).some(f => f.question) || photos;
    if (sec.key === 'report_issue') return d.email || d.phone || photos;
    if (sec.key === 'checkout')     return d.content || guide.checkout_time || photos;
    return d.content || d.code || photos;
  }

  // ── Build content HTML for a section ───────────────────────────────────────
  function buildInner(sec) {
    const d = secs[sec.key];
    let html = '';
    if (['welcome','getting_there','car_parking','house_manual','emergency'].includes(sec.key)) {
      if (d.content) html = `<div class="prose">${nl2br(d.content)}</div>`;
      if (sec.key === 'getting_there' && prop.address)
        html += `<a href="https://maps.google.com/?q=${encodeURIComponent(prop.address)}" target="_blank" rel="noopener" class="map-btn">📍 Directions to the Property</a>`;
    } else if (sec.key === 'key_collection') {
      if (d.content) html = `<div class="prose">${nl2br(d.content)}</div>`;
      if (d.code)    html += `<div class="code-box"><div class="code-label">🔑 Access Code</div><div class="code-value">${esc(d.code)}</div></div>`;
    } else if (sec.key === 'wifi') {
      if (d.network || d.password) {
        html = `<div class="wifi-box">
          ${d.network  ? `<div class="wifi-row"><span class="wifi-label">Network</span><span class="wifi-val">${esc(d.network)}</span></div>` : ''}
          ${d.password ? `<div class="wifi-row"><span class="wifi-label">Password</span><span class="wifi-pass">${esc(d.password)}</span></div>` : ''}
        </div>`;
      }
      if (d.content) html += `<div class="prose" style="margin-top:12px;">${nl2br(d.content)}</div>`;
    } else if (sec.key === 'checkout') {
      if (guide.checkout_time) html = `<div class="time-badge">🚪 Check-out by ${esc(guide.checkout_time)}</div>`;
      if (d.content) html += `<div class="prose">${nl2br(d.content)}</div>`;
    } else if (sec.key === 'contacts') {
      const items = (d.items||[]).filter(c => c.name||c.phone||c.email);
      if (items.length) html = items.map(c => `
        <div class="contact-item">
          <div class="contact-name">${esc(c.name)}</div>
          ${c.role ? `<div class="contact-role">${esc(c.role)}</div>` : ''}
          <div class="contact-actions">
            ${c.phone ? `<a href="tel:${esc(c.phone.replace(/\s/g,''))}" class="contact-btn primary">📱 ${esc(c.phone)}</a>` : ''}
            ${c.email ? `<a href="mailto:${esc(c.email)}" class="contact-btn">✉️ Email</a>` : ''}
          </div>
        </div>`).join('');
    } else if (sec.key === 'poi') {
      const items = (d.items||[]).filter(p => p.name);
      if (items.length) html = items.map(p => `
        <div class="poi-item">
          <div class="poi-name-row">
            <span class="poi-name">${esc(p.name)}</span>
            ${p.maps_url ? `<a href="${esc(p.maps_url)}" target="_blank" rel="noopener" class="poi-map-btn">📍 Directions</a>` : ''}
          </div>
          ${p.distance    ? `<div class="poi-dist">${esc(p.distance)} away</div>` : ''}
          ${p.description ? `<div class="poi-desc">${esc(p.description)}</div>`   : ''}
        </div>`).join('');
    } else if (sec.key === 'faqs') {
      const items = (d.items||[]).filter(f => f.question);
      if (items.length) html = items.map(f => `
        <details class="faq-item">
          <summary>${esc(f.question)}</summary>
          <div class="faq-answer">${nl2br(f.answer)}</div>
        </details>`).join('');
    } else if (sec.key === 'report_issue') {
      const d2 = secs[sec.key];
      if (d2.email || d2.phone) html = `
        <p class="report-intro">Need to report a problem? Contact us directly:</p>
        <div class="report-btns">
          ${d2.phone ? `<a href="tel:${esc(d2.phone.replace(/\s/g,''))}" class="report-btn report-btn-phone">📱 Call ${esc(d2.phone)}</a>` : ''}
          ${d2.email ? `<a href="mailto:${esc(d2.email)}" class="report-btn report-btn-email">✉️ Email Us</a>` : ''}
        </div>`;
    }
    html += photosHTML(d.photos);
    return html;
  }

  // ── Home: inline section cards ─────────────────────────────────────────────
  const homeCards = SECTIONS
    .filter(sec => HOME_KEYS.includes(sec.key) && hasContent(sec))
    .map(sec => {
      const inner = buildInner(sec);
      if (!inner.trim()) return '';
      // Welcome gets a special warm style; others get the standard card
      const isWelcome = sec.key === 'welcome';
      return `
  <div class="home-card${isWelcome ? ' welcome-card' : ''}">
    <div class="home-card-head">
      <span class="home-card-icon">${sec.icon}</span>
      <span class="home-card-title">${sec.title}</span>
    </div>
    <div class="home-card-body">${inner}</div>
  </div>`;
    }).join('');

  // ── Hamburger: remaining sections ─────────────────────────────────────────
  const menuSections = SECTIONS.filter(sec => !HOME_KEYS.includes(sec.key) && hasContent(sec));

  const menuItems = menuSections.map(sec => `
    <a href="#${sec.key}" class="menu-item">
      <span class="menu-item-icon">${sec.icon}</span>
      <div class="menu-item-text">
        <div class="menu-item-title">${sec.title}</div>
        <div class="menu-item-sub">${sec.sub}</div>
      </div>
      <span class="menu-chevron">›</span>
    </a>`).join('');

  // ── Section screens (for hamburger items) ──────────────────────────────────
  const sectionScreens = menuSections.map(sec => {
    const inner = buildInner(sec);
    if (!inner.trim()) return '';
    return `
  <div id="screen-${sec.key}" class="screen">
    <div class="topbar">
      <button onclick="goHome()" class="back-btn">← Back</button>
      <span class="topbar-title">${sec.icon} ${sec.title}</span>
      <button onclick="openMenu()" class="ham-sm" aria-label="Menu">☰</button>
    </div>
    <div class="screen-body">
      <div class="content-card">${inner}</div>
    </div>
    <footer>Powered by Vaun Holidays</footer>
  </div>`;
  }).join('');

  // ── Full HTML ──────────────────────────────────────────────────────────────
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
body{font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;background:#f0f4f8;color:#303336;-webkit-font-smoothing:antialiased}

/* ── Screen routing ── */
.screen{display:none;min-height:100vh}
.screen.active{display:block;animation:fadeIn .18s ease both}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}

/* ═══════════ HOME HEADER ═══════════ */
.home-header{background:var(--brand);padding:52px 16px 28px;color:white;position:relative}
.ham-btn{position:absolute;top:14px;right:14px;background:rgba(255,255,255,.22);border:1px solid rgba(255,255,255,.35);color:white;border-radius:10px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:6px;font-family:inherit}
.ham-btn:active{background:rgba(255,255,255,.35)}
.ham-btn svg{width:16px;height:16px;flex-shrink:0}
.home-prop-name{font-size:28px;font-weight:700;line-height:1.2;margin-bottom:6px}
.home-prop-addr{font-size:13px;opacity:.85;margin-bottom:16px}
.times{display:flex;gap:8px;flex-wrap:wrap}
.time-chip{background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.35);border-radius:999px;padding:6px 14px;font-size:12px;font-weight:600;white-space:nowrap}

/* ═══════════ HOME BODY ═══════════ */
.home-body{max-width:640px;margin:0 auto;padding:20px 14px 60px}

/* ── Home cards ── */
.home-card{background:white;border-radius:14px;margin-bottom:14px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)}
.home-card-head{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid #f1f5f9}
.home-card-icon{font-size:20px;flex-shrink:0;line-height:1}
.home-card-title{font-size:16px;font-weight:700;color:#0f172a}
.home-card-body{padding:16px 18px;font-size:14px;color:#475569;line-height:1.75}

/* Welcome card gets a warm brand-color accent on the left */
.welcome-card{border-left:4px solid var(--brand)}
.welcome-card .home-card-head{background:linear-gradient(135deg,rgba(var(--brand-rgb,33,146,163),.06) 0%,transparent 100%)}

/* ═══════════ SECTION TOPBAR ═══════════ */
.topbar{background:var(--brand);padding:12px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:10;min-height:52px}
.back-btn{background:rgba(255,255,255,.2);border:none;color:white;font-size:13px;font-weight:600;padding:7px 12px;border-radius:8px;cursor:pointer;white-space:nowrap;font-family:inherit;flex-shrink:0}
.back-btn:active{background:rgba(255,255,255,.35)}
.topbar-title{font-size:15px;font-weight:700;color:white;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.ham-sm{background:rgba(255,255,255,.2);border:none;color:white;font-size:16px;padding:7px 10px;border-radius:8px;cursor:pointer;flex-shrink:0}
.ham-sm:active{background:rgba(255,255,255,.35)}

/* ═══════════ SECTION SCREEN ═══════════ */
.screen-body{max-width:640px;margin:0 auto;padding:16px 14px 24px}
.content-card{background:white;border-radius:12px;padding:18px 16px;box-shadow:0 2px 10px rgba(0,0,0,.07)}

/* ═══════════ HAMBURGER PANEL ═══════════ */
.menu-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:200;opacity:0;pointer-events:none;transition:opacity .25s}
.menu-overlay.open{opacity:1;pointer-events:auto}
.menu-panel{position:fixed;top:0;right:0;bottom:0;width:min(300px,88vw);background:white;z-index:201;transform:translateX(100%);transition:transform .28s cubic-bezier(.4,0,.2,1);display:flex;flex-direction:column;overflow:hidden}
.menu-panel.open{transform:translateX(0)}
.menu-head{background:var(--brand);padding:52px 18px 18px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
.menu-head-title{font-size:17px;font-weight:700;color:white}
.menu-close{background:rgba(255,255,255,.2);border:none;color:white;font-size:20px;width:36px;height:36px;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-family:inherit}
.menu-close:active{background:rgba(255,255,255,.35)}
.menu-nav{overflow-y:auto;flex:1;padding:8px 0}
.menu-item{display:flex;align-items:center;gap:14px;padding:14px 18px;text-decoration:none;color:#303336;border-bottom:1px solid #f1f5f9;transition:background .12s;-webkit-tap-highlight-color:transparent}
.menu-item:last-child{border-bottom:none}
.menu-item:active{background:#f8fafc}
.menu-item-icon{font-size:22px;flex-shrink:0;width:32px;text-align:center;line-height:1}
.menu-item-text{flex:1;min-width:0}
.menu-item-title{font-size:14px;font-weight:600;color:#0f172a}
.menu-item-sub{font-size:12px;color:#94a3b8;margin-top:1px}
.menu-chevron{font-size:18px;color:#cbd5e1;flex-shrink:0}
.menu-footer{padding:16px 18px;border-top:1px solid #f1f5f9;font-size:11px;color:#94a3b8;text-align:center;flex-shrink:0}

/* ═══════════ CONTENT ELEMENTS ═══════════ */
.prose{font-size:14px;color:#475569;line-height:1.75}
.code-box{background:#f0fdf4;border:2px solid var(--brand);border-radius:8px;padding:18px 16px;margin-top:14px;text-align:center}
.code-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#64748b;margin-bottom:8px}
.code-value{font-size:28px;font-weight:700;letter-spacing:7px;color:#166534}
.time-badge{display:inline-flex;align-items:center;gap:6px;background:#e0f2fe;color:#0369a1;border-radius:6px;padding:7px 14px;font-size:14px;font-weight:600;margin-bottom:12px}
.map-btn{display:inline-flex;align-items:center;gap:6px;margin-top:16px;background:var(--brand);color:white;border-radius:8px;padding:11px 18px;font-size:14px;font-weight:600;text-decoration:none}
.wifi-box{background:#f0f9ff;border:2px solid var(--brand);border-radius:8px;padding:4px 16px}
.wifi-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid #e0f2fe}
.wifi-row:last-child{border-bottom:none}
.wifi-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#64748b;flex-shrink:0}
.wifi-val{font-size:15px;font-weight:600;color:#0f172a;text-align:right}
.wifi-pass{font-size:18px;font-weight:700;letter-spacing:3px;color:#0369a1;font-family:monospace;text-align:right}
.contact-item{padding:14px 0;border-bottom:1px solid #e9e9ea}
.contact-item:last-child{border-bottom:none;padding-bottom:0}
.contact-name{font-size:15px;font-weight:600;color:#0f172a;margin-bottom:2px}
.contact-role{font-size:12px;color:#94a3b8;margin-bottom:10px}
.contact-actions{display:flex;gap:8px}
.contact-btn{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:5px;padding:10px;background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;color:#334155;text-decoration:none;font-weight:500}
.contact-btn.primary{background:var(--brand);color:white;border-color:var(--brand)}
.poi-item{padding:12px 0;border-bottom:1px solid #e9e9ea}
.poi-item:last-child{border-bottom:none}
.poi-name-row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.poi-name{font-size:14px;font-weight:600;color:#0f172a}
.poi-map-btn{display:inline-flex;align-items:center;gap:4px;padding:5px 11px;background:var(--brand);color:white;border-radius:6px;font-size:11px;font-weight:600;text-decoration:none;white-space:nowrap;flex-shrink:0}
.poi-dist{font-size:12px;color:#94a3b8;margin:3px 0}
.poi-desc{font-size:13px;color:#475569;margin-top:4px;line-height:1.6}
details.faq-item{border-bottom:1px solid #e9e9ea}
details.faq-item:last-child{border-bottom:none}
summary{padding:13px 0;font-size:14px;font-weight:600;color:#0f172a;cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center;gap:8px}
summary::-webkit-details-marker{display:none}
summary::after{content:'+';color:#94a3b8;font-size:20px;font-weight:300;flex-shrink:0}
details[open] summary::after{content:'−'}
.faq-answer{padding:0 0 12px;font-size:13px;color:#475569;line-height:1.65}
.report-intro{font-size:13px;color:#64748b;margin-bottom:14px}
.report-btns{display:flex;flex-direction:column;gap:10px}
.report-btn{display:block;text-align:center;padding:14px;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none}
.report-btn-phone{background:var(--brand);color:white}
.report-btn-email{background:#f8fafc;color:#334155;border:1.5px solid #e2e8f0}
.photo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:8px;margin-top:14px;padding-top:14px;border-top:1px solid #e9e9ea}
.photo-grid a{display:block;aspect-ratio:1;overflow:hidden;border-radius:8px;background:#f1f5f9}
.photo-grid img{width:100%;height:100%;object-fit:cover;display:block}
footer{text-align:center;padding:24px 16px;font-size:11px;color:#94a3b8}
</style>
</head>
<body>

<!-- ════════════════ HOME SCREEN ════════════════ -->
<div id="screen-home" class="screen active">

  <header class="home-header">
    <button class="ham-btn" onclick="openMenu()" aria-label="More information">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="3" y1="6"  x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      More Info
    </button>
    <div class="home-prop-name">${esc(prop.name)}</div>
    ${prop.address ? `<div class="home-prop-addr">📍 ${esc(prop.address)}</div>` : ''}
    <div class="times">
      ${guide.checkin_time  ? `<span class="time-chip">✅ Check-in from ${esc(guide.checkin_time)}</span>`  : ''}
      ${guide.checkout_time ? `<span class="time-chip">🚪 Check-out by ${esc(guide.checkout_time)}</span>` : ''}
    </div>
  </header>

  <div class="home-body">
    ${homeCards}
  </div>

  <footer>Powered by Vaun Holidays</footer>
</div>

<!-- ════════════════ SECTION SCREENS (hamburger) ════════════════ -->
${sectionScreens}

<!-- ════════════════ HAMBURGER MENU ════════════════ -->
<div id="menu-overlay" class="menu-overlay" onclick="closeMenu()"></div>

<div id="menu-panel" class="menu-panel" role="dialog" aria-label="More information">
  <div class="menu-head">
    <span class="menu-head-title">More Information</span>
    <button class="menu-close" onclick="closeMenu()" aria-label="Close menu">✕</button>
  </div>
  <nav class="menu-nav">
    ${menuItems}
  </nav>
  <div class="menu-footer">Powered by Vaun Holidays</div>
</div>

<script>
function openMenu(){
  document.getElementById('menu-overlay').classList.add('open');
  document.getElementById('menu-panel').classList.add('open');
  document.body.style.overflow='hidden';
}
function closeMenu(){
  document.getElementById('menu-overlay').classList.remove('open');
  document.getElementById('menu-panel').classList.remove('open');
  document.body.style.overflow='';
}
function goHome(){history.pushState(null,'',location.pathname);route()}
function route(){
  var h=(location.hash||'').replace('#','');
  document.querySelectorAll('.screen').forEach(function(el){el.classList.remove('active')});
  var t=h?document.getElementById('screen-'+h):null;
  (t||document.getElementById('screen-home')).classList.add('active');
  window.scrollTo(0,0);
  closeMenu();
}
window.addEventListener('hashchange',route);
window.addEventListener('popstate',route);
route();
</script>

</body>
</html>`;
}

function errorPage(msg) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not Found</title><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet"><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Inter',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f0f4f8;color:#334155}</style></head><body><div style="text-align:center;padding:32px 20px"><div style="font-size:52px;margin-bottom:20px">🏠</div><h2 style="font-size:20px;font-weight:700;color:#0f172a;margin-bottom:8px">Guide not available</h2><p style="font-size:14px;color:#64748b">${msg}</p></div></body></html>`;
}
