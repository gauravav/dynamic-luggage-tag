-- Provisioning applied by infra/scripts/db-up.sh once the server is accepting
-- connections. Idempotent: safe to re-run on every start.
--
-- psql variables: :app_user, :app_password, :db_name (passed with -v so the
-- password never appears in a file, an image layer, or the process table).
--
-- \gexec rather than a DO block: psql does not interpolate variables inside
-- dollar-quoted strings, so the password would be passed through literally.

\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- The API never connects as the superuser.
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'app_user', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user')
\gexec

SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', :'app_user', :'app_password')
\gexec

-- No SUPERUSER, CREATEDB, CREATEROLE, REPLICATION or RLS bypass.
ALTER ROLE :"app_user" NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

-- Nothing is world-creatable; the app gets one schema that it owns.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE :"db_name" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db_name" TO :"app_user";

CREATE SCHEMA IF NOT EXISTS dlt AUTHORIZATION :"app_user";
GRANT USAGE ON SCHEMA public TO :"app_user";

-- search_path deliberately excludes dlt. SQLAlchemy qualifies every table
-- with its schema, so the app does not need it on the path — and if dlt were
-- the default schema, Alembic would reflect each table both qualified and
-- unqualified and report permanent phantom drift.
ALTER ROLE :"app_user" IN DATABASE :"db_name" SET search_path = public;

-- Statement text carries ciphertext and blind indexes; keep it out of the logs.
ALTER ROLE :"app_user" SET log_statement = 'none';
