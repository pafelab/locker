<?php
/**
 * Auth endpoint. Routed by ?action=me|login|register|logout|forgot|profile|password plus the HTTP method.
 *   GET me | POST login | POST register | POST logout | POST forgot | PUT profile | PUT password
 */
require __DIR__ . '/helpers.php';

/** Hash used to spend the same time when the e-mail is unknown (prevents user enumeration by timing). */
const AUTH_DUMMY_HASH = '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi';

const PASSWORD_TOO_LONG = 'รหัสผ่านต้องไม่เกิน 72 ไบต์ (ตัวอักษรไทย 1 ตัวนับเป็น 3 ไบต์)';

/** Password rule shared by register / change password: at least 8 characters (and within bcrypt's 72 byte limit). */
function password_ok($pw): bool
{
    return is_string($pw) && s_len($pw) >= 8 && strlen($pw) <= 72;
}

function auth_login(): never
{
    $b = body();
    $email = s_lower(str($b['email'] ?? null));
    $password = $b['password'] ?? null;
    $u = $email === '' ? null : db_one('SELECT * FROM users WHERE email = ? LIMIT 1', [$email]);
    $hash = $u ? (string)$u['password_hash'] : AUTH_DUMMY_HASH;
    $valid = is_string($password) && $password !== '' && password_verify($password, $hash);
    if (!$u || !$valid) {
        fail(401, 'invalid_credentials', 'อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    }
    if ($u['status'] === 'suspended') {
        fail(403, 'account_suspended', 'บัญชีนี้ถูกระงับ');
    }
    if (js_truthy($b['admin'] ?? null) && $u['role'] === 'customer') {
        fail(403, 'forbidden', 'บัญชีนี้ไม่มีสิทธิ์เข้าสู่ระบบหลังบ้าน');
    }
    if (password_needs_rehash($hash, PASSWORD_DEFAULT)) {
        db_exec('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash($password, PASSWORD_DEFAULT), (int)$u['id']]);
    }
    $now = now_str();
    db_exec('UPDATE users SET last_login_at = ? WHERE id = ?', [$now, (int)$u['id']]);
    $u['last_login_at'] = $now;
    lg_login_session($u, js_truthy($b['remember'] ?? null));
    ok(map_user_public($u));
}

function auth_register(): never
{
    $b = body();
    $name = str($b['name'] ?? null);
    $email = s_lower(str($b['email'] ?? null));
    $phone = str($b['phone'] ?? null);
    $pw = $b['password'] ?? '';
    if (is_string($pw) && strlen($pw) > 72 && s_len($pw) >= 8) {
        fail(422, 'validation', PASSWORD_TOO_LONG);
    }
    if ($name === '' || s_len($name) > 120 || !valid_email($email) || s_len($email) > 190
        || preg_match('/^[0-9\-+ ]{9,15}$/D', $phone) !== 1 || !password_ok($pw)) {
        fail(422, 'validation', 'กรุณากรอกข้อมูลให้ครบถ้วน (รหัสผ่านอย่างน้อย 8 ตัวอักษร)');
    }
    if (db_val('SELECT COUNT(*) FROM users WHERE email = ?', [$email]) > 0) {
        fail(409, 'email_taken', 'อีเมลนี้ถูกใช้งานแล้ว');
    }
    $now = now_str();
    try {
        db_exec(
            "INSERT INTO users (name, email, phone, role, status, password_hash, notify_email, notify_sms, created_at, last_login_at) VALUES (?, ?, ?, 'customer', 'active', ?, 1, 0, ?, ?)",
            [$name, $email, $phone, password_hash($pw, PASSWORD_DEFAULT), $now, $now]
        );
    } catch (PDOException $e) {
        if (is_duplicate($e)) {
            fail(409, 'email_taken', 'อีเมลนี้ถูกใช้งานแล้ว');
        }
        throw $e;
    }
    $u = db_one('SELECT * FROM users WHERE id = ?', [(int)db()->lastInsertId()]);
    lg_login_session($u, false);
    ok(map_user_public($u), 201);
}

function auth_forgot(): never
{
    $b = body();
    if (!valid_email(str($b['email'] ?? null))) {
        fail(422, 'validation', 'อีเมลไม่ถูกต้อง');
    }
    ok(['sent' => true]);   // never reveal whether the e-mail exists
}

function auth_profile(): never
{
    $u = require_login();
    $b = body();
    $name = str($b['name'] ?? null);
    if ($name === '') {
        fail(422, 'validation', 'กรุณากรอกชื่อ');
    }
    $phone = str($b['phone'] ?? null);
    if (s_len($name) > 120 || s_len($phone) > 30) {
        fail(422, 'validation', 'ข้อมูลยาวเกินกำหนด');
    }
    db_exec(
        'UPDATE users SET name = ?, phone = ?, notify_email = ?, notify_sms = ? WHERE id = ?',
        [$name, $phone, js_truthy($b['notifyEmail'] ?? null) ? 1 : 0, js_truthy($b['notifySms'] ?? null) ? 1 : 0, (int)$u['id']]
    );
    $fresh = db_one('SELECT * FROM users WHERE id = ?', [(int)$u['id']]);
    $GLOBALS['LG_USER'] = $fresh;
    ok(map_user_public($fresh));
}

function auth_password(): never
{
    $u = require_login();
    $b = body();
    $current = $b['current'] ?? null;
    $next = $b['next'] ?? null;
    if (!is_string($current) || $current === '' || !password_verify($current, (string)$u['password_hash'])) {
        fail(422, 'wrong_password', 'รหัสผ่านปัจจุบันไม่ถูกต้อง');
    }
    if (is_string($next) && strlen($next) > 72 && s_len($next) >= 8) {
        fail(422, 'validation', PASSWORD_TOO_LONG);
    }
    if (!password_ok($next)) {
        fail(422, 'validation', 'รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร');
    }
    db_exec('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash($next, PASSWORD_DEFAULT), (int)$u['id']]);
    ok(true);
}

switch (method() . ' ' . (qparam('action') ?? '')) {
    case 'GET me':
        $u = current_user();
        ok($u ? map_user_public($u) : null);
    case 'POST login':
        auth_login();
    case 'POST register':
        auth_register();
    case 'POST logout':
        lg_logout_session();
        ok(true);
    case 'POST forgot':
        auth_forgot();
    case 'PUT profile':
        auth_profile();
    case 'PUT password':
        auth_password();
    default:
        fail(405, 'method_not_allowed', 'Method not allowed');
}
