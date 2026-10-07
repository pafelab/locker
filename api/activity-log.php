<?php
/**
 * Activity log (staff only). GET [?limit=200] newest first, limit capped at 500.
 */
require __DIR__ . '/helpers.php';

if (method() !== 'GET') {
    fail(405, 'method_not_allowed', 'Method not allowed');
}
require_admin();

$n = to_num(qparam('limit'));
$limit = (is_finite($n) && $n >= 1) ? (int)min(floor($n), 500) : 200;   // missing / invalid / 0 -> 200 (like `+q.limit || 200`)

$rows = db_all('SELECT id, actor_id, actor_name, action, target, created_at FROM activity_log ORDER BY created_at DESC, id DESC LIMIT ' . $limit);
ok(array_map(static fn(array $r): array => [
    'id'        => (int)$r['id'],
    'actorId'   => $r['actor_id'] === null ? null : (int)$r['actor_id'],
    'actor'     => $r['actor_name'],
    'action'    => $r['action'],
    'target'    => $r['target'],
    'createdAt' => $r['created_at'],
], $rows));
