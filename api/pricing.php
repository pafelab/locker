<?php
/**
 * Pricing + promo codes.
 *   GET                      -> {prices:[{size,hour,day,month}], promos:[...] (staff only, otherwise [])}
 *   GET ?action=promo&code=  -> promo (422 invalid_promo)
 *   POST                     -> create promo           (staff)
 *   PUT ?type=promo&id=      -> update promo           (staff)
 *   PUT ?type=price          -> update a size's prices (staff), body {size,hour,day,month}
 *   DELETE ?id=              -> delete promo           (staff)
 */
require __DIR__ . '/helpers.php';

function promo_by_id(int $id): ?array
{
    $r = db_one('SELECT * FROM promo_codes WHERE id = ?', [$id]);
    return $r ? map_promo($r) : null;
}

/** Validated promo fields (422 validation otherwise). expires_at becomes 'YYYY-MM-DD 23:59:00' or null. */
function promo_body(array $b): array
{
    $code = s_upper(str($b['code'] ?? null));
    $type = $b['type'] ?? null;
    $value = to_num($b['value'] ?? null);
    $valid = $code !== '' && s_len($code) <= 40 && is_string($type) && in_array($type, ['percent', 'fixed'], true)
        && $value > 0 && !($type === 'percent' && $value > 100);
    $iv = $valid ? (int)round($value) : 0;
    if (!$valid || $iv < 1 || $iv > 1000000000) {
        fail(422, 'validation', 'ข้อมูลโปรโมชันไม่ถูกต้อง');
    }
    $expires = null;
    $e = str($b['expiresAt'] ?? null);
    if ($e !== '') {
        $day = s_sub($e, 0, 10);
        if (!valid_ymd($day)) {
            fail(422, 'validation', 'ข้อมูลโปรโมชันไม่ถูกต้อง');
        }
        $expires = $day . ' 23:59:00';
    }
    return ['code' => $code, 'type' => $type, 'value' => $iv, 'active' => js_truthy($b['active'] ?? null) ? 1 : 0, 'expiresAt' => $expires];
}

switch (method()) {
    case 'GET':
        if (qparam('action') === 'promo') {
            ok(map_promo(find_promo((string)qparam('code'))));
        }
        $prices = array_map('map_price', db_all("SELECT * FROM pricing ORDER BY FIELD(size, 'S', 'M', 'L', 'XL')"));
        $u = current_user();
        $promos = ($u && $u['role'] !== 'customer') ? array_map('map_promo', db_all('SELECT * FROM promo_codes ORDER BY id')) : [];
        ok(['prices' => $prices, 'promos' => $promos]);

    case 'POST':
        require_admin();
        $o = promo_body(body());
        if ((int)db_val('SELECT COUNT(*) FROM promo_codes WHERE code = ?', [$o['code']]) > 0) {
            fail(409, 'duplicate_code', 'รหัสนี้มีอยู่แล้ว');
        }
        try {
            db_exec(
                'INSERT INTO promo_codes (code, `type`, `value`, active, expires_at) VALUES (?, ?, ?, ?, ?)',
                [$o['code'], $o['type'], $o['value'], $o['active'], $o['expiresAt']]
            );
        } catch (PDOException $e) {
            if (is_duplicate($e)) {
                fail(409, 'duplicate_code', 'รหัสนี้มีอยู่แล้ว');
            }
            throw $e;
        }
        $newId = (int)db()->lastInsertId();
        log_activity('เพิ่มรหัสโปรโมชัน', $o['code']);
        ok(promo_by_id($newId), 201);

    case 'PUT':
        require_admin();
        $b = body();
        if (qparam('type') === 'promo') {
            $id = qint(qparam('id'));
            if (!promo_by_id($id)) {
                fail(404, 'not_found', 'ไม่พบโปรโมชัน');
            }
            $o = promo_body($b);
            try {
                db_exec(
                    'UPDATE promo_codes SET code = ?, `type` = ?, `value` = ?, active = ?, expires_at = ? WHERE id = ?',
                    [$o['code'], $o['type'], $o['value'], $o['active'], $o['expiresAt'], $id]
                );
            } catch (PDOException $e) {
                if (is_duplicate($e)) {
                    fail(409, 'duplicate_code', 'รหัสนี้มีอยู่แล้ว');
                }
                throw $e;
            }
            log_activity('แก้ไขรหัสโปรโมชัน', $o['code']);
            ok(promo_by_id($id));
        }
        $size = $b['size'] ?? null;
        $row = (is_string($size) && in_array($size, LG_SIZES, true)) ? db_one('SELECT * FROM pricing WHERE size = ?', [$size]) : null;
        if (!$row) {
            fail(404, 'not_found', 'ไม่พบขนาด');
        }
        $vals = [];
        foreach (['hour', 'day', 'month'] as $k) {
            $n = to_num($b[$k] ?? null);
            if (!($n >= 0) || $n > 10000000) {
                fail(422, 'validation', 'ราคาไม่ถูกต้อง');
            }
            $vals[$k] = (int)round($n);
        }
        db_exec(
            'UPDATE pricing SET hour_price = ?, day_price = ?, month_price = ? WHERE size = ?',
            [$vals['hour'], $vals['day'], $vals['month'], $size]
        );
        log_activity('แก้ไขราคา', 'ขนาด ' . $size);
        ok(['size' => $size, 'hour' => $vals['hour'], 'day' => $vals['day'], 'month' => $vals['month']]);

    case 'DELETE':
        require_admin();
        $x = promo_by_id(qint(qparam('id')));
        if (!$x) {
            fail(404, 'not_found', 'ไม่พบโปรโมชัน');
        }
        db_exec('DELETE FROM promo_codes WHERE id = ?', [$x['id']]);
        log_activity('ลบรหัสโปรโมชัน', $x['code']);
        ok(true);

    default:
        fail(405, 'method_not_allowed', 'Method not allowed');
}
