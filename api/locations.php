<?php
/**
 * Locations. GET (public) [?id=] | POST | PUT ?id= | DELETE ?id=   (writes: any staff role)
 */
require __DIR__ . '/helpers.php';

function location_by_id(int $id): ?array
{
    $r = db_one(LOCATION_SELECT . ' WHERE loc.id = ?', [$id]);
    return $r ? map_location($r) : null;
}

/** Validated writable fields (422 validation otherwise). */
function location_body(array $b): array
{
    $o = [
        'name'      => str($b['name'] ?? null),
        'address'   => str($b['address'] ?? null),
        'zones'     => str($b['zones'] ?? null),
        'openHours' => str($b['openHours'] ?? null),
        'phone'     => str($b['phone'] ?? null),
    ];
    if ($o['name'] === '' || $o['address'] === '' || s_len($o['name']) > 120 || s_len($o['address']) > 255
        || s_len($o['zones']) > 120 || s_len($o['openHours']) > 60 || s_len($o['phone']) > 30) {
        fail(422, 'validation', 'กรุณากรอกชื่อและที่อยู่ตึก');
    }
    return $o;
}

switch (method()) {
    case 'GET':
        $id = qparam('id');
        if ($id !== null) {
            $loc = location_by_id(qint($id));
            if (!$loc) {
                fail(404, 'not_found', 'ไม่พบตึก');
            }
            ok($loc);
        }
        ok(array_map('map_location', db_all(LOCATION_SELECT . ' ORDER BY loc.id')));

    case 'POST':
        require_admin();
        $o = location_body(body());
        db_exec(
            'INSERT INTO locations (name, address, zones, open_hours, phone) VALUES (?, ?, ?, ?, ?)',
            [$o['name'], $o['address'], $o['zones'], $o['openHours'], $o['phone']]
        );
        $newId = (int)db()->lastInsertId();
        log_activity('เพิ่มตึก', $o['name']);
        ok(location_by_id($newId), 201);

    case 'PUT':
        require_admin();
        $id = qint(qparam('id'));
        if (!location_by_id($id)) {
            fail(404, 'not_found', 'ไม่พบตึก');
        }
        $o = location_body(body());
        db_exec(
            'UPDATE locations SET name = ?, address = ?, zones = ?, open_hours = ?, phone = ? WHERE id = ?',
            [$o['name'], $o['address'], $o['zones'], $o['openHours'], $o['phone'], $id]
        );
        log_activity('แก้ไขตึก', $o['name']);
        ok(location_by_id($id));

    case 'DELETE':
        require_admin();
        $id = qint(qparam('id'));
        $loc = location_by_id($id);
        if (!$loc) {
            fail(404, 'not_found', 'ไม่พบตึก');
        }
        if ($loc['lockerCount'] > 0) {
            fail(409, 'has_lockers', 'ไม่สามารถลบตึกที่ยังมีล็อกเกอร์อยู่');
        }
        try {
            db_exec('DELETE FROM locations WHERE id = ?', [$id]);
        } catch (PDOException $e) {
            if (is_fk_blocked($e)) {
                fail(409, 'has_lockers', 'ไม่สามารถลบตึกที่ยังมีล็อกเกอร์อยู่');
            }
            throw $e;
        }
        log_activity('ลบตึก', $loc['name']);
        ok(true);

    default:
        fail(405, 'method_not_allowed', 'Method not allowed');
}
