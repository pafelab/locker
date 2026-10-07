<?php
/**
 * Database access: lg_config() and db() (lazy PDO singleton).
 */
if (basename($_SERVER['SCRIPT_FILENAME'] ?? '') === basename(__FILE__)) {
    http_response_code(403);
    exit;
}

/** Loads config.php once. */
function lg_config(): array
{
    static $cfg = null;
    if ($cfg === null) {
        $cfg = require __DIR__ . '/config.php';
    }
    return $cfg;
}

/** Lazy PDO singleton. Throws PDOException when the server cannot be reached. */
function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $c = lg_config()['db'];
        $charset = preg_match('/^[a-z0-9]+$/i', (string)$c['charset']) ? $c['charset'] : 'utf8mb4';
        $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=%s', $c['host'], (int)$c['port'], $c['name'], $charset);
        $pdo = new PDO($dsn, $c['user'], $c['pass'], [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
            PDO::ATTR_TIMEOUT            => 3,
        ]);
        // same collation as the tables, and the same clock as PHP (DATETIME values are stored as local time)
        $pdo->exec('SET NAMES ' . $charset . ' COLLATE ' . $charset . '_unicode_ci');
        $pdo->exec('SET time_zone = ' . $pdo->quote(date('P')));
        $GLOBALS['LG_PDO'] = $pdo;
    }
    return $pdo;
}
