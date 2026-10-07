<?php
/**
 * Dashboard / report data (staff only). GET [?from=YYYY-MM-DD&to=YYYY-MM-DD]  (default: the last 30 days)
 */
require __DIR__ . '/helpers.php';

if (method() !== 'GET') {
    fail(405, 'method_not_allowed', 'Method not allowed');
}
require_admin();

$to = qparam('to') ?? today_str();
$from = qparam('from');
if (!valid_ymd($to) || ($from !== null && !valid_ymd($from))) {
    fail(422, 'validation', 'ช่วงวันที่ไม่ถูกต้อง');
}
$toDay = new DateTimeImmutable($to);
$from = $from ?? $toDay->modify('-29 days')->format('Y-m-d');
$fromDay = new DateTimeImmutable($from);
if ($toDay->getTimestamp() - $fromDay->getTimestamp() > 731 * 86400) {
    fail(422, 'validation', 'ช่วงวันที่ยาวเกินไป');
}

// [from 00:00, to+1 00:00) bounds for index-friendly range filters
$fromDt = $from . ' 00:00:00';
$toEx = $toDay->modify('+1 day')->format('Y-m-d') . ' 00:00:00';

$days = [];
for ($d = $fromDay; $d <= $toDay; $d = $d->modify('+1 day')) {
    $days[] = $d->format('Y-m-d');
}

// lockers by status
$statusCounts = ['available' => 0, 'booked' => 0, 'in_use' => 0, 'maintenance' => 0];
foreach (db_all('SELECT status, COUNT(*) AS c FROM lockers GROUP BY status') as $r) {
    $statusCounts[$r['status']] = (int)$r['c'];
}
$totalLockers = array_sum($statusCounts);

// today / month / range figures
$today = today_str();
$tomorrow = (new DateTimeImmutable($today))->modify('+1 day')->format('Y-m-d');
$monthStart = date('Y-m-01');
$nextMonth = (new DateTimeImmutable($monthStart))->modify('+1 month')->format('Y-m-d');

$bookingsToday = (int)db_val('SELECT COUNT(*) FROM bookings WHERE start_at >= ? AND start_at < ?', [$today . ' 00:00:00', $tomorrow . ' 00:00:00']);
$revenueMonth = (int)db_val(
    "SELECT COALESCE(SUM(amount), 0) FROM payments WHERE status = 'paid' AND created_at >= ? AND created_at < ?",
    [$monthStart . ' 00:00:00', $nextMonth . ' 00:00:00']
);
$rangeBookings = (int)db_val('SELECT COUNT(*) FROM bookings WHERE start_at >= ? AND start_at < ?', [$fromDt, $toEx]);
$rangeRevenue = (int)db_val(
    "SELECT COALESCE(SUM(amount), 0) FROM payments WHERE status = 'paid' AND created_at >= ? AND created_at < ?",
    [$fromDt, $toEx]
);

// per-day series (one entry per day, zeros included)
$bookingsPerDay = [];
foreach (db_all('SELECT DATE(start_at) AS d, COUNT(*) AS c FROM bookings WHERE start_at >= ? AND start_at < ? GROUP BY DATE(start_at)', [$fromDt, $toEx]) as $r) {
    $bookingsPerDay[(string)$r['d']] = (int)$r['c'];
}
$revenuePerDay = [];
foreach (db_all("SELECT DATE(created_at) AS d, SUM(amount) AS s FROM payments WHERE status = 'paid' AND created_at >= ? AND created_at < ? GROUP BY DATE(created_at)", [$fromDt, $toEx]) as $r) {
    $revenuePerDay[(string)$r['d']] = (int)$r['s'];
}
$bookingsByDay = [];
$revenueByDay = [];
foreach ($days as $day) {
    $bookingsByDay[] = ['date' => $day, 'count' => $bookingsPerDay[$day] ?? 0];
    $revenueByDay[] = ['date' => $day, 'amount' => $revenuePerDay[$day] ?? 0];
}

// top locations: bookings starting in the range, revenue of their paid payments, current occupancy
$bookingsByLoc = [];
foreach (db_all('SELECT l.location_id AS lid, COUNT(*) AS c FROM bookings b JOIN lockers l ON l.id = b.locker_id WHERE b.start_at >= ? AND b.start_at < ? GROUP BY l.location_id', [$fromDt, $toEx]) as $r) {
    $bookingsByLoc[(int)$r['lid']] = (int)$r['c'];
}
$revenueByLoc = [];
foreach (db_all("SELECT l.location_id AS lid, SUM(p.amount) AS s FROM bookings b JOIN lockers l ON l.id = b.locker_id JOIN payments p ON p.booking_id = b.id AND p.status = 'paid' WHERE b.start_at >= ? AND b.start_at < ? GROUP BY l.location_id", [$fromDt, $toEx]) as $r) {
    $revenueByLoc[(int)$r['lid']] = (int)$r['s'];
}
$top = [];
$locSql = "SELECT loc.id, loc.name, "
    . "(SELECT COUNT(*) FROM lockers x WHERE x.location_id = loc.id) AS locker_count, "
    . "(SELECT COUNT(*) FROM lockers x WHERE x.location_id = loc.id AND x.status IN ('booked', 'in_use')) AS occupied "
    . "FROM locations loc ORDER BY loc.id";
foreach (db_all($locSql) as $r) {
    $lid = (int)$r['id'];
    $cnt = (int)$r['locker_count'];
    $top[] = [
        'locationId' => $lid,
        'name'       => $r['name'],
        'bookings'   => $bookingsByLoc[$lid] ?? 0,
        'revenue'    => $revenueByLoc[$lid] ?? 0,
        'occupancy'  => $cnt ? (int)round((int)$r['occupied'] / $cnt * 100) : 0,
    ];
}
usort($top, static fn(array $a, array $b): int => $b['revenue'] <=> $a['revenue']);   // stable: ties keep location order

ok([
    'from' => $from,
    'to'   => $to,
    'kpis' => [
        'totalLockers'  => $totalLockers,
        'availableNow'  => $statusCounts['available'],
        'bookingsToday' => $bookingsToday,
        'revenueMonth'  => $revenueMonth,
        'occupancyRate' => $totalLockers ? (int)round(($statusCounts['booked'] + $statusCounts['in_use']) / $totalLockers * 100) : 0,
        'rangeBookings' => $rangeBookings,
        'rangeRevenue'  => $rangeRevenue,
    ],
    'bookingsByDay' => $bookingsByDay,
    'revenueByDay'  => $revenueByDay,
    'statusCounts'  => $statusCounts,
    'topLocations'  => $top,
    'attention'     => array_map('map_locker', db_all(LOCKER_SELECT . " WHERE l.status = 'maintenance' ORDER BY l.id")),
    'recent'        => array_map('map_booking', db_all(BOOKING_SELECT . ' ORDER BY b.created_at DESC, b.id ASC LIMIT 8')),
]);
