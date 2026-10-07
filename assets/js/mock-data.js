/**
 * Mock data for LockerGo. Deterministic (seeded PRNG) and expressed as HOUR OFFSETS
 * from today 00:00, so the demo always looks current.
 * database/seed.sql is generated from raw() by tools/make-seed.js, so both modes hold the same records.
 *   MockData.raw()    -> tables with *H offsets (used by the seed generator)
 *   MockData.build()  -> tables with real 'YYYY-MM-DD HH:MM:SS' strings (used by mock-service)
 */
(function (root) {
  const SIZES = ['S', 'M', 'L', 'XL'];
  const PRICES = { S: [10, 50, 800], M: [15, 80, 1200], L: [25, 120, 1800], XL: [40, 200, 3000] };
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

    // ---- locations ----
    const locations = [
      { id: 1, name: 'LockerGo สยามสแควร์', address: 'ซอย 3 ถนนพระราม 1 แขวงวังใหม่ เขตปทุมวัน กรุงเทพฯ 10330', zones: 'A, B', openHours: '08:00 - 22:00', phone: '02-123-4501', prefix: 'SI' },
      { id: 2, name: 'LockerGo หมอชิต', address: 'สถานีขนส่งผู้โดยสารกรุงเทพ (จตุจักร) ถนนกำแพงเพชร 2 กรุงเทพฯ 10900', zones: 'A, B', openHours: '06:00 - 23:00', phone: '02-123-4502', prefix: 'MO' },
      { id: 3, name: 'LockerGo สุวรรณภูมิ', address: 'ท่าอากาศยานสุวรรณภูมิ อาคารผู้โดยสาร ชั้น 2 บางพลี สมุทรปราการ 10540', zones: 'A, B', openHours: '24 ชั่วโมง', phone: '02-123-4503', prefix: 'SU' },
      { id: 4, name: 'LockerGo เชียงใหม่ นิมมาน', address: 'ถนนนิมมานเหมินท์ ซอย 9 อ.เมือง จ.เชียงใหม่ 50200', zones: 'A, B', openHours: '09:00 - 21:00', phone: '053-123-450', prefix: 'CM' },
    ];

    // ---- lockers: 16 per location (6 S, 5 M, 3 L, 2 XL) = 64 ----
    const lockers = [];
    const mix = { S: 6, M: 5, L: 3, XL: 2 };
    locations.forEach((loc) => {
      SIZES.forEach((size) => {
        for (let n = 1; n <= mix[size]; n++) {
          lockers.push({
            id: lockers.length + 1, code: `${loc.prefix}-${size}${String(n).padStart(2, '0')}`,
            locationId: loc.id, size, zone: size === 'S' || size === 'M' ? 'A' : 'B', status: 'available',
          });
        }
      });
    });

    // ---- users: 1-3 staff, 4-18 customers ----
    const names = ['สมชาย ใจดี', 'สุดา รักเรียน', 'ปกรณ์ วงศ์สุวรรณ', 'นภัสสร แก้วมณี', 'ธนากร ศรีสุข', 'พิมพ์ชนก อินทร์แก้ว',
      'อนุชา เจริญผล', 'กัญญารัตน์ ทองดี', 'วีระพงษ์ สุขใจ', 'ชลธิชา บุญมา', 'ภานุวัฒน์ รุ่งเรือง', 'ศิริพร จันทร์เพ็ญ',
      'ณัฐพล พรหมมา', 'จิราพร สายสุวรรณ', 'เอกชัย มั่นคง'];
    const users = [
      { id: 1, name: 'ผู้ดูแลระบบ', email: 'admin@demo.com', phone: '081-000-0001', role: 'super_admin', password: 'admin1234' },
      { id: 2, name: 'มานี ผู้จัดการ', email: 'manager@demo.com', phone: '081-000-0002', role: 'manager', password: 'admin1234' },
      { id: 3, name: 'สมศักดิ์ พนักงาน', email: 'staff@demo.com', phone: '081-000-0003', role: 'staff', password: 'admin1234' },
    ];
    names.forEach((name, i) => users.push({
      id: 4 + i, name, email: i === 0 ? 'user@demo.com' : `customer${i}@example.com`,
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
        let type = 'hour', qty = int(1, 12), startH;
        if (kind === 'completed') {
          const d = int(2, 45);
          if (r() < .5) { type = 'day'; qty = int(1, 2); }
          if (d > 35 && r() < .3) { type = 'month'; qty = 1; }
          startH = -24 * d + int(8, 20);
        } else if (kind === 'active') { type = 'day'; qty = int(2, 5); startH = -24 + int(8, 20); }
        else if (kind === 'today') { startH = int(9, 20); }
        else { startH = 24 * int(1, 10) + int(8, 20); if (r() < .4) { type = 'day'; qty = int(1, 3); } }
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

    const acts = [['เพิ่มล็อกเกอร์', 'SI-S01'], ['แก้ไขราคา', 'ขนาด M'], ['ยกเลิกการจอง', 'LG260012'], ['เปลี่ยนสถานะล็อกเกอร์', 'MO-L02 → ซ่อมบำรุง'],
      ['ยืนยันการจอง', 'LG260030'], ['คืนเงิน', 'LG260012'], ['เพิ่มรหัสโปรโมชัน', 'SONGKRAN50'], ['แก้ไขสาขา', 'LockerGo เชียงใหม่ นิมมาน'],
      ['ปิดการจอง (เสร็จสิ้น)', 'LG260021'], ['แก้ไขการตั้งค่าระบบ', 'กฎการจอง']];
    const activity = [];
    for (let i = 0; i < 24; i++) {
      const a = acts[i % acts.length], u = users[i % 3];
      activity.push({ id: i + 1, actorId: u.id, actor: u.name, action: a[0], target: a[1], createdH: -(i * 7 + int(1, 6)) });
    }
    activity.reverse().forEach((a, i) => { a.id = i + 1; });

    const settings = {
      siteName: 'LockerGo', tagline: 'ล็อกเกอร์ปลอดภัย จองง่าย ใช้ได้ทันที',
      contactEmail: 'hello@lockergo.example', contactPhone: '02-123-4500', address: '99 อาคารตัวอย่าง ถนนพระราม 1 กรุงเทพฯ 10330',
      minDuration: 1, maxDuration: 720, gracePeriod: 15, cancelFreeHours: 24,
      cancelPolicy: 'ยกเลิกฟรีก่อนเวลาเริ่มใช้งาน 24 ชั่วโมง หลังจากนั้นคืนเงิน 50%',
      tplConfirm: 'การจอง {ref} ยืนยันแล้ว ล็อกเกอร์ {locker} รหัส PIN {pin}',
      tplReminder: 'แจ้งเตือน: การจอง {ref} จะเริ่มใช้งานในอีก 1 ชั่วโมง',
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
