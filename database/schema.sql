-- LockerGo database schema (MySQL 8 / MariaDB 10.4+, utf8mb4)
-- Import this first, then seed.sql.  Money is stored as whole baht (INT).

CREATE DATABASE IF NOT EXISTS lockergo CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE lockergo;

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS settings, activity_log, promo_codes, pricing, payments, bookings, lockers, locations, users;
SET FOREIGN_KEY_CHECKS = 1;

-- customers and staff share one table; `role` tells them apart
CREATE TABLE users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(120) NOT NULL,
  email         VARCHAR(190) NOT NULL,
  phone         VARCHAR(30)  NOT NULL DEFAULT '',
  role          ENUM('customer','staff','manager','super_admin') NOT NULL DEFAULT 'customer',
  status        ENUM('active','suspended') NOT NULL DEFAULT 'active',
  password_hash VARCHAR(255) NOT NULL,
  notify_email  TINYINT(1) NOT NULL DEFAULT 1,
  notify_sms    TINYINT(1) NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME NULL,
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE locations (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(120) NOT NULL,
  address    VARCHAR(255) NOT NULL,
  zones      VARCHAR(120) NOT NULL DEFAULT '',
  open_hours VARCHAR(60)  NOT NULL DEFAULT '',
  phone      VARCHAR(30)  NOT NULL DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE lockers (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code        VARCHAR(20) NOT NULL,
  location_id INT UNSIGNED NOT NULL,
  size        ENUM('S','M','L','XL') NOT NULL,
  zone        VARCHAR(20) NOT NULL DEFAULT '',
  status      ENUM('available','booked','in_use','maintenance') NOT NULL DEFAULT 'available',
  UNIQUE KEY uq_lockers_code (code),
  KEY idx_lockers_location_status (location_id, status),
  CONSTRAINT fk_lockers_location FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- user_id is NULL for walk-in bookings created by staff; customer_* is a snapshot taken at booking time
CREATE TABLE bookings (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ref            VARCHAR(20) NOT NULL,
  user_id        INT UNSIGNED NULL,
  customer_name  VARCHAR(120) NOT NULL,
  customer_email VARCHAR(190) NOT NULL,
  customer_phone VARCHAR(30)  NOT NULL,
  locker_id      INT UNSIGNED NOT NULL,
  start_at       DATETIME NOT NULL,
  end_at         DATETIME NOT NULL,
  duration_type  ENUM('hour','day','month') NOT NULL,
  quantity       INT UNSIGNED NOT NULL,
  amount         INT UNSIGNED NOT NULL DEFAULT 0,
  discount       INT UNSIGNED NOT NULL DEFAULT 0,
  promo_code     VARCHAR(40) NULL,
  status         ENUM('pending','confirmed','active','completed','cancelled') NOT NULL DEFAULT 'confirmed',
  pin            CHAR(6) NOT NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_bookings_ref (ref),
  KEY idx_bookings_locker_time (locker_id, start_at, end_at),
  KEY idx_bookings_user (user_id),
  KEY idx_bookings_status (status),
  KEY idx_bookings_start (start_at),
  CONSTRAINT fk_bookings_user   FOREIGN KEY (user_id)   REFERENCES users (id)   ON DELETE SET NULL,
  CONSTRAINT fk_bookings_locker FOREIGN KEY (locker_id) REFERENCES lockers (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE payments (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  booking_id INT UNSIGNED NOT NULL,
  amount     INT UNSIGNED NOT NULL,
  method     ENUM('card','promptpay','cash') NOT NULL DEFAULT 'card',
  status     ENUM('paid','pending','refunded') NOT NULL DEFAULT 'paid',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_payments_booking (booking_id),
  KEY idx_payments_status (status),
  CONSTRAINT fk_payments_booking FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE pricing (
  size        ENUM('S','M','L','XL') NOT NULL PRIMARY KEY,
  hour_price  INT UNSIGNED NOT NULL,
  day_price   INT UNSIGNED NOT NULL,
  month_price INT UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE promo_codes (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code       VARCHAR(40) NOT NULL,
  type       ENUM('percent','fixed') NOT NULL,
  value      INT UNSIGNED NOT NULL,
  active     TINYINT(1) NOT NULL DEFAULT 1,
  expires_at DATETIME NULL,
  UNIQUE KEY uq_promo_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE activity_log (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  actor_id   INT UNSIGNED NULL,
  actor_name VARCHAR(120) NOT NULL,
  action     VARCHAR(120) NOT NULL,
  target     VARCHAR(190) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_activity_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- key/value; `v` holds a JSON-encoded value (string / number)
CREATE TABLE settings (
  k VARCHAR(60) NOT NULL PRIMARY KEY,
  v TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
