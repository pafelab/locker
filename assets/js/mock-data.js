/**
 * Mock data for LockerGo. Deterministic (seeded PRNG) and expressed as HOUR OFFSETS
 * from today 00:00, so the demo always looks current.
 * database/seed.sql is generated from raw() by tools/make-seed.js, so both modes hold the same records.
 *   MockData.raw()    -> tables with *H offsets (used by the seed generator)
 *   MockData.build()  -> tables with real 'YYYY-MM-DD HH:MM:SS' strings (used by mock-service)
 */
(function (root) {
  const SIZES = ['S', 'M', 'L', 'XL', 'XXL'];
  // [hour, day, month] — bookings are daily only; hour/month are kept in the table but not offered
  const PRICES = { S: [10, 50, 800], M: [15, 80, 1200], L: [25, 120, 1800], XL: [40, 200, 3000], XXL: [60, 300, 4500] };
  const HOURS_PER = { hour: 1, day: 24, month: 720 };

  function rng(seed) { // mulberry32
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function raw() {
    const r = rng(20261007);
    const int = (a, b) => a + Math.floor(r() * (b - a + 1));
    const pick = (a) => a[Math.floor(r() * a.length)];

    // ---- locations = buildings; each building stores ONE size: ตึก 1 = S, ตึก 2 = M, ตึก 3 = L, ตึก 4 = XL, ตึก 5 = XXL ----
    const UNI = 'มหาวิทยาลัยเทคโนโลยีราชมงคลสุวรรณภูมิ';
    const locations = SIZES.map((size, i) => ({
      id: i + 1, name: `ตึก ${i + 1}`, address: `ชั้น 1 ตึก ${i + 1} ${UNI}`, zones: 'A', openHours: '07:00 - 20:00',
      phone: `035-709-10${i + 1}`, prefix: `T${i + 1}`, size,
    }));

    // ---- lockers: smaller sizes get more lockers (16 + 14 + 12 + 10 + 8 = 60) ----
    const lockers = [];
    const mix = { S: 16, M: 14, L: 12, XL: 10, XXL: 8 };
    locations.forEach((loc) => {
      for (let n = 1; n <= mix[loc.size]; n++) {
        lockers.push({
          id: lockers.length + 1, code: `${loc.prefix}-${loc.size}${String(n).padStart(2, '0')}`,
          locationId: loc.id, size: loc.size, zone: 'A', status: 'available',
        });
      }
    });
    locations.forEach((l) => { delete l.size; });

    // ---- users: 1-3 staff, 4-18 customers ----
    const names = ['สมชาย ใจดี', 'สุดา รักเรียน', 'ปกรณ์ วงศ์สุวรรณ', 'นภัสสร แก้วมณี', 'ธนากร ศรีสุข', 'พิมพ์ชนก อินทร์แก้ว',
      'อนุชา เจริญผล', 'กัญญารัตน์ ทองดี', 'วีระพงษ์ สุขใจ', 'ชลธิชา บุญมา', 'ภานุวัฒน์ รุ่งเรือง', 'ศิริพร จันทร์เพ็ญ',
      'ณัฐพล พรหมมา', 'จิราพร สายสุวรรณ', 'เอกชัย มั่นคง'];
    const users = [
      { id: 1, username: 'admin', name: 'ผู้ดูแลระบบ', email: 'admin@demo.com', phone: '081-000-0001', role: 'super_admin', password: 'admin1234' },
      { id: 2, username: 'manager', name: 'มานี ผู้จัดการ', email: 'manager@demo.com', phone: '081-000-0002', role: 'manager', password: 'admin1234' },
      { id: 3, username: 'staff', name: 'สมศักดิ์ พนักงาน', email: 'staff@demo.com', phone: '081-000-0003', role: 'staff', password: 'admin1234' },
    ];
    names.forEach((name, i) => users.push({
      id: 4 + i, username: i === 0 ? 'user' : `customer${i}`, name, email: i === 0 ? 'user@demo.com' : `customer${i}@example.com`,
      phone: `08${int(1, 9)}-${int(100, 999)}-${int(1000, 9999)}`, role: 'customer', password: 'demo1234',
    }));
    users.forEach((u, i) => {
      u.status = (u.role === 'customer' && (u.id === 12 || u.id === 17)) ? 'suspended' : 'active';
      u.notifyEmail = 1; u.notifySms = u.id % 3 === 0 ? 1 : 0;
      u.createdH = -24 * (120 - i * 5); u.lastLoginH = -int(1, 400);
    });

    // ---- bookings: 60, no overlaps on the same locker ----
    const bookings = [];
    const taken = {}; // lockerId -> [[startH,endH]]
    const free = (lid, s, e) => !(taken[lid] || []).some(([a, b]) => s < b && e > a);
    const price = (size, type) => PRICES[size][['hour', 'day', 'month'].indexOf(type)];
    const plan = [];
    for (let i = 0; i < 40; i++) plan.push('completed');
    for (let i = 0; i < 6; i++) plan.push('active');
    for (let i = 0; i < 4; i++) plan.push('today');
    for (let i = 0; i < 6; i++) plan.push('confirmed');
    for (let i = 0; i < 2; i++) plan.push('pending');
    for (let i = 0; i < 2; i++) plan.push('cancelled');
    plan.forEach((kind) => {
      for (let tries = 0; tries < 50; tries++) {
        const locker = pick(lockers);
        const type = 'day';   // daily bookings only
        let qty = int(1, 3), startH;
        if (kind === 'completed') startH = -24 * int(4, 45) + int(8, 18);
        else if (kind === 'active') { const back = int(1, 2); qty = back + int(1, 3); startH = -24 * back + int(8, 18); }
        else if (kind === 'today') { qty = 1; startH = int(8, 18); }
        else startH = 24 * int(1, 10) + int(8, 18);
        const endH = startH + qty * HOURS_PER[type];
        if (!free(locker.id, startH, endH)) continue;
        (taken[locker.id] = taken[locker.id] || []).push([startH, endH]);
        const user = users[3 + int(0, 14)];
        const promo = r() < .15 ? 'WELCOME10' : null;
        const gross = price(locker.size, type) * qty;
        const discount = promo ? Math.round(gross * .1) : 0;
        const status = kind === 'today' ? pick(['confirmed', 'active', 'completed']) : kind;
        bookings.push({
          id: bookings.length + 1, ref: 'LG' + String(260000 + bookings.length + 1), userId: user.id,
          customerName: user.name, customerEmail: user.email, customerPhone: user.phone,
          lockerId: locker.id, startH, endH, durationType: type, quantity: qty,
          amount: gross - discount, discount, promoCode: promo, status,
          pin: String(int(100000, 999999)), createdH: startH - int(6, 72),
        });
        return;
      }
    });
    bookings.sort((a, b) => a.createdH - b.createdH).forEach((b, i) => { b.id = i + 1; b.ref = 'LG' + (260001 + i); });

    // ---- locker status from bookings (+ 4 maintenance on untouched lockers) ----
    const L = Object.fromEntries(lockers.map((l) => [l.id, l]));
    bookings.forEach((b) => {
      if (b.status === 'active') L[b.lockerId].status = 'in_use';
      else if (b.status === 'confirmed' && L[b.lockerId].status === 'available') L[b.lockerId].status = 'booked';
    });
    lockers.filter((l) => !taken[l.id]).slice(0, 4).forEach((l) => { l.status = 'maintenance'; });

    // ---- payments: one per booking ----
    const payments = bookings.map((b, i) => ({
      id: i + 1, bookingId: b.id, amount: b.amount, method: pick(['promptpay', 'card', 'card', 'cash']),
      status: b.status === 'pending' ? 'pending' : b.status === 'cancelled' ? 'refunded' : 'paid',
      createdH: b.createdH,
    }));

    const prices = SIZES.map((size) => ({ size, hour: PRICES[size][0], day: PRICES[size][1], month: PRICES[size][2] }));
    const promos = [
      { id: 1, code: 'WELCOME10', type: 'percent', value: 10, active: 1, expiresH: 24 * 180 },
      { id: 2, code: 'SONGKRAN50', type: 'fixed', value: 50, active: 1, expiresH: 24 * 60 },
      { id: 3, code: 'OLDPROMO', type: 'percent', value: 20, active: 0, expiresH: -24 * 30 },
    ];

    const acts = [['เพิ่มล็อกเกอร์', 'T1-S01'], ['แก้ไขราคา', 'ขนาด M'], ['ยกเลิกการจอง', 'LG260012'], ['เปลี่ยนสถานะล็อกเกอร์', 'T3-L02 → ซ่อมบำรุง'],
      ['ยืนยันการจอง', 'LG260030'], ['คืนเงิน', 'LG260012'], ['เพิ่มรหัสโปรโมชัน', 'SONGKRAN50'], ['แก้ไขตึก', 'ตึก 4'],
      ['ปิดการจอง (เสร็จสิ้น)', 'LG260021'], ['แก้ไขการตั้งค่าระบบ', 'กฎการจอง']];
    const activity = [];
    for (let i = 0; i < 24; i++) {
      const a = acts[i % acts.length], u = users[i % 3];
      activity.push({ id: i + 1, actorId: u.id, actor: u.name, action: a[0], target: a[1], createdH: -(i * 7 + int(1, 6)) });
    }
    activity.reverse().forEach((a, i) => { a.id = i + 1; });

    const settings = {
      siteName: 'LockerGo', tagline: 'ล็อกเกอร์ปลอดภัย จองง่าย ใช้ได้ทันที',
      contactEmail: 'hello@lockergo.example', contactPhone: '035-709-100', address: 'มหาวิทยาลัยเทคโนโลยีราชมงคลสุวรรณภูมิ',
      minDuration: 24, maxDuration: 720,   // stored in HOURS: 1 to 30 days (daily bookings only)
      gracePeriod: 15, cancelFreeHours: 24,
      cancelPolicy: 'ยกเลิกฟรีก่อนเวลาเริ่มใช้งาน 24 ชั่วโมง หลังจากนั้นคืนเงิน 50%',
      tplConfirm: 'การจอง {ref} ยืนยันแล้ว ล็อกเกอร์ {locker} รหัส PIN {pin}',
      tplReminder: 'แจ้งเตือน: การจอง {ref} จะเริ่มใช้งานพรุ่งนี้',
      tplCancel: 'การจอง {ref} ถูกยกเลิกแล้ว ขอบคุณที่ใช้บริการ',
      defaultTheme: 'light',
    };

    return { users, locations, lockers, bookings, payments, prices, promos, activity, settings };
  }

  const pad = (n) => String(n).padStart(2, '0');
  function at(h, base) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0);
    d.setHours(d.getHours() + h);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
  }

  /** Same tables, *H offsets replaced by date strings (createdAt, startAt, endAt, expiresAt, lastLoginAt). */
  function build(now) {
    now = now || new Date();
    const db = raw();
    const conv = (rows, map) => rows.forEach((x) => Object.keys(map).forEach((k) => {
      if (x[k + 'H'] != null) { x[map[k]] = at(x[k + 'H'], now); delete x[k + 'H']; }
    }));
    conv(db.users, { created: 'createdAt', lastLogin: 'lastLoginAt' });
    conv(db.bookings, { start: 'startAt', end: 'endAt', created: 'createdAt' });
    conv(db.payments, { created: 'createdAt' });
    conv(db.promos, { expires: 'expiresAt' });
    conv(db.activity, { created: 'createdAt' });
    return db;
  }

  root.MockData = { raw, build, HOURS_PER };
  if (typeof module !== 'undefined') module.exports = root.MockData;
})(typeof window !== 'undefined' ? window : globalThis);
