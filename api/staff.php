<?php
/**
 * Staff accounts. GET (any staff role) | POST | PUT ?id= | DELETE ?id=   (writes: super_admin only)
 */
require __DIR__ . '/helpers.php';

const STAFF_ROLES = ['super_admin', 'manager', 'staff'];
const STAFF_INVALID = 'ข้อมูลพนักงานไม่ถูกต้อง (รหัสผ่านอย่างน้อย 8 ตัวอักษร)';

function staff_by_id(int $id): ?array
{
    $r = db_one("SELECT * FROM users WHERE id = ? AND role <> 'customer'", [$id]);
    return $r ?: null;
}

/**
 * Validated fields. $cur = the existing staff row when updating (password optional then).
 * 422 validation / 409 email_taken otherwise.
 */
function staff_body(array $b, ?array $cur): array
{
    $role = $b['role'] ?? null;
    $statusRaw = $b['status'] ?? null;
    $status = js_truthy($statusRaw) ? $statusRaw : 'active';
    $o = [
        'username' => s_lower(str($b['username'] ?? null)),
        'name'   => str($b['name'] ?? null),
        'email'  => s_lower(str($b['email'] ?? null)),
        'phone'  => str($b['phone'] ?? null),
        'role'   => $role,
        'status' => $status,
    ];
    $pw = $b['password'] ?? null;
    $pwNeeded = !$cur || js_truthy($pw);
    if ($o['name'] === '' || !valid_email($o['email']) || !is_string($role) || !in_array($role, STAFF_ROLES, true)
        || !is_string($status) || !in_array($status, ['active', 'suspended'], true)
        || ($pwNeeded && !(is_string($pw) && s_len($pw) >= 8 && strlen($pw) <= 72))
        || s_len($o['name']) > 120 || s_len($o['email']) > 190 || s_len($o['phone']) > 30) {
        fail(422, 'validation', STAFF_INVALID);
    }
    if (!valid_username($o['username'])) {
        fail(422, 'validation', USERNAME_INVALID);
    }
    if ((int)db_val('SELECT COUNT(*) FROM users WHERE username = ? AND id <> ?', [$o['username'], $cur ? (int)$cur['id'] : 0]) > 0) {
        fail(409, 'username_taken', 'ชื่อผู้ใช้นี้ถูกใช้งานแล้ว');
    }
    if ((int)db_val('SELECT COUNT(*) FROM users WHERE email = ? AND id <> ?', [$o['email'], $cur ? (int)$cur['id'] : 0]) > 0) {
        fail(409, 'email_taken', 'อีเมลนี้ถูกใช้งานแล้ว');
    }
    return $o;
}

switch (method()) {
    case 'GET':
        require_admin();
        ok(array_map('map_staff', db_all("SELECT * FROM users WHERE role <> 'customer' ORDER BY id")));

    case 'POST':
        require_super();
        $b = body();
        $o = staff_body($b, null);
        try {
            db_exec(
                'INSERT INTO users (username, name, email, phone, role, status, password_hash, notify_email, notify_sms, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, NULL)',
                [$o['username'], $o['name'], $o['email'], $o['phone'], $o['role'], $o['status'], password_hash((string)$b['password'], PASSWORD_DEFAULT), now_str()]
            );
        } catch (PDOException $e) {
            if (is_duplicate($e)) {
                fail(409, 'email_taken', 'อีเมลนี้ถูกใช้งานแล้ว');
            }
            throw $e;
        }
        $newId = (int)db()->lastInsertId();
        log_activity('เพิ่มพนักงาน', $o['name']);
        ok(map_staff(staff_by_id($newId)), 201);

    case 'PUT':
        $me = require_super();
        $cur = staff_by_id(qint(qparam('id')));
        if (!$cur) {
            fail(404, 'not_found', 'ไม่พบพนักงาน');
        }
        $b = body();
        $o = staff_body($b, $cur);
        if ((int)$cur['id'] === (int)$me['id'] && ($o['role'] !== 'super_admin' || $o['status'] !== 'active')) {
            fail(409, 'self_demote', 'ไม่สามารถลดสิทธิ์หรือระงับบัญชีของตนเองได้');
        }
        try {
            db_exec(
                'UPDATE users SET username = ?, name = ?, email = ?, phone = ?, role = ?, status = ? WHERE id = ?',
                [$o['username'], $o['name'], $o['email'], $o['phone'], $o['role'], $o['status'], (int)$cur['id']]
            );
            if (js_truthy($b['password'] ?? null)) {
                db_exec('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash((string)$b['password'], PASSWORD_DEFAULT), (int)$cur['id']]);
            }
        } catch (PDOException $e) {
            if (is_duplicate($e)) {
                fail(409, 'email_taken', 'อีเมลนี้ถูกใช้งานแล้ว');
            }
            throw $e;
        }
        log_activity('แก้ไขพนักงาน', $o['name']);
        ok(map_staff(staff_by_id((int)$cur['id'])));

    case 'DELETE':
        $me = require_super();
        $x = staff_by_id(qint(qparam('id')));
        if (!$x) {
            fail(404, 'not_found', 'ไม่พบพนักงาน');
        }
        if ((int)$x['id'] === (int)$me['id']) {
            fail(409, 'self_delete', 'ไม่สามารถลบบัญชีของตนเองได้');
        }
        db_exec("DELETE FROM users WHERE id = ? AND role <> 'customer'", [(int)$x['id']]);
        log_activity('ลบพนักงาน', (string)$x['name']);
        ok(true);

    default:
        fail(405, 'method_not_allowed', 'Method not allowed');
}
