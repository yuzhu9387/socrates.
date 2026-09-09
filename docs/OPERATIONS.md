# Operations

## Local runtime

`npm run setup` prepares a dedicated local PostgreSQL cluster and an app build. `npm start` runs the HTTP server in the foreground. Stop it with Ctrl-C; database data remains under `.local/postgres`. `npm run db:stop` shuts down only this app's dedicated cluster.

The local cluster uses SCRAM authentication and listens on 127.0.0.1:55439. The application role is not a superuser and cannot create roles/databases. The database admin credential is stored in `.local/postgres-admin.json`; app configuration is `.env`. Both are local files with mode 600. Do not commit them, serve the repository directory, or expose PostgreSQL to the public network.

## Docker Compose

Create a separate Compose environment file, e.g. `deploy.env`, with random URL-safe hex passwords:

```dotenv
POSTGRES_PASSWORD=<random-admin-password>
DATABASE_PASSWORD=<different-random-app-password>
APP_ORIGIN=http://127.0.0.1:3001
NODE_ENV=development
```

```sh
docker compose --env-file deploy.env up --build -d
docker compose --env-file deploy.env logs --tail=50 app
```

The database is private to the Compose network and persists in the `postgres_data` volume. Its initialization script creates a separate non-superuser application role. App port 3001 binds only to localhost. Do not use `down -v` on a database whose data you want to retain. Changing the password environment variables after the volume is initialized does not rotate PostgreSQL passwords.

For remote hosting, use `APP_ORIGIN=https://notes.your-domain`, `NODE_ENV=production`, and an HTTPS reverse proxy such as the configuration in `deploy/Caddyfile.example`. Complete first-account setup before exposing the service. Secure cookies require HTTPS; the configured origin is checked on browser mutations. Do not use the prototype dev server as the public application server.

## Migrations and upgrades

`npm run migrate` uses a transaction and an advisory lock. Applied SQL migration checksums are recorded. Never edit an already applied migration; add a new numbered SQL file. The app also runs migrations before listening. Take a backup before upgrading and test restores independently before changing a production instance.

## Backups

For a full PostgreSQL dump with PostgreSQL tools installed:

```sh
npm run backup:db
```

The script uses `pg_dump --format=custom --no-owner --no-acl`; backup files are mode 600 in `backups/`. Dumps contain user content and authentication data. The command requires a `pg_dump` version compatible with the server. A browser `.socrates.zip` backup is useful for content portability but does not include account sessions or API credentials.

Restore a database dump into a **new empty database**, never silently over an active app:

```sh
pg_restore --no-owner --no-acl --dbname=<new-database-connection> backups/<file>.dump
```

Verify account access, notes, map revisions, tags and connection geometry against the restored database before switching `DATABASE_URL`. Schedule and retain backups using your host's backup facilities; this repository does not claim an automatic offsite backup schedule or measured recovery SLA.

## Add an account or reset a password

Use the local administrative CLI with database access. It does not add a public signup route. Provide the new password through an environment variable rather than a command-line argument. For example, in zsh:

```sh
read -s 'SOCRATES_ACCOUNT_PASSWORD?New password: '
export SOCRATES_ACCOUNT_PASSWORD
node --env-file=.env server/src/cli.mjs user:create user@example.com
unset SOCRATES_ACCOUNT_PASSWORD
```

Use `user:password` instead of `user:create` to reset an existing account. Password reset revokes all existing sessions and API tokens for that account. Email delivery and self-service reset are not configured.

## Health and limits

`GET /api/v1/health/live` checks the HTTP process. `GET /api/v1/health/ready` checks database access. API errors return codes without logging note text or credentials. Run only a deployment configuration you have verified; Docker/cloud deployment is separate from the tested local runtime.

Body and graph-size limits are validated. The initial compatibility service loads the personal workspace projection and replaces mutable relation rows within a transaction. That provides straightforward integrity but is not a scale benchmark. Use the performance results for the existing whiteboard as interaction evidence, not as a guarantee of server throughput.
