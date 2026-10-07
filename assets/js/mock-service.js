/**
 * Mock implementation of the PHP API. It mimics api/*.php route for route, returning the exact same JSON shapes,
 * and keeps its database in localStorage. MockService.handle(method, resource, {query, body}) -> data | throws ApiError.
 * The PHP files in /api must stay behaviourally identical to this file (it is the reference implementation).
 */
window.MockService = (() => {
  const DB_KEY = 'lg_mock_db_v4', SESSION_KEY = 'lg_mock_session';
  const ACTIVE = ['pending', 'confirmed', 'active'];   // booking statuses that occupy a locker
  const SLIP_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/, SLIP_MAX = 2.8e6;   // ~2 MB of image as base64
  const HOURS = MockData.HOURS_PER;
  let db;

  // ---------- storage ----------
  function load() {
    try { db = JSON.parse(localStorage.getItem(DB_KEY)); } catch (e) { db = null; }
    if (!db) { db = MockData.build(); save(); }
  }
  const save = () => { try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch (e) { /* storage full/blocked: stays in memory */ } };
  const session = () => { try { return +localStorage.getItem(SESSION_KEY) || null; } catch (e) { return null; } };
  const setSession = (id) => { try { id ? localStorage.setItem(SESSION_KEY, id) : localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ } };

  // ---------- helpers ----------
  const fail = (status, code, message) => { throw new ApiError(status, code, message); };
  const nextId = (rows) => rows.reduce((m, r) => Math.max(m, r.id), 0) + 1;
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
  const parse = (s) => new Date(String(s).replace(' ', 'T'));
  const addHours = (s, h) => fmt(new Date(parse(s).getTime() + h * 3600000));
  const today = () => fmt(new Date()).slice(0, 10);
  const str = (v) => (v == null ? '' : String(v).trim());
  const byId = (rows, id) => rows.find((r) => r.id === +id);
  const USERNAME_RE = /^[a-z0-9._-]{3,30}$/, USERNAME_INVALID = 'ชื่อผู้ใช้ต้องเป็น a-z, 0-9, จุด, ขีดล่าง หรือขีดกลาง ยาว 3-30 ตัวอักษร';
  const publicUser = (u) => u && { id: u.id, username: u.username, name: u.name, email: u.email, phone: u.phone, role: u.role, notifyEmail: +u.notifyEmail, notifySms: +u.notifySms };

  const me = () => { const u = byId(db.users, session()); return u && u.status !== 'suspended' ? u : null; };   // suspension ends live sessions
  function needUser() { const u = me(); if (!u) fail(401, 'unauthenticated', 'กรุณาเข้าสู่ระบบ'); return u; }
  function needAdmin() { const u = needUser(); if (u.role === 'customer') fail(403, 'forbidden', 'ไม่มีสิทธิ์เข้าถึง'); return u; }
  function log(action, target) { const u = me(); if (u && u.role !== 'customer') db.activity.push({ id: nextId(db.activity), actorId: u.id, actor: u.name, action, target: String(target), createdAt: fmt(new Date()) }); }

  // ---------- joins ----------
  const locName = (id) => (byId(db.locations, id) || {}).name || '';
  const lockerOut = (l) => ({ ...l, locationName: locName(l.locationId) });
  function bookingOut(b) {
    const l = byId(db.lockers, b.lockerId) || {}, p = db.payments.find((x) => x.bookingId === b.id);
    return { ...b, lockerCode: l.code, locationId: l.locationId, locationName: locName(l.locationId), size: l.size, paymentId: p ? p.id : null, paymentStatus: p ? p.status : null, paymentMethod: p ? p.method : null, hasSlip: p && p.slip ? 1 : 0 };
  }
  const overlaps = (lockerId, s, e, ignoreId) => db.bookings.some((b) => b.lockerId === lockerId && b.id !== ignoreId && ACTIVE.includes(b.status) && s < b.endAt && e > b.startAt);

  /** Keep locker.status in step with its bookings (same rule as the PHP API). */
  function syncLocker(lockerId) {
    const l = byId(db.lockers, lockerId);
    if (!l || l.status === 'maintenance') return;
    const bs = db.bookings.filter((b) => b.lockerId === lockerId && ACTIVE.includes(b.status));
    l.status = bs.some((b) => b.status === 'active') ? 'in_use' : bs.length ? 'booked' : 'available';
  }

  // ---------- auth ----------
  const auth = {
    'GET me': () => publicUser(me()) || null,
    'POST login': ({ username, password, admin }) => {
      const u = db.users.find((x) => x.username === str(username).toLowerCase() && x.password === password);
      if (!u) fail(401, 'invalid_credentials', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
      if (u.status === 'suspended') fail(403, 'account_suspended', 'บัญชีนี้ถูกระงับ');
      if (admin && u.role === 'customer') fail(403, 'forbidden', 'บัญชีนี้ไม่มีสิทธิ์เข้าสู่ระบบหลังบ้าน');
      u.lastLoginAt = fmt(new Date()); setSession(u.id); save();
      return publicUser(u);
    },
    'POST register': (b) => {
      const name = str(b.name), username = str(b.username).toLowerCase(), email = str(b.email).toLowerCase(), phone = str(b.phone), pw = b.password || '';
      if (!name || !/^\S+@\S+\.\S+$/.test(email) || !/^[0-9\-+ ]{9,15}$/.test(phone) || pw.length < 8) fail(422, 'validation', 'กรุณากรอกข้อมูลให้ครบถ้วน (รหัสผ่านอย่างน้อย 8 ตัวอักษร)');
      if (!USERNAME_RE.test(username)) fail(422, 'validation', USERNAME_INVALID);
      if (db.users.some((u) => u.username === username)) fail(409, 'username_taken', 'ชื่อผู้ใช้นี้ถูกใช้งานแล้ว');
      if (db.users.some((u) => u.email === email)) fail(409, 'email_taken', 'อีเมลนี้ถูกใช้งานแล้ว');
      const u = { id: nextId(db.users), username, name, email, phone, role: 'customer', password: pw, status: 'active', notifyEmail: 1, notifySms: 0, createdAt: fmt(new Date()), lastLoginAt: fmt(new Date()) };
      db.users.push(u); setSession(u.id); save();
      return publicUser(u);
    },
    'POST logout': () => { setSession(null); return true; },
    'POST forgot': ({ email }) => {
      if (!/^\S+@\S+\.\S+$/.test(str(email))) fail(422, 'validation', 'อีเมลไม่ถูกต้อง');
      return { sent: true };   // never reveal whether the email exists
    },
    'PUT profile': (b) => {
      const u = needUser();
      if (!str(b.name)) fail(422, 'validation', 'กรุณากรอกชื่อ');
      Object.assign(u, { name: str(b.name), phone: str(b.phone), notifyEmail: b.notifyEmail ? 1 : 0, notifySms: b.notifySms ? 1 : 0 });
      save(); return publicUser(u);
    },
    'PUT password': ({ current, next }) => {
      const u = needUser();
      if (u.password !== current) fail(422, 'wrong_password', 'รหัสผ่านปัจจุบันไม่ถูกต้อง');
      if (!next || next.length < 8) fail(422, 'validation', 'รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร');
      u.password = next; save(); return true;
    },
  };

  // ---------- locations ----------
  function locationOut(x) {
    const ls = db.lockers.filter((l) => l.locationId === x.id);
    return { id: x.id, name: x.name, address: x.address, zones: x.zones, openHours: x.openHours, phone: x.phone, lockerCount: ls.length, availableCount: ls.filter((l) => l.status === 'available').length };
  }
  function locationBody(b) {
    if (!str(b.name) || !str(b.address)) fail(422, 'validation', 'กรุณากรอกชื่อและที่อยู่ตึก');
    return { name: str(b.name), address: str(b.address), zones: str(b.zones), openHours: str(b.openHours), phone: str(b.phone) };
  }
  const locations = {
    'GET': (b, { id }) => id ? locationOut(byId(db.locations, id) || fail(404, 'not_found', 'ไม่พบตึก')) : db.locations.map(locationOut),
    'POST': (b) => { needAdmin(); const x = { id: nextId(db.locations), ...locationBody(b) }; db.locations.push(x); log('เพิ่มตึก', x.name); save(); return locationOut(x); },
    'PUT': (b, { id }) => { needAdmin(); const x = byId(db.locations, id) || fail(404, 'not_found', 'ไม่พบตึก'); Object.assign(x, locationBody(b)); log('แก้ไขตึก', x.name); save(); return locationOut(x); },
    'DELETE': (b, { id }) => {
      needAdmin(); const x = byId(db.locations, id) || fail(404, 'not_found', 'ไม่พบตึก');
      if (db.lockers.some((l) => l.locationId === x.id)) fail(409, 'has_lockers', 'ไม่สามารถลบตึกที่ยังมีล็อกเกอร์อยู่');
      db.locations = db.locations.filter((l) => l.id !== x.id); log('ลบตึก', x.name); save(); return true;
    },
  };

  // ---------- lockers ----------
  function lockerBody(b, cur) {
    const o = { code: str(b.code ?? cur?.code), locationId: +(b.locationId ?? cur?.locationId), size: b.size ?? cur?.size, zone: str(b.zone ?? cur?.zone), status: b.status ?? cur?.status ?? 'available' };
    if (!o.code || !byId(db.locations, o.locationId) || !['S', 'M', 'L', 'XL', 'XXL'].includes(o.size) || !['available', 'booked', 'in_use', 'maintenance'].includes(o.status)) fail(422, 'validation', 'ข้อมูลล็อกเกอร์ไม่ถูกต้อง');
    if (db.lockers.some((l) => l.code === o.code && l.id !== cur?.id)) fail(409, 'duplicate_code', 'รหัสล็อกเกอร์นี้มีอยู่แล้ว');
    return o;
  }
  const lockers = {
    'GET': (b, q) => {
      if (q.id) return lockerOut(byId(db.lockers, q.id) || fail(404, 'not_found', 'ไม่พบล็อกเกอร์'));
      const needle = str(q.q).toLowerCase();
      return db.lockers
        .filter((l) => (!q.locationId || l.locationId === +q.locationId) && (!q.size || l.size === q.size) && (!needle || l.code.toLowerCase().includes(needle)))
        .map((l) => {
          const o = lockerOut(l);
          if (q.start && q.end && l.status !== 'maintenance') o.status = overlaps(l.id, q.start, q.end) ? 'booked' : 'available';   // availability for a time window
          return o;
        })
        .filter((l) => !q.status || l.status === q.status);
    },
    'POST': (b) => { needAdmin(); const x = { id: nextId(db.lockers), ...lockerBody(b) }; db.lockers.push(x); log('เพิ่มล็อกเกอร์', x.code); save(); return lockerOut(x); },
    'PUT': (b, q) => {
      needAdmin();
      if (q.action === 'bulk') {
        const ids = (b.ids || []).map(Number);
        db.lockers.filter((l) => ids.includes(l.id)).forEach((l) => { Object.assign(l, lockerBody({ status: b.status }, l)); });
        log('เปลี่ยนสถานะล็อกเกอร์หลายรายการ', `${ids.length} รายการ → ${b.status}`); save(); return { updated: ids.length };
      }
      const x = byId(db.lockers, q.id) || fail(404, 'not_found', 'ไม่พบล็อกเกอร์');
      Object.assign(x, lockerBody(b, x)); log('แก้ไขล็อกเกอร์', `${x.code} (${x.status})`); save(); return lockerOut(x);
    },
    'DELETE': (b, { id }) => {
      needAdmin(); const x = byId(db.lockers, id) || fail(404, 'not_found', 'ไม่พบล็อกเกอร์');
      if (db.bookings.some((k) => k.lockerId === x.id && ACTIVE.includes(k.status))) fail(409, 'has_bookings', 'ล็อกเกอร์นี้มีการจองที่ยังไม่สิ้นสุด');
      db.lockers = db.lockers.filter((l) => l.id !== x.id); log('ลบล็อกเกอร์', x.code); save(); return true;
    },
  };

  // ---------- pricing ----------
  function findPromo(code) {
    const p = db.promos.find((x) => x.code === str(code).toUpperCase());
    if (!p || !p.active || (p.expiresAt && p.expiresAt < fmt(new Date()))) fail(422, 'invalid_promo', 'รหัสโปรโมชันไม่ถูกต้องหรือหมดอายุ');
    return p;
  }
  function promoBody(b) {
    const o = { code: str(b.code).toUpperCase(), type: b.type, value: +b.value, active: b.active ? 1 : 0, expiresAt: str(b.expiresAt) ? str(b.expiresAt).slice(0, 10) + ' 23:59:00' : null };
    if (!o.code || !['percent', 'fixed'].includes(o.type) || !(o.value > 0) || (o.type === 'percent' && o.value > 100)) fail(422, 'validation', 'ข้อมูลโปรโมชันไม่ถูกต้อง');
    return o;
  }
  const pricing = {
    'GET': (b, q) => {
      if (q.action === 'promo') return findPromo(q.code);
      return { prices: db.prices, promos: me() && me().role !== 'customer' ? db.promos : [] };
    },
    'POST': (b) => { needAdmin(); const x = { id: nextId(db.promos), ...promoBody(b) }; if (db.promos.some((p) => p.code === x.code)) fail(409, 'duplicate_code', 'รหัสนี้มีอยู่แล้ว'); db.promos.push(x); log('เพิ่มรหัสโปรโมชัน', x.code); save(); return x; },
    'PUT': (b, q) => {
      needAdmin();
      if (q.type === 'promo') {
        const x = byId(db.promos, q.id) || fail(404, 'not_found', 'ไม่พบโปรโมชัน'), o = promoBody(b);
        if (db.promos.some((p) => p.code === o.code && p.id !== x.id)) fail(409, 'duplicate_code', 'รหัสนี้มีอยู่แล้ว');
        Object.assign(x, o); log('แก้ไขรหัสโปรโมชัน', x.code); save(); return x; }
      const x = db.prices.find((p) => p.size === b.size) || fail(404, 'not_found', 'ไม่พบขนาด');
      ['hour', 'day', 'month'].forEach((k) => { if (!(+b[k] >= 0)) fail(422, 'validation', 'ราคาไม่ถูกต้อง'); x[k] = +b[k]; });
      log('แก้ไขราคา', `ขนาด ${x.size}`); save(); return x;
    },
    'DELETE': (b, { id }) => { needAdmin(); const x = byId(db.promos, id) || fail(404, 'not_found', 'ไม่พบโปรโมชัน'); db.promos = db.promos.filter((p) => p.id !== x.id); log('ลบรหัสโปรโมชัน', x.code); save(); return true; },
  };

  // ---------- bookings ----------
  function setLockerAfter(b) { syncLocker(b.lockerId); }
  const bookings = {
    'GET': (body, q) => {
      const u = needUser(), mine = u.role === 'customer' || q.mine;
      if (q.id || q.ref) {
        const b = db.bookings.find((x) => (q.id ? x.id === +q.id : x.ref === q.ref));
        if (!b) fail(404, 'not_found', 'ไม่พบการจอง');
        if (u.role === 'customer' && b.userId !== u.id) fail(403, 'forbidden', 'ไม่มีสิทธิ์เข้าถึง');
        return bookingOut(b);
      }
      const needle = str(q.q).toLowerCase();
      return db.bookings.map(bookingOut)
        .filter((b) => (!mine || b.userId === u.id) && (!q.status || b.status === q.status) && (!q.from || b.startAt.slice(0, 10) >= q.from) && (!q.to || b.startAt.slice(0, 10) <= q.to)
          && (!needle || [b.ref, b.customerName, b.customerEmail, b.lockerCode].some((v) => String(v).toLowerCase().includes(needle))))
        .sort((a, b) => b.startAt.localeCompare(a.startAt));
    },
    'POST': (b) => {
      const u = needUser(), locker = byId(db.lockers, b.lockerId);
      const type = b.durationType, qty = +b.quantity, startAt = str(b.startAt).replace('T', ' ');
      if (!locker) fail(422, 'validation', 'ไม่พบล็อกเกอร์');
      if (type !== 'day' || !Number.isInteger(qty) || qty < 1 || isNaN(parse(startAt))) fail(422, 'validation', 'ข้อมูลการจองไม่ถูกต้อง');
      const hours = qty * HOURS[type], s = db.settings;
      if (hours < s.minDuration || hours > s.maxDuration) fail(422, 'validation', `ระยะเวลาต้องอยู่ระหว่าง ${s.minDuration / 24} - ${s.maxDuration / 24} วัน`);
      const customer = u.role === 'customer' ? u : (byId(db.users, b.userId) || null);   // staff may book for a walk-in (no account)
      const name = str(b.customerName) || customer?.name, email = str(b.customerEmail) || customer?.email, phone = str(b.customerPhone) || customer?.phone;
      if (!name || !/^\S+@\S+\.\S+$/.test(email) || !phone) fail(422, 'validation', 'กรุณากรอกข้อมูลผู้จองให้ครบถ้วน');
      if (locker.status === 'maintenance') fail(409, 'locker_unavailable', 'ล็อกเกอร์นี้ปิดซ่อมบำรุง');
      const start = fmt(parse(startAt)), end = addHours(start, hours);
      if (overlaps(locker.id, start, end)) fail(409, 'locker_taken', 'ล็อกเกอร์นี้ถูกจองแล้วในช่วงเวลาดังกล่าว');
      const method = ['card', 'promptpay', 'cash'].includes(b.paymentMethod) ? b.paymentMethod : 'card';
      // Transfer slip (data URL). Stored as proof only — never verified.
      const slip = b.slip ? String(b.slip) : null;
      if (slip && (!SLIP_RE.test(slip) || slip.length > SLIP_MAX)) fail(422, 'invalid_slip', 'ไฟล์สลิปไม่ถูกต้อง (รองรับ JPG, PNG, WebP ขนาดไม่เกิน 2 MB)');
      if (method === 'promptpay' && !slip) fail(422, 'slip_required', 'กรุณาแนบสลิปการโอนเงิน');
      const promo = str(b.promoCode) ? findPromo(b.promoCode) : null;
      const q = quote(db.prices.find((p) => p.size === locker.size)[type], qty, promo);
      const x = {
        id: nextId(db.bookings), ref: 'LG' + (260000 + nextId(db.bookings)), userId: customer ? customer.id : null, customerName: name, customerEmail: email, customerPhone: phone,
        lockerId: locker.id, startAt: start, endAt: end, durationType: type, quantity: qty, amount: q.total, discount: q.discount, promoCode: promo ? promo.code : null,
        status: 'confirmed', pin: String(100000 + Math.floor(Math.random() * 900000)), createdAt: fmt(new Date()),
      };
      db.bookings.push(x);
      db.payments.push({ id: nextId(db.payments), bookingId: x.id, amount: x.amount, method, status: 'paid', createdAt: x.createdAt, slip });
      setLockerAfter(x); log('สร้างการจอง', x.ref); save();
      return bookingOut(x);
    },
    'PUT': (b, q) => {
      const u = needUser(), x = byId(db.bookings, q.id) || fail(404, 'not_found', 'ไม่พบการจอง');
      if (u.role === 'customer' && x.userId !== u.id) fail(403, 'forbidden', 'ไม่มีสิทธิ์เข้าถึง');
      if (q.action === 'extend') {
        const qty = +b.quantity;
        if (!Number.isInteger(qty) || qty < 1 || !ACTIVE.includes(x.status)) fail(422, 'validation', 'ไม่สามารถต่อเวลาได้');
        const end = addHours(x.endAt, qty * HOURS[x.durationType]);
        if (overlaps(x.lockerId, x.endAt, end, x.id)) fail(409, 'locker_taken', 'ล็อกเกอร์ถูกจองต่อในช่วงเวลาดังกล่าว');
        const add = quote(db.prices.find((p) => p.size === byId(db.lockers, x.lockerId).size)[x.durationType], qty, null).total;
        x.endAt = end; x.quantity += qty; x.amount += add;
        const p = db.payments.find((k) => k.bookingId === x.id); if (p) p.amount += add;
        log('ต่อเวลาการจอง', x.ref); save(); return bookingOut(x);
      }
      const status = b.status;
      if (!['pending', 'confirmed', 'active', 'completed', 'cancelled'].includes(status)) fail(422, 'validation', 'สถานะไม่ถูกต้อง');
      if (u.role === 'customer' && status !== 'cancelled') fail(403, 'forbidden', 'ไม่มีสิทธิ์เปลี่ยนสถานะนี้');
      if (['completed', 'cancelled'].includes(x.status)) fail(409, 'final_status', 'การจองนี้สิ้นสุดแล้ว');
      x.status = status;
      const p = db.payments.find((k) => k.bookingId === x.id);
      if (status === 'cancelled' && p && p.status === 'paid') p.status = 'refunded';
      syncLocker(x.lockerId); log(`เปลี่ยนสถานะการจองเป็น ${status}`, x.ref); save(); return bookingOut(x);
    },
  };

  // ---------- customers / payments / staff ----------
  function customerOut(u) {
    const bs = db.bookings.filter((b) => b.userId === u.id);
    const paid = db.payments.filter((p) => p.status === 'paid' && bs.some((b) => b.id === p.bookingId));
    return { id: u.id, username: u.username, name: u.name, email: u.email, phone: u.phone, status: u.status, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt, bookingCount: bs.length, totalSpent: paid.reduce((s, p) => s + p.amount, 0) };
  }
  const customers = {
    'GET': (b, q) => {
      needAdmin();
      if (q.id) { const u = db.users.find((x) => x.id === +q.id && x.role === 'customer') || fail(404, 'not_found', 'ไม่พบลูกค้า'); return { ...customerOut(u), bookings: db.bookings.filter((k) => k.userId === u.id).map(bookingOut).sort((a, c) => c.startAt.localeCompare(a.startAt)) }; }
      return db.users.filter((u) => u.role === 'customer').map(customerOut);
    },
    'PUT': (b, { id }) => {
      needAdmin(); const u = db.users.find((x) => x.id === +id && x.role === 'customer') || fail(404, 'not_found', 'ไม่พบลูกค้า');
      if (!['active', 'suspended'].includes(b.status)) fail(422, 'validation', 'สถานะไม่ถูกต้อง');
      u.status = b.status; log(b.status === 'suspended' ? 'ระงับลูกค้า' : 'เปิดใช้งานลูกค้า', u.name); save(); return customerOut(u);
    },
  };
  const paymentOut = (p) => { const b = byId(db.bookings, p.bookingId) || {}; const { slip, ...rest } = p; return { ...rest, hasSlip: slip ? 1 : 0, bookingRef: b.ref, customerName: b.customerName }; };
  const payments = {
    'GET': (b, q) => {
      needAdmin();
      if (q.action === 'slip') { const p = byId(db.payments, q.id) || fail(404, 'not_found', 'ไม่พบรายการชำระเงิน'); return { slip: p.slip || null }; }
      const needle = str(q.q).toLowerCase();
      return db.payments.map(paymentOut).filter((p) => (!q.status || p.status === q.status) && (!needle || [p.bookingRef, p.customerName].some((v) => String(v).toLowerCase().includes(needle)))).sort((a, c) => c.createdAt.localeCompare(a.createdAt));
    },
    'PUT': (b, { id }) => {
      needAdmin(); const p = byId(db.payments, id) || fail(404, 'not_found', 'ไม่พบรายการชำระเงิน');
      if (p.status !== 'paid') fail(409, 'not_refundable', 'คืนเงินได้เฉพาะรายการที่ชำระแล้ว');
      p.status = 'refunded'; log('คืนเงิน', paymentOut(p).bookingRef); save(); return paymentOut(p);
    },
  };
  const staffOut = (u) => ({ id: u.id, username: u.username, name: u.name, email: u.email, phone: u.phone, role: u.role, status: u.status, lastLoginAt: u.lastLoginAt });
  function staffBody(b, cur) {
    const o = { username: str(b.username).toLowerCase(), name: str(b.name), email: str(b.email).toLowerCase(), phone: str(b.phone), role: b.role, status: b.status || 'active' };
    if (!o.name || !/^\S+@\S+\.\S+$/.test(o.email) || !['super_admin', 'manager', 'staff'].includes(o.role) || (!cur && (b.password || '').length < 8)) fail(422, 'validation', 'ข้อมูลพนักงานไม่ถูกต้อง (รหัสผ่านอย่างน้อย 8 ตัวอักษร)');
    if (!USERNAME_RE.test(o.username)) fail(422, 'validation', USERNAME_INVALID);
    if (db.users.some((u) => u.username === o.username && u.id !== cur?.id)) fail(409, 'username_taken', 'ชื่อผู้ใช้นี้ถูกใช้งานแล้ว');
    if (db.users.some((u) => u.email === o.email && u.id !== cur?.id)) fail(409, 'email_taken', 'อีเมลนี้ถูกใช้งานแล้ว');
    return o;
  }
  function needSuper() { const u = needAdmin(); if (u.role !== 'super_admin') fail(403, 'forbidden', 'เฉพาะ Super Admin เท่านั้น'); return u; }
  const staff = {
    'GET': () => { needAdmin(); return db.users.filter((u) => u.role !== 'customer').map(staffOut); },
    'POST': (b) => { needSuper(); const u = { id: nextId(db.users), ...staffBody(b), password: b.password, notifyEmail: 1, notifySms: 0, createdAt: fmt(new Date()), lastLoginAt: null }; db.users.push(u); log('เพิ่มพนักงาน', u.name); save(); return staffOut(u); },
    'PUT': (b, { id }) => {
      const me_ = needSuper(), u = db.users.find((x) => x.id === +id && x.role !== 'customer') || fail(404, 'not_found', 'ไม่พบพนักงาน');
      const o = staffBody(b, u);
      if (u.id === me_.id && (o.role !== 'super_admin' || o.status !== 'active')) fail(409, 'self_demote', 'ไม่สามารถลดสิทธิ์หรือระงับบัญชีของตนเองได้');
      Object.assign(u, o); if (b.password) u.password = b.password; log('แก้ไขพนักงาน', u.name); save(); return staffOut(u);
    },
    'DELETE': (b, { id }) => {
      const me_ = needSuper(), u = db.users.find((x) => x.id === +id && x.role !== 'customer') || fail(404, 'not_found', 'ไม่พบพนักงาน');
      if (u.id === me_.id) fail(409, 'self_delete', 'ไม่สามารถลบบัญชีของตนเองได้');
      db.users = db.users.filter((x) => x.id !== u.id); log('ลบพนักงาน', u.name); save(); return true;
    },
  };

  // ---------- reports / activity / settings ----------
  const reports = {
    'GET': (b, q) => {
      needAdmin();
      const to = q.to || today(), from = q.from || fmt(new Date(parse(to + ' 00:00').getTime() - 29 * 86400000)).slice(0, 10);
      const days = []; for (let d = parse(from + ' 00:00'); fmt(d).slice(0, 10) <= to; d = new Date(d.getTime() + 86400000)) days.push(fmt(d).slice(0, 10));
      const inRange = (s) => s.slice(0, 10) >= from && s.slice(0, 10) <= to;
      const paid = db.payments.filter((p) => p.status === 'paid');
      const count = db.lockers.length, st = (k) => db.lockers.filter((l) => l.status === k).length;
      const month = today().slice(0, 7);
      const top = db.locations.map((l) => {
        const ids = db.lockers.filter((x) => x.locationId === l.id).map((x) => x.id), bs = db.bookings.filter((x) => ids.includes(x.lockerId) && inRange(x.startAt));
        return { locationId: l.id, name: l.name, bookings: bs.length, revenue: paid.filter((p) => bs.some((x) => x.id === p.bookingId)).reduce((s, p) => s + p.amount, 0), occupancy: ids.length ? Math.round(db.lockers.filter((x) => x.locationId === l.id && ['booked', 'in_use'].includes(x.status)).length / ids.length * 100) : 0 };
      }).sort((a, c) => c.revenue - a.revenue);
      return {
        from, to,
        kpis: {
          totalLockers: count, availableNow: st('available'), bookingsToday: db.bookings.filter((x) => x.startAt.slice(0, 10) === today()).length,
          revenueMonth: paid.filter((p) => p.createdAt.slice(0, 7) === month).reduce((s, p) => s + p.amount, 0),
          occupancyRate: count ? Math.round((st('booked') + st('in_use')) / count * 100) : 0,
          rangeBookings: db.bookings.filter((x) => inRange(x.startAt)).length, rangeRevenue: paid.filter((p) => inRange(p.createdAt)).reduce((s, p) => s + p.amount, 0),
        },
        bookingsByDay: days.map((d) => ({ date: d, count: db.bookings.filter((x) => x.startAt.slice(0, 10) === d).length })),
        revenueByDay: days.map((d) => ({ date: d, amount: paid.filter((p) => p.createdAt.slice(0, 10) === d).reduce((s, p) => s + p.amount, 0) })),
        statusCounts: { available: st('available'), booked: st('booked'), in_use: st('in_use'), maintenance: st('maintenance') },
        topLocations: top,
        attention: db.lockers.filter((l) => l.status === 'maintenance').map(lockerOut),
        recent: [...db.bookings].sort((a, c) => c.createdAt.localeCompare(a.createdAt)).slice(0, 8).map(bookingOut),
      };
    },
  };
  const activity = { 'GET': (b, q) => { needAdmin(); return [...db.activity].sort((a, c) => c.createdAt.localeCompare(a.createdAt) || c.id - a.id).slice(0, +q.limit || 200); } };
  const settings = {
    'GET': () => db.settings,
    'PUT': (b) => {
      needAdmin(); if (!str(b.siteName)) fail(422, 'validation', 'กรุณากรอกชื่อเว็บไซต์');
      if (b.minDuration != null && b.maxDuration != null && +b.minDuration > +b.maxDuration) fail(422, 'validation', 'ระยะเวลาขั้นต่ำต้องไม่มากกว่าระยะเวลาสูงสุด');
      Object.assign(db.settings, b); log('แก้ไขการตั้งค่าระบบ', 'ตั้งค่า'); save(); return db.settings; },
    'POST': (b, q) => { if (q.action !== 'reset') fail(400, 'bad_request', 'Unknown action'); needAdmin(); const keep = session(); db = MockData.build(); setSession(keep); save(); return true; },
  };

  const routes = { auth, locations, lockers, pricing, bookings, customers, payments, staff, reports, 'activity-log': activity, settings };

  /** Entry point used by data-service. Resource 'auth' routes by `action`, everything else by HTTP method. */
  async function handle(method, resource, { query = {}, body = {} } = {}) {
    if (!db) load();
    await new Promise((r) => setTimeout(r, 80));   // small delay so loading states are visible
    const r = routes[resource];
    if (!r) fail(404, 'not_found', 'Unknown resource');
    const fn = resource === 'auth' ? r[`${method} ${query.action}`] : r[method];
    if (!fn) fail(405, 'method_not_allowed', 'Method not allowed');
    return JSON.parse(JSON.stringify(fn(body, query) ?? null));   // deep copy: callers can never mutate the store
  }

  return { handle, reset() { db = MockData.build(); save(); } };
})();
