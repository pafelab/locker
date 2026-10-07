<?php
/**
 * LockerGo API configuration.
 * Every value can be overridden with an environment variable (LG_DB_HOST, LG_DB_NAME, ...), or edit the defaults below.
 * This file only returns an array; it is loaded through lg_config() in db.php.
 */
if (basename($_SERVER['SCRIPT_FILENAME'] ?? '') === basename(__FILE__)) {
    http_response_code(403);
    exit;
}

$env = static function (string $key, string $default): string {
    $v = getenv($key);
    return ($v !== false && $v !== '') ? $v : $default;
};

return [
    'db' => [
        'host'    => $env('LG_DB_HOST', 'localhost'),
        'port'    => (int)$env('LG_DB_PORT', '3306'),
        'name'    => $env('LG_DB_NAME', 'lockergo'),
        'user'    => $env('LG_DB_USER', 'root'),
        'pass'    => $env('LG_DB_PASS', ''),
        'charset' => 'utf8mb4',
    ],
    'session_name' => 'lockergo_sid',
    // Private folder for session files, so the 30 day lifetime is not cut short by the system's shared session cleanup.
    // Empty = <project>/storage/sessions (created on first use, closed to web access). Set LG_SESSION_PATH to use another folder.
    'session_path' => $env('LG_SESSION_PATH', ''),
    'timezone'     => 'Asia/Bangkok',
    'debug'        => false,   // true = include exception messages in 500 responses (never enable in production)
];
