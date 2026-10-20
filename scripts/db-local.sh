#!/usr/bin/env bash
# npm run db:local — local Postgres without Docker, for containers where PostgreSQL 16 is
# installed as a Debian/Ubuntu cluster (pg_ctlcluster) and the shell runs as root or postgres.
#
# Idempotent: starts the cluster if it is down, sets the postgres role's password (TCP logins
# use scram-sha-256), and creates maqady_dev and maqady_test if they are missing.
# Developer machines use `docker compose up -d` instead.
set -euo pipefail

PG_VERSION="${PG_VERSION:-16}"
PG_CLUSTER="${PG_CLUSTER:-main}"
PG_PASSWORD="${PG_PASSWORD:-postgres}"
DATABASES=(maqady_dev maqady_test)

as_postgres() {
  if [ "$(id -un)" = "postgres" ]; then
    "$@"
  else
    runuser -u postgres -- "$@"
  fi
}

if ! command -v pg_ctlcluster >/dev/null 2>&1; then
  echo "pg_ctlcluster not found: install PostgreSQL ${PG_VERSION}, or use docker compose up -d" >&2
  exit 1
fi

if ! pg_lsclusters --no-header | awk -v v="$PG_VERSION" -v c="$PG_CLUSTER" '$1 == v && $2 == c && $4 == "online" { found = 1 } END { exit !found }'; then
  echo "Starting PostgreSQL ${PG_VERSION}/${PG_CLUSTER}..."
  pg_ctlcluster "$PG_VERSION" "$PG_CLUSTER" start
fi

for _ in $(seq 1 30); do
  if as_postgres pg_isready -q; then break; fi
  sleep 1
done
as_postgres pg_isready -q || { echo "PostgreSQL did not become ready" >&2; exit 1; }

as_postgres psql -v ON_ERROR_STOP=1 -q -c "ALTER ROLE postgres WITH PASSWORD '${PG_PASSWORD}'"

for db in "${DATABASES[@]}"; do
  if [ "$(as_postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = '${db}'")" != "1" ]; then
    as_postgres createdb "$db"
    echo "Created database ${db}"
  else
    echo "Database ${db} already exists"
  fi
done

echo "Ready: postgres://postgres:${PG_PASSWORD}@localhost:5432/{maqady_dev,maqady_test}"
