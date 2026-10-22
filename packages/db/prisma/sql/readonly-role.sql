-- The web app connects as this role. It can read and nothing else, so a write
-- from a Server Component fails in Postgres rather than in code review.
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
REVOKE SELECT ON "ShopPaymentAccount" FROM curios_readonly;
GRANT SELECT ("pageId", "provider", "brandId", "brandName", "publicKeyPem", "methods", "isTest", "connectedAt", "checkedAt", "lastErrorAt")
  ON "ShopPaymentAccount" TO curios_readonly;
