<?php
/**
 * Bootstrap + shared helpers, included by every endpoint.
 * Keep the behaviour identical to assets/js/mock-service.js (the reference implementation).
 */
if (basename($_SERVER['SCRIPT_FILENAME'] ?? '') === basename(__FILE__)) {
    http_response_code(403);
    exit;
}

require_once __DIR__ . '/db.php';

const LG_ACTIVE = ['pending', 'confirmed', 'active'];                 // booking statuses that occupy a locker
const LG_HOURS = ['hour' => 1, 'day' => 24, 'month' => 720];
const LG_SIZES = ['S', 'M', 'L', 'XL'];
const LG_PRICE_COLUMN = ['hour' => 'hour_price', 'day' => 'day_price', 'month' => 'month_price'];
const LG_NO_PROMO_MESSAGE = 'รหัสโปรโมชันไม่ถูกต้องหรือหมดอายุ';

// ---------------------------------------------------------------------------------------------------------------
// SELECT fragments (joins shared by several endpoints)
// ---------------------------------------------------------------------------------------------------------------
const LOCKER_SELECT = "SELECT l.*, COALESCE(loc.name, '') AS location_name FROM lockers l LEFT JOIN locations loc ON loc.id = l.location_id";

const LOCATION_SELECT = "SELECT loc.*, "
    . "(SELECT COUNT(*) FROM lockers x WHERE x.location_id = loc.id) AS locker_count, "
    . "(SELECT COUNT(*) FROM lockers x WHERE x.location_id = loc.id AND x.status = 'available') AS available_count "
    . "FROM locations loc";

const BOOKING_SELECT = "SELECT b.*, l.code AS locker_code, l.location_id AS location_id, COALESCE(loc.name, '') AS location_name, "
    . "l.size AS size, p.status AS payment_status, p.method AS payment_method "
    . "FROM bookings b "
    . "LEFT JOIN lockers l ON l.id = b.locker_id "
    . "LEFT JOIN locations loc ON loc.id = l.location_id "
    . "LEFT JOIN payments p ON p.id = (SELECT MIN(p2.id) FROM payments p2 WHERE p2.booking_id = b.id)";

const PAYMENT_SELECT = "SELECT p.*, b.ref AS booking_ref, b.customer_name AS customer_name "
    . "FROM payments p LEFT JOIN bookings b ON b.id = p.booking_id";

const CUSTOMER_SELECT = "SELECT u.*, "
    . "(SELECT COUNT(*) FROM bookings bb WHERE bb.user_id = u.id) AS booking_count, "
    . "(SELECT COALESCE(SUM(pp.amount), 0) FROM payments pp JOIN bookings b2 ON b2.id = pp.booking_id WHERE b2.user_id = u.id AND pp.status = 'paid') AS total_spent "
    . "FROM users u";

// ---------------------------------------------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------------------------------------------

/** Rolls back a transaction that is still open (called before every response so a fail() never leaves one behind). */
function db_rollback_open(): void
{
    $pdo = $GLOBALS['LG_PDO'] ?? null;
    if ($pdo instanceof PDO) {
        try {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
        } catch (Throwable $e) {
            // ignore: the connection is going away anyway
        }
    }
}

/** Emits the JSON envelope and stops the script. */
function send_json(int $status, array $payload): never
{
    db_rollback_open();
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
    if (!headers_sent()) {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('X-Content-Type-Options: nosniff');
        header('Cache-Control: no-store');
    }
    $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PARTIAL_OUTPUT_ON_ERROR);
    echo $json === false ? '{"success":false,"error":"server_error","message":"Server error"}' : $json;
    exit;
}

/** Success: {"success":true,"data":...} */
function ok($data, int $status = 200): never
{
    send_json($status, ['success' => true, 'data' => $data]);
}

/** Failure: {"success":false,"error":"code","message":"..."} */
function fail(int $status, string $code, string $message): never
{
    send_json($status, ['success' => false, 'error' => $code, 'message' => $message]);
}

// ---------------------------------------------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------------------------------------------

function method(): string
{
    return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
}

function raw_body(): string
{
    static $raw = null;
    if ($raw === null) {
        $raw = (string)file_get_contents('php://input');
    }
    return $raw;
}

/** Decoded JSON request body (always an array). 400 on invalid JSON. */
function body(): array
{
    $raw = trim(raw_body());
    if ($raw === '') {
        return [];
    }
    $data = json_decode($raw, true);
    if (json_last_error() !== JSON_ERROR_NONE || !is_array($data)) {
        fail(400, 'invalid_json', 'ข้อมูลที่ส่งมาไม่ถูกต้อง');
    }
    return $data;
}

/** Query-string value as a non-empty string, or null (absent / empty / array). Mirrors JS truthiness of q.x. */
function qparam(string $name): ?string
{
    $v = $_GET[$name] ?? null;
    return (is_string($v) && $v !== '') ? $v : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Value helpers (JavaScript semantics of the mock: str(), unary +, truthiness)
// ---------------------------------------------------------------------------------------------------------------

function s_len(string $s): int
{
    return function_exists('mb_strlen') ? mb_strlen($s, 'UTF-8') : strlen($s);
}

function s_sub(string $s, int $start, ?int $len = null): string
{
    return function_exists('mb_substr') ? mb_substr($s, $start, $len, 'UTF-8') : substr($s, $start, $len);
}

function s_lower(string $s): string
{
    return function_exists('mb_strtolower') ? mb_strtolower($s, 'UTF-8') : strtolower($s);
}

function s_upper(string $s): string
{
    return function_exists('mb_strtoupper') ? mb_strtoupper($s, 'UTF-8') : strtoupper($s);
}

/** mock str(): null -> '', otherwise trimmed string. */
function str($v): string
{
    if ($v === null) {
        return '';
    }
    if (is_bool($v)) {
        return $v ? 'true' : 'false';
    }
    if (!is_scalar($v)) {
        return '';
    }
    $s = (string)$v;
    $t = preg_replace('/^[\p{Z}\s\x{FEFF}]+|[\p{Z}\s\x{FEFF}]+$/u', '', $s);
    return $t === null ? trim($s) : $t;
}

/** JavaScript unary plus: numbers pass, numeric strings convert, '' -> 0, everything else (incl. null) -> NaN. */
function to_num($v): float
{
    if (is_int($v) || is_float($v)) {
        return (float)$v;
    }
    if (is_bool($v)) {
        return $v ? 1.0 : 0.0;
    }
    if (is_string($v)) {
        $t = trim($v);
        if ($t === '') {
            return 0.0;
        }
        return is_numeric($t) ? (float)$t : NAN;
    }
    return NAN;
}

/** Number.isInteger */
function is_int_num(float $n): bool
{
    return is_finite($n) && floor($n) == $n;
}

/** Id-like value -> int (0 when it is not a plain integer, which never matches a row). */
function qint($v): int
{
    $n = to_num($v);
    return (is_int_num($n) && abs($n) < 9.0e15) ? (int)$n : 0;
}

/** JavaScript truthiness of a decoded JSON value. */
function js_truthy($v): bool
{
    if ($v === null || $v === false || $v === 0 || $v === 0.0 || $v === '') {
        return false;
    }
    return !(is_float($v) && is_nan($v));
}

function valid_email(string $s): bool
{
    return preg_match('/^\S+@\S+\.\S+$/D', $s) === 1;
}

/** 'YYYY-MM-DD' that is a real calendar date. */
function valid_ymd(string $s): bool
{
    return preg_match('/^(\d{4})-(\d{2})-(\d{2})$/D', $s, $m) === 1 && checkdate((int)$m[2], (int)$m[3], (int)$m[1]);
}

function now_str(): string
{
    return date('Y-m-d H:i:s');
}

function today_str(): string
{
    return date('Y-m-d');
}

/** Parses 'YYYY-MM-DD[ T]HH:MM[:SS]' (local time). Null when it is not a valid date. */
function parse_dt(string $s): ?DateTimeImmutable
{
    $s = str_replace('T', ' ', trim($s));
    if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/D', $s, $m)) {
        return null;
    }
    $y = (int)$m[1];
    $mo = (int)$m[2];
    $d = (int)$m[3];
    $h = isset($m[4]) ? (int)$m[4] : 0;
    $mi = isset($m[5]) ? (int)$m[5] : 0;
    $se = isset($m[6]) ? (int)$m[6] : 0;
    if ($y < 2000 || $y > 2100 || !checkdate($mo, $d, $y) || $h > 23 || $mi > 59 || $se > 59) {
        return null;
    }
    return new DateTimeImmutable(sprintf('%04d-%02d-%02d %02d:%02d:%02d', $y, $mo, $d, $h, $mi, $se));
}

/** Escapes a search term for LIKE ... ESCAPE '|' and wraps it with wildcards. */
function like_term(string $s): string
{
    return '%' . str_replace(['|', '%', '_'], ['||', '|%', '|_'], $s) . '%';
}

// ---------------------------------------------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------------------------------------------

function db_all(string $sql, array $params = []): array
{
    $st = db()->prepare($sql);
    $st->execute($params);
    return $st->fetchAll();
}

function db_one(string $sql, array $params = []): ?array
{
    $st = db()->prepare($sql);
    $st->execute($params);
    $row = $st->fetch();
    $st->closeCursor();
    return $row === false ? null : $row;
}

/** First column of the first row, or null. */
function db_val(string $sql, array $params = [])
{
    $st = db()->prepare($sql);
    $st->execute($params);
    $v = $st->fetchColumn();
    $st->closeCursor();
    return $v === false ? null : $v;
}

/** Runs a write statement; returns the number of affected rows. */
function db_exec(string $sql, array $params = []): int
{
    $st = db()->prepare($sql);
    $st->execute($params);
    return $st->rowCount();
}

/** Runs $fn inside a transaction (commit on return, roll back on exception). fail() inside $fn rolls back too. */
function db_tx(callable $fn)
{
    $pdo = db();
    $pdo->beginTransaction();
    try {
        $result = $fn();
        $pdo->commit();
        return $result;
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            try {
                $pdo->rollBack();
            } catch (Throwable $e2) {
                // ignore
            }
        }
        throw $e;
    }
}

/** UNIQUE constraint violation (MySQL error 1062). */
function is_duplicate(PDOException $e): bool
{
    return (int)($e->errorInfo[1] ?? 0) === 1062;
}

/** Foreign key still referenced (MySQL error 1451). */
function is_fk_blocked(PDOException $e): bool
{
    return (int)($e->errorInfo[1] ?? 0) === 1451;
}

// ---------------------------------------------------------------------------------------------------------------
// Session / auth
// ---------------------------------------------------------------------------------------------------------------

function lg_is_https(): bool
{
    return (!empty($_SERVER['HTTPS']) && strtolower((string)$_SERVER['HTTPS']) !== 'off')
        || (string)($_SERVER['SERVER_PORT'] ?? '') === '443'
        || strtolower((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https';
}

/** App-private, writable session folder (null = fall back to PHP's default save path). */
function lg_session_dir(): ?string
{
    $dir = trim((string)(lg_config()['session_path'] ?? ''));
    if ($dir === '') {
        $dir = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'storage' . DIRECTORY_SEPARATOR . 'sessions';
    }
    if (!is_dir($dir)) {
        if (!@mkdir($dir, 0700, true) && !is_dir($dir)) {
            return null;
        }
        // keep session files away from the web server
        @file_put_contents($dir . DIRECTORY_SEPARATOR . '.htaccess', "Require all denied\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n");
        @file_put_contents($dir . DIRECTORY_SEPARATOR . 'index.html', '');
    }
    return is_writable($dir) ? $dir : null;
}

/** Starts the session. Read-only callers release the session lock immediately ($_SESSION stays readable). */
function lg_session(bool $write = false): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    static $configured = false;
    if (!$configured) {
        ini_set('session.use_strict_mode', '1');
        ini_set('session.use_only_cookies', '1');
        ini_set('session.gc_maxlifetime', (string)(30 * 86400));
        $sessDir = lg_session_dir();
        if ($sessDir !== null) {
            session_save_path($sessDir);   // own folder: the distro's shared-path GC cron (php.ini 1440 s) no longer deletes our sessions
            ini_set('session.gc_probability', '1');
            ini_set('session.gc_divisor', '100');
        }
        session_name((string)lg_config()['session_name']);
        session_set_cookie_params([
            'lifetime' => 0,
            'path'     => '/',
            'domain'   => '',
            'secure'   => lg_is_https(),
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        $configured = true;
    }
    if (!$write && !isset($_COOKIE[session_name()])) {
        return;   // anonymous visitor: do not create a session file just to read it
    }
    session_start();
    if (!$write) {
        session_write_close();
    }
}

/** Sends the session cookie with an explicit expiry (0 = browser session). */
function lg_send_session_cookie(int $expires): void
{
    setcookie(session_name(), $expires < 0 ? '' : session_id(), [
        'expires'  => $expires < 0 ? time() - 3600 : $expires,
        'path'     => '/',
        'domain'   => '',
        'secure'   => lg_is_https(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

/** Signs the user in: fresh session id, remembered for 30 days when $remember. */
function lg_login_session(array $userRow, bool $remember): void
{
    lg_session(true);
    session_regenerate_id(true);
    $_SESSION['uid'] = (int)$userRow['id'];
    if ($remember) {
        lg_send_session_cookie(time() + 30 * 86400);
    }
    session_write_close();
    $GLOBALS['LG_USER'] = $userRow;
}

/** Signs the user out and destroys the session. */
function lg_logout_session(): void
{
    lg_session(true);
    $_SESSION = [];
    session_destroy();
    lg_send_session_cookie(-1);
    $GLOBALS['LG_USER'] = null;
}

/** Raw users row of the signed-in user, or null. */
function current_user(): ?array
{
    if (array_key_exists('LG_USER', $GLOBALS)) {
        return $GLOBALS['LG_USER'];
    }
    lg_session(false);
    $uid = (int)($_SESSION['uid'] ?? 0);
    $u = $uid > 0 ? db_one('SELECT * FROM users WHERE id = ?', [$uid]) : null;
    if ($u && $u['status'] === 'suspended') {
        $u = null;   // suspended after sign-in: existing sessions lose access immediately
    }
    $GLOBALS['LG_USER'] = $u;
    return $u;
}

function require_login(): array
{
    $u = current_user();
    if (!$u) {
        fail(401, 'unauthenticated', 'กรุณาเข้าสู่ระบบ');
    }
    return $u;
}

/** Any non-customer role. */
function require_admin(): array
{
    $u = require_login();
    if ($u['role'] === 'customer') {
        fail(403, 'forbidden', 'ไม่มีสิทธิ์เข้าถึง');
    }
    return $u;
}

function require_super(): array
{
    $u = require_admin();
    if ($u['role'] !== 'super_admin') {
        fail(403, 'forbidden', 'เฉพาะ Super Admin เท่านั้น');
    }
    return $u;
}

/** Writes an activity_log row for staff users (customers are never logged). */
function log_activity(string $action, string $target): void
{
    $u = current_user();
    if (!$u || $u['role'] === 'customer') {
        return;
    }
    db_exec(
        'INSERT INTO activity_log (actor_id, actor_name, action, target, created_at) VALUES (?, ?, ?, ?, ?)',
        [(int)$u['id'], s_sub((string)$u['name'], 0, 120), s_sub($action, 0, 120), s_sub($target, 0, 190), now_str()]
    );
}

// ---------------------------------------------------------------------------------------------------------------
// Mappers: DB rows (snake_case) -> API shapes (camelCase, same as the mock)
// ---------------------------------------------------------------------------------------------------------------

function map_user_public(array $r): array
{
    return [
        'id' => (int)$r['id'], 'name' => $r['name'], 'email' => $r['email'], 'phone' => $r['phone'], 'role' => $r['role'],
        'notifyEmail' => (int)$r['notify_email'], 'notifySms' => (int)$r['notify_sms'],
    ];
}

function map_locker(array $r): array
{
    return [
        'id' => (int)$r['id'], 'code' => $r['code'], 'locationId' => (int)$r['location_id'], 'size' => $r['size'],
        'zone' => $r['zone'], 'status' => $r['status'], 'locationName' => (string)($r['location_name'] ?? ''),
    ];
}

function map_location(array $r): array
{
    return [
        'id' => (int)$r['id'], 'name' => $r['name'], 'address' => $r['address'], 'zones' => $r['zones'],
        'openHours' => $r['open_hours'], 'phone' => $r['phone'],
        'lockerCount' => (int)$r['locker_count'], 'availableCount' => (int)$r['available_count'],
    ];
}

function map_booking(array $r): array
{
    return [
        'id' => (int)$r['id'], 'ref' => $r['ref'], 'userId' => $r['user_id'] === null ? null : (int)$r['user_id'],
        'customerName' => $r['customer_name'], 'customerEmail' => $r['customer_email'], 'customerPhone' => $r['customer_phone'],
        'lockerId' => (int)$r['locker_id'], 'startAt' => $r['start_at'], 'endAt' => $r['end_at'],
        'durationType' => $r['duration_type'], 'quantity' => (int)$r['quantity'], 'amount' => (int)$r['amount'],
        'discount' => (int)$r['discount'], 'promoCode' => $r['promo_code'], 'status' => $r['status'], 'pin' => $r['pin'],
        'createdAt' => $r['created_at'],
        'lockerCode' => $r['locker_code'], 'locationId' => $r['location_id'] === null ? null : (int)$r['location_id'],
        'locationName' => (string)($r['location_name'] ?? ''), 'size' => $r['size'],
        'paymentStatus' => $r['payment_status'], 'paymentMethod' => $r['payment_method'],
    ];
}

function map_payment(array $r): array
{
    return [
        'id' => (int)$r['id'], 'bookingId' => (int)$r['booking_id'], 'amount' => (int)$r['amount'], 'method' => $r['method'],
        'status' => $r['status'], 'createdAt' => $r['created_at'],
        'bookingRef' => $r['booking_ref'] ?? null, 'customerName' => $r['customer_name'] ?? null,
    ];
}

function map_customer(array $r): array
{
    return [
        'id' => (int)$r['id'], 'name' => $r['name'], 'email' => $r['email'], 'phone' => $r['phone'], 'status' => $r['status'],
        'createdAt' => $r['created_at'], 'lastLoginAt' => $r['last_login_at'],
        'bookingCount' => (int)$r['booking_count'], 'totalSpent' => (int)$r['total_spent'],
    ];
}

function map_staff(array $r): array
{
    return [
        'id' => (int)$r['id'], 'name' => $r['name'], 'email' => $r['email'], 'phone' => $r['phone'], 'role' => $r['role'],
        'status' => $r['status'], 'lastLoginAt' => $r['last_login_at'],
    ];
}

function map_promo(array $r): array
{
    return [
        'id' => (int)$r['id'], 'code' => $r['code'], 'type' => $r['type'], 'value' => (int)$r['value'],
        'active' => (int)$r['active'], 'expiresAt' => $r['expires_at'],
    ];
}

function map_price(array $r): array
{
    return ['size' => $r['size'], 'hour' => (int)$r['hour_price'], 'day' => (int)$r['day_price'], 'month' => (int)$r['month_price']];
}

function fetch_booking(int $id): ?array
{
    $r = db_one(BOOKING_SELECT . ' WHERE b.id = ?', [$id]);
    return $r ? map_booking($r) : null;
}

function fetch_locker(int $id): ?array
{
    $r = db_one(LOCKER_SELECT . ' WHERE l.id = ?', [$id]);
    return $r ? map_locker($r) : null;
}

function fetch_payment(int $id): ?array
{
    $r = db_one(PAYMENT_SELECT . ' WHERE p.id = ?', [$id]);
    return $r ? map_payment($r) : null;
}

function fetch_customer(int $id): ?array
{
    $r = db_one(CUSTOMER_SELECT . " WHERE u.id = ? AND u.role = 'customer'", [$id]);
    return $r ? map_customer($r) : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Domain helpers
// ---------------------------------------------------------------------------------------------------------------

/** All settings as key => decoded value. */
function settings_all(): array
{
    $out = [];
    foreach (db_all('SELECT k, v FROM settings ORDER BY k') as $r) {
        $val = json_decode((string)$r['v'], true);
        $out[$r['k']] = json_last_error() === JSON_ERROR_NONE ? $val : $r['v'];
    }
    return $out;
}

/** True when an active booking of the locker overlaps [start, end) (same rule as the mock). */
function has_overlap(int $lockerId, string $start, string $end, int $ignoreId = 0, bool $lock = false): bool
{
    $sql = "SELECT id FROM bookings WHERE locker_id = ? AND id <> ? AND status IN ('pending', 'confirmed', 'active') "
        . 'AND end_at > ? AND start_at < ? LIMIT 1' . ($lock ? ' FOR UPDATE' : '');
    return db_one($sql, [$lockerId, $ignoreId, $start, $end]) !== null;
}

/** Keeps locker.status in step with its bookings (maintenance is never touched). Same rule as the mock syncLocker. */
function sync_locker(int $lockerId): void
{
    $l = db_one('SELECT status FROM lockers WHERE id = ?', [$lockerId]);
    if (!$l || $l['status'] === 'maintenance') {
        return;
    }
    $row = db_one(
        "SELECT COUNT(*) AS total, COALESCE(SUM(status = 'active'), 0) AS active_count FROM bookings "
        . "WHERE locker_id = ? AND status IN ('pending', 'confirmed', 'active')",
        [$lockerId]
    );
    $status = (int)$row['active_count'] > 0 ? 'in_use' : ((int)$row['total'] > 0 ? 'booked' : 'available');
    db_exec('UPDATE lockers SET status = ? WHERE id = ?', [$status, $lockerId]);
}

/** Price quote: unit = price of one hour/day/month; promo = ['type'=>..., 'value'=>...] or null. Same formula as quote() in config.js. */
function quote_price(int $unit, int $qty, ?array $promo): array
{
    $gross = $unit * $qty;
    if (!$promo) {
        $discount = 0;
    } elseif ($promo['type'] === 'percent') {
        $discount = (int)round($gross * (int)$promo['value'] / 100);
    } else {
        $discount = min((int)$promo['value'], $gross);
    }
    return ['gross' => $gross, 'discount' => $discount, 'total' => $gross - $discount];
}

/** Valid, active, unexpired promo row or 422 invalid_promo. */
function find_promo(string $code): array
{
    $code = s_upper(str($code));
    $p = $code === '' ? null : db_one('SELECT * FROM promo_codes WHERE code = ?', [$code]);
    if (!$p || $p['code'] !== $code || !(int)$p['active'] || ($p['expires_at'] !== null && $p['expires_at'] < now_str())) {
        fail(422, 'invalid_promo', LG_NO_PROMO_MESSAGE);
    }
    return $p;
}

// ---------------------------------------------------------------------------------------------------------------
// Bootstrap (runs on include)
// ---------------------------------------------------------------------------------------------------------------
error_reporting(E_ALL);
ini_set('display_errors', '0');
ini_set('html_errors', '0');
ini_set('log_errors', '1');
date_default_timezone_set((string)(lg_config()['timezone'] ?? 'Asia/Bangkok'));
ob_start();

// warnings/notices become exceptions (deprecations are only logged)
set_error_handler(static function (int $severity, string $message, string $file, int $line): bool {
    if (!(error_reporting() & $severity)) {
        return false;
    }
    if ($severity & (E_DEPRECATED | E_USER_DEPRECATED)) {
        error_log("[LockerGo] deprecated: $message @ $file:$line");
        return true;
    }
    throw new ErrorException($message, 0, $severity, $file, $line);
});

// anything uncaught -> JSON (never an HTML error page)
set_exception_handler(static function (Throwable $e): void {
    error_log('[LockerGo] ' . get_class($e) . ': ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    if ($e instanceof PDOException && in_array((int)($e->errorInfo[1] ?? 0), [2002, 2003, 2006, 2013], true)) {
        fail(503, 'db_unavailable', 'ไม่สามารถเชื่อมต่อฐานข้อมูลได้');
    }
    $debug = (bool)(lg_config()['debug'] ?? false);
    fail(500, 'server_error', $debug ? $e->getMessage() : 'เกิดข้อผิดพลาดของเซิร์ฟเวอร์ กรุณาลองใหม่อีกครั้ง');
});

// fatal errors (not catchable) -> JSON too
register_shutdown_function(static function (): void {
    $err = error_get_last();
    if ($err && in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR], true)) {
        error_log('[LockerGo] fatal: ' . $err['message'] . ' @ ' . $err['file'] . ':' . $err['line']);
        if (!headers_sent()) {
            while (ob_get_level() > 0) {
                ob_end_clean();
            }
            http_response_code(500);
            header('Content-Type: application/json; charset=utf-8');
            echo '{"success":false,"error":"server_error","message":"เกิดข้อผิดพลาดของเซิร์ฟเวอร์ กรุณาลองใหม่อีกครั้ง"}';
        }
    }
});

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

// connect eagerly so EVERY endpoint answers 503 when the database is down
try {
    db();
} catch (Throwable $e) {
    error_log('[LockerGo] database connection failed: ' . $e->getMessage());
    fail(503, 'db_unavailable', 'ไม่สามารถเชื่อมต่อฐานข้อมูลได้');
}

// CSRF: state-changing requests that carry a body must be JSON (a cross-site HTML form cannot send that)
if (in_array(method(), ['POST', 'PUT', 'DELETE'], true) && trim(raw_body()) !== '') {
    if (strpos(strtolower(trim((string)($_SERVER['CONTENT_TYPE'] ?? ''))), 'application/json') !== 0) {
        fail(415, 'unsupported_media_type', 'Content-Type ต้องเป็น application/json');
    }
}
