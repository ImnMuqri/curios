-- The web app connects as this role. It can read and nothing else, so a write
-- from a Server Component fails in Postgres rather than in code review.
--
-- THE RULE FOR A TABLE WITH A PII COLUMN. The default privileges below give the role every table a
-- migration creates, whole, the moment it exists; this script narrows it again only after
-- `migrate deploy` finishes. Postgres default privileges cannot be column-wise, so the gap cannot
-- be closed from here. A migration that creates a table with a column the role must not read (or
-- adds such a column) therefore REVOKEs SELECT and GRANTs the other columns inline, guarded by
-- `IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'curios_readonly')`, as
-- 20261027050000_admin_indexes_report_privileges does. Then add the same narrowing to this file.
--
-- The GRANT CONNECT is issued via EXECUTE against current_database() rather
-- than hardcoding a database name, so this single file applies unchanged to
-- both curios and curios_test.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'curios_readonly') THEN
    CREATE ROLE curios_readonly LOGIN PASSWORD 'curios_readonly';
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO curios_readonly', current_database());
END $$;

GRANT USAGE ON SCHEMA public TO curios_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO curios_readonly;

-- Tables created by future migrations must inherit the same grant.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO curios_readonly;

-- Every column of a shop's payment account but the sealed CHIP secret key: the
-- web app never needs it, so it cannot read it. Re-granting ALL TABLES above
-- gives the whole table back, so this narrows it again on every run.
-- Skipped until the migration has created the table.
DO $$
BEGIN
  IF to_regclass('"ShopPaymentAccount"') IS NOT NULL THEN
    REVOKE SELECT ON "ShopPaymentAccount" FROM curios_readonly;
    GRANT SELECT ("pageId", "provider", "brandId", "brandName", "publicKeyPem", "methods", "isTest", "connectedAt", "checkedAt", "lastErrorAt")
      ON "ShopPaymentAccount" TO curios_readonly;
  END IF;
END $$;

-- Every column of an admin user but the password hash.
DO $$
BEGIN
  IF to_regclass('"AdminUser"') IS NOT NULL THEN
    REVOKE SELECT ON "AdminUser" FROM curios_readonly;
    GRANT SELECT ("id", "email", "name", "role", "disabledAt", "lastLoginAt", "createdAt")
      ON "AdminUser" TO curios_readonly;
  END IF;
END $$;

-- Every column of a report but the reporter's hashed address.
DO $$
BEGIN
  IF to_regclass('"Report"') IS NOT NULL THEN
    REVOKE SELECT ON "Report" FROM curios_readonly;
    GRANT SELECT ("id", "pageId", "reason", "details", "status", "decidedById", "decidedAt", "createdAt")
      ON "Report" TO curios_readonly;
  END IF;
END $$;

-- Every column of a CHIP message but its body, which holds the payer's name and email.
DO $$
BEGIN
  IF to_regclass('"ChipWebhookEvent"') IS NOT NULL THEN
    REVOKE SELECT ON "ChipWebhookEvent" FROM curios_readonly;
    GRANT SELECT ("id", "source", "eventType", "purchaseId", "attempts", "outcome", "statusCode", "error", "receivedAt", "lastAttemptAt")
      ON "ChipWebhookEvent" TO curios_readonly;
  END IF;
END $$;
