# Google Cloud Run deployment

This runbook records the personal Socrates deployment and the commands used to operate it. Review commands before running them; creation commands are included for recovery and a future clean installation.

| Setting | Value |
| --- | --- |
| Google account | `yuzhu9387@gmail.com` |
| Project | `leonas-friends` |
| Region | `us-west2` |
| Cloud Run service | `socrates` |
| Runtime service account | `socrates-runtime@leonas-friends.iam.gserviceaccount.com` |
| Artifact Registry repository | `us-west2-docker.pkg.dev/leonas-friends/cloud-run-source-deploy` |
| Cloud SQL instance | `leonas-friends:us-west2:avery-db` |
| PostgreSQL database / role | `socrates` / `socrates_app` |
| Secret Manager secret | `socrates-database-url` |

As of 2026-09-09, revision `socrates-00001-m68` is Ready at [Socrates](https://socrates-314788321213.us-west2.run.app). It runs image tag `socrates:20260909-1` (digest `sha256:83da3425805ea06968d9395c2efd097ee5935612affe409577c82c4007762c62`) and pins database secret version `1`. The validated account data has been migrated. All ten cloud verification groups passed both before and after explicitly approved public browser access, with temporary accounts removed afterward. Library access still requires Socrates authentication.

The Cloud SQL **instance** is shared infrastructure. Socrates uses its own `socrates` database and restricted `socrates_app` login; that does not share tables, accounts, sessions, passwords, or API tokens with Avery. Socrates has its own authentication and is not Avery SSO. Do not grant `socrates_app` privileges on an Avery database or reuse an Avery application credential.

## Select the gcloud context

Use the existing named gcloud configuration so commands do not depend on another project's active settings:

```sh
gcloud --configuration=avery-personal config set account yuzhu9387@gmail.com
gcloud --configuration=avery-personal config set project leonas-friends
gcloud --configuration=avery-personal config set run/region us-west2
gcloud --configuration=avery-personal auth list
gcloud --configuration=avery-personal config list
```

If the account is not listed, run `gcloud --configuration=avery-personal auth login yuzhu9387@gmail.com` first. These commands select normal gcloud credentials; they do not change Application Default Credentials. Do not run `gcloud auth application-default login`, `revoke`, or `set-quota-project` for this deployment.

Enable the required APIs and verify the existing resources:

```sh
gcloud --configuration=avery-personal services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com
gcloud --configuration=avery-personal sql instances describe avery-db --format='value(connectionName,region,databaseVersion)'
gcloud --configuration=avery-personal artifacts repositories describe cloud-run-source-deploy --location=us-west2
```

The instance connection name must be `leonas-friends:us-west2:avery-db`. Stop if the project, region, or instance differs.

## Create the isolated database identity

Open a secure `psql` session to `avery-db` as an existing Cloud SQL administrator, preferably through the Cloud SQL Auth Proxy. Do not put the administrator password or new application password in shell history. In `psql`, create the runtime role and database once:

```sql
CREATE ROLE socrates_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
\password socrates_app
-- Replace bootstrap_admin_role with the current Cloud SQL administrator role.
GRANT socrates_app TO bootstrap_admin_role WITH SET TRUE;
CREATE DATABASE socrates OWNER socrates_app;
\connect socrates
SET ROLE socrates_app;
REVOKE ALL ON DATABASE socrates FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO socrates_app;
RESET ROLE;
REVOKE socrates_app FROM bootstrap_admin_role;
```

Cloud SQL administrators need the temporary membership above to assign the database to the restricted owner. Use `\password` so the plaintext password is not embedded in a SQL statement, and revoke the membership after setting the database permissions. Confirm that `socrates_app` is not a member of `cloudsqlsuperuser`, cannot create roles or databases, and has no grants on Avery's application tables or membership in Avery roles. Remove any temporary bootstrap database login after migration and validation.

## Create the runtime identity and database secret

Create the dedicated service account once, then give it only Cloud SQL connection access:

```sh
gcloud --configuration=avery-personal iam service-accounts create socrates-runtime --display-name='Socrates Cloud Run runtime'
gcloud --configuration=avery-personal projects add-iam-policy-binding leonas-friends --member='serviceAccount:socrates-runtime@leonas-friends.iam.gserviceaccount.com' --role='roles/cloudsql.client'
```

Create `socrates-database-url` once. Build the connection URL in a mode-600 temporary file; the following keeps the password out of command arguments and terminal output:

```sh
gcloud --configuration=avery-personal secrets create socrates-database-url --replication-policy=automatic
SECRET_FILE="$(mktemp)"
chmod 600 "$SECRET_FILE"
read -s 'SOCRATES_DB_PASSWORD?Password for socrates_app: '
export SOCRATES_DB_PASSWORD SECRET_FILE
node --input-type=module <<'NODE'
import { writeFileSync } from 'node:fs';
const url = new URL('postgresql:///socrates');
url.searchParams.set('host', '/cloudsql/leonas-friends:us-west2:avery-db');
url.searchParams.set('user', 'socrates_app');
url.searchParams.set('password', process.env.SOCRATES_DB_PASSWORD);
writeFileSync(process.env.SECRET_FILE, url.toString(), { mode: 0o600 });
NODE
unset SOCRATES_DB_PASSWORD
gcloud --configuration=avery-personal secrets versions add socrates-database-url --data-file="$SECRET_FILE"
rm -f "$SECRET_FILE"
unset SECRET_FILE
gcloud --configuration=avery-personal secrets add-iam-policy-binding socrates-database-url --member='serviceAccount:socrates-runtime@leonas-friends.iam.gserviceaccount.com' --role='roles/secretmanager.secretAccessor'
```

For an existing secret, skip `secrets create` and add a new version. Never use `gcloud secrets versions access` merely to inspect the URL, and never paste the password into `--set-env-vars`.

The deployer also needs permission to use the runtime service account. Grant the narrow `roles/iam.serviceAccountUser` binding to `user:yuzhu9387@gmail.com` if it is not already inherited. Cloud Build's build identity must have Artifact Registry write access to `cloud-run-source-deploy`; follow the project's existing IAM policy rather than granting broad editor access.

## Build the Docker image

Run from the repository root. `.gcloudignore` excludes Git data, environment files, local databases, backups, dumps, dependencies, generated runtime screenshots, test reports, and internal working files. Documentation screenshots under `docs/assets/screenshots` are intentional source files. Review the upload set before submitting it:

```sh
gcloud --configuration=avery-personal meta list-files-for-upload
```

Stop if that output contains `.env`, `deploy.env`, `.local`, `backups`, a dump, or credentials. Choose an immutable release identifier, then let Cloud Build use the checked-in `Dockerfile` and push to the existing repository:

```sh
RELEASE_ID='YYYYMMDD-HHMM-source-revision'
IMAGE_URI="us-west2-docker.pkg.dev/leonas-friends/cloud-run-source-deploy/socrates:${RELEASE_ID}"
gcloud --configuration=avery-personal builds submit --region=us-west2 --tag="$IMAGE_URI" .
```

Do not deploy a mutable local image or a source tree containing unreviewed secrets.

## Deploy privately, initialize, then open access

Use the canonical Cloud Run URL as the browser origin from the first process start:

```sh
SERVICE_URL='https://socrates-314788321213.us-west2.run.app'
```

Cloud Run also reports the legacy alias `https://socrates-dkfldaimlq-wl.a.run.app`. Keep `APP_ORIGIN` on the canonical URL above: Socrates validates browser origins exactly, so an alias is not interchangeable for browser requests.

Deploy the image privately with the Cloud SQL attachment and secret. `--port=3001` supplies Cloud Run's reserved `PORT=3001` environment variable; do not also set `PORT` with `--set-env-vars`.

```sh
gcloud --configuration=avery-personal run deploy socrates \
  --image="$IMAGE_URI" \
  --region=us-west2 \
  --execution-environment=gen2 \
  --service-account='socrates-runtime@leonas-friends.iam.gserviceaccount.com' \
  --set-cloudsql-instances='leonas-friends:us-west2:avery-db' \
  --set-secrets='DATABASE_URL=socrates-database-url:1' \
  --set-env-vars="HOST=0.0.0.0,NODE_ENV=production,TRUST_PROXY_HOPS=1,APP_ORIGIN=${SERVICE_URL}" \
  --port=3001 \
  --startup-probe='httpGet.path=/health/ready,httpGet.port=3001,periodSeconds=5,timeoutSeconds=3,failureThreshold=24' \
  --cpu=1 \
  --memory=1Gi \
  --concurrency=10 \
  --min-instances=0 \
  --max-instances=2 \
  --min=0 \
  --max=2 \
  --ingress=all \
  --no-allow-unauthenticated
```

Both instance flags and service-level `--min`/`--max` flags are intentional; together they keep the revision and service scaling ceiling at two instances.

The app runs migrations transactionally, under an advisory lock, before it listens. Keep the service private while forcing startup, checking readiness, and initializing data. First grant only the owner permission to invoke it:

```sh
gcloud --configuration=avery-personal run services add-iam-policy-binding socrates --region=us-west2 --member='user:yuzhu9387@gmail.com' --role='roles/run.invoker'
ID_TOKEN="$(gcloud --configuration=avery-personal auth print-identity-token)"
curl --fail-with-body --silent --show-error -H "X-Serverless-Authorization: Bearer ${ID_TOKEN}" "${SERVICE_URL}/api/v1/health/ready"
```

Use `X-Serverless-Authorization` for Cloud Run IAM because Socrates reserves `Authorization` for its own API tokens. A ready response is `{"status":"ready"}`. Migration failures appear in Cloud Run logs and must be resolved before proceeding.

For a genuinely empty installation, create its first Socrates account while the service remains private. Set `ACCOUNT_EMAIL` to the intended Socrates login; it need not match the Google deployment account. The password stays in a temporary mode-600 request body instead of shell history:

```sh
SETUP_FILE="$(mktemp)"
chmod 600 "$SETUP_FILE"
read -s 'SOCRATES_ACCOUNT_PASSWORD?New Socrates password (12+ characters): '
read 'ACCOUNT_EMAIL?Socrates account email: '
export SOCRATES_ACCOUNT_PASSWORD SETUP_FILE ACCOUNT_EMAIL
node --input-type=module <<'NODE'
import { writeFileSync } from 'node:fs';
writeFileSync(process.env.SETUP_FILE, JSON.stringify({
  email: process.env.ACCOUNT_EMAIL,
  password: process.env.SOCRATES_ACCOUNT_PASSWORD,
}), { mode: 0o600 });
NODE
unset SOCRATES_ACCOUNT_PASSWORD ACCOUNT_EMAIL
curl --fail-with-body --silent --show-error \
  -H "X-Serverless-Authorization: Bearer ${ID_TOKEN}" \
  -H "Origin: ${SERVICE_URL}" \
  -H 'X-Socrates-CSRF: 1' \
  -H 'Content-Type: application/json' \
  --data-binary "@${SETUP_FILE}" \
  "${SERVICE_URL}/api/v1/auth/setup"
rm -f "$SETUP_FILE"
unset SETUP_FILE ID_TOKEN
```

The current deployment used a validated snapshot instead of first-account setup. Import snapshots only into an empty `socrates` database, retain the source copy, exclude `sessions` and `idempotency_records` so deployment starts with a fresh sign-in, and compare all persisted table counts and content digests before accepting the migration. Local and cloud databases are independent copies; there is no automatic synchronization.

Only after readiness and either first-account setup or migrated-data validation succeed, and after explicitly approving public browser access, make the website invocable without Google IAM credentials:

```sh
gcloud --configuration=avery-personal run services add-iam-policy-binding socrates --region=us-west2 --member='allUsers' --role='roles/run.invoker'
curl --fail-with-body --silent --show-error "${SERVICE_URL}/api/v1/health/ready"
```

Open `SERVICE_URL`, sign in with the Socrates account stored in that database, and verify a note, map save, page reload, and sign-out. Public Cloud Run invocation exposes only the Socrates HTTPS application; it does not make Cloud SQL public or bypass Socrates login.

## Routine operation

Read recent logs and errors without printing secrets:

```sh
gcloud --configuration=avery-personal run services logs read socrates --region=us-west2 --limit=100
gcloud --configuration=avery-personal logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="socrates" AND severity>=ERROR' --limit=50 --format='table(timestamp,severity,textPayload)'
```

Check `/api/v1/health/live` for the process and `/api/v1/health/ready` for database access. With two instances, the application can open up to two Node PostgreSQL pools; confirm the Cloud SQL connection budget before increasing `--max-instances` or concurrency.

The deployed gen2 direct-ingress proxy behavior was verified before opening the service: Cloud Run appended the real caller address to `X-Forwarded-For`, including when a caller supplied that header. With `TRUST_PROXY_HOPS=1`, Socrates selected the Cloud Run-added caller address for rate limiting. Recheck the hop count if adding a load balancer or another ingress path.

For an upgrade, take a Socrates-only database dump, build a new immutable image tag, and deploy it with the same service account, Cloud SQL attachment, secret, environment, and resource limits. The startup migration lock protects concurrent starts. Never edit an applied migration.

To roll back application traffic, list revisions, choose a known previously healthy revision, and route 100% to that exact name:

```sh
gcloud --configuration=avery-personal run revisions list --service=socrates --region=us-west2
KNOWN_GOOD_REVISION='socrates-00000-abc'
gcloud --configuration=avery-personal run services update-traffic socrates --region=us-west2 --to-revisions="${KNOWN_GOOD_REVISION}=100"
```

A code rollback does not reverse a database migration. Route to an older revision only when its code is compatible with the current schema; otherwise restore into a new database and validate before switching.

## Socrates-only backup and restore

The existing Cloud SQL automated-backup policy predates Socrates and covers the whole `avery-db` instance; this runbook does not create or change that schedule. For application-level recovery, run Cloud SQL Auth Proxy locally and dump only the `socrates` database with a compatible `pg_dump`:

```sh
CSQL_PROXY_TOKEN="$(gcloud --configuration=avery-personal auth print-access-token)" \
  cloud-sql-proxy leonas-friends:us-west2:avery-db --address=127.0.0.1 --port=5433
```

This uses the selected personal account without changing Application Default Credentials. Restart the proxy with a fresh token for sessions longer than the token lifetime. In a second terminal:

```sh
umask 077
read -s 'PGPASSWORD?Password for socrates_app: '
export PGPASSWORD
BACKUP_FILE="socrates-YYYYMMDD-HHMM.dump"
pg_dump --host=127.0.0.1 --port=5433 --username=socrates_app --dbname=socrates --format=custom --no-owner --no-acl --file="$BACKUP_FILE"
unset PGPASSWORD
chmod 600 "$BACKUP_FILE"
pg_restore --list "$BACKUP_FILE"
```

The dump contains Socrates content, password hashes, sessions, and API-token hashes. Store it privately with an explicit retention policy.

Restore only into a **new empty database**, such as `socrates_restore_YYYYMMDD`, created by the Cloud SQL administrator and owned by `socrates_app`:

```sh
read -s 'PGPASSWORD?Password for socrates_app: '
export PGPASSWORD
pg_restore --host=127.0.0.1 --port=5433 --username=socrates_app --dbname=socrates_restore_YYYYMMDD --no-owner --no-acl --exit-on-error --single-transaction "$BACKUP_FILE"
unset PGPASSWORD
```

Verify login, notes, tags, map revisions, card geometry, and connections against the restored database before creating a separate test secret or deliberately switching `DATABASE_URL`. Never restore over the live `socrates` database and never restore a Socrates dump into an Avery database.

## Google references

- [Build a container with Cloud Build](https://cloud.google.com/run/docs/building/containers)
- [Deploy container images to Cloud Run](https://cloud.google.com/run/docs/deploying)
- [Connect Cloud Run to Cloud SQL for PostgreSQL](https://cloud.google.com/sql/docs/postgres/connect-run)
- [Configure Secret Manager secrets for Cloud Run](https://cloud.google.com/run/docs/configuring/services/secrets)
- [Invoke a private Cloud Run service](https://cloud.google.com/run/docs/authenticating/service-to-service)
- [Manage Cloud Run access](https://cloud.google.com/run/docs/securing/managing-access)
- [Roll back Cloud Run traffic](https://cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration)
