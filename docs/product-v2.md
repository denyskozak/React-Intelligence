# React Intelligence V2 product contract

## Initial customer profile

The private MVP is for React SaaS teams with roughly 3–30 engineers that ship frequently, need to diagnose frontend regressions, and prefer either managed ingestion or keeping telemetry in their own infrastructure.

The primary job is: **identify which release, route, request, or React subtree caused a production regression, with evidence that an engineer can inspect.**

The target time-to-first-value is 15 minutes from installing the SDK to seeing a real event in the dashboard.

## Deployment modes

Both modes use the same SDK and HTTP contract:

- `remote`: the SDK sends events to a React Intelligence managed endpoint.
- `local`: the SDK sends events to a customer-controlled server. The supported MVP topology is a single Docker Compose deployment with persistent SQLite storage and optional local Ollama.

`RI_DEPLOYMENT_MODE=cloud` enables stricter startup validation and rejects bundled development credentials. Hosted multi-node storage is intentionally outside this repository's current production guarantee; Postgres support is the next control-plane milestone.

## Security boundaries

- SDK write keys are scoped to one project and cannot read telemetry.
- The owner dashboard token can read all local projects.
- Additional read tokens can be scoped to explicit project IDs with `RI_READ_TOKENS_JSON`.
- Browser origins, request rate, body size, batch size, strings, and query values are bounded.
- Sensitive fields are scrubbed in the SDK and again at ingestion.
- `RI_AUTH_DISABLED=true` exists only for isolated development and must never be used on an exposed server.

## MVP acceptance criteria

- A new project can ingest its first event in under 15 minutes.
- A key for project A cannot write or read project B.
- Telemetry delivery failures never break the host React application.
- Click text and console capture are disabled or scrubbed by default.
- Errors can be tied to a release and symbolicated with an uploaded source map.
- React costs can be attributed to explicitly named subtrees with `IntelligenceProfiler`.
- A clean checkout passes typecheck, integration tests, and production builds.
- The self-hosted data volume survives container replacement.
- A dashboard owner can create a project and receive a one-time write key without editing server configuration.
- Connection status identifies whether the SDK has sent an event and which SDK version was last observed.
- Every project has bounded retention, JSON/CSV export, and confirmed deletion of its telemetry-derived data.
- AI findings contain validated evidence event IDs, confidence, limitations, and persisted run history.
- Two releases can be compared using consistent error, network, and React-render semantics.
- Threshold rules create and resolve in-dashboard incidents without requiring an external notification provider.
- Write keys and dashboard access tokens are revocable, role-scoped credentials with one-time secret display.
- Monthly usage limits reject over-quota ingestion before storage and expose accepted/rejected diagnostics.
- Alert incidents can be delivered through allowlisted, HMAC-signed webhooks with durable delivery history.
- Administrative mutations produce a project-filtered audit trail.
- SQLite schema changes are numbered and transactional; verified backup/restore and an upgrade runbook are available.
- Scrubbed SDK events survive short offline periods and flush on reconnect without breaking the host application.
- Retried batches are idempotent by event ID and duplicates neither inflate analytics nor consume quota.
- Errors have stable fingerprints and an audited open/resolved/ignored workflow that reopens on recurrence.
- Readiness verifies SQLite integrity and schema version; owner-only Prometheus/JSON metrics expose operational health.
- CI exercises a real React provider through the SDK, HTTP ingestion, and SQLite persistence.
- Dashboard credentials are entered at runtime, scoped by role, kept only for the browser-tab session, and absent from production JavaScript assets.
- Public/cloud startup fails closed for disabled auth, development secrets, and wildcard CORS.
- The published SDK artifact and minimal deployed server runtime are smoke-tested independently from the monorepo.
