<?php
/**
 * Customers (staff only). GET [?id= -> customer + bookings[]] | PUT ?id= body {status: active|suspended}
 */
require __DIR__ . '/helpers.php';

switch (method()) {
    case 'GET':
        require_admin();
        $idQ = qparam('id');
        if ($idQ !== null) {
            $c = fetch_customer(qint($idQ));
            if (!$c) {
                fail(404, 'not_found', 'ไม่พบลูกค้า');
            }
            $c['bookings'] = array_map(
                'map_booking',
                db_all(BOOKING_SELECT . ' WHERE b.user_id = ? ORDER BY b.start_at DESC, b.id ASC', [$c['id']])
            );
            ok($c);
        }
        ok(array_map('map_customer', db_all(CUSTOMER_SELECT . " WHERE u.role = 'customer' ORDER BY u.id")));

    case 'PUT':
        require_admin();
        $id = qint(qparam('id'));
        $c = fetch_customer($id);
        if (!$c) {
            fail(404, 'not_found', 'ไม่พบลูกค้า');
        }
        $b = body();
        $status = $b['status'] ?? null;
        if (!is_string($status) || !in_array($status, ['active', 'suspended'], true)) {
            fail(422, 'validation', 'สถานะไม่ถูกต้อง');
        }
        db_exec("UPDATE users SET status = ? WHERE id = ? AND role = 'customer'", [$status, $id]);
        log_activity($status === 'suspended' ? 'ระงับลูกค้า' : 'เปิดใช้งานลูกค้า', $c['name']);
        ok(fetch_customer($id));

    default:
        fail(405, 'method_not_allowed', 'Method not allowed');
}
