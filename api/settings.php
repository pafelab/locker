<?php
/**
 * Site settings (key/value table, values JSON-encoded).
 *   GET                 -> object of all settings (public: the site name, contact details, policies are shown on the public pages)
 *   PUT                 -> merge the posted keys (staff)
 *   POST ?action=reset  -> 400 not_supported (demo-data reset exists only in the mock mode)
 */
require __DIR__ . '/helpers.php';

/** Settings as a JSON object (an empty table must encode as {} not []). */
function settings_object(): object
{
    return (object)settings_all();
}

switch (method()) {
    case 'GET':
        ok(settings_object());

    case 'PUT':
        require_admin();
        $b = body();
        if (str($b['siteName'] ?? null) === '') {
            fail(422, 'validation', 'กรุณากรอกชื่อเว็บไซต์');
        }
        if (isset($b['minDuration'], $b['maxDuration']) && (float)$b['minDuration'] > (float)$b['maxDuration']) {
            fail(422, 'validation', 'ระยะเวลาขั้นต่ำต้องไม่มากกว่าระยะเวลาสูงสุด');
        }
        if (count($b) > 60) {
            fail(422, 'validation', 'ข้อมูลการตั้งค่าไม่ถูกต้อง');
        }
        $encoded = [];
        foreach ($b as $key => $value) {
            $key = (string)$key;
            $json = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            if (preg_match('/^[A-Za-z][A-Za-z0-9_]{0,59}$/D', $key) !== 1 || $json === false || strlen($json) > 20000) {
                fail(422, 'validation', 'ข้อมูลการตั้งค่าไม่ถูกต้อง');
            }
            $encoded[$key] = $json;
        }
        db_tx(static function () use ($encoded): void {
            foreach ($encoded as $key => $json) {
                db_exec('REPLACE INTO settings (k, v) VALUES (?, ?)', [(string)$key, $json]);
            }
            log_activity('แก้ไขการตั้งค่าระบบ', 'ตั้งค่า');
        });
        ok(settings_object());

    case 'POST':
        if (qparam('action') !== 'reset') {
            fail(400, 'bad_request', 'Unknown action');
        }
        fail(400, 'not_supported', 'ใช้ได้เฉพาะโหมดข้อมูลตัวอย่าง');

    default:
        fail(405, 'method_not_allowed', 'Method not allowed');
}
