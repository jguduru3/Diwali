-- Least-privilege runtime role (SPEC §10): the app can read/write rows but never
-- change the schema. Migrations run separately with the admin login.
-- Run by the deploy workflow:  psql "$MIGRATION_URL" -v app_password="..." -f infra/db-roles.sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'festive_app') THEN
    CREATE ROLE festive_app LOGIN;
  END IF;
END
$$;

ALTER ROLE festive_app WITH LOGIN PASSWORD :'app_password';

GRANT CONNECT ON DATABASE festive TO festive_app;
GRANT USAGE ON SCHEMA public TO festive_app;
REVOKE CREATE ON SCHEMA public FROM festive_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO festive_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO festive_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO festive_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO festive_app;
-- Drizzle's migration journal stays admin-only.
REVOKE ALL ON SCHEMA drizzle FROM festive_app;
