<?php
require __DIR__ . '/helpers.php';

if (method() !== 'GET') {
    fail(405, 'method_not_allowed', 'Method not allowed');
}

db_val('SELECT 1');   // throws (-> 500/503 JSON) when the database does not answer
ok(['status' => 'ok', 'time' => now_str()]);
