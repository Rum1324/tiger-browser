-- Runs once, when the docker-compose db volume is first created (docker-entrypoint-initdb.d).
-- tiger_dev is created by POSTGRES_DB; this adds tiger_test and the extensions in both, matching
-- scripts/dev-db.sh on Linux.
CREATE DATABASE tiger_test TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8';

\connect tiger_dev
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

\connect tiger_test
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
