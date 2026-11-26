#!/usr/bin/env bash
# Create the local development and test databases on a Postgres that is already installed and
# running (Linux dev containers). On a Mac use `docker compose up -d db` from the repo root instead.
# Idempotent. Needs a superuser: runs psql as the `postgres` OS user.
set -euo pipefail

ROLE="${TIGER_DB_ROLE:-tiger}"
PASSWORD="${TIGER_DB_PASSWORD:-tiger}"
DATABASES=("tiger_dev" "tiger_test")

as_postgres() { su postgres -c "psql -v ON_ERROR_STOP=1 -Atq $*"; }

if command -v pg_ctlcluster >/dev/null 2>&1; then
  pg_lsclusters -h | awk '$4 != "online" { print $1, $2 }' | while read -r ver name; do
    pg_ctlcluster "$ver" "$name" start
  done
fi

if [ -z "$(as_postgres "-c \"SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}'\"")" ]; then
  as_postgres "-c \"CREATE ROLE ${ROLE} LOGIN PASSWORD '${PASSWORD}'\""
fi

for db in "${DATABASES[@]}"; do
  if [ -z "$(as_postgres "-c \"SELECT 1 FROM pg_database WHERE datname = '${db}'\"")" ]; then
    # pg_trgm only indexes non-ASCII text when the database locale is not plain C.
    as_postgres "-c \"CREATE DATABASE ${db} OWNER ${ROLE} TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8'\""
  fi
  # Extensions need a superuser once; the migrations then find them present.
  as_postgres "-d ${db} -c \"CREATE EXTENSION IF NOT EXISTS vector\" -c \"CREATE EXTENSION IF NOT EXISTS pg_trgm\""
done

echo "ready: postgres://${ROLE}:${PASSWORD}@127.0.0.1:5432/tiger_dev (and tiger_test)"
