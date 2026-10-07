/**
 * Shared UI for every page (public + admin): helpers (window.LG), theme toggle, toasts, confirm dialog,
 * demo-mode badge, "service unavailable" page, and the public navbar + footer (injected so they are defined once).
 * Page markup contract: <div id="lg-navbar"></div> ... <main id="main"> ... </main> ... <div id="lg-footer"></div>,
 * <body data-page="home|lockers|pricing|contact|..."> (used for the active nav link).
 */
(function () {
  const R = LG_CONFIG.root, BRAND = LG_CONFIG.brand;
  const $ = (s, el = document) => el.querySelector(s);

  // ---------- constants ----------
  /** [label, color] per status. Colors map to .st-<color> in custom.css (green / amber / blue / gray / red / cyan). */
  const STATUS = {
    locker: { available: ['ว่าง', 'green'], booked: ['จองแล้ว', 'amber'], in_use: ['ใช้งานอยู่', 'blue'], maintenance: ['ซ่อมบำรุง', 'gray'] },
    booking: { pending: ['รอยืนยัน', 'amber'], confirmed: ['ยืนยันแล้ว', 'cyan'], active: ['กำลังใช้งาน', 'blue'], completed: ['เสร็จสิ้น', 'green'], cancelled: ['ยกเลิก', 'red'] },
    payment: { paid: ['ชำระแล้ว', 'green'], pending: ['รอชำระ', 'amber'], refunded: ['คืนเงินแล้ว', 'gray'] },
    user: { active: ['ใช้งานอยู่', 'green'], suspended: ['ถูกระงับ', 'red'] },
  };
  const SIZES = {
    S: { label: 'เล็ก', dim: '25 × 35 × 40 ซม.', fits: 'กระเป๋าสะพาย กล้อง ของใช้ส่วนตัว' },
    M: { label: 'กลาง', dim: '35 × 40 × 55 ซม.', fits: 'เป้ กระเป๋าถือ ถุงช้อปปิ้ง' },
    L: { label: 'ใหญ่', dim: '45 × 55 × 70 ซม.', fits: 'กระเป๋าเดินทางขนาดกลาง' },
    XL: { label: 'ใหญ่พิเศษ', dim: '55 × 75 × 90 ซม.', fits: 'กระเป๋าเดินทางใบใหญ่ อุปกรณ์กีฬา' },
  };
  const DURATION = { hour: 'ชั่วโมง', day: 'วัน', month: 'เดือน' };
  const ROLES = { super_admin: 'Super Admin', manager: 'Manager', staff: 'Staff' };
  const PAY_METHODS = { card: 'บัตรเครดิต/เดบิต', promptpay: 'พร้อมเพย์', cash: 'เงินสด' };

  // ---------- formatting ----------
  const p2 = (n) => String(n).padStart(2, '0');
  // 'YYYY-MM-DD' alone would parse as UTC; force local time so dates never shift a day
  const toDate = (s) => (s instanceof Date ? s : new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T00:00:00' : String(s).replace(' ', 'T')));
  const fmt = {
    baht: (n) => '฿' + Number(n || 0).toLocaleString('th-TH'),
    date: (s) => { if (!s) return '-'; const d = toDate(s); return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`; },   // DD/MM/YYYY
    time: (s) => { if (!s) return '-'; const d = toDate(s); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; },                          // 24h
    datetime: (s) => (s ? `${fmt.date(s)} ${fmt.time(s)}` : '-'),
    duration: (type, qty) => `${qty} ${DURATION[type] || type}`,
    /** 'YYYY-MM-DD' for <input type="date"> */
    isoDate: (d = new Date()) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`,
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const qs = (name) => new URLSearchParams(location.search).get(name);

  // ---------- small HTML builders ----------
  const badge = (kind, status) => { const [label, color] = (STATUS[kind] || {})[status] || [status, 'gray']; return `<span class="badge status-badge st-${color}">${esc(label)}</span>`; };
  const skeleton = (rows = 5) => `<div class="placeholder-glow" aria-hidden="true">${'<span class="placeholder col-12 rounded mb-2 py-3"></span>'.repeat(rows)}</div><span class="visually-hidden" role="status">กำลังโหลด...</span>`;
  const empty = (msg = 'ไม่พบข้อมูล', icon = 'inbox') => `<div class="text-center text-body-secondary py-5"><i class="bi bi-${icon} display-4 d-block mb-2"></i><p class="mb-0">${esc(msg)}</p></div>`;
  const errorBox = (e) => `<div class="alert alert-danger d-flex gap-2 align-items-center" role="alert"><i class="bi bi-exclamation-triangle-fill"></i><div>${esc((e && e.message) || 'เกิดข้อผิดพลาด')}</div></div>`;

  // ---------- logo (replace LOGO_MARK / BRAND to rebrand; keep assets/img/*.svg in sync) ----------
  const LOGO_MARK = '<svg class="lg-logo-mark" viewBox="0 0 40 40" width="36" height="36" role="img" aria-hidden="true" focusable="false"><rect width="40" height="40" rx="10" fill="var(--lg-primary)"/><rect x="8" y="8" width="10" height="24" rx="2.5" fill="none" stroke="#fff" stroke-width="2.4"/><rect x="22" y="8" width="10" height="24" rx="2.5" fill="none" stroke="#fff" stroke-width="2.4"/><circle cx="15" cy="21" r="1.8" fill="#fff"/><circle cx="25" cy="21" r="1.8" fill="var(--lg-accent)"/></svg>';
  const logo = (cls = '') => `<span class="lg-logo ${cls}">${LOGO_MARK}<span class="lg-logo-text">${esc(BRAND)}</span></span>`;

  // ---------- toasts ----------
  function toast(message, type = 'success') {
    let box = $('#lg-toasts');
    if (!box) { box = document.createElement('div'); box.id = 'lg-toasts'; box.className = 'toast-container position-fixed bottom-0 end-0 p-3'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    const icon = { success: 'check-circle-fill', danger: 'x-octagon-fill', warning: 'exclamation-triangle-fill', info: 'info-circle-fill' }[type] || 'info-circle-fill';
    const el = document.createElement('div');
    el.className = `toast align-items-center text-bg-${type} border-0`; el.setAttribute('role', type === 'danger' ? 'alert' : 'status');
    el.innerHTML = `<div class="d-flex"><div class="toast-body"><i class="bi bi-${icon} me-2"></i>${esc(message)}</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="ปิด"></button></div>`;
    box.appendChild(el);
    el.addEventListener('hidden.bs.toast', () => el.remove());
    new bootstrap.Toast(el, { delay: type === 'danger' ? 6000 : 3500 }).show();
  }
  const toastError = (e) => toast((e && e.message) || 'เกิดข้อผิดพลาด', 'danger');

  /** Confirmation dialog -> Promise<boolean>. Use before every destructive action. */
  function confirmDialog({ title = 'ยืนยันการทำรายการ', message = '', okText = 'ยืนยัน', danger = false } = {}) {
    return new Promise((resolve) => {
      const el = document.createElement('div');
      el.className = 'modal fade'; el.tabIndex = -1; el.setAttribute('aria-labelledby', 'lg-confirm-title');
      el.innerHTML = `<div class="modal-dialog modal-dialog-centered"><div class="modal-content"><div class="modal-header"><h2 class="modal-title fs-5" id="lg-confirm-title">${esc(title)}</h2><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="ปิด"></button></div><div class="modal-body">${esc(message)}</div><div class="modal-footer"><button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">ยกเลิก</button><button type="button" class="btn btn-${danger ? 'danger' : 'primary'}" data-ok>${esc(okText)}</button></div></div></div>`;
      document.body.appendChild(el);
      const modal = new bootstrap.Modal(el); let ok = false;
      $('[data-ok]', el).addEventListener('click', () => { ok = true; modal.hide(); });
      el.addEventListener('hidden.bs.modal', () => { el.remove(); resolve(ok); });
      modal.show();
    });
  }

  // ---------- forms / lists ----------
  /** Bootstrap validation styles. Returns true when the form is valid. */
  function validate(form) { form.classList.add('was-validated'); return form.checkValidity(); }
  /** Disable a button while an async action runs (prevents double submit). */
  async function busy(btn, fn) { btn.disabled = true; try { return await fn(); } finally { btn.disabled = false; } }

  /** Client-side pagination: LG.paginate(items, page, per) -> {rows, pages, page}. */
  function paginate(items, page = 1, per = 10) {
    const pages = Math.max(1, Math.ceil(items.length / per)); page = Math.min(Math.max(1, page), pages);
    return { rows: items.slice((page - 1) * per, page * per), pages, page };
  }
  /** Render a Bootstrap pager into `el`; calls onChange(newPage). */
  function pager(el, { total, page, per = 10 }, onChange) {
    const pages = Math.max(1, Math.ceil(total / per));
    if (pages <= 1) { el.innerHTML = ''; return; }
    const item = (p, label, dis, act) => `<li class="page-item${dis ? ' disabled' : ''}${act ? ' active' : ''}"><a class="page-link" href="#" data-p="${p}">${label}</a></li>`;
    let h = item(page - 1, '&laquo;', page === 1);
    for (let p = 1; p <= pages; p++) if (p === 1 || p === pages || Math.abs(p - page) <= 1) h += item(p, p, false, p === page); else if (Math.abs(p - page) === 2) h += '<li class="page-item disabled"><span class="page-link">…</span></li>';
    h += item(page + 1, '&raquo;', page === pages);
    el.innerHTML = `<nav aria-label="เปลี่ยนหน้า"><ul class="pagination pagination-sm justify-content-center mb-0">${h}</ul></nav>`;
    el.querySelectorAll('[data-p]').forEach((a) => a.addEventListener('click', (ev) => { ev.preventDefault(); if (!a.parentElement.classList.contains('disabled')) onChange(+a.dataset.p); }));
  }

  /** Download rows (array of arrays) as a UTF-8 CSV that opens correctly in Excel. */
  function csv(filename, rows) {
    const body = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' }));
    a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- locker grid + legend (shared by lockers.html, booking.html and admin/lockers.html) ----------
  const legend = () => `<ul class="list-inline mb-0 locker-legend small">${Object.entries(STATUS.locker).map(([k, [label, c]]) => `<li class="list-inline-item"><span class="legend-dot st-${c}"></span> ${label}</li>`).join('')}</ul>`;
  /**
   * Render lockers as tiles into `el`. opts: {selectedIds:Set|Array, onClick(locker, tileEl), selectable(locker)->bool (default: all)}.
   * Tiles are <button>s (keyboard accessible) colored by status.
   */
  function lockerGrid(el, lockers, { selectedIds = [], onClick, selectable = () => true } = {}) {
    if (!lockers.length) { el.innerHTML = empty('ไม่พบล็อกเกอร์ตามเงื่อนไข', 'lock'); return; }
    const sel = new Set(selectedIds);
    el.innerHTML = `<div class="locker-grid">${lockers.map((l) => {
      const [label, c] = STATUS.locker[l.status] || ['', 'gray'];
      return `<button type="button" class="locker-tile st-${c}${sel.has(l.id) ? ' selected' : ''}" data-id="${l.id}" ${selectable(l) ? '' : 'disabled'} aria-label="ล็อกเกอร์ ${esc(l.code)} ขนาด ${l.size} ${label}" aria-pressed="${sel.has(l.id)}"><i class="bi bi-${l.status === 'available' ? 'unlock' : 'lock'}-fill"></i><span class="code">${esc(l.code)}</span><span class="size">${l.size}</span></button>`;
    }).join('')}</div>`;
    el.querySelectorAll('.locker-tile').forEach((t) => t.addEventListener('click', () => onClick && onClick(lockers.find((l) => l.id === +t.dataset.id), t)));
  }

  // ---------- theme ----------
  const theme = {
    get: () => document.documentElement.getAttribute('data-bs-theme') || 'light',
    set(t) { document.documentElement.setAttribute('data-bs-theme', t); try { localStorage.setItem('lg_theme', t); } catch (e) { /* ignore */ } theme.sync(); window.dispatchEvent(new CustomEvent('lg:theme', { detail: t })); },
    sync() { document.querySelectorAll('[data-theme-toggle] i').forEach((i) => { i.className = `bi bi-${theme.get() === 'dark' ? 'sun' : 'moon-stars'}-fill`; }); },
  };
  document.addEventListener('click', (e) => { if (e.target.closest('[data-theme-toggle]')) theme.set(theme.get() === 'dark' ? 'light' : 'dark'); });

  // ---------- data mode: demo badge, switch toast, service-unavailable page ----------
  function showUnavailable() {
    document.body.innerHTML = `<main class="container container-narrow text-center py-5"><div class="py-5">${logo('justify-content-center mb-4')}<i class="bi bi-cloud-slash display-1 text-body-secondary"></i><h1 class="h3 mt-3">ขณะนี้ระบบไม่พร้อมให้บริการ</h1><p class="text-body-secondary">ไม่สามารถเชื่อมต่อฐานข้อมูลได้ในขณะนี้ กรุณาลองใหม่อีกครั้งในอีกสักครู่</p><button class="btn btn-primary" onclick="location.reload()"><i class="bi bi-arrow-clockwise"></i> ลองใหม่</button></div></main>`;
  }
  window.addEventListener('lg:mode', (e) => {
    const { mode, switched } = e.detail;
    if (mode === 'unavailable') return showUnavailable();
    let b = $('#lg-demo-badge');
    if (mode === 'mock' && !b) {
      b = document.createElement('div'); b.id = 'lg-demo-badge'; b.className = 'demo-badge'; b.setAttribute('role', 'status');
      b.innerHTML = '<i class="bi bi-database-exclamation"></i> Demo mode: ข้อมูลตัวอย่าง'; document.body.appendChild(b);
    }
    if (switched) toast('ไม่สามารถเชื่อมต่อฐานข้อมูลได้ ระบบสลับไปใช้ข้อมูลตัวอย่าง (Demo mode) การเปลี่ยนแปลงจะไม่ถูกบันทึกลงฐานข้อมูลจริง', 'warning');
  });

  // ---------- public navbar + footer ----------
  const NAV = [['home', 'index.html', 'หน้าแรก'], ['lockers', 'lockers.html', 'ล็อกเกอร์'], ['pricing', 'pricing.html', 'ราคา'], ['how', 'index.html#how', 'วิธีใช้งาน'], ['faq', 'index.html#faq', 'คำถามที่พบบ่อย'], ['contact', 'contact.html', 'ติดต่อเรา']];
  async function renderPublicShell() {
    const page = document.body.dataset.page, nav = $('#lg-navbar'), foot = $('#lg-footer');
    if (nav) {
      nav.outerHTML = `<header class="sticky-top"><nav class="navbar navbar-expand-lg lg-navbar bg-body border-bottom" aria-label="เมนูหลัก"><div class="container">
        <a class="navbar-brand" href="${R}index.html" aria-label="${esc(BRAND)} หน้าแรก">${logo()}</a>
        <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#lg-nav" aria-controls="lg-nav" aria-expanded="false" aria-label="เปิดเมนู"><span class="navbar-toggler-icon"></span></button>
        <div class="collapse navbar-collapse" id="lg-nav"><ul class="navbar-nav mx-auto mb-2 mb-lg-0">${NAV.map(([k, href, label]) => `<li class="nav-item"><a class="nav-link${k === page ? ' active' : ''}" ${k === page ? 'aria-current="page"' : ''} href="${R}${href}">${label}</a></li>`).join('')}</ul>
        <div class="d-flex align-items-center gap-2"><button class="btn btn-outline-secondary btn-sm" type="button" data-theme-toggle aria-label="สลับโหมดสว่าง/มืด"><i class="bi bi-moon-stars-fill"></i></button><div id="lg-user-slot"></div></div></div></div></nav></header>`;
    }
    if (foot) {
      foot.outerHTML = `<footer class="lg-footer border-top mt-5 pt-5 pb-4 bg-body-tertiary"><div class="container"><div class="row gy-4">
        <div class="col-lg-4">${logo('mb-3')}<p class="text-body-secondary small">ล็อกเกอร์อัจฉริยะ จองออนไลน์ได้ทุกที่ ปลอดภัย สะดวก ฝากของได้ทันที</p>
          <div class="d-flex gap-3 fs-4">${['facebook', 'line', 'instagram', 'youtube'].map((s) => `<a class="text-body-secondary" href="#" aria-label="${s}"><i class="bi bi-${s}"></i></a>`).join('')}</div></div>
        <div class="col-6 col-lg-2"><h2 class="h6">เมนู</h2><ul class="list-unstyled small">${NAV.map(([, href, label]) => `<li class="mb-1"><a class="link-secondary text-decoration-none" href="${R}${href}">${label}</a></li>`).join('')}</ul></div>
        <div class="col-6 col-lg-2"><h2 class="h6">บัญชี</h2><ul class="list-unstyled small">${[['login.html', 'เข้าสู่ระบบ'], ['register.html', 'สมัครสมาชิก'], ['my-bookings.html', 'การจองของฉัน'], ['terms.html', 'ข้อกำหนดและความเป็นส่วนตัว'], ['admin/login.html', 'สำหรับเจ้าหน้าที่']].map(([h, l]) => `<li class="mb-1"><a class="link-secondary text-decoration-none" href="${R}${h}">${l}</a></li>`).join('')}</ul></div>
        <div class="col-lg-4"><h2 class="h6">ติดต่อเรา</h2><ul class="list-unstyled small text-body-secondary"><li class="mb-1"><i class="bi bi-geo-alt me-2"></i><span id="lg-f-address">99 อาคารตัวอย่าง ถนนพระราม 1 กรุงเทพฯ 10330</span></li><li class="mb-1"><i class="bi bi-telephone me-2"></i><span id="lg-f-phone">02-123-4500</span></li><li class="mb-1"><i class="bi bi-envelope me-2"></i><span id="lg-f-email">hello@lockergo.example</span></li><li><i class="bi bi-clock me-2"></i>ฝ่ายบริการลูกค้า ทุกวัน 08:00 - 20:00</li></ul></div>
      </div><hr><p class="text-center text-body-secondary small mb-0">&copy; ${new Date().getFullYear()} ${esc(BRAND)}. สงวนลิขสิทธิ์</p></div></footer>`;
    }
    theme.sync();
    if (foot) DS.getSettings().then((s) => {   // footer contact details follow admin settings
      [['address', 'address'], ['phone', 'contactPhone'], ['email', 'contactEmail']].forEach(([id, k]) => { const el = $('#lg-f-' + id); if (el && s[k]) el.textContent = s[k]; });
    }).catch(() => {});
    if (nav) {   // user menu (needs the session, so it fills in after the shell is visible)
      const u = await Auth.current(), slot = $('#lg-user-slot');
      if (!slot) return;
      slot.innerHTML = u
        ? `<div class="dropdown"><button class="btn btn-primary btn-sm dropdown-toggle" data-bs-toggle="dropdown" aria-expanded="false"><i class="bi bi-person-circle me-1"></i>${esc(u.name.split(' ')[0])}</button><ul class="dropdown-menu dropdown-menu-end">
            <li><a class="dropdown-item" href="${R}my-bookings.html"><i class="bi bi-calendar-check me-2"></i>การจองของฉัน</a></li><li><a class="dropdown-item" href="${R}profile.html"><i class="bi bi-person me-2"></i>โปรไฟล์</a></li>
            ${Auth.isStaff(u) ? `<li><a class="dropdown-item" href="${R}admin/index.html"><i class="bi bi-speedometer2 me-2"></i>หลังบ้าน</a></li>` : ''}<li><hr class="dropdown-divider"></li>
            <li><button class="dropdown-item text-danger" id="lg-logout"><i class="bi bi-box-arrow-right me-2"></i>ออกจากระบบ</button></li></ul></div>`
        : `<a class="btn btn-outline-primary btn-sm" href="${R}login.html">เข้าสู่ระบบ</a><a class="btn btn-primary btn-sm" href="${R}register.html">สมัครสมาชิก</a>`;
      const out = $('#lg-logout');
      if (out) out.addEventListener('click', async () => { await Auth.logout(); location.href = R + 'index.html'; });
    }
  }

  window.LG = { root: R, STATUS, SIZES, DURATION, ROLES, PAY_METHODS, fmt, esc, qs, badge, skeleton, empty, errorBox, logo, toast, toastError, confirm: confirmDialog, validate, busy, paginate, pager, csv, legend, lockerGrid, theme, toDate };

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-logo]').forEach((el) => { el.innerHTML = logo(el.dataset.logo); });   // logo slots (login pages etc.)
    DS.init();                                                                                               // health check once -> badge
    if (document.body.dataset.shell !== 'admin') renderPublicShell();
    theme.sync();
  });
})();
