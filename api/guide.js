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
      `${supabaseUrl}/rest/v1/properties?id=eq.${encodeURIComponent(id)}&select=*&limit=1`,
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

// ─── Check-in time gate (Brisbane / Australia time) ─────────────────────────

// Parse a check-in time string like "3:00pm" / "3pm" / "15:00" into minutes-since-midnight.
function parseCheckinTimeToMinutes(str) {
  if (!str) return 15 * 60; // default 3:00pm
  const s = String(str).toLowerCase().trim();
  const m = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!m) return 15 * 60;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const ampm = m[3];
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  return h * 60 + min;
}

// Current minutes-since-midnight in Brisbane (UTC+10, no DST). Server is on Vercel/UTC.
function getBrisbaneMinutesNow() {
  const fmt = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Brisbane',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
  const parts = fmt.formatToParts(new Date());
  const hour = parseInt(parts.find(p => p.type === 'hour').value, 10);
  const minute = parseInt(parts.find(p => p.type === 'minute').value, 10);
  return hour * 60 + minute;
}

// "850" -> "2:10pm"
function formatMinutesAsTime(mins) {
  let h = Math.floor(mins / 60);
  const m = mins % 60;
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, '0')}${ampm}`;
}

// ─── Main builder ─────────────────────────────────────────────────────────────

function buildGuideHTML(prop, guide) {
  // Guide brand colour is fixed Vaun Holidays navy — NOT tied to properties.color
  // (properties.color is a staff dashboard setting; guide is a separate guest-facing product)
  const VAUN_NAVY = '#0c1b33';
  const secs  = guide.sections || {};

  // ── Check-in time gate for the access code ──────────────────────────────────
  // Code is hidden until `checkin_time` - 10 minutes (Brisbane TZ), unless the
  // staff has toggled "early check-in" on.
  const checkinMin = parseCheckinTimeToMinutes(guide.checkin_time);
  const releaseMin = Math.max(0, checkinMin - 10);
  const nowMin     = getBrisbaneMinutesNow();
  const earlyCheckin = guide.early_checkin === true;
  const codeGateOpen = earlyCheckin || nowMin >= releaseMin;
  const minsUntilRelease = Math.max(0, releaseMin - nowMin);
  const checkinTimeFmt = formatMinutesAsTime(checkinMin);
  const releaseTimeFmt = formatMinutesAsTime(releaseMin);

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

  // Welcome shown inline on home; these 4 shown as nav buttons on home
  const HOME_INLINE_KEYS = ['welcome'];
  const HOME_NAV_KEYS    = ['key_collection', 'getting_there', 'car_parking', 'wifi'];
  const HOME_KEYS        = [...HOME_INLINE_KEYS, ...HOME_NAV_KEYS];

  // ── Should this section appear in the guide? ───────────────────────────────
  // The builder toggle is the source of truth:
  //   enabled === false  → never shown (user disabled it)
  //   enabled === true   → always shown (user explicitly enabled it)
  //   enabled undefined  → fall back to a content check (legacy data)
  function hasContent(sec) {
    const d = secs[sec.key];
    if (!d) return false;
    if (d.enabled === false) return false;
    if (d.enabled === true)  return true;
    // Legacy fallback: section has no explicit toggle → only show if it has content
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
      if (d.code) {
        if (codeGateOpen) {
          html += `<div class="code-box"><div class="code-label">🔑 Access Code</div><div class="code-value">${esc(d.code)}</div></div>`;
        } else {
          html += `<div class="code-gate">
            <div class="code-gate-icon">🕐</div>
            <div class="code-gate-title">Check-in is at ${checkinTimeFmt}</div>
            <div class="code-gate-msg">For your convenience the code will be released here at <strong>${releaseTimeFmt}</strong>.<br>Please check back here later.</div>
          </div>`;
        }
      }
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

  // ── Home: welcome card (inline) ────────────────────────────────────────────
  const welcomeSec = SECTIONS.find(s => s.key === 'welcome');
  const welcomeCard = (welcomeSec && hasContent(welcomeSec)) ? (() => {
    const inner = buildInner(welcomeSec);
    return inner.trim() ? `
  <div class="home-card welcome-card">
    <div class="home-card-head">
      <span class="home-card-icon">${welcomeSec.icon}</span>
      <span class="home-card-title">${welcomeSec.title}</span>
    </div>
    <div class="home-card-body">${inner}</div>
  </div>` : '';
  })() : '';

  // ── Home: quick-access nav list (Getting There, Key Collection, Parking, WiFi) ──
  // Map HOME_NAV_KEYS to sections so the rendered order matches the array order
  // (a .filter on SECTIONS would inherit SECTIONS' order, not HOME_NAV_KEYS').
  const homeNavSections = HOME_NAV_KEYS
    .map(key => SECTIONS.find(s => s.key === key))
    .filter(sec => sec && hasContent(sec));
  const homeNavList = homeNavSections.length ? `
  <div class="home-nav-list">
    ${homeNavSections.map(sec => `
    <a href="#${sec.key}" class="home-nav-item">
      <span class="home-nav-icon">${sec.icon}</span>
      <div class="home-nav-text">
        <div class="home-nav-title">${sec.title}</div>
        <div class="home-nav-sub">${sec.sub}</div>
      </div>
      <span class="home-nav-chevron">›</span>
    </a>`).join('')}
  </div>` : '';

  // ── Hamburger: everything not on the home page ─────────────────────────────
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

  // ── Section screens (home nav + hamburger items) ───────────────────────────
  const allNavSections = SECTIONS.filter(sec => !HOME_INLINE_KEYS.includes(sec.key) && hasContent(sec));
  const sectionScreens = allNavSections.map(sec => {
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
    <footer><svg viewBox="0 0 24 24" width="13" height="13" style="display:inline-block;vertical-align:-2px;margin-right:6px;" aria-hidden="true"><path d="M3 4L12 22L21 4" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>Powered by Vaun Holidays</footer>
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
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
:root{--brand:${VAUN_NAVY}}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:'Poppins',-apple-system,BlinkMacSystemFont,sans-serif;background:#ffffff;color:#0f172a;-webkit-font-smoothing:antialiased}

/* ── Screen routing ── */
.screen{display:none;min-height:100vh}
.screen.active{display:block;animation:fadeUp .22s ease both}
@keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}

/* ═══════════ HOME HEADER ═══════════ */
.home-header{background:linear-gradient(150deg,var(--brand) 40%,rgba(0,0,0,.18) 150%),var(--brand);padding:56px 20px 56px;color:white;position:relative;background-size:cover;background-position:center}
.home-header.has-thumb{background:none}
.home-header.has-thumb::before{content:'';position:absolute;inset:0;background-image:var(--thumb-url);background-size:cover;background-position:center;z-index:0}
.home-header.has-thumb .header-overlay{position:absolute;inset:0;background:linear-gradient(160deg,rgba(12,27,51,.82) 0%,rgba(12,27,51,.55) 100%);z-index:1}
.home-header.has-thumb .header-content{position:relative;z-index:2}
.home-header::after{content:'';position:absolute;bottom:-1px;left:0;right:0;height:34px;background:#ffffff;border-radius:34px 34px 0 0}
.ham-btn{position:absolute;top:16px;right:16px;background:rgba(255,255,255,.25);border:1.5px solid rgba(255,255,255,.5);color:white;border-radius:14px;padding:9px 16px;font-size:13px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:6px;font-family:inherit;letter-spacing:.02em}
.ham-btn:active{background:rgba(255,255,255,.4)}
.ham-btn svg{width:15px;height:15px;flex-shrink:0}
.home-prop-name{font-size:34px;font-weight:800;line-height:1.15;margin-bottom:6px;text-shadow:0 2px 12px rgba(0,0,0,.18)}
.home-prop-addr{font-size:13px;opacity:.92;margin-bottom:22px;font-weight:500}
.times{display:flex;gap:8px;flex-wrap:wrap}
.time-chip{background:rgba(255,255,255,.25);border:1.5px solid rgba(255,255,255,.5);border-radius:999px;padding:7px 16px;font-size:12px;font-weight:700;white-space:nowrap;letter-spacing:.03em}

/* ═══════════ HOME BODY ═══════════ */
.home-body{max-width:640px;margin:0 auto;padding:24px 16px 72px}

/* ── Home welcome card ── */
.home-card{background:white;border-radius:20px;margin-bottom:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)}
.home-card-head{display:flex;align-items:center;gap:10px;padding:16px 20px 14px;border-bottom:1px solid #e2e8f0}
.home-card-icon{font-size:22px;flex-shrink:0;line-height:1}
.home-card-title{font-size:16px;font-weight:700;color:#0f172a}
.home-card-body{padding:18px 20px;font-size:14px;color:#475569;line-height:1.85}
.welcome-card{border-left:5px solid var(--brand)}
.welcome-card .home-card-head{background:#f1f5f9}

/* ── Section label ── */
.home-section-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#64748b;margin:4px 4px 10px}

/* ── Home quick-access nav list ── */
.home-nav-list{background:white;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);margin-bottom:16px}
.home-nav-item{display:flex;align-items:center;gap:14px;padding:16px 20px;text-decoration:none;color:#0f172a;border-bottom:1px solid #e2e8f0;transition:background .14s;-webkit-tap-highlight-color:transparent}
.home-nav-item:last-child{border-bottom:none}
.home-nav-item:active{background:#f1f5f9}
.home-nav-icon{width:46px;height:46px;background:#eef2ff;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;line-height:1}
.home-nav-text{flex:1;min-width:0}
.home-nav-title{font-size:15px;font-weight:700;color:#0f172a}
.home-nav-sub{font-size:12px;color:#64748b;margin-top:2px;font-weight:500}
.home-nav-chevron{font-size:22px;color:var(--brand);flex-shrink:0;font-weight:800}

/* ═══════════ SECTION TOPBAR ═══════════ */
.topbar{background:linear-gradient(135deg,var(--brand) 0%,rgba(0,0,0,.12) 200%),var(--brand);padding:12px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:10;min-height:54px}
.back-btn{background:rgba(255,255,255,.25);border:none;color:white;font-size:13px;font-weight:700;padding:8px 14px;border-radius:10px;cursor:pointer;white-space:nowrap;font-family:inherit;flex-shrink:0}
.back-btn:active{background:rgba(255,255,255,.4)}
.topbar-title{font-size:15px;font-weight:700;color:white;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.ham-sm{background:rgba(255,255,255,.25);border:none;color:white;font-size:16px;padding:8px 11px;border-radius:10px;cursor:pointer;flex-shrink:0}
.ham-sm:active{background:rgba(255,255,255,.4)}

/* ═══════════ SECTION SCREEN ═══════════ */
.screen-body{max-width:640px;margin:0 auto;padding:18px 16px 28px}
.content-card{background:white;border-radius:18px;padding:20px 18px;box-shadow:0 4px 24px rgba(0,0,0,.08)}

/* ═══════════ HAMBURGER PANEL ═══════════ */
.menu-overlay{position:fixed;inset:0;background:rgba(5,10,30,.55);z-index:200;opacity:0;pointer-events:none;transition:opacity .25s}
.menu-overlay.open{opacity:1;pointer-events:auto}
.menu-panel{position:fixed;top:0;right:0;bottom:0;width:min(300px,88vw);background:#ffffff;z-index:201;transform:translateX(100%);transition:transform .28s cubic-bezier(.4,0,.2,1);display:flex;flex-direction:column;overflow:hidden}
.menu-panel.open{transform:translateX(0)}
.menu-head{background:linear-gradient(150deg,var(--brand) 40%,rgba(0,0,0,.18) 150%),var(--brand);padding:52px 18px 22px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
.menu-head-title{font-size:18px;font-weight:800;color:white}
.menu-close{background:rgba(255,255,255,.25);border:none;color:white;font-size:20px;width:36px;height:36px;border-radius:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-family:inherit}
.menu-close:active{background:rgba(255,255,255,.4)}
.menu-nav{overflow-y:auto;flex:1;padding:8px 0}
.menu-item{display:flex;align-items:center;gap:14px;padding:15px 18px;text-decoration:none;color:#0f172a;border-bottom:1px solid #e2e8f0;transition:background .14s;-webkit-tap-highlight-color:transparent}
.menu-item:last-child{border-bottom:none}
.menu-item:active{background:#f1f5f9}
.menu-item-icon{font-size:22px;flex-shrink:0;width:38px;text-align:center;line-height:1}
.menu-item-text{flex:1;min-width:0}
.menu-item-title{font-size:14px;font-weight:700;color:#0f172a}
.menu-item-sub{font-size:12px;color:#64748b;margin-top:2px;font-weight:500}
.menu-chevron{font-size:20px;color:var(--brand);flex-shrink:0;font-weight:800}
.menu-footer{padding:16px 18px;border-top:1px solid #e2e8f0;font-size:11px;color:#64748b;text-align:center;flex-shrink:0;font-weight:600;letter-spacing:.04em}

/* ═══════════ CONTENT ELEMENTS ═══════════ */
.prose{font-size:14px;color:#475569;line-height:1.85}
.code-box{background:#f0f7ff;border:2px solid var(--brand);border-radius:14px;padding:22px 16px;margin-top:16px;text-align:center}
.code-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#64748b;margin-bottom:10px}
.code-value{font-size:34px;font-weight:800;letter-spacing:8px;color:#1a6620}
.code-gate{background:#fffaf0;border:1.5px solid #fcd34d;border-radius:14px;padding:20px 18px;margin-top:16px;text-align:center}
.code-gate-icon{font-size:30px;margin-bottom:8px;line-height:1}
.code-gate-title{font-size:15px;font-weight:700;color:#0f172a;margin-bottom:8px}
.code-gate-msg{font-size:13px;color:#475569;line-height:1.65}
.code-gate-msg strong{color:#92400e;font-weight:700}
.time-badge{display:inline-flex;align-items:center;gap:6px;background:#e0f5fe;color:#0369a1;border-radius:10px;padding:8px 16px;font-size:14px;font-weight:700;margin-bottom:14px}
.map-btn{display:inline-flex;align-items:center;gap:8px;margin-top:18px;background:var(--brand);color:white;border-radius:14px;padding:13px 22px;font-size:14px;font-weight:700;text-decoration:none;box-shadow:0 4px 16px rgba(0,0,0,.18)}
.wifi-box{background:#f0f9ff;border:2px solid var(--brand);border-radius:14px;padding:4px 18px}
.wifi-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 0;border-bottom:1px solid #ddf0fb}
.wifi-row:last-child{border-bottom:none}
.wifi-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#64748b;flex-shrink:0}
.wifi-val{font-size:15px;font-weight:700;color:#0f172a;text-align:right}
.wifi-pass{font-size:18px;font-weight:700;letter-spacing:3px;color:#0369a1;font-family:monospace;text-align:right}
.contact-item{padding:16px 0;border-bottom:1px solid #e2e8f0}
.contact-item:last-child{border-bottom:none;padding-bottom:0}
.contact-name{font-size:15px;font-weight:700;color:#0f172a;margin-bottom:2px}
.contact-role{font-size:12px;color:#64748b;margin-bottom:12px;font-weight:500}
.contact-actions{display:flex;gap:8px}
.contact-btn{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:11px;background:#f1f5f9;border:1.5px solid #cbd5e1;border-radius:12px;font-size:13px;color:#1e293b;text-decoration:none;font-weight:600}
.contact-btn.primary{background:var(--brand);color:white;border-color:var(--brand)}
.poi-item{padding:14px 0;border-bottom:1px solid #e2e8f0}
.poi-item:last-child{border-bottom:none}
.poi-name-row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.poi-name{font-size:14px;font-weight:700;color:#0f172a}
.poi-map-btn{display:inline-flex;align-items:center;gap:4px;padding:6px 13px;background:var(--brand);color:white;border-radius:8px;font-size:11px;font-weight:700;text-decoration:none;white-space:nowrap;flex-shrink:0}
.poi-dist{font-size:12px;color:#64748b;margin:4px 0;font-weight:500}
.poi-desc{font-size:13px;color:#475569;margin-top:4px;line-height:1.7}
details.faq-item{border-bottom:1px solid #e2e8f0}
details.faq-item:last-child{border-bottom:none}
summary{padding:15px 0;font-size:14px;font-weight:700;color:#0f172a;cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center;gap:8px}
summary::-webkit-details-marker{display:none}
summary::after{content:'+';color:#64748b;font-size:22px;font-weight:300;flex-shrink:0}
details[open] summary::after{content:'−'}
.faq-answer{padding:0 0 14px;font-size:13px;color:#475569;line-height:1.75}
.report-intro{font-size:13px;color:#64748b;margin-bottom:16px;font-weight:500}
.report-btns{display:flex;flex-direction:column;gap:10px}
.report-btn{display:block;text-align:center;padding:15px;border-radius:14px;font-size:14px;font-weight:700;text-decoration:none}
.report-btn-phone{background:var(--brand);color:white}
.report-btn-email{background:#f1f5f9;color:#1e293b;border:1.5px solid #cbd5e1}
.photo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:8px;margin-top:16px;padding-top:16px;border-top:1px solid #e2e8f0}
.photo-grid a{display:block;aspect-ratio:1;overflow:hidden;border-radius:14px;background:#e2e8f0}
.photo-grid img{width:100%;height:100%;object-fit:cover;display:block}
footer{text-align:center;padding:28px 16px;font-size:11px;color:#64748b;font-weight:600;letter-spacing:.06em}
</style>
</head>
<body>

<!-- ════════════════ HOME SCREEN ════════════════ -->
<div id="screen-home" class="screen active">

  <header class="home-header${prop.thumbnail_url ? ' has-thumb' : ''}"${prop.thumbnail_url ? ` style="--thumb-url:url('${esc(prop.thumbnail_url)}')"` : ''}>
    ${prop.thumbnail_url ? '<div class="header-overlay"></div>' : ''}
    <div class="${prop.thumbnail_url ? 'header-content' : ''}" style="position:relative;z-index:2;">
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
    </div>
  </header>

  <div class="home-body">
    ${welcomeCard}
    ${homeNavList ? `<p class="home-section-label">Your stay essentials</p>${homeNavList}` : ''}
  </div>

  <footer><svg viewBox="0 0 24 24" width="13" height="13" style="display:inline-block;vertical-align:-2px;margin-right:6px;" aria-hidden="true"><path d="M3 4L12 22L21 4" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>Powered by Vaun Holidays</footer>
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
  <div class="menu-footer"><svg viewBox="0 0 24 24" width="13" height="13" style="display:inline-block;vertical-align:-2px;margin-right:6px;" aria-hidden="true"><path d="M3 4L12 22L21 4" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>Powered by Vaun Holidays</div>
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

// Auto-refresh when the access code is about to be released.
// Only kicks in if the gate is closed AND the release time is within an hour,
// so we don't keep a tab refreshing pointlessly all day.
${(!codeGateOpen && minsUntilRelease > 0 && minsUntilRelease <= 60) ? `
setTimeout(function(){ location.reload(); }, ${(minsUntilRelease * 60 + 5) * 1000});
` : ''}
</script>

</body>
</html>`;
}

function errorPage(msg) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not Found</title><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet"><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Inter',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f0f4f8;color:#334155}</style></head><body><div style="text-align:center;padding:32px 20px"><div style="font-size:52px;margin-bottom:20px">🏠</div><h2 style="font-size:20px;font-weight:700;color:#0f172a;margin-bottom:8px">Guide not available</h2><p style="font-size:14px;color:#64748b">${msg}</p></div></body></html>`;
}
