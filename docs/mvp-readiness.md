# MVP readiness

Assessment date: 2026-08-18

## Decision

React Intelligence is ready for controlled, paid B2B pilots as a single-node self-hosted product. It is not presented as a multi-tenant SaaS or a compliance-certified enterprise platform.

Readiness: **93/100 for the defined pilot MVP**. The remaining seven points are customer-environment launch operations and later enterprise capabilities, not missing telemetry fundamentals.

## Launch gates

| Gate | Status | Evidence |
| --- | --- | --- |
| Useful product loop | Ready | React SDK collects privacy-bounded telemetry; dashboard supports overview, event exploration, error issues, performance, network, releases, alerts, and evidence-linked local AI. |
| Easy integration | Ready | Per-project write keys, copyable setup snippet, test event, connection status, packaged SDK verification, demo and vertical React → HTTP → SQLite smoke. |
| Access control | Ready | Runtime dashboard login, owner/member/viewer RBAC, project scopes, revocation, separate ingestion keys, audit log, no token in production dashboard assets. |
| Data safety | Ready | Client/server scrubbing, event and batch bounds, idempotency, retention, export/deletion, source-map limits, SQLite migrations, verified backup and restore. |
| Delivery reliability | Ready | Offline queue, reconnect/page-exit delivery, exponential backoff, quota-aware `Retry-After`, terminal auth/config failure handling, webhook retries and redirect refusal. Ingestion preparation, deduplication, quota enforcement, persistence, and accounting commit atomically. |
| Query scalability | Ready for the pilot envelope | Event exploration uses deterministic `(timestamp, id)` keyset pagination and composite indexes for time, release, environment, and session filters; unbounded all-at-once dashboard reads were removed. |
| Operations | Ready | Loopback-by-default Compose, non-root server container, cheap database-aware readiness, explicit owner-only integrity diagnostics, request IDs, authenticated metrics, graceful shutdown, and an upgrade/rollback runbook. |
| Supply chain | Ready | Frozen workspace lockfile, zero known production advisories, CI typecheck/test/build/audit plus SDK/package/server/Docker build gates. |
| Production UX | Ready | Production auth flow, overview with real stored data, route-level recovery UI, paginated event history, operations status, responsive navigation/tables, and mobile layout verified at 390 px without document overflow or console errors. |

## Pilot deployment checklist

Before admitting a customer:

1. Run `pnpm setup`; store the generated owner token and project keys in the customer's secret manager.
2. Terminate TLS at a trusted reverse proxy and keep the API/database host private where possible.
3. Set explicit origins and webhook hosts; do not expose the development credentials.
4. Configure an off-host daily backup and test a restore before onboarding production data.
5. Add host alerts for `/ready`, sustained `5xx`, disk capacity, webhook failures, and quota headroom.
6. Run `pnpm check`, deploy the pinned image/revision, then validate one SDK event, one paginated dashboard read, and the owner integrity check.
7. Agree retention, captured event classes, data ownership, support contact, and deletion/export process with the customer.

## Deliberately deferred after MVP

These are valuable only after pilots prove demand or a named buyer requires them:

- hosted multi-tenant control plane, PostgreSQL/object storage, horizontal ingestion and shared quotas;
- SAML/OIDC SSO, SCIM, organization hierarchy and fine-grained custom roles;
- billing, contracts automation, usage metering for invoicing and a customer-facing status page;
- formal SOC 2/ISO 27001 evidence, DPA templates and region-specific data residency;
- OpenTelemetry export, native Slack/Teams/PagerDuty integrations and broader framework SDKs;
- high-volume sampling, aggregation pipelines and long-term warehouse analytics;
- a full cross-browser end-to-end suite and automated disaster-recovery drills.

The stopping rule for this MVP is therefore met: no known issue blocks a private single-node B2B pilot, and further engineering would expand the target market rather than harden the core pilot loop.
