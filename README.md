# LockerGo — Online Locker Booking Website Template 

A complete template for an online locker booking system, with a public site for customers and an admin back office for staff. The UI is in Thai.

- Front end: static HTML5 pages, Bootstrap 5.3, Bootstrap Icons, vanilla JS (ES2020) and Chart.js. No build step.
- Back end: a PHP 8.1+ JSON API using PDO, backed by MySQL 8 or MariaDB 10.4+.
- Fallback: when the API or the database can't be reached, the site switches to built-in mock data on its own, so every page still works.

---

## 1. Run it without a server (mock mode)

Open `index.html` in a browser by double-clicking it. That's all.

When a page is opened from `file://`, it uses the mock data in `assets/js/mock-data.js`. A yellow **"Demo mode: ข้อมูลตัวอย่าง"** badge stays on screen. Everything you change (bookings, lockers, settings and so on) is saved in your browser's `localStorage` and survives a refresh. None of it is ever sent to a database.

To start over, go to **Admin → ตั้งค่า → ระบบ → รีเซ็ตข้อมูลตัวอย่าง**.

> You can also serve the folder with any static server, for example `npx serve .`. With no PHP behind it, the health check fails and the site falls back to mock data.

## 2. Run it with PHP + MySQL (XAMPP / Laragon / shared hosting)

1. Copy the project folder into your web root:
   - XAMPP: `C:\xampp\htdocs\lockergo`
   - Laragon: `C:\laragon\www\lockergo`
2. Start Apache and MySQL.
3. Create the database by importing the two SQL files in order, using phpMyAdmin (Import tab) or the command line:
   ```bash
   mysql -u root -p < database/schema.sql   # creates database `lockergo` + tables
   mysql -u root -p < database/seed.sql     # demo data (same records as mock mode)
   ```
4. Edit `api/config.php` and set the DB host, name, user and password. You can also use the environment variables `LG_DB_HOST`, `LG_DB_NAME`, `LG_DB_USER` and `LG_DB_PASS`. PHP sessions are stored in `storage/sessions/`, which is created on first use and blocked from the web by `.htaccess`. On nginx, set `LG_SESSION_PATH` to a folder outside the web root.

   Payment slips (PromptPay transfers) are saved in `storage/slips/` with random file names. They are blocked from the web the same way and are only served to staff through `api/payments.php?id=…&action=slip`. Slips are kept as proof only and are never verified. On nginx, deny access to `/storage/` as well.

   Upgrading a database imported before slips existed? Run `mysql -u root -p lockergo < database/migrate-slip.sql` once. Fresh installs don't need it.
5. Open `http://localhost/lockergo/`. The demo badge should **not** appear, which means the data is coming from MySQL.

Seed dates are written relative to `CURDATE()`, so the demo data always looks current. If you change `assets/js/mock-data.js`, regenerate the seed so both modes stay identical:

```bash
node database/make-seed.js
```

## Buildings, sizes and daily booking

- Locations are **buildings** (ตึก 1 - ตึก 5). Each building holds exactly one locker size: ตึก 1 = S, ตึก 2 = M, ตึก 3 = L, ตึก 4 = XL, ตึก 5 = XXL (the new, largest size). The pages derive the building-to-size link from the locker data, never from fixed ids.
- Bookings are **daily only**: `durationType` is always `"day"` and `quantity` is the number of days. The API answers `422` to any other type. The `pricing` table keeps its `hour` and `month` columns, but the UI only shows and edits the per-day price (hour and month values are sent back unchanged when a price is saved).
- `settings.minDuration` / `maxDuration` are stored in **hours** (default 24 and 720 = 1 to 30 days). The admin UI shows and edits them in days.

## 3. Demo accounts (same in both modes)

Login is by **username** (not email). Usernames are 3-30 characters of `a-z 0-9 . _ -`, stored in lower case. Email is still collected and used for contact.

| Role | Username | Password | Login page |
| --- | --- | --- | --- |
| Customer | `user` | `demo1234` | `login.html` |
| Super Admin | `admin` | `admin1234` | `admin/login.html` |
| Manager | `manager` | `admin1234` | `admin/login.html` |
| Staff | `staff` | `admin1234` | `admin/login.html` |

The 14 other demo customers (`customer1` … `customer14`) use the password `demo1234`.

## 4. Folder structure

```
/                      public pages (index, lockers, booking, booking-success, pricing, login, register,
                       forgot-password, my-bookings, profile, terms, 404)
admin/                 back office pages (login, index = dashboard, lockers, bookings, customers, locations,
                       pricing, payments, reports, staff, activity-log, settings)
api/                   PHP JSON API: config.php, db.php, helpers.php + one file per resource
database/              schema.sql, seed.sql (generated), make-seed.js (seed generator)
assets/css/            custom.css (theme + shared components), admin.css (back office layout)
assets/js/config.js    dataMode, API base URL, timeout, quote() price formula
assets/js/mock-data.js demo records (deterministic; the source for seed.sql)
assets/js/mock-service.js  in-browser implementation of every API route (localStorage)
assets/js/api-client.js    fetch() wrapper for api/*.php (timeout, envelope, error classification)
assets/js/data-service.js  the data layer pages use (DS.getLockers(), DS.createBooking(), …)
assets/js/auth.js      session helpers + page guards
assets/js/main.js      shared UI: navbar/footer injection, theme, toasts, confirm dialog, demo badge, helpers
assets/js/admin.js     admin shell: sidebar, topbar, breadcrumbs, guard
assets/img/            logo.svg, favicon.svg
```

Pages never call `fetch()` or `localStorage` directly. They use only `DS.*` (data), `Auth.*` (session) and `LG.*` (UI helpers). The navbar, footer and admin sidebar are each defined once, in `main.js` and `admin.js`.

## 5. How the fallback works

`assets/js/config.js`:

```js
window.LG_CONFIG = {
  dataMode: 'auto',   // 'auto' | 'api' | 'mock'
  apiBase: 'api/',
  timeout: 3000,      // ms
};
```

| dataMode | Behaviour |
| --- | --- |
| `auto` (default) | Calls `api/health.php` once on the first page load and stores the result in `sessionStorage` for the session. If the call succeeds, the site uses the API; if not, it uses mock data. |
| `api` | Never falls back. If the API or database is down, a friendly "ระบบไม่พร้อมให้บริการ" page is shown instead. **Use this in production**, so a customer can never make a booking that isn't really saved. |
| `mock` | Never calls the API. |

In `auto` mode, the site switches to mock data in these cases:

- the page was opened from `file://`
- a request timed out (3 s) or the network failed
- the response isn't valid JSON
- the API returned HTTP 5xx or `"error": "db_unavailable"`

If the API fails in the middle of a session, a toast explains what happened, the demo badge appears, and the site keeps working on mock data.

Normal API errors **never** trigger the fallback: 400, 401, 403, 404, 409 (for example "ล็อกเกอร์นี้ถูกจองแล้ว") and 422 (validation). Their message is shown to the user instead.

To force a fresh health check, close the tab or clear `sessionStorage`. The key is `lg_mode`.

## 6. API endpoints

Every response uses one envelope, `{ "success": true, "data": … }` or `{ "success": false, "error": "code", "message": "…" }`, with a matching HTTP status. If the database can't be reached, every endpoint returns `503` with `db_unavailable`.

| Endpoint | Methods |
| --- | --- |
| `api/health.php` | `GET` — succeeds only when the DB connection works |
| `api/auth.php` | `GET ?action=me` · `POST ?action=login` `{username,password,admin,remember}` · `POST ?action=register` `{username,name,email,phone,password}` · `POST ?action=logout` · `POST ?action=forgot` · `PUT ?action=profile` · `PUT ?action=password` |
| `api/lockers.php` | `GET [?id] [?locationId&size&status&q&start&end]` (public; `start`/`end` → availability for that window) · `POST` · `PUT ?id` · `PUT ?action=bulk {ids,status}` · `DELETE ?id` (admin) |
| `api/locations.php` | `GET [?id]` (public) · `POST` · `PUT ?id` · `DELETE ?id` (admin) |
| `api/bookings.php` | `GET [?id\|?ref] [?q&status&from&to&mine]` (customers only see their own) · `POST` (transaction + overlap re-check → `409 locker_taken`) · `PUT ?id&action=status {status}` · `PUT ?id&action=extend {quantity}` |
| `api/customers.php` | `GET [?id]` · `PUT ?id {status}` (admin) |
| `api/pricing.php` | `GET` (prices; promos for admins) · `GET ?action=promo&code=` · `PUT ?type=price` · `POST/PUT/DELETE ?type=promo[&id]` |
| `api/payments.php` | `GET [?status&q]` · `PUT ?id&action=refund` (admin) |
| `api/staff.php` | `GET` (admin) · `POST` · `PUT ?id` · `DELETE ?id` (Super Admin only) |
| `api/reports.php` | `GET [?from&to]` — KPIs, daily bookings and revenue, status counts, top locations, lockers needing attention, recent bookings |
| `api/activity-log.php` | `GET [?limit]` (admin) |
| `api/settings.php` | `GET` (public) · `PUT` (admin) |

Security measures in the API:

- prepared statements for every query
- server-side validation of all input
- `password_hash()` / `password_verify()` for passwords
- PHP sessions with `HttpOnly` + `SameSite=Lax` cookies
- `Content-Type: application/json` required on writes (CSRF guard)
- a role check at the top of every admin endpoint
- an `activity_log` row for every admin change

`assets/js/mock-service.js` is the reference implementation. The PHP API returns the same shapes, codes and messages.

## 7. Change the logo and brand colors

- **Name:** set `brand` in `assets/js/config.js`.
- **Logo:** edit `LOGO_MARK` in `assets/js/main.js`, which is the inline SVG used in the navbar, footer, login pages and admin sidebar. Then replace `assets/img/logo.svg` and `assets/img/favicon.svg`.
- **Colors:** in `assets/css/custom.css`, change `--lg-primary`, `--lg-primary-dark`, `--lg-primary-rgb` and `--lg-accent`. There is a light set in `:root` and a dark set in `[data-bs-theme='dark']`. Bootstrap's primary buttons, links, pills and focus rings follow these variables automatically.
- **Status colors:** `--st-green`, `--st-amber`, `--st-blue`, `--st-gray` (and their `-text` variants).
- **Font:** change the Google Fonts `<link>` in the pages and `--lg-font`.

## 8. Notes and limitations

- "Forgot password" doesn't send email. Hook up your mailer in `api/auth.php` (`forgot`).
- Payment is a mock step. The card and PromptPay fields are never sent anywhere. Plug a real gateway into the `POST api/bookings.php` flow before going live.
- The logo upload in Settings is a preview only. Replace the files in `assets/img/` to change the real logo.
- `settings.defaultTheme` is saved but not applied yet. Visitors start in light mode until they use the toggle.
- `404.html` uses relative paths. Point your server's error page at it with its full path (for example `ErrorDocument 404 /lockergo/404.html`).
