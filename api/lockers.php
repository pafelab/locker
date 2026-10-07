<?php
/**
 * Lockers. GET (public) [?id= | ?locationId=&size=&status=&q=&start=&end=] | POST | PUT ?id= | PUT ?action=bulk | DELETE ?id=
 * Writes: any staff role.
 */
require __DIR__ . '/helpers.php';

const LOCKER_STATUSES = ['available', 'booked', 'in_use', 'maintenance'];

/**
 * Validated writable fields; missing keys fall back to the current locker ($cur, camelCase) when updating.
 * 422 validation / 409 duplicate_code otherwise.
 */
function locker_body(array $b, ?array $cur): array
{
    $code = str($b['code'] ?? $cur['code'] ?? null);
    $locationId = qint($b['locationId'] ?? $cur['locationId'] ?? null);
    $size = $b['size'] ?? $cur['size'] ?? null;
    $zone = str($b['zone'] ?? $cur['zone'] ?? null);
    $status = $b['status'] ?? $cur['status'] ?? 'available';

    $valid = $code !== '' && s_len($code) <= 20 && s_len($zone) <= 20
        && $locationId > 0 && (int)db_val('SELECT COUNT(*) FROM locations WHERE id = ?', [$locationId]) > 0
        && is_string($size) && in_array($size, LG_SIZES, true)
        && is_string($status) && in_array($status, LOCKER_STATUSES, true);
    if (!$valid) {
        fail(422, 'validation', 'ข้อมูลล็อกเกอร์ไม่ถูกต้อง');
    }
    $curId = $cur ? (int)$cur['id'] : 0;
    if ((int)db_val('SELECT COUNT(*) FROM lockers WHERE code = ? AND id <> ?', [$code, $curId]) > 0) {
        fail(409, 'duplicate_code', 'รหัสล็อกเกอร์นี้มีอยู่แล้ว');
    }
    return ['code' => $code, 'locationId' => $locationId, 'size' => $size, 'zone' => $zone, 'status' => $status];
}

switch (method()) {
    case 'GET':
        $id = qparam('id');
        if ($id !== null) {
            $l = fetch_locker(qint($id));
            if (!$l) {
                fail(404, 'not_found', 'ไม่พบล็อกเกอร์');
            }
            ok($l);
        }

        $where = [];
        $params = [];
        $loc = qparam('locationId');
        if ($loc !== null) {
            $where[] = 'l.location_id = ?';
            $params[] = qint($loc);
        }
        $size = qparam('size');
        if ($size !== null) {
            if (!in_array($size, LG_SIZES, true)) {
                ok([]);
            }
            $where[] = 'l.size = ?';
            $params[] = $size;
        }
        $needle = s_lower(str(qparam('q')));
        if ($needle !== '') {
            $where[] = "l.code LIKE ? ESCAPE '|'";
            $params[] = like_term($needle);
        }
        $rows = db_all(LOCKER_SELECT . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY l.id', $params);

        // availability for a time window: lockers with an overlapping active booking are reported as 'booked'
        $busy = null;
        $startQ = qparam('start');
        $endQ = qparam('end');
        if ($startQ !== null && $endQ !== null) {
            $s = parse_dt($startQ);
            $e = parse_dt($endQ);
            if ($s && $e) {
                $busy = [];
                $sql = "SELECT DISTINCT locker_id FROM bookings WHERE status IN ('pending', 'confirmed', 'active') AND end_at > ? AND start_at < ?";
                foreach (db_all($sql, [$s->format('Y-m-d H:i:s'), $e->format('Y-m-d H:i:s')]) as $r) {
                    $busy[(int)$r['locker_id']] = true;
                }
            }
        }
        $statusFilter = qparam('status');
        $out = [];
        foreach ($rows as $r) {
            $o = map_locker($r);
            if ($busy !== null && $o['status'] !== 'maintenance') {
                $o['status'] = isset($busy[$o['id']]) ? 'booked' : 'available';
            }
            if ($statusFilter === null || $o['status'] === $statusFilter) {
                $out[] = $o;
            }
        }
        ok($out);

    case 'POST':
        require_admin();
        $o = locker_body(body(), null);
        try {
            db_exec(
                'INSERT INTO lockers (code, location_id, size, zone, status) VALUES (?, ?, ?, ?, ?)',
                [$o['code'], $o['locationId'], $o['size'], $o['zone'], $o['status']]
            );
        } catch (PDOException $e) {
            if (is_duplicate($e)) {
                fail(409, 'duplicate_code', 'รหัสล็อกเกอร์นี้มีอยู่แล้ว');
            }
            throw $e;
        }
        $newId = (int)db()->lastInsertId();
        log_activity('เพิ่มล็อกเกอร์', $o['code']);
        ok(fetch_locker($newId), 201);

    case 'PUT':
        require_admin();
        $b = body();
        if (qparam('action') === 'bulk') {
            $ids = is_array($b['ids'] ?? null) ? array_values($b['ids']) : [];
            $count = count($ids);
            $status = $b['status'] ?? null;
            $valid = [];
            foreach ($ids as $raw) {
                $n = qint($raw);
                if ($n > 0) {
                    $valid[$n] = $n;
                }
            }
            $valid = array_values($valid);
            if ($valid) {
                $marks = implode(',', array_fill(0, count($valid), '?'));
                $matched = (int)db_val("SELECT COUNT(*) FROM lockers WHERE id IN ($marks)", $valid);
                if ($matched > 0 && $status !== null) {
                    if (!is_string($status) || !in_array($status, LOCKER_STATUSES, true)) {
                        fail(422, 'validation', 'ข้อมูลล็อกเกอร์ไม่ถูกต้อง');
                    }
                    db_exec("UPDATE lockers SET status = ? WHERE id IN ($marks)", array_merge([$status], $valid));
                }
            }
            log_activity('เปลี่ยนสถานะล็อกเกอร์หลายรายการ', $count . ' รายการ → ' . str($status));
            ok(['updated' => $count]);
        }
        $cur = fetch_locker(qint(qparam('id')));
        if (!$cur) {
            fail(404, 'not_found', 'ไม่พบล็อกเกอร์');
        }
        $o = locker_body($b, $cur);
        try {
            db_exec(
                'UPDATE lockers SET code = ?, location_id = ?, size = ?, zone = ?, status = ? WHERE id = ?',
                [$o['code'], $o['locationId'], $o['size'], $o['zone'], $o['status'], $cur['id']]
            );
        } catch (PDOException $e) {
            if (is_duplicate($e)) {
                fail(409, 'duplicate_code', 'รหัสล็อกเกอร์นี้มีอยู่แล้ว');
            }
            throw $e;
        }
        log_activity('แก้ไขล็อกเกอร์', $o['code'] . ' (' . $o['status'] . ')');
        ok(fetch_locker($cur['id']));

    case 'DELETE':
        require_admin();
        $x = fetch_locker(qint(qparam('id')));
        if (!$x) {
            fail(404, 'not_found', 'ไม่พบล็อกเกอร์');
        }
        if ((int)db_val("SELECT COUNT(*) FROM bookings WHERE locker_id = ? AND status IN ('pending', 'confirmed', 'active')", [$x['id']]) > 0) {
            fail(409, 'has_bookings', 'ล็อกเกอร์นี้มีการจองที่ยังไม่สิ้นสุด');
        }
        try {
            db_exec('DELETE FROM lockers WHERE id = ?', [$x['id']]);
        } catch (PDOException $e) {
            if (is_fk_blocked($e)) {   // finished bookings still reference it (the database keeps the history)
                fail(409, 'has_bookings', 'ล็อกเกอร์นี้มีประวัติการจอง ไม่สามารถลบได้ (ให้เปลี่ยนเป็นซ่อมบำรุงแทน)');
            }
            throw $e;
        }
        log_activity('ลบล็อกเกอร์', $x['code']);
        ok(true);

    default:
        fail(405, 'method_not_allowed', 'Method not allowed');
}
