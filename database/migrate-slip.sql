-- Upgrade for databases created before the payment-slip feature.
-- Run once (skip on a fresh install: schema.sql already has the column):
--   mysql -u root -p lockergo < database/migrate-slip.sql
ALTER TABLE payments ADD COLUMN slip_path VARCHAR(255) NULL AFTER status;
