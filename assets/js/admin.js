/**
 * Admin shell: guard + sidebar + topbar + page heading, injected so they are defined once.
 * Page markup contract (see any admin/*.html):
 *   <body data-shell="admin" data-page="bookings">
 *     <div class="admin-wrap"><aside id="admin-sidebar"></aside>
 *       <div class="admin-main"><div id="admin-topbar"></div><main id="main" class="admin-content" data-title="จัดการการจอง"> ...page content... </main></div></div>
 * The shell inserts breadcrumb + <h1> + <div id="page-actions"> at the top of <main>.
 * Page code:  const user = await Admin.ready;   // resolves with the logged-in staff user (redirects to admin/login.html otherwise)
 * admin/login.html uses <body data-shell="admin-login"> and never loads the shell.
 */
(function () {
  const R = LG_CONFIG.root + 'admin/';
  // [page key, file, label, icon]
  const MENU = [
    ['ภาพรวม', [['dashboard', 'index.html', 'แดชบอร์ด', 'speedometer2']]],
    ['การดำเนินงาน', [['bookings', 'bookings.html', 'การจอง', 'calendar-check'], ['lockers', 'lockers.html', 'ล็อกเกอร์', 'grid-3x3-gap'], ['customers', 'customers.html', 'ลูกค้า', 'people'], ['locations', 'locations.html', 'สาขาและโซน', 'geo-alt']]],
    ['การเงิน', [['payments', 'payments.html', 'การชำระเงิน', 'credit-card'], ['pricing', 'pricing.html', 'ราคาและโปรโมชัน', 'tags'], ['reports', 'reports.html', 'รายงาน', 'bar-chart-line']]],
    ['ระบบ', [['staff', 'staff.html', 'พนักงานและสิทธิ์', 'person-badge'], ['activity-log', 'activity-log.html', 'บันทึกกิจกรรม', 'clock-history'], ['settings', 'settings.html', 'ตั้งค่า', 'gear']]],
  ];
  const { esc } = LG;

  function sidebar(page) {
    return `<div class="offcanvas-lg offcanvas-start admin-sidebar-inner" tabindex="-1" id="admin-menu" aria-labelledby="admin-menu-title">
      <div class="offcanvas-header"><h2 class="visually-hidden" id="admin-menu-title">เมนูหลังบ้าน</h2><a href="${R}index.html" class="text-decoration-none">${LG.logo()}</a><button type="button" class="btn-close d-lg-none" data-bs-dismiss="offcanvas" data-bs-target="#admin-menu" aria-label="ปิด"></button></div>
      <div class="offcanvas-body flex-column"><nav aria-label="เมนูหลังบ้าน">${MENU.map(([group, items]) => `<div class="menu-group">${esc(group)}</div><ul class="nav flex-column mb-2">${items.map(([k, href, label, icon]) => `<li class="nav-item"><a class="nav-link${k === page ? ' active' : ''}" ${k === page ? 'aria-current="page"' : ''} href="${R}${href}"><i class="bi bi-${icon}"></i><span>${label}</span></a></li>`).join('')}</ul>`).join('')}</nav>
      <a class="nav-link mt-auto small" href="${LG_CONFIG.root}index.html"><i class="bi bi-box-arrow-up-right"></i><span>ดูหน้าเว็บไซต์</span></a></div></div>`;
  }

  function topbar(user) {
    return `<header class="admin-topbar border-bottom bg-body d-flex align-items-center gap-2 px-3">
      <button class="btn btn-outline-secondary btn-sm" type="button" id="sidebar-toggle" aria-label="ย่อ/ขยายเมนู" aria-controls="admin-menu"><i class="bi bi-list fs-5"></i></button>
      <form class="d-none d-md-block ms-2 flex-grow-1" style="max-width:360px" id="admin-search" role="search"><div class="input-group input-group-sm"><span class="input-group-text"><i class="bi bi-search"></i></span><input type="search" class="form-control" name="q" placeholder="ค้นหาการจอง (รหัส / ชื่อ / ล็อกเกอร์)" aria-label="ค้นหาการจอง"></div></form>
      <div class="ms-auto d-flex align-items-center gap-2">
        <div class="dropdown"><button class="btn btn-outline-secondary btn-sm position-relative" data-bs-toggle="dropdown" aria-expanded="false" aria-label="การแจ้งเตือน"><i class="bi bi-bell"></i><span id="notif-count" class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger d-none">0</span></button>
          <div class="dropdown-menu dropdown-menu-end p-0" style="min-width:290px"><h2 class="dropdown-header fs-6 mt-1">การแจ้งเตือน</h2><div id="notif-list" class="list-group list-group-flush"><div class="p-3 small text-body-secondary">กำลังโหลด...</div></div></div></div>
        <button class="btn btn-outline-secondary btn-sm" type="button" data-theme-toggle aria-label="สลับโหมดสว่าง/มืด"><i class="bi bi-moon-stars-fill"></i></button>
        <div class="dropdown"><button class="btn btn-sm d-flex align-items-center gap-2" data-bs-toggle="dropdown" aria-expanded="false"><span class="avatar">${esc(user.name.charAt(0))}</span><span class="d-none d-md-block text-start lh-sm"><span class="d-block small fw-semibold">${esc(user.name)}</span><span class="d-block text-body-secondary" style="font-size:.75rem">${esc(LG.ROLES[user.role] || user.role)}</span></span></button>
          <ul class="dropdown-menu dropdown-menu-end"><li><a class="dropdown-item" href="${LG_CONFIG.root}index.html"><i class="bi bi-house me-2"></i>หน้าเว็บไซต์</a></li><li><a class="dropdown-item" href="${R}settings.html"><i class="bi bi-gear me-2"></i>ตั้งค่า</a></li><li><hr class="dropdown-divider"></li><li><button class="dropdown-item text-danger" id="admin-logout"><i class="bi bi-box-arrow-right me-2"></i>ออกจากระบบ</button></li></ul></div>
      </div></header>`;
  }

  async function fillNotifications() {
    const list = document.getElementById('notif-list'), count = document.getElementById('notif-count');
    try {
      const [pending, broken] = await Promise.all([DS.getBookings({ status: 'pending' }), DS.getLockers({ status: 'maintenance' })]);
      const items = [
        ...pending.slice(0, 4).map((b) => `<a class="list-group-item list-group-item-action small" href="${R}bookings.html?q=${encodeURIComponent(b.ref)}"><i class="bi bi-hourglass-split text-warning me-2"></i>การจอง ${esc(b.ref)} รอยืนยัน</a>`),
        ...broken.slice(0, 4).map((l) => `<a class="list-group-item list-group-item-action small" href="${R}lockers.html?status=maintenance"><i class="bi bi-tools text-secondary me-2"></i>ล็อกเกอร์ ${esc(l.code)} ซ่อมบำรุง</a>`),
      ];
      list.innerHTML = items.join('') || '<div class="p-3 small text-body-secondary">ไม่มีการแจ้งเตือนใหม่</div>';
      const n = pending.length + broken.length;
      count.textContent = n; count.classList.toggle('d-none', !n);
    } catch (e) { list.innerHTML = '<div class="p-3 small text-body-secondary">โหลดการแจ้งเตือนไม่สำเร็จ</div>'; }
  }

  async function build() {
    const user = await Auth.require('admin'), page = document.body.dataset.page, main = document.getElementById('main');
    document.getElementById('admin-sidebar').outerHTML = `<aside class="admin-sidebar" id="admin-sidebar-wrap">${sidebar(page)}</aside>`;
    document.getElementById('admin-topbar').outerHTML = topbar(user);

    const group = MENU.find(([, items]) => items.some(([k]) => k === page)), title = main.dataset.title || '';
    main.insertAdjacentHTML('afterbegin', `<div class="page-head d-flex flex-wrap align-items-center gap-2 mb-4"><div><nav aria-label="breadcrumb"><ol class="breadcrumb mb-1 small"><li class="breadcrumb-item"><a href="${R}index.html">หลังบ้าน</a></li>${group && page !== 'dashboard' ? `<li class="breadcrumb-item">${esc(group[0])}</li>` : ''}<li class="breadcrumb-item active" aria-current="page">${esc(title)}</li></ol></nav><h1 class="h3 mb-0">${esc(title)}</h1></div><div class="ms-auto d-flex flex-wrap gap-2" id="page-actions"></div></div>`);

    // sidebar toggle: collapse on desktop, offcanvas drawer on mobile
    document.getElementById('sidebar-toggle').addEventListener('click', () => {
      if (matchMedia('(min-width: 992px)').matches) {
        const c = document.body.classList.toggle('sidebar-collapsed');
        try { localStorage.setItem('lg_sidebar', c ? '1' : ''); } catch (e) { /* ignore */ }
      } else bootstrap.Offcanvas.getOrCreateInstance('#admin-menu').toggle();
    });
    try { if (localStorage.getItem('lg_sidebar')) document.body.classList.add('sidebar-collapsed'); } catch (e) { /* ignore */ }

    document.getElementById('admin-search').addEventListener('submit', (e) => { e.preventDefault(); location.href = `${R}bookings.html?q=${encodeURIComponent(e.target.q.value.trim())}`; });
    document.getElementById('admin-logout').addEventListener('click', async () => { await Auth.logout(); location.href = R + 'login.html'; });
    LG.theme.sync(); fillNotifications();
    return user;
  }

  window.Admin = { ready: document.body.dataset.shell === 'admin' ? new Promise((res) => document.addEventListener('DOMContentLoaded', () => res(build()))) : Promise.resolve(null) };
})();
