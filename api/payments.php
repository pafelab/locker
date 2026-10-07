<?php
/**
 * Payments (staff only). GET [?status=&q=] | PUT ?id=[&action=refund]  (refund a paid payment)
 */
require __DIR__ . '/helpers.php';

switch (method()) {
    case 'GET':
        require_admin();
        $where = [];
        $params = [];
        $status = qparam('status');
        if ($status !== null) {
            if (!in_array($status, ['paid', 'pending', 'refunded'], true)) {
                ok([]);
            }
            $where[] = 'p.status = ?';
            $params[] = $status;
        }
        $needle = str(qparam('q'));
        if ($needle !== '') {
            $like = like_term($needle);
            $where[] = "(b.ref LIKE ? ESCAPE '|' OR b.customer_name LIKE ? ESCAPE '|')";
            array_push($params, $like, $like);
        }
        $sql = PAYMENT_SELECT . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY p.created_at DESC, p.id ASC';
        ok(array_map('map_payment', db_all($sql, $params)));

    case 'PUT':
        require_admin();
        $id = qint(qparam('id'));
        $p = fetch_payment($id);
        if (!$p) {
            fail(404, 'not_found', 'ไม่พบรายการชำระเงิน');
        }
        if ($p['status'] !== 'paid') {
            fail(409, 'not_refundable', 'คืนเงินได้เฉพาะรายการที่ชำระแล้ว');
        }
        // conditional update: two concurrent refunds cannot both succeed
        if (db_exec("UPDATE payments SET status = 'refunded' WHERE id = ? AND status = 'paid'", [$id]) < 1) {
            fail(409, 'not_refundable', 'คืนเงินได้เฉพาะรายการที่ชำระแล้ว');
        }
        log_activity('คืนเงิน', (string)$p['bookingRef']);
        ok(fetch_payment($id));

    default:
        fail(405, 'method_not_allowed', 'Method not allowed');
}
