#!/bin/sh
# Creates the SQLite database on first start. The consent server does not
# create its own schema and exits if the file is missing, so a fresh clone
# (empty volume) needs this before the server runs.
set -e

DB=/opt/openfgc/repository/database/consent.db

if [ ! -f "$DB" ]; then
	echo "==> no consent.db found; applying dbscripts/db_schema_sqlite.sql"
	mkdir -p "$(dirname "$DB")"
	sqlite3 "$DB" < /opt/openfgc/dbscripts/db_schema_sqlite.sql
	echo "==> consent.db created"
fi

exec /opt/openfgc/consent-server "$@"
