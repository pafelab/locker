<?php
/**
 * Bookings.
 *   GET [?id= | ?ref= | ?q=&status=&from=&to=&mine=]   (login required; customers only ever see their own)
 *   POST                                                 create (price is always computed server-side)
 *   PUT ?id=&action=extend  body {quantity}              extend by N units
 *   PUT ?id=[&action=status] body {status}               change status
 */
require __DIR__ . '/helpers.php';

const BOOKING_STATUSES = ['pending', 'confirmed', 'active', 'completed', 'cancelled'];

/** Unit price (baht) of one hour/day/month for a locker size. */
function unit_price(string $size, string $type): int
{
    $col = LG_PRICE_COLUMN[$type];
    $row = db_one("SELECT $col AS unit FROM pricing WHERE size = ?", [$size]);
    if (!$row) {
        fail(422, 'validation', 'ไม่พบราคาของล็อกเกอร์ขนาดนี้');
    }
    return (int)$row['unit'];
}

function num_text(float $n): string
{
    return is_finite($n) && floor($n) == $n ? (string)(int)$n : (string)$n;
}

function bookings_get(array $u): never
{
    $mine = $u['role'] === 'customer' || qparam('mine') !== null;
    $idQ = qparam('id');
    $refQ = qparam('ref');

    if ($idQ !== null || $refQ !== null) {
        if ($idQ !== null) {
            $row = db_one(BOOKING_SELECT . ' WHERE b.id = ?', [qint($idQ)]);
        } else {
            $row = db_one(BOOKING_SELECT . ' WHERE b.ref = ?', [$refQ]);
            if ($row && $row['ref'] !== $refQ) {
                $row = null;
            }
        }
        if (!$row) {
            fail(404, 'not_found', 'ไม่พบการจอง');
        }
        if ($u['role'] === 'customer' && (int)$row['user_id'] !== (int)$u['id']) {
            fail(403, 'forbidden', 'ไม่มีสิทธิ์เข้าถึง');
        }
        ok(map_booking($row));
    }

    $where = [];
    $params = [];
    if ($mine) {
        $where[] = 'b.user_id = ?';
        $params[] = (int)$u['id'];
    }
    $status = qparam('status');
    if ($status !== null) {
        if (!in_array($status, BOOKING_STATUSES, true)) {
            ok([]);
        }
        $where[] = 'b.status = ?';
        $params[] = $status;
    }
    $from = qparam('from');
    if ($from !== null && valid_ymd(s_sub($from, 0, 10))) {
        $where[] = 'DATE(b.start_at) >= ?';
        $params[] = s_sub($from, 0, 10);
    }
    $to = qparam('to');
    if ($to !== null && valid_ymd(s_sub($to, 0, 10))) {
        $where[] = 'DATE(b.start_at) <= ?';
        $params[] = s_sub($to, 0, 10);
    }
    $needle = str(qparam('q'));
    if ($needle !== '') {
        $like = like_term($needle);
        $where[] = "(b.ref LIKE ? ESCAPE '|' OR b.customer_name LIKE ? ESCAPE '|' OR b.customer_email LIKE ? ESCAPE '|' OR l.code LIKE ? ESCAPE '|')";
        array_push($params, $like, $like, $like, $like);
    }
    $sql = BOOKING_SELECT . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY b.start_at DESC, b.id ASC';
    ok(array_map('map_booking', db_all($sql, $params)));
}

function bookings_create(array $u): never
{
    $b = body();
    $locker = db_one('SELECT * FROM lockers WHERE id = ?', [qint($b['lockerId'] ?? null)]);
    $type = $b['durationType'] ?? null;
    $qty = to_num($b['quantity'] ?? null);
    $start = parse_dt(str($b['startAt'] ?? null));

    if (!$locker) {
        fail(422, 'validation', 'ไม่พบล็อกเกอร์');
    }
    if (!is_string($type) || !isset(LG_HOURS[$type]) || !is_int_num($qty) || $qty < 1 || $start === null) {
        fail(422, 'validation', 'ข้อมูลการจองไม่ถูกต้อง');
    }
    $hours = $qty * LG_HOURS[$type];
    $s = settings_all();
    $min = array_key_exists('minDuration', $s) ? to_num($s['minDuration']) : 1.0;
    $max = array_key_exists('maxDuration', $s) ? to_num($s['maxDuration']) : 720.0;
    if ($hours < $min || $hours > $max || $hours > 100000) {
        fail(422, 'validation', 'ระยะเวลาต้องอยู่ระหว่าง ' . num_text($min) . ' - ' . num_text($max) . ' ชั่วโมง');
    }

    // customers book for themselves; staff may book for a customer account or a walk-in (no account)
    $customer = $u['role'] === 'customer'
        ? $u
        : db_one("SELECT * FROM users WHERE id = ? AND role = 'customer'", [qint($b['userId'] ?? null)]);
    $name = str($b['customerName'] ?? null);
    $email = str($b['customerEmail'] ?? null);
    $phone = str($b['customerPhone'] ?? null);
    if ($name === '' && $customer) {
        $name = (string)$customer['name'];
    }
    if ($email === '' && $customer) {
        $email = (string)$customer['email'];
    }
    if ($phone === '' && $customer) {
        $phone = (string)$customer['phone'];
    }
    if ($name === '' || !valid_email($email) || $phone === '' || s_len($name) > 120 || s_len($email) > 190 || s_len($phone) > 30) {
        fail(422, 'validation', 'กรุณากรอกข้อมูลผู้จองให้ครบถ้วน');
    }

    $qtyInt = (int)$qty;
    $hoursInt = (int)$hours;
    $startAt = $start->format('Y-m-d H:i:00');
    $endAt = (new DateTimeImmutable($startAt))->modify('+' . $hoursInt . ' hours')->format('Y-m-d H:i:00');
    $lockerId = (int)$locker['id'];
    $method = $b['paymentMethod'] ?? null;
    $payMethod = (is_string($method) && in_array($method, ['card', 'promptpay', 'cash'], true)) ? $method : 'card';
    $promoCode = str($b['promoCode'] ?? null);

    $newId = db_tx(static function () use ($lockerId, $startAt, $endAt, $type, $qtyInt, $customer, $name, $email, $phone, $payMethod, $promoCode, $locker): int {
        // serialise concurrent bookings of the same locker, then re-check availability on the latest committed data
        $lk = db_one('SELECT id, status FROM lockers WHERE id = ? FOR UPDATE', [$lockerId]);
        if (!$lk) {
            fail(422, 'validation', 'ไม่พบล็อกเกอร์');
        }
        if ($lk['status'] === 'maintenance') {
            fail(409, 'locker_unavailable', 'ล็อกเกอร์นี้ปิดซ่อมบำรุง');
        }
        if (has_overlap($lockerId, $startAt, $endAt, 0, true)) {
            fail(409, 'locker_taken', 'ล็อกเกอร์นี้ถูกจองแล้วในช่วงเวลาดังกล่าว');
        }
        $promo = $promoCode !== '' ? find_promo($promoCode) : null;
        $q = quote_price(unit_price((string)$locker['size'], $type), $qtyInt, $promo);
        $now = now_str();

        db_exec(
            'INSERT INTO bookings (ref, user_id, customer_name, customer_email, customer_phone, locker_id, start_at, end_at, duration_type, quantity, amount, discount, promo_code, status, pin, created_at) '
            . "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?)",
            [
                'T' . bin2hex(random_bytes(7)),   // temporary unique ref, replaced below once the id is known
                $customer ? (int)$customer['id'] : null, $name, $email, $phone, $lockerId, $startAt, $endAt, $type, $qtyInt,
                $q['total'], $q['discount'], $promo ? $promo['code'] : null, (string)random_int(100000, 999999), $now,
            ]
        );
        $id = (int)db()->lastInsertId();
        $ref = 'LG' . (260000 + $id);
        db_exec('UPDATE bookings SET ref = ? WHERE id = ?', [$ref, $id]);
        db_exec(
            "INSERT INTO payments (booking_id, amount, method, status, created_at) VALUES (?, ?, ?, 'paid', ?)",
            [$id, $q['total'], $payMethod, $now]
        );
        sync_locker($lockerId);
        log_activity('สร้างการจอง', $ref);
        return $id;
    });
    ok(fetch_booking($newId), 201);
}

function bookings_update(array $u): never
{
    $id = qint(qparam('id'));
    $x = $id > 0 ? db_one('SELECT * FROM bookings WHERE id = ?', [$id]) : null;
    if (!$x) {
        fail(404, 'not_found', 'ไม่พบการจอง');
    }
    if ($u['role'] === 'customer' && (int)$x['user_id'] !== (int)$u['id']) {
        fail(403, 'forbidden', 'ไม่มีสิทธิ์เข้าถึง');
    }
    $b = body();
    $lockerId = (int)$x['locker_id'];

    if (qparam('action') === 'extend') {
        $qty = to_num($b['quantity'] ?? null);
        if (!is_int_num($qty) || $qty < 1 || $qty > 100000 || !in_array($x['status'], LG_ACTIVE, true)) {
            fail(422, 'validation', 'ไม่สามารถต่อเวลาได้');
        }
        $qtyInt = (int)$qty;
        db_tx(static function () use ($id, $lockerId, $qtyInt): void {
            db_one('SELECT id FROM lockers WHERE id = ? FOR UPDATE', [$lockerId]);
            $cur = db_one('SELECT * FROM bookings WHERE id = ? FOR UPDATE', [$id]);
            if (!$cur || !in_array($cur['status'], LG_ACTIVE, true)) {
                fail(422, 'validation', 'ไม่สามารถต่อเวลาได้');
            }
            $end = (new DateTimeImmutable((string)$cur['end_at']))
                ->modify('+' . ($qtyInt * LG_HOURS[$cur['duration_type']]) . ' hours')->format('Y-m-d H:i:00');
            if (has_overlap($lockerId, (string)$cur['end_at'], $end, $id, true)) {
                fail(409, 'locker_taken', 'ล็อกเกอร์ถูกจองต่อในช่วงเวลาดังกล่าว');
            }
            $size = (string)db_val('SELECT size FROM lockers WHERE id = ?', [$lockerId]);
            $add = quote_price(unit_price($size, (string)$cur['duration_type']), $qtyInt, null)['total'];
            db_exec('UPDATE bookings SET end_at = ?, quantity = quantity + ?, amount = amount + ? WHERE id = ?', [$end, $qtyInt, $add, $id]);
            $payId = db_val('SELECT MIN(id) FROM payments WHERE booking_id = ?', [$id]);
            if ($payId !== null) {
                db_exec('UPDATE payments SET amount = amount + ? WHERE id = ?', [$add, (int)$payId]);
            }
            log_activity('ต่อเวลาการจอง', (string)$cur['ref']);
        });
        ok(fetch_booking($id));
    }

    $status = $b['status'] ?? null;
    if (!is_string($status) || !in_array($status, BOOKING_STATUSES, true)) {
        fail(422, 'validation', 'สถานะไม่ถูกต้อง');
    }
    if ($u['role'] === 'customer' && $status !== 'cancelled') {
        fail(403, 'forbidden', 'ไม่มีสิทธิ์เปลี่ยนสถานะนี้');
    }
    if (in_array($x['status'], ['completed', 'cancelled'], true)) {
        fail(409, 'final_status', 'การจองนี้สิ้นสุดแล้ว');
    }
    db_tx(static function () use ($id, $lockerId, $status): void {
        db_one('SELECT id FROM lockers WHERE id = ? FOR UPDATE', [$lockerId]);
        $cur = db_one('SELECT * FROM bookings WHERE id = ? FOR UPDATE', [$id]);
        if (!$cur || in_array($cur['status'], ['completed', 'cancelled'], true)) {
            fail(409, 'final_status', 'การจองนี้สิ้นสุดแล้ว');
        }
        db_exec('UPDATE bookings SET status = ? WHERE id = ?', [$status, $id]);
        if ($status === 'cancelled') {
            $payId = db_val('SELECT MIN(id) FROM payments WHERE booking_id = ?', [$id]);
            if ($payId !== null) {
                db_exec("UPDATE payments SET status = 'refunded' WHERE id = ? AND status = 'paid'", [(int)$payId]);
            }
        }
        sync_locker((int)$cur['locker_id']);
        log_activity('เปลี่ยนสถานะการจองเป็น ' . $status, (string)$cur['ref']);
    });
    ok(fetch_booking($id));
}

switch (method()) {
    case 'GET':
        bookings_get(require_login());
    case 'POST':
        bookings_create(require_login());
    case 'PUT':
        bookings_update(require_login());
    default:
        fail(405, 'method_not_allowed', 'Method not allowed');
}
