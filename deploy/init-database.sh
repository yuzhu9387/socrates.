#!/bin/sh
set -eu
psql --username "$POSTGRES_USER" --dbname postgres --set=ON_ERROR_STOP=1 --set=app_password="$DATABASE_PASSWORD" <<'SQL'
CREATE ROLE socrates_app LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE socrates OWNER socrates_app ENCODING 'UTF8' TEMPLATE template0;
SQL
