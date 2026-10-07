# Prompt: Online Locker Booking System — Website Template (HTML + Bootstrap + PHP API)

## 1. Role and goal

You are a senior front-end developer and UI/UX designer. Build a complete, ready-to-use **website template for an online locker booking system**, with a public-facing site for customers and a modern admin back office.

The site stores its data in **MySQL through a PHP JSON API**. If the PHP API or the database cannot be reached, the site must **automatically fall back to built-in mock data**, so every page still works end to end and the template can be demoed anywhere, even without a server.

## 2. Tech stack and constraints

- **HTML5** with semantic markup, one file per page.
- **Bootstrap 5.3** (CSS and JS bundle) loaded from CDN, used for layout, components and utilities.
- **Bootstrap Icons** for all icons.
- **Vanilla JavaScript (ES6+)** only. No jQuery, no frameworks, no build step.
- **Chart.js** (CDN) for the admin charts.
- One shared `custom.css` for the theme, built on CSS variables. Avoid inline styles.
- **PHP 8.1+** for the API, plain PHP with **PDO**. No framework, no Composer dependencies.
- **MySQL 8 / MariaDB 10.4+**, `utf8mb4` throughout.
- Front-end pages stay as static `.html` files and talk to PHP only through `fetch()` and JSON. Do not mix PHP into the page markup.
- Runs in two ways: on a PHP server (XAMPP, Laragon or shared hosting) with the database, or by opening `index.html` directly in a browser, in which case it uses mock data.
- **UI text language: Thai**, using a Thai-friendly Google Font (for example `Prompt` or `Noto Sans Thai`). Code, comments, file names and variable names in English.
- Currency: Thai Baht (฿). Date format: DD/MM/YYYY, 24-hour time.

## 3. Brand and design direction

- **Logo:** design an original inline SVG logo (a locker or padlock mark plus a wordmark). Use the placeholder brand name `LockerGo`, and make it easy to replace. Show the logo in the navbar, footer, login pages, admin sidebar, and as the favicon.
- **Style:** clean, modern and trustworthy. Generous spacing, rounded corners, soft shadows, clear visual hierarchy.
- **Color:** one primary brand color, one accent, and neutral grays, all defined as CSS variables. Use fixed semantic colors for locker status:
  - Available: green
  - Booked / Reserved: amber
  - In use: blue
  - Maintenance / Out of service: gray or red
- **Light and dark mode** with a toggle, using Bootstrap's `data-bs-theme`. Remember the choice in `localStorage`.
- **Fully responsive**, mobile first. Test at 360px, 768px, 1024px and 1440px.
- **Accessible:** sufficient contrast, visible focus states, labels on every form field, `alt` text, ARIA attributes on interactive components, full keyboard navigation.

## 4. Public site (customer side)

Shared across all public pages: a sticky top navbar (logo, Home, Lockers, Pricing, How it works, FAQ, Contact, Login / Register or user menu) and a footer (logo, quick links, contact details, social icons, copyright).

| Page | File | Contents |
| --- | --- | --- |
| Home | `index.html` | Hero with headline and a quick-search box (location, date, size); how it works in 3–4 steps; locker sizes with prices; key features; locations preview; testimonials; FAQ accordion; call to action |
| Browse lockers | `lockers.html` | Filters for location, size, date and time; a visual locker grid colored by status with a legend; click an available locker to see details and start booking |
| Booking | `booking.html` | Multi-step wizard with a progress indicator: (1) location and locker, (2) date, time and duration, (3) customer details, (4) review and price summary, (5) mock payment, (6) confirmation |
| Booking confirmation | `booking-success.html` | Booking reference, locker number, access PIN, QR code placeholder, print and download buttons |
| Pricing | `pricing.html` | Pricing cards by size (S / M / L / XL) and by duration (hourly, daily, monthly) |
| Login | `login.html` | Email and password, remember me, forgot password link |
| Register | `register.html` | Name, email, phone, password, confirm password, accept terms |
| Forgot password | `forgot-password.html` | Email form with a success state |
| My bookings | `my-bookings.html` | Tabs for upcoming, active and past bookings; view details; extend; cancel with a confirmation modal |
| Profile | `profile.html` | Edit personal details, change password, notification preferences |
| Contact | `contact.html` | Contact form, address, opening hours, map placeholder |
| Terms and privacy | `terms.html` | Static content page |
| Not found | `404.html` | Friendly error page with a link back home |

## 5. Admin back office

A modern dashboard layout: a collapsible left sidebar (logo, grouped menu with icons, active state), a top bar (sidebar toggle, global search, notification dropdown, theme toggle, admin profile menu), breadcrumbs, and a content area. On mobile the sidebar becomes an offcanvas drawer.

| Page | File | Contents |
| --- | --- | --- |
| Admin login | `admin/login.html` | Separate login screen for staff |
| Dashboard | `admin/index.html` | KPI cards (total lockers, available now, bookings today, revenue this month, occupancy rate); booking trend line chart; revenue bar chart; locker status doughnut chart; recent bookings table; lockers needing attention |
| Locker management | `admin/lockers.html` | Switch between a visual grid view and a table view; filter by location, size and status; add, edit and delete through modals; change status; bulk actions |
| Booking management | `admin/bookings.html` | Table with search, filters for status and date range, sorting and pagination; booking detail offcanvas; approve, cancel, mark as completed; create a booking manually |
| Customers | `admin/customers.html` | Customer list, search, profile with booking history, suspend or activate |
| Locations | `admin/locations.html` | Manage branches and zones: name, address, opening hours, number of lockers |
| Pricing | `admin/pricing.html` | Manage price by size and duration; manage promo codes |
| Payments | `admin/payments.html` | Transaction list with status (paid, pending, refunded) and a refund action |
| Reports | `admin/reports.html` | Date range picker; revenue and occupancy charts; top locations; export to CSV and print |
| Staff and roles | `admin/staff.html` | Admin accounts with roles (Super Admin, Manager, Staff) and a permissions matrix |
| Activity log | `admin/activity-log.html` | Timeline of who did what and when |
| Settings | `admin/settings.html` | Tabbed: general (site name, logo upload preview), booking rules (minimum and maximum duration, grace period, cancellation policy), notification templates, appearance |

## 6. Data: PHP + MySQL API with automatic mock fallback

### 6.1 PHP API and database

- Provide `database/schema.sql` (tables, keys, indexes) and `database/seed.sql` (demo data). Tables: `users` (with a `role` column), `locations`, `lockers`, `bookings`, `payments`, `pricing`, `promo_codes`, `activity_log`, `settings`.
- Keep the connection settings in `api/config.php` and create the PDO connection in `api/db.php`.
- One PHP file per resource under `api/`, using HTTP methods (GET to read, POST to create, PUT to update, DELETE to remove): `health.php`, `auth.php`, `lockers.php`, `locations.php`, `bookings.php`, `customers.php`, `pricing.php`, `payments.php`, `staff.php`, `reports.php`, `activity-log.php`, `settings.php`.
- Every response is JSON in one envelope: `{ "success": true, "data": ... }` or `{ "success": false, "error": "code", "message": "..." }`, with a matching HTTP status code.
- `health.php` returns success only when the database connection works. If the connection fails, every endpoint returns HTTP 503 with `"error": "db_unavailable"` and never prints a PHP warning or HTML.
- Security: prepared statements for every query, server-side validation of all input, `password_hash()` and `password_verify()`, session-based login with `HttpOnly` cookies, and a role check at the top of every admin endpoint.
- Create a booking inside a transaction that re-checks the locker is free for the requested time, so two people cannot book the same locker. Return HTTP 409 when it is taken.
- Write an `activity_log` row for every admin change.

### 6.2 Fallback rules

- `assets/js/config.js` holds `dataMode`: `'auto'` (default), `'api'` or `'mock'`, plus the API base URL and a request timeout (3 seconds).
- In `'auto'` mode, call `api/health.php` once when the first page loads and store the result in `sessionStorage`. If it succeeds, use the API. If it fails, use mock data.
- Switch to mock data when: the page is opened from `file://`, the request times out or the network fails, the response is not valid JSON, or the API returns 5xx or `db_unavailable`.
- **Do not** switch to mock data on normal API errors (400, 401, 403, 404, 409, 422). Show the API's message to the user instead.
- If the API fails in the middle of a session, switch to mock data, show a toast explaining it, and continue.
- While in mock mode, show a small persistent "Demo mode: sample data" badge on every page, public and admin, so nobody mistakes sample data for real data. Changes made in mock mode stay in the browser and are never sent to the database.
- `'api'` mode disables the fallback and shows a friendly "Service unavailable" page instead. Explain in the README that this is the setting to use in production, so customers never make a booking that is not really saved.
- `'mock'` mode never calls the API.

### 6.3 Mock data and shared behavior

- Keep all mock data in `assets/js/mock-data.js`: locations, lockers, bookings, customers, payments, staff and activity log. Include enough records to look realistic (at least 3 locations, 60 lockers, 30 bookings, 15 customers). `database/seed.sql` must contain the same records, so the site looks the same in both modes.
- Put every read and write behind a small data layer in `assets/js/data-service.js`, with functions such as `getLockers()`, `createBooking()` and `updateLockerStatus()`. Page code calls only these functions and never calls `fetch()` or `localStorage` directly.
- Each function has two implementations behind it: an API one (`assets/js/api-client.js`) and a mock one (`assets/js/mock-service.js`). Both are `async` and return data in exactly the same shape, so pages behave identically in either mode.
- In mock mode, persist changes in `localStorage` so they survive a page refresh, and add a "Reset demo data" action in admin settings.
- Authentication uses PHP sessions in API mode and is simulated with `localStorage` in mock mode. Seed the same demo accounts in both, and show them on the login pages:
  - Customer: `user@demo.com` / `demo1234`
  - Admin: `admin@demo.com` / `admin1234`
- Redirect to the login page when a protected page is opened without a session.
- All interactions must work: form validation with Bootstrap validation styles, live price calculation in the booking wizard, search, filter, sort, pagination, modals, toasts for success and error feedback, confirmation dialogs before destructive actions.
- Design the empty, loading and error states too, for example "No bookings found" and skeleton placeholders.

## 7. Project structure

```
/
├── index.html
├── lockers.html
├── booking.html
├── booking-success.html
├── pricing.html
├── login.html
├── register.html
├── forgot-password.html
├── my-bookings.html
├── profile.html
├── contact.html
├── terms.html
├── 404.html
├── admin/
│   ├── login.html
│   ├── index.html
│   ├── lockers.html
│   ├── bookings.html
│   ├── customers.html
│   ├── locations.html
│   ├── pricing.html
│   ├── payments.html
│   ├── reports.html
│   ├── staff.html
│   ├── activity-log.html
│   └── settings.html
├── api/
│   ├── config.php
│   ├── db.php
│   ├── helpers.php
│   ├── health.php
│   ├── auth.php
│   ├── lockers.php
│   ├── locations.php
│   ├── bookings.php
│   ├── customers.php
│   ├── pricing.php
│   ├── payments.php
│   ├── staff.php
│   ├── reports.php
│   ├── activity-log.php
│   └── settings.php
├── database/
│   ├── schema.sql
│   └── seed.sql
├── assets/
│   ├── css/
│   │   ├── custom.css
│   │   └── admin.css
│   ├── js/
│   │   ├── config.js
│   │   ├── mock-data.js
│   │   ├── mock-service.js
│   │   ├── api-client.js
│   │   ├── data-service.js
│   │   ├── auth.js
│   │   ├── main.js
│   │   └── admin.js
│   └── img/
│       ├── logo.svg
│       └── favicon.svg
└── README.md
```

## 8. Code quality

- Clean, consistently indented, well-commented code.
- Reuse the navbar, footer and admin sidebar across pages by injecting them from JavaScript, so each is defined once.
- Use Bootstrap utilities and components first. Write custom CSS only where Bootstrap does not cover the need.
- No broken links, no console errors, no placeholder "lorem ipsum" where realistic content is possible.
- Pin CDN versions.
- Use placeholder images from inline SVG or CSS gradients rather than external image hosts.

## 9. Deliverables

1. All HTML, CSS, JavaScript, PHP and SQL files, complete and in the structure above. Do not abbreviate or skip files with "similar to the previous page".
2. A `README.md` covering: how to run it without a server (mock mode); how to set it up with XAMPP or Laragon (create the database, import `schema.sql` and `seed.sql`, edit `api/config.php`); the folder structure; the demo accounts; how the fallback works and how to change `dataMode`; the list of API endpoints; and how to change the logo and brand colors.

## 10. Acceptance checklist

- [ ] With PHP and MySQL running, all data comes from the database and every change is saved there.
- [ ] With MySQL stopped, or with `index.html` opened directly, the site loads mock data on its own, shows the demo-mode badge, and every page still works.
- [ ] A validation or "locker already booked" error from the API shows a message and does not trigger the fallback.
- [ ] Every menu item and button leads somewhere that works.
- [ ] A customer can register, log in, find a locker, complete a booking and see it in "My bookings".
- [ ] A booking made on the public site appears in the admin booking table, and the locker's status changes in the admin grid.
- [ ] An admin can add, edit and delete lockers, and change a booking's status.
- [ ] Dashboard numbers and charts are calculated from the current data source, not hard-coded.
- [ ] Layout holds up on mobile, tablet and desktop.
- [ ] Light and dark mode both look finished.
- [ ] The logo appears on every page.

## 11. How to work

Start by briefly listing the design decisions (brand color, font, layout approach), then build in this order: database schema and seed, PHP API, shared assets and the data layer with both modes, public pages, admin pages, README. If the output is too long for one response, stop at a file boundary and continue when asked, without repeating files already delivered.
