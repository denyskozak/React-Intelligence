# React Intelligence

React Intelligence is a privacy-first runtime analytics MVP for React applications. The same SDK can send telemetry to a managed endpoint (`remote`) or to a customer-controlled single-node deployment (`local`).

The repository contains:

- `@react-intelligence/sdk` — errors, named React profiler trees, network calls, performance entries, safe user actions, route changes, and custom events.
- `apps/server` — authenticated Fastify ingestion and analytics API with SQLite, rate limits, retention-ready event metadata, and optional Ollama analysis.
- `apps/dashboard` — a React Router dashboard for apps, events, errors, performance, network, and AI analysis.
- `apps/demo` and `apps/test-app` — telemetry producers for development and browser integration testing.

The product scope and acceptance criteria are documented in [docs/product-v2.md](docs/product-v2.md). The current launch decision, evidence, pilot checklist, and deliberate post-MVP boundary are in [docs/mvp-readiness.md](docs/mvp-readiness.md).

## Secure self-hosted start

Generate local credentials and launch the persistent stack:

```bash
pnpm setup
docker compose up --build -d
```

Open `http://localhost:5178` and enter the dashboard owner token printed by `pnpm setup`. The token is retained only in that browser tab; no administrative secret is compiled into the dashboard assets. The API listens on `http://localhost:4000`; SQLite lives in a named Docker volume. `pnpm setup` creates a mode-`0600`, gitignored `.env` and never overwrites an existing one.

Open **Connect app** to create a project. Its write key is returned once, together with a ready-to-copy SDK snippet and a test-event action that validates the ingestion key immediately. After the first SDK event, the project displays its SDK version and last connection time.

To include local Ollama:

```bash
docker compose --profile ai up --build -d
docker compose exec ollama ollama pull llama3.1
```

## Source development

The checked-in development credentials are scoped and only intended for a loopback-bound local server:

```bash
pnpm install
pnpm seed
pnpm dev:server
pnpm dev:dashboard
```

- dashboard: `http://localhost:5178`
- demo: `http://localhost:5179` via `pnpm dev:demo`
- test app: `http://localhost:5180` via `pnpm dev:test-app`
- API: `http://localhost:4000`

Defaults are `ri_dev_dashboard`, `ri_dev_demo`, and `ri_dev_test`. Set `RI_DASHBOARD_TOKEN`, `RI_PROJECTS_JSON`, `RI_READ_TOKENS_JSON`, and `RI_ALLOWED_ORIGINS` for a real deployment. `RI_AUTH_DISABLED=true` is for isolated debugging only.

Docker ports bind to loopback by default. Set `RI_API_BIND` or `RI_DASHBOARD_BIND` only when external exposure is intentional and protected by TLS/reverse-proxy controls. The server refuses public or cloud startup with development credentials, wildcard CORS, or disabled authentication.

## SDK integration

Configure before `createRoot` so early errors and the first explicitly profiled commit can be collected:

```tsx
import {
  configureReactIntelligence,
  IntelligenceProfiler,
  ReactIntelligenceProvider
} from "@react-intelligence/sdk";

const telemetry = {
  appId: "checkout-ui",
  endpoint: "https://intelligence.example.com",
  writeKey: import.meta.env.VITE_RI_WRITE_KEY,
  processingMode: "remote" as const,
  environment: "production",
  release: import.meta.env.VITE_RELEASE
};

configureReactIntelligence(telemetry);

createRoot(document.getElementById("root")!).render(
  <ReactIntelligenceProvider {...telemetry}>
    <IntelligenceProfiler id="Checkout">
      <Checkout />
    </IntelligenceProfiler>
  </ReactIntelligenceProvider>
);
```

Use multiple `IntelligenceProfiler` boundaries around important subtrees. Root profiling is opt-in with `profileRoot`; production React profiling still requires an appropriate React profiling build.

Custom events:

```ts
import { track } from "@react-intelligence/sdk";

track("checkout_started", { cartSize: 3, source: "product_page" });
```

Privacy defaults are conservative: console capture is off, click text and ARIA labels are scrubbed, URL query strings are removed, and sensitive key names are redacted both in the SDK and at ingestion. Request bodies, response bodies, cookies, storage, and input values are not collected.

The SDK keeps its own already-scrubbed pending queue in origin-local storage for up to 24 hours. It flushes again when the browser comes online and uses a keepalive request during `visibilitychange`/`pagehide`. Set `persistOfflineEvents: false` if a customer's policy forbids any telemetry persistence in the browser.

## Source maps

Upload a Vite/webpack source map with the same `appId` and `release` used by the SDK:

```bash
RI_ENDPOINT=http://localhost:4000 \
RI_WRITE_KEY=ri_dev_demo \
pnpm upload:sourcemap demo-app 1.2.3 dist/assets/index.js.map
```

Returned error events include `payload.symbolicatedStack` when a matching bundle and release are available. Source maps are capped at 10 MB and require the project's write key.

## Authentication model

- A write key belongs to exactly one project and can ingest events or upload its source maps.
- `RI_DASHBOARD_TOKEN` can read all projects in the deployment.
- `RI_READ_TOKENS_JSON`, for example `{"customer-token":["checkout-ui"]}`, creates project-scoped readers.
- `RI_DEPLOYMENT_MODE=cloud` refuses bundled development secrets at startup.

The **Access & audit** screen issues revocable `owner`, `member`, and `viewer` bearer tokens. Owners administer all projects and access tokens; members can analyze and manage alerts, retention, and keys for assigned projects; viewers are read-only. SDK write keys have their own lifecycle in each project's Settings screen and can be rotated independently from read access.

Dashboard access tokens are entered at runtime and stored in `sessionStorage`, so closing the tab ends the browser session. The production build contains no bearer token. `GET /api/auth/me` returns the current actor, role, and project scope for UI capability gating.

Administrative changes are recorded with actor, role, project, action, metadata, and timestamp. Project-scoped readers only see audit entries for their assigned projects.

## Usage and ingestion diagnostics

Every project has a monthly event quota (100,000 by default). Ingestion is rejected with HTTP 429 plus `Retry-After` before storage when a batch would cross the quota. Accepted/rejected event and byte counters are aggregated daily and exposed in Project Settings. Request-rate limits are isolated by hashed bearer credential, with an IP fallback for anonymous requests. This single-node enforcement is atomic at the application level; a future multi-node cloud data plane will require shared quota coordination.

## Data lifecycle

Each project has a 1–365 day retention window (30 days by default). Cleanup runs at startup and every six hours, removing expired events, orphaned sessions, and old AI analyses. The Connect app screen supports JSON export and confirmed telemetry deletion; CSV is also available through the API.

## Release comparison and alerts

The Releases screen compares two releases across error rate, p95 React render time, p95 fetch time, sessions, and network failures. Release totals use the selected time window; percentile diagnostics use the latest bounded sample.

The Alerts screen supports rules for error rate, p95 React render time, and network failures over a one-hour or 24-hour window. Rules can deliver signed open/resolved events to allowlisted webhook hosts. Delivery attempts and failures are visible in the dashboard and retried up to three times.

## Error triage

Browser and React errors are assigned a stable server-side fingerprint. The Errors screen tracks first/last seen, affected routes and releases, occurrence count, and `open`, `resolved`, or `ignored` status. A new occurrence automatically reopens a resolved or ignored issue, so regressions do not remain hidden. Status changes are RBAC-protected and audited.

Retried SDK batches are idempotent by event ID. Duplicate events do not consume the monthly quota and are shown separately in Project Settings.

Event ingestion and its quota/accounting updates commit atomically on SQLite. Event history is ordered and paginated by the stable `(timestamp, id)` cursor, backed by composite indexes for the primary project and filter paths.

## Evidence-based AI

AI requests send aggregated counts plus a relevance-ranked, bounded event sample. The model must return event IDs and affected routes for every finding. Responses are constrained by JSON Schema, validated again with Zod, and stored with confidence and limitations. The dashboard checks `/api/tags`, uses installed Ollama models, links evidence back to the Events Explorer, and displays analysis history.

## API

- `GET /health` and `GET /ready`
- `GET /api/auth/me`
- `GET /metrics` (owner token; Prometheus text or JSON through `Accept: application/json`)
- `GET /api/operations/integrity` (owner token; explicit SQLite integrity check)
- `GET|POST /api/projects`
- `GET /api/projects/:appId/connection`
- `PATCH /api/projects/:appId/retention`
- `PATCH /api/projects/:appId/quota`
- `GET /api/projects/:appId/ingestion`
- `GET|POST /api/projects/:appId/keys`
- `DELETE /api/projects/:appId/keys/:keyId`
- `GET /api/projects/:appId/export?format=json|csv`
- `DELETE /api/projects/:appId/data`
- `POST /api/events/batch`
- `GET /api/apps`
- `GET /api/apps/:appId/overview`
- `GET /api/apps/:appId/events`
- `GET /api/apps/:appId/errors`
- `GET /api/apps/:appId/issues?status=open|resolved|ignored|all`
- `PATCH /api/apps/:appId/issues/:issueId`
- `GET /api/apps/:appId/performance`
- `GET /api/apps/:appId/network`
- `POST /api/apps/:appId/source-maps`
- `POST /api/apps/:appId/analyze`
- `GET /api/apps/:appId/analyses`
- `GET /api/ai/status`
- `GET /api/apps/:appId/releases/compare`
- `GET|POST /api/apps/:appId/alerts`
- `DELETE /api/apps/:appId/alerts/:ruleId`
- `GET|POST /api/access-tokens`
- `DELETE /api/access-tokens/:tokenId`
- `GET /api/audit-log`

Read endpoints require `Authorization: Bearer <read-token>`. Ingestion and source map endpoints require `Authorization: Bearer <project-write-key>`.

## Verification

```bash
pnpm check
pnpm smoke:sdk
```

`pnpm check` runs typechecking, API/security/privacy/integration tests, production builds, an SDK tarball check, and a deployed-server startup smoke. `pnpm smoke:sdk` runs the React SDK → HTTP → SQLite vertical smoke alone. CI additionally blocks high-severity production dependency advisories and builds both Docker images.

Operational backup, restore, migration, upgrade, and rollback procedures are in [docs/operations.md](docs/operations.md).
