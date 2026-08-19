# Operations runbook

## Upgrade

1. Stop ingestion or put the reverse proxy into maintenance mode.
2. Create a verified online backup with `pnpm db:backup`.
3. Pull the new application version and run `pnpm install --frozen-lockfile`.
4. Start the server. Pending numbered migrations run transactionally before it accepts traffic.
5. Run `pnpm db:migrations`, then verify `/ready` and a project-scoped read.
6. Resume ingestion. Keep the pre-upgrade backup until the new version has been observed under normal traffic.

The service handles `SIGTERM`/`SIGINT` by stopping new work and closing Fastify before process exit. Container ports bind to `127.0.0.1` by default; external exposure should terminate TLS and forward only the required dashboard/API routes.

## Backup

```bash
pnpm db:backup
pnpm db:backup /absolute/path/react-intelligence.sqlite
```

The command uses SQLite's online backup API and runs `quick_check`. It refuses to overwrite an existing destination. Back up the database volume outside the host as part of the customer's normal backup policy.

## Restore

Stop the server before restore:

```bash
REACT_INTELLIGENCE_DB=/data/react-intelligence.sqlite \
  pnpm db:restore /backups/react-intelligence.sqlite
```

The restore command validates the backup and its migration history. If a target database exists, it first creates a timestamped safety backup. Start the server after restore and verify `/ready`.

## Rollback

Application rollback is safe only when the older version understands the latest applied schema. Otherwise stop the server and restore the backup made before upgrade. Database migrations in this MVP are forward-only.

## Health and metrics

- `GET /health` confirms the process is serving requests.
- `GET /ready` performs a lightweight database query and reports the applied schema version. Remove an instance from service on HTTP 503.
- `GET /api/operations/integrity` requires an owner token and runs SQLite `quick_check`; use it after restore/upgrade or from a low-frequency maintenance job, not as a frequent readiness probe.
- `GET /metrics` requires an owner bearer token and returns Prometheus text. Send `Accept: application/json` for the dashboard/operator JSON view.

Useful alerts for the single-node MVP are readiness failures, sustained `5xx` responses, ingestion rejections, failed webhook deliveries, disk growth, and a quota with less than 10% remaining. Metrics are process-local except database counts; they reset after restart.

## Webhook delivery

Set `RI_WEBHOOK_ALLOWED_HOSTS` to an explicit comma-separated host allowlist and configure a long random `RI_WEBHOOK_SIGNING_SECRET`. Payload signatures are sent in `x-react-intelligence-signature` as an HMAC SHA-256 digest. Failed deliveries are retained and retried once per minute, up to three attempts.
